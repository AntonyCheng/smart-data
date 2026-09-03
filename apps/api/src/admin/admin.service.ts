import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as fs from 'node:fs';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../common/identity.service';
import { ApiError, ApiErrorCode, ExecutionStatus } from '../common/errors';
import { WorkspaceService } from '../common/workspace.service';
import { OpenCodeService } from '../opencode/opencode.service';
import { inferAnalysisCategory } from '../session/analysis-category';
import { AdminStatsView, AdminUserView, CreateAdminUserDto, ResetAdminUserPasswordView } from './admin.types';

const TOKEN_TREND_DAYS = 14;
const CHINA_MOBILE = /^1[3-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly workspace: WorkspaceService,
    private readonly opencode: OpenCodeService,
  ) {}

  async listUsers(): Promise<AdminUserView[]> {
    const { tenantId } = this.assertAdmin();
    const users = await this.prisma.sysUser.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { sessions: { where: { deletedAt: null } } } } },
    });
    return users.map((user) => ({
      id: user.id,
      account: user.phone || user.email || '未设置账号',
      name: user.name ?? undefined,
      role: user.role === 'admin' ? 'admin' : 'user',
      status: user.deletedAt ? 'disabled' : 'active',
      sessionCount: user._count.sessions,
      lastLoginAt: user.lastLoginAt ?? undefined,
      createdAt: user.createdAt,
    }));
  }

  async createUser(dto: CreateAdminUserDto): Promise<AdminUserView> {
    const { tenantId } = this.assertAdmin();
    const account = dto?.account?.trim().toLowerCase() ?? '';
    const name = dto?.name?.trim().replace(/\s+/g, ' ') ?? '';
    const password = dto?.password ?? '';
    if (!account || (!EMAIL.test(account) && !CHINA_MOBILE.test(account))) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '请输入有效的邮箱或中国大陆手机号');
    }
    if (!name || name.length > 30) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '请输入 1 至 30 个字符的用户名');
    }
    if (password.length < 8 || password.length > 64) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '密码长度需为 8 至 64 位');
    }
    const existing = await this.prisma.sysUser.findFirst({
      where: { OR: [{ email: account }, { phone: account }] },
    });
    if (existing) throw new ApiError(ApiErrorCode.BAD_REQUEST, '该邮箱或手机号已经存在');
    const user = await this.prisma.sysUser.create({
      data: {
        tenantId,
        email: EMAIL.test(account) ? account : undefined,
        phone: CHINA_MOBILE.test(account) ? account : undefined,
        name,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'user',
      },
    });
    const users = await this.listUsers();
    return users.find((item) => item.id === user.id)!;
  }

  async updateUserStatus(userId: string, status: string | undefined): Promise<AdminUserView> {
    const { tenantId, userId: currentUserId } = this.assertAdmin();
    if (status !== 'active' && status !== 'disabled') {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '用户状态无效');
    }
    const user = await this.prisma.sysUser.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new ApiError(ApiErrorCode.BAD_REQUEST, '用户不存在', 404);
    if (user.id === currentUserId || user.role === 'admin') {
      throw new ApiError(ApiErrorCode.FORBIDDEN, '内置管理员账号不能被停用', 403);
    }
    await this.prisma.sysUser.update({
      where: { id: user.id },
      data: { deletedAt: status === 'disabled' ? new Date() : null },
    });
    const refreshed = await this.listUsers();
    return refreshed.find((item) => item.id === user.id)!;
  }

  async resetUserPassword(userId: string, newPassword: string | undefined): Promise<ResetAdminUserPasswordView> {
    const { tenantId } = this.assertAdmin();
    const user = await this.prisma.sysUser.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new ApiError(ApiErrorCode.BAD_REQUEST, '用户不存在', 404);
    if (!newPassword || newPassword.length < 8 || newPassword.length > 64) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '新密码长度需为 8 至 64 位');
    }
    await this.prisma.sysUser.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    return { reset: true };
  }

  async removeUser(userId: string): Promise<void> {
    const { tenantId } = this.assertAdmin();
    const user = await this.prisma.sysUser.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new ApiError(ApiErrorCode.BAD_REQUEST, '用户不存在', 404);

    const sessions = await this.prisma.aiSession.findMany({
      where: { tenantId, userId: user.id },
      select: { id: true, opencodeSessionId: true },
    });
    const sessionIds = sessions.map((session) => session.id);
    if (sessionIds.length) {
      const activeExecutions = await this.prisma.aiExecution.count({
        where: { sessionId: { in: sessionIds }, status: { in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING] } },
      });
      if (activeExecutions) {
        throw new ApiError(ApiErrorCode.SESSION_BUSY, '该用户还有正在处理的任务，请稍后再删除', 409);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (sessionIds.length) {
        await tx.aiExecution.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.aiArtifact.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.aiFile.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.aiMessage.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.aiSession.deleteMany({ where: { id: { in: sessionIds } } });
      }
      await tx.sysUser.delete({ where: { id: user.id } });
    });

    for (const session of sessions) {
      if (session.opencodeSessionId) {
        await this.opencode.deleteSession(session.opencodeSessionId).catch(() => undefined);
      }
      fs.rmSync(this.workspace.sessionRoot(tenantId, session.id), { recursive: true, force: true });
    }
  }

  async stats(): Promise<AdminStatsView> {
    const { tenantId } = this.assertAdmin();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfTrend = new Date(startOfDay);
    startOfTrend.setDate(startOfTrend.getDate() - (TOKEN_TREND_DAYS - 1));

    const [
      totalUsers, activeUsers, dailyActiveUsers, sessions,
      tokenTotals, todayTokenTotals, recentExecutions, recentUserMessages, artifactCount,
    ] = await Promise.all([
      this.prisma.sysUser.count({ where: { tenantId } }),
      this.prisma.sysUser.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.sysUser.count({ where: { tenantId, deletedAt: null, lastLoginAt: { gte: startOfDay } } }),
      this.prisma.aiSession.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          title: true,
          categoryPrimary: true,
          categorySecondary: true,
          createdAt: true,
          userId: true,
          user: { select: { name: true, phone: true, email: true } },
        },
      }),
      this.prisma.aiExecution.aggregate({
        where: { tenantId, status: ExecutionStatus.COMPLETED },
        _sum: { inputTokens: true, outputTokens: true, artifactCount: true },
      }),
      this.prisma.aiExecution.aggregate({
        where: { tenantId, status: ExecutionStatus.COMPLETED, completedAt: { gte: startOfDay } },
        _sum: { inputTokens: true, outputTokens: true, artifactCount: true },
      }),
      this.prisma.aiExecution.findMany({
        where: { tenantId, status: ExecutionStatus.COMPLETED, completedAt: { gte: startOfTrend } },
        select: { completedAt: true, inputTokens: true, outputTokens: true },
        orderBy: { completedAt: 'asc' },
      }),
      this.prisma.aiMessage.findMany({
        where: { tenantId, role: 'user', createdAt: { gte: startOfTrend }, session: { deletedAt: null } },
        select: { createdAt: true, session: { select: { userId: true } } },
      }),
      this.prisma.aiArtifact.count({ where: { tenantId } }),
    ]);

    const categoryCounts = new Map<string, number>();
    const commandCounts = new Map<string, number>();
    const userSessionCounts = new Map<string, { name: string; account: string; count: number }>();
    for (const session of sessions) {
      const inferred = inferAnalysisCategory(session.title);
      const primary = session.categoryPrimary || inferred.primary;
      const secondary = session.categorySecondary || inferred.secondary;
      categoryCounts.set(primary, (categoryCounts.get(primary) ?? 0) + 1);
      commandCounts.set(secondary, (commandCounts.get(secondary) ?? 0) + 1);
      const userRow = userSessionCounts.get(session.userId);
      const account = session.user.phone || session.user.email || '未设置账号';
      if (userRow) userRow.count += 1;
      else userSessionCounts.set(session.userId, {
        name: session.user.name || account,
        account,
        count: 1,
      });
    }

    const dailyTokenMap = new Map<string, { inputTokens: number; outputTokens: number }>();
    const dailyActiveMap = new Map<string, Set<string>>();
    const dailySessionMap = new Map<string, number>();
    for (let offset = 0; offset < TOKEN_TREND_DAYS; offset += 1) {
      const date = new Date(startOfTrend);
      date.setDate(date.getDate() + offset);
      const key = localDateKey(date);
      dailyTokenMap.set(key, { inputTokens: 0, outputTokens: 0 });
      dailyActiveMap.set(key, new Set());
      dailySessionMap.set(key, 0);
    }
    for (const execution of recentExecutions) {
      if (!execution.completedAt) continue;
      const row = dailyTokenMap.get(localDateKey(execution.completedAt));
      if (!row) continue;
      row.inputTokens += execution.inputTokens ?? 0;
      row.outputTokens += execution.outputTokens ?? 0;
    }
    for (const message of recentUserMessages) {
      dailyActiveMap.get(localDateKey(message.createdAt))?.add(message.session.userId);
    }
    for (const session of sessions) {
      const key = localDateKey(session.createdAt);
      if (dailySessionMap.has(key)) dailySessionMap.set(key, (dailySessionMap.get(key) ?? 0) + 1);
    }
    const inputTokens = tokenTotals._sum.inputTokens ?? 0;
    const outputTokens = tokenTotals._sum.outputTokens ?? 0;
    return {
      totalUsers,
      activeUsers,
      dailyActiveUsers,
      totalSessions: sessions.length,
      todaySessions: sessions.filter((session) => session.createdAt >= startOfDay).length,
      totalTokens: inputTokens + outputTokens,
      todayTokens: (todayTokenTotals._sum.inputTokens ?? 0) + (todayTokenTotals._sum.outputTokens ?? 0),
      inputTokens,
      outputTokens,
      artifactCount,
      todayArtifactCount: todayTokenTotals._sum.artifactCount ?? 0,
      categories: [...categoryCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      dailyTokens: [...dailyTokenMap.entries()].map(([date, value]) => ({
        date,
        label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
        tokens: value.inputTokens + value.outputTokens,
        inputTokens: value.inputTokens,
        outputTokens: value.outputTokens,
      })),
      topCommands: [...commandCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
        .slice(0, 5),
      dailyActiveTrend: [...dailyActiveMap.entries()].map(([date, userIds]) => ({
        date,
        label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
        count: userIds.size,
      })),
      dailySessionTrend: [...dailySessionMap.entries()].map(([date, count]) => ({
        date,
        label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
        count,
      })),
      topUsers: [...userSessionCounts.entries()]
        .map(([userId, value]) => ({ userId, ...value }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
        .slice(0, 5),
    };
  }

  private assertAdmin() {
    const identity = this.identity.getIdentity();
    if (identity.role !== 'admin') {
      throw new ApiError(ApiErrorCode.FORBIDDEN, '仅管理员可以访问该功能', 403);
    }
    return identity;
  }
}
