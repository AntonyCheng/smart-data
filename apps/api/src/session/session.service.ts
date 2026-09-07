import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenCodeService } from '../opencode/opencode.service';
import { IdentityService } from '../common/identity.service';
import { WorkspaceService } from '../common/workspace.service';
import { ApiError, ApiErrorCode, ExecutionStatus } from '../common/errors';
import { SessionView } from './session.types';
import { inferAnalysisCategory } from './analysis-category';

type SessionMode = 'operate' | 'report';

function normalizeMode(value: unknown): SessionMode | undefined {
  return value === 'operate' || value === 'report' ? value : undefined;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opencode: OpenCodeService,
    private readonly identity: IdentityService,
    private readonly workspace: WorkspaceService,
  ) {}

  /** 创建业务会话 → OpenCode 会话 → 保存映射（opencode id 永不返回前端）。 */
  async create(title?: string, mode?: unknown): Promise<SessionView> {
    const { tenantId, userId } = this.identity.getIdentity();
    const row = await this.prisma.aiSession.create({
      data: {
        tenantId,
        userId,
        title: title?.trim() || '新任务',
        status: 'PENDING',
        mode: normalizeMode(mode) ?? 'operate',
      },
    });
    try {
      const oc = await this.opencode.createSession({
        title: row.title,
        permission: this.workspace.sessionPermissionRuleset(tenantId, row.id),
      });
      const updated = await this.prisma.aiSession.update({
        where: { id: row.id },
        data: { opencodeSessionId: oc.id, status: 'ACTIVE' },
      });
      return this.toView(updated);
    } catch {
      await this.prisma.aiSession.delete({ where: { id: row.id } }).catch(() => undefined);
      throw new ApiError(ApiErrorCode.AGENT_RUNTIME_UNAVAILABLE, 'OpenCode 运行时不可用', 503);
    }
  }

  async list(): Promise<SessionView[]> {
    const { tenantId, userId } = this.identity.getIdentity();
    const [rows, activeExecutions] = await Promise.all([
      this.prisma.aiSession.findMany({
        where: { tenantId, userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.aiExecution.findMany({
        where: {
          tenantId,
          status: { in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING] },
          session: { userId, deletedAt: null },
        },
        distinct: ['sessionId'],
        select: { sessionId: true },
      }),
    ]);
    const runningSessionIds = new Set(activeExecutions.map((execution) => execution.sessionId));
    return rows.map((row) => this.toView(row, runningSessionIds.has(row.id)));
  }

  async get(id: string): Promise<SessionView> {
    const row = await this.findOwned(id);
    return this.toView(row, await this.isRunning(row.id));
  }

  async patch(id: string, title?: string, mode?: unknown): Promise<SessionView> {
    const row = await this.findOwned(id);
    const nextMode = normalizeMode(mode);
    if (title === undefined && nextMode === undefined) return this.toView(row);
    const updated = await this.prisma.aiSession.update({
      where: { id: row.id },
      data: {
        ...(title !== undefined ? { title: title.trim() || row.title } : {}),
        ...(nextMode ? { mode: nextMode } : {}),
      },
    });
    if (row.opencodeSessionId && title !== undefined && updated.title !== row.title) {
      await this.opencode.patchSession(row.opencodeSessionId, updated.title).catch(() => undefined);
    }
    return this.toView(updated, await this.isRunning(updated.id));
  }

  /** DB 软删除；OpenCode 尽力删除；清理磁盘工作区与已失效的成果记录。 */
  async remove(id: string): Promise<void> {
    const row = await this.findOwned(id);
    await this.prisma.aiSession.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    if (row.opencodeSessionId) {
      await this.opencode.deleteSession(row.opencodeSessionId).catch(() => undefined);
    }
    this.workspace.removeSessionWorkspace(row.tenantId, row.id);
    // 成果文件已随工作区目录删除，对应的成果记录也一并清掉（无恢复路径）。
    await this.prisma.aiArtifact.deleteMany({ where: { sessionId: row.id } }).catch(() => undefined);
  }

  private async findOwned(id: string) {
    const { tenantId, userId } = this.identity.getIdentity();
    const row = await this.prisma.aiSession.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
    });
    if (!row) throw new ApiError(ApiErrorCode.SESSION_NOT_FOUND, '任务不存在', 404);
    return row;
  }

  private async isRunning(sessionId: string): Promise<boolean> {
    return Boolean(await this.prisma.aiExecution.findFirst({
      where: {
        sessionId,
        status: { in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING] },
      },
      select: { id: true },
    }));
  }

  private toView(r: {
    id: string;
    title: string;
    status: string;
    mode: string;
    metricProfileId?: string | null;
    categoryPrimary?: string | null;
    categorySecondary?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }, running = false): SessionView {
    const inferred = inferAnalysisCategory(r.title);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      running,
      mode: r.mode === 'report' ? 'report' : 'operate',
      metricProfileId: r.metricProfileId ?? null,
      categoryPrimary: r.categoryPrimary || inferred.primary,
      categorySecondary: r.categorySecondary || inferred.secondary,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
