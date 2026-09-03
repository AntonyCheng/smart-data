import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError, ApiErrorCode } from './errors';

export interface RequestIdentity {
  tenantId: string;
  userId: string;
  email?: string;
  phone?: string;
  name?: string;
  role?: string;
}

/**
 * Request-scoped identity for the current HTTP request.
 *
 * P4: replaced the P2 stopgap (single seeded identity for every request) with
 * real per-request identity populated by the global JWT guard via an
 * AsyncLocalStorage context. Every business service calls getIdentity() and is
 * automatically tenant/user-scoped (design §23). If no authenticated context
 * exists (unauthenticated internal call), it throws AUTH_ERROR rather than
 * silently granting access.
 */
@Injectable()
export class IdentityService {
  static readonly als = new AsyncLocalStorage<RequestIdentity | null>();

  /** Run `fn` inside an identity context bound to the current async execution. */
  runWith(identity: RequestIdentity | null, fn: () => unknown): unknown {
    return IdentityService.als.run(identity, fn);
  }

  /** Current authenticated identity for this request (design §23). */
  getIdentity(): RequestIdentity {
    const store = IdentityService.als.getStore();
    if (!store?.tenantId || !store?.userId) {
      throw new ApiError(ApiErrorCode.AUTH_ERROR, '未认证', 401);
    }
    return store;
  }
}
