/** Auth DTOs / views (design §16). */

export interface LoginDto {
  account?: string;
  email?: string;
  password?: string;
}

export interface RegisterDto {
  name?: string;
  phone?: string;
  password?: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // seconds
  user: MeView;
}

/** GET /auth/me — current authenticated user (design §23: tenant-scoped view). */
export interface MeView {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  role: string;
  tenantId: string;
  tenantName: string;
}

/** JWT payload carried in the access token. */
export interface JwtPayload {
  sub: string; // user id
  tenantId: string;
  email?: string;
  phone?: string;
  name?: string;
  role: string;
}
