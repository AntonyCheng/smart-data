import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { IdentityService, RequestIdentity } from '../common/identity.service';
import { JwtPayload } from './auth.types';

/**
 * Binds the authenticated identity into AsyncLocalStorage for the remainder of
 * the request (design §23). Runs `als.run(() => next())` so the downstream
 * guard/controller/async chain all observe the identity.
 *
 * This middleware never blocks — it only resolves and binds context. The
 * JwtAuthGuard (which reads the bound context) makes the allow/deny decision.
 */
@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly identity: IdentityService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const payload = this.resolve(req);
    this.identity.runWith(payload, () => next());
  }

  private resolve(req: Request): RequestIdentity | null {
    const token = this.parseBearer(req);
    if (!token) return null;
    try {
      const p = this.jwt.verify<JwtPayload>(token);
      if (p?.sub && p?.tenantId) {
        return { tenantId: p.tenantId, userId: p.sub, email: p.email, phone: p.phone, name: p.name, role: p.role };
      }
    } catch {
      // invalid/expired token → treat as unauthenticated; guard will reject.
    }
    return null;
  }

  private parseBearer(req: Request): string | undefined {
    const h = req.headers.authorization;
    if (!h) return undefined;
    const [scheme, token] = h.split(' ');
    return scheme?.toLowerCase() === 'bearer' ? token : undefined;
  }
}
