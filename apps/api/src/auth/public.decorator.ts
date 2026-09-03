import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Mark a route as publicly accessible (skip global JWT guard). Used for /auth/login. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
