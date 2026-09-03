import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../common/identity.service';
import { ApiError, ApiErrorCode } from '../common/errors';
import { LoginDto, LoginResponse, MeView, RegisterDto } from './auth.types';

const DEFAULT_JWT_EXPIRES = '7d';
export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const CHINA_MOBILE = /^1[3-9]\d{9}$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly identity: IdentityService,
  ) {}

  /** POST /auth/login (design §16). */
  async login(dto: LoginDto): Promise<LoginResponse> {
    const account = (dto?.account ?? dto?.email)?.trim().toLowerCase();
    const password = dto?.password ?? '';
    if (!account || !password) throw new ApiError(ApiErrorCode.AUTH_ERROR, '请输入手机号或邮箱和密码', 401);

    const user = await this.prisma.sysUser.findFirst({
      where: { OR: [{ email: account }, { phone: account }] },
    });
    const ok = user && !user.deletedAt && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new ApiError(ApiErrorCode.AUTH_ERROR, '账号或密码错误', 401);
    return this.issueLoginResponse(user);
  }

  /** Public registration always creates a normal user; admin is seed/backoffice-only. */
  async register(dto: RegisterDto): Promise<LoginResponse> {
    const name = dto?.name?.trim().replace(/\s+/g, ' ') ?? '';
    const phone = dto?.phone?.trim() ?? '';
    const password = dto?.password ?? '';
    if (!name || name.length > 30) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '请输入 1 至 30 个字符的用户名');
    }
    if (!CHINA_MOBILE.test(phone)) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '请输入有效的中国大陆手机号');
    }
    if (password.length < 8 || password.length > 64) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '密码长度需为 8 至 64 位');
    }
    const existing = await this.prisma.sysUser.findUnique({ where: { phone } });
    if (existing) throw new ApiError(ApiErrorCode.BAD_REQUEST, '该手机号已经注册');

    const tenant = await this.prisma.sysTenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
    if (!tenant) throw new ApiError(ApiErrorCode.BAD_REQUEST, '注册服务暂未初始化，请联系管理员');
    const user = await this.prisma.sysUser.create({
      data: {
        tenantId: tenant.id,
        phone,
        passwordHash: await bcrypt.hash(password, 10),
        name,
        role: 'user',
      },
    });
    return this.issueLoginResponse(user);
  }

  private async issueLoginResponse(user: {
    id: string;
    tenantId: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    role: string;
  }): Promise<LoginResponse> {
    await this.prisma.sysUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const payload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      name: user.name ?? undefined,
      role: user.role,
    };
    const accessToken = await this.jwt.signAsync(payload);
    const tenant = await this.prisma.sysTenant.findUnique({ where: { id: user.tenantId } });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.expiresInSeconds(),
      user: {
        id: user.id,
        email: user.email ?? undefined,
        phone: user.phone ?? undefined,
        name: user.name ?? undefined,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: tenant?.name ?? '',
      },
    };
  }

  /** GET /auth/me — current user from the bound identity (design §16/§23). */
  async me(): Promise<MeView> {
    const { userId } = this.identity.getIdentity();
    const user = await this.prisma.sysUser.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new ApiError(ApiErrorCode.AUTH_ERROR, '用户不存在', 401);
    await this.prisma.sysUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tenant = await this.prisma.sysTenant.findUnique({ where: { id: user.tenantId } });
    return {
      id: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      name: user.name ?? undefined,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: tenant?.name ?? '',
    };
  }

  get jwtSecret(): string {
    return process.env.JWT_SECRET?.trim() || '';
  }

  get jwtExpiresIn(): string {
    return process.env.JWT_EXPIRES_IN?.trim() || DEFAULT_JWT_EXPIRES;
  }

  private expiresInSeconds(): number {
    const raw = (process.env.JWT_EXPIRES_IN?.trim() || DEFAULT_JWT_EXPIRES).toLowerCase();
    const m = raw.match(/^(\d+)([smhd])$/);
    if (!m) return 7 * 24 * 3600;
    const n = Number(m[1]);
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return n * (units[m[2]] ?? 1);
  }
}

/** Seed a real login user with a bcrypt-hashed password (replaces the P2 plaintext stub). */
@Injectable()
export class AuthSeedService {
  private readonly logger = new Logger(AuthSeedService.name);
  readonly TENANT_ID = DEFAULT_TENANT_ID;
  readonly USER_ID = '00000000-0000-4000-8000-000000000002';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.sysTenant.upsert({
      where: { id: this.TENANT_ID },
      update: {},
      create: { id: this.TENANT_ID, name: process.env.SEED_TENANT_NAME?.trim() || '默认租户' },
    });
    const activeAdmin = await this.prisma.sysUser.findFirst({
      where: { tenantId: this.TENANT_ID, role: 'admin', deletedAt: null },
      select: { id: true, email: true, phone: true },
    });
    if (activeAdmin) {
      this.logger.log(`admin account already available: ${activeAdmin.email || activeAdmin.phone || activeAdmin.id}`);
      return;
    }

    const email = process.env.SEED_ADMIN_EMAIL?.trim();
    const configuredPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
    if (!email || !configuredPassword || (process.env.NODE_ENV === 'production' && configuredPassword === 'admin123')) {
      throw new Error('没有可用管理员账号；请设置 SEED_ADMIN_EMAIL 和 SEED_ADMIN_PASSWORD，生产环境不得使用默认密码');
    }
    const hash = await bcrypt.hash(configuredPassword, 10);
    // Only recover the seed account when the tenant has no active administrator.
    // This keeps password resets and administrator deletions persistent across restarts.
    await this.prisma.sysUser.upsert({
      where: { id: this.USER_ID },
      update: { email, passwordHash: hash, name: 'Admin', role: 'admin', deletedAt: null },
      create: {
        id: this.USER_ID,
        tenantId: this.TENANT_ID,
        email,
        passwordHash: hash,
        name: 'Admin',
        role: 'admin',
      },
    });
    this.logger.log(`seeded login user ${email} (tenant ${this.TENANT_ID})`);
  }
}
