import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../common/identity.service';
import { WorkspaceService } from '../common/workspace.service';
import { ApiError, ApiErrorCode } from '../common/errors';

export interface ArtifactView {
  id: string;
  name: string;
  relativePath: string;
  mediaType: string;
  size: number;
  createdAt: Date;
}

const MEDIA_TYPES: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const EXCEL_EXT = new Set(['.xlsx', '.xlsm']);

/** 分析过程的中间/缓存文件，huashu-excel 常写在 output/ 下，不是交付物。 */
const SCRATCH_EXT = new Set(['.pkl', '.pickle', '.npy', '.npz', '.parquet', '.feather', '.log', '.tmp', '.bak', '.lock']);

/**
 * 只有这些扩展名会被登记为成果，其余（含无扩展名）一律忽略。
 * huashu-excel 的中间产物多为 _clean.pkl / _results.json 这类下划线开头的文件，
 * 由 isDeliverable() 的前缀规则拦掉；模型显式命名并在答复里引用的 summary.json 予以保留。
 */
const DELIVERABLE_EXT = new Set([
  '.xlsx', '.xlsm', '.csv', '.html', '.htm', '.md', '.txt', '.json', '.pdf', '.docx', '.png', '.jpg', '.jpeg', '.svg',
]);

function mediaTypeFor(name: string): string {
  return MEDIA_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/** 隐藏文件、下划线开头的内部文件、以及非交付类扩展名都不算成果。 */
function isDeliverable(base: string): boolean {
  if (base.startsWith('.') || base.startsWith('_') || base.startsWith('~')) return false;
  const ext = path.extname(base).toLowerCase();
  if (SCRATCH_EXT.has(ext)) return false;
  return DELIVERABLE_EXT.has(ext);
}

/**
 * 成果登记：扫 workspaces/<tenant>/<session>/output/ 下所有非隐藏文件，
 * 按 relativePath upsert 到 ai_artifact（用 size + mtime 判断更新）。
 * 成果由 model 写盘，不由 model 显式注册（防路径注入）。
 */
@Injectable()
export class ArtifactService {
  private readonly logger = new Logger(ArtifactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly workspace: WorkspaceService,
  ) {}

  /** 扫描 output/ 并返回本次新增或更新的成果（供 SSE 推送）。 */
  async register(tenantId: string, sessionId: string): Promise<ArtifactView[]> {
    const outputDir = this.workspace.outputDir(tenantId, sessionId);
    if (!fs.existsSync(outputDir)) return [];

    const sessionRoot = this.workspace.sessionRoot(tenantId, sessionId);
    const known = await this.prisma.aiArtifact.findMany({ where: { tenantId, sessionId } });
    const knownByPath = new Map(known.map((row) => [row.relativePath, row]));
    const changed: ArtifactView[] = [];

    for (const abs of walk(outputDir)) {
      const base = path.basename(abs);
      if (!isDeliverable(base)) continue;
      const stat = fs.statSync(abs);
      if (!stat.isFile()) continue;
      const relativePath = path.relative(sessionRoot, abs).split(path.sep).join('/');
      const existing = knownByPath.get(relativePath);

      if (existing) {
        if (Number(existing.size) === stat.size && existing.updatedAt.getTime() >= stat.mtimeMs) continue;
        const updated = await this.prisma.aiArtifact.update({
          where: { id: existing.id },
          data: { name: base, mediaType: mediaTypeFor(base), size: BigInt(stat.size) },
        });
        changed.push(this.toView(updated));
        continue;
      }

      const created = await this.prisma.aiArtifact.create({
        data: {
          tenantId,
          sessionId,
          name: base,
          relativePath,
          mediaType: mediaTypeFor(base),
          size: BigInt(stat.size),
        },
      });
      changed.push(this.toView(created));
    }

    // 清理：模型收尾时删掉的中间文件、或早先被误登记的非交付文件。
    const staleIds = known
      .filter((row) => {
        const abs = path.resolve(sessionRoot, row.relativePath);
        return !isDeliverable(path.basename(abs)) || !fs.existsSync(abs);
      })
      .map((row) => row.id);
    if (staleIds.length) {
      await this.prisma.aiArtifact.deleteMany({ where: { id: { in: staleIds } } });
    }

    return changed;
  }

  async list(sessionId: string): Promise<ArtifactView[]> {
    const session = await this.findOwnedSession(sessionId);
    await this.register(session.tenantId, session.id).catch((cause) => {
      this.logger.warn(`成果扫描失败 ${sessionId}: ${(cause as Error).message}`);
    });
    const rows = await this.prisma.aiArtifact.findMany({
      where: { tenantId: session.tenantId, sessionId: session.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toView(row));
  }

  async isExcel(id: string): Promise<boolean> {
    const row = await this.findOwned(id);
    return EXCEL_EXT.has(path.extname(row.name).toLowerCase());
  }

  async resolve(id: string) {
    const row = await this.findOwned(id);
    const sessionRoot = this.workspace.sessionRoot(row.tenantId, row.sessionId);
    const abs = path.resolve(sessionRoot, row.relativePath);
    const root = `${path.resolve(sessionRoot)}${path.sep}`;
    if (!abs.startsWith(root) || !fs.existsSync(abs)) {
      throw new ApiError(ApiErrorCode.FILE_NOT_FOUND, '成果不存在', 404);
    }
    return { abs, name: row.name, mediaType: row.mediaType, size: Number(row.size) };
  }

  private async findOwnedSession(sessionId: string) {
    const { tenantId, userId } = this.identity.getIdentity();
    const row = await this.prisma.aiSession.findFirst({
      where: { id: sessionId, tenantId, userId, deletedAt: null },
    });
    if (!row) throw new ApiError(ApiErrorCode.SESSION_NOT_FOUND, '任务不存在', 404);
    return row;
  }

  private async findOwned(id: string) {
    const { tenantId } = this.identity.getIdentity();
    const row = await this.prisma.aiArtifact.findFirst({ where: { id, tenantId } });
    if (!row) throw new ApiError(ApiErrorCode.FILE_NOT_FOUND, '成果不存在', 404);
    return row;
  }

  private toView(r: {
    id: string; name: string; relativePath: string; mediaType: string; size: bigint; createdAt: Date;
  }): ArtifactView {
    return {
      id: r.id,
      name: r.name,
      relativePath: r.relativePath,
      mediaType: r.mediaType,
      size: Number(r.size),
      createdAt: r.createdAt,
    };
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
