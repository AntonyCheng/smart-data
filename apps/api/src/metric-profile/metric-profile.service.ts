import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../common/identity.service';
import { ApiError, ApiErrorCode } from '../common/errors';
import { DEFAULT_TENANT_ID } from '../auth/auth.service';
import { METRIC_PROFILE_SEEDS, type MetricCaliber } from './metric-profile.seed';
import type {
  MetricProfileView,
  MetricProfileForPrompt,
  UpsertMetricProfileDto,
} from './metric-profile.types';

const BRIEF_MAX = 4000;
const CALIBER_DEF_MAX = 2000;

@Injectable()
export class MetricProfileService implements OnModuleInit {
  private readonly logger = new Logger(MetricProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  /** 为已存在的每个租户补齐缺失的预置集（create-only，不覆盖管理员改动）。 */
  async onModuleInit(): Promise<void> {
    const tenants = await this.prisma.sysTenant.findMany({ select: { id: true } });
    for (const { id: tenantId } of tenants) {
      await this.seedForTenant(tenantId);
    }
  }

  async seedForTenant(tenantId: string): Promise<void> {
    const existing = await this.prisma.aiMetricProfile.findMany({
      where: { tenantId, key: { not: null } },
      select: { key: true },
    });
    const have = new Set(existing.map((r) => r.key));
    const missing = METRIC_PROFILE_SEEDS.filter((s) => !have.has(s.key));
    if (missing.length === 0) return;
    await this.prisma.aiMetricProfile.createMany({
      data: missing.map((s) => ({
        tenantId,
        key: s.key,
        name: s.name,
        summary: s.summary,
        category: s.category,
        calibers: s.calibers as unknown as Prisma.InputJsonValue,
        brief: s.brief,
        reportOutline: s.reportOutline ?? null,
        builtin: true,
        enabled: true,
        sortOrder: s.sortOrder,
      })),
    });
    this.logger.log(`seeded ${missing.length} metric profile(s) for tenant ${tenantId}`);
  }

  async list(includeDisabled = false): Promise<MetricProfileView[]> {
    const { tenantId } = this.identity.getIdentity();
    const rows = await this.prisma.aiMetricProfile.findMany({
      where: { tenantId, deletedAt: null, ...(includeDisabled ? {} : { enabled: true }) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async get(id: string): Promise<MetricProfileView> {
    return this.toView(await this.findOwned(id));
  }

  async create(dto: UpsertMetricProfileDto): Promise<MetricProfileView> {
    const { tenantId, userId } = this.assertAdmin();
    const name = dto.name?.trim();
    if (!name) throw new ApiError(ApiErrorCode.BAD_REQUEST, '名称不能为空');
    const row = await this.prisma.aiMetricProfile.create({
      data: {
        tenantId,
        key: null,
        name,
        summary: (dto.summary ?? '').trim(),
        category: (dto.category ?? '其他').trim() || '其他',
        calibers: this.normalizeCalibers(dto.calibers) as unknown as Prisma.InputJsonValue,
        brief: this.clip(dto.brief ?? '', BRIEF_MAX),
        reportOutline: dto.reportOutline?.trim() ? this.clip(dto.reportOutline, BRIEF_MAX) : null,
        builtin: false,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 100,
        createdBy: userId,
      },
    });
    return this.toView(row);
  }

  async update(id: string, dto: UpsertMetricProfileDto): Promise<MetricProfileView> {
    this.assertAdmin();
    const current = await this.findOwned(id);
    const data: Prisma.AiMetricProfileUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new ApiError(ApiErrorCode.BAD_REQUEST, '名称不能为空');
      data.name = name;
    }
    if (dto.summary !== undefined) data.summary = dto.summary.trim();
    if (dto.category !== undefined) data.category = dto.category.trim() || '其他';
    if (dto.calibers !== undefined) {
      data.calibers = this.normalizeCalibers(dto.calibers) as unknown as Prisma.InputJsonValue;
    }
    if (dto.brief !== undefined) data.brief = this.clip(dto.brief, BRIEF_MAX);
    if (dto.reportOutline !== undefined) {
      data.reportOutline = dto.reportOutline?.trim() ? this.clip(dto.reportOutline, BRIEF_MAX) : null;
    }
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    const row = await this.prisma.aiMetricProfile.update({ where: { id: current.id }, data });
    return this.toView(row);
  }

  async remove(id: string): Promise<void> {
    this.assertAdmin();
    const current = await this.findOwned(id);
    if (current.builtin) {
      throw new ApiError(ApiErrorCode.FORBIDDEN, '系统预置指标定义集不能删除，只能停用', 409);
    }
    await this.prisma.aiMetricProfile.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), enabled: false },
    });
  }

  /** 供 message.service 注入 prompt；找不到 / 已停用 / 已删则返回 null（退回通用报告）。 */
  async forPrompt(tenantId: string, id: string | null | undefined): Promise<MetricProfileForPrompt | null> {
    if (!id) return null;
    const row = await this.prisma.aiMetricProfile.findFirst({
      where: { id, tenantId, deletedAt: null, enabled: true },
    });
    if (!row) return null;
    return {
      name: row.name,
      calibers: this.readCalibers(row.calibers),
      brief: row.brief,
      reportOutline: row.reportOutline,
    };
  }

  /** 校验 id 属于当前租户且存在（可选用）。 */
  async assertUsable(id: string): Promise<void> {
    const { tenantId } = this.identity.getIdentity();
    const row = await this.prisma.aiMetricProfile.findFirst({
      where: { id, tenantId, deletedAt: null, enabled: true },
      select: { id: true },
    });
    if (!row) throw new ApiError(ApiErrorCode.BAD_REQUEST, '指标定义集不存在或已停用', 404);
  }

  private async findOwned(id: string) {
    const { tenantId } = this.identity.getIdentity();
    const row = await this.prisma.aiMetricProfile.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!row) throw new ApiError(ApiErrorCode.BAD_REQUEST, '指标定义集不存在', 404);
    return row;
  }

  private assertAdmin() {
    const identity = this.identity.getIdentity();
    if (identity.role !== 'admin') {
      throw new ApiError(ApiErrorCode.FORBIDDEN, '仅管理员可以维护指标定义集', 403);
    }
    return identity;
  }

  private toView(row: {
    id: string;
    key: string | null;
    name: string;
    summary: string;
    category: string;
    calibers: Prisma.JsonValue;
    brief: string;
    reportOutline: string | null;
    builtin: boolean;
    enabled: boolean;
    sortOrder: number;
    updatedAt: Date;
  }): MetricProfileView {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      summary: row.summary,
      category: row.category,
      calibers: this.readCalibers(row.calibers),
      brief: row.brief,
      reportOutline: row.reportOutline,
      builtin: row.builtin,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt,
    };
  }

  private readCalibers(value: Prisma.JsonValue): MetricCaliber[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const rec = item as Record<string, unknown>;
        const name = typeof rec.name === 'string' ? rec.name : '';
        const definition = typeof rec.definition === 'string' ? rec.definition : '';
        if (!name && !definition) return null;
        return { name, definition };
      })
      .filter((c): c is MetricCaliber => c !== null);
  }

  private normalizeCalibers(input: MetricCaliber[] | undefined): MetricCaliber[] {
    if (!Array.isArray(input)) return [];
    return input
      .map((c) => ({
        name: (c?.name ?? '').trim(),
        definition: this.clip((c?.definition ?? '').trim(), CALIBER_DEF_MAX),
      }))
      .filter((c) => c.name || c.definition)
      .slice(0, 30);
  }

  private clip(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) : text;
  }
}
