import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityService } from '../common/identity.service';
import { ApiError, ApiErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global authorization guard (design §16: Bearer JWT — decision only).
 *
 * The AuthContextMiddleware has verified the token and bound the identity into
 * AsyncLocalStorage. This guard also confirms that the database user is still
 * active, so deleting or disabling an account revokes its existing JWT.
 * Routes annotated @Public() (e.g. POST /auth/login) are allowed through.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const store = IdentityService.als.getStore();
    if (!store?.tenantId || !store?.userId) {
      throw new ApiError(ApiErrorCode.AUTH_ERROR, '未认证或登录已过期', 401);
    }
    const user = await this.prisma.sysUser.findFirst({
      where: { id: store.userId, tenantId: store.tenantId, deletedAt: null },
      select: { role: true },
    });
    if (!user || user.role !== store.role) {
      throw new ApiError(ApiErrorCode.AUTH_ERROR, '账号已失效，请重新登录', 401);
    }
    return true;
  }
}
