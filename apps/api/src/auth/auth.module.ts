import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthService, AuthSeedService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

const configuredJwtSecret = process.env.JWT_SECRET?.trim();
if (!configuredJwtSecret || (process.env.NODE_ENV === 'production' && configuredJwtSecret.length < 32)) {
  throw new Error('必须设置 JWT_SECRET；生产环境长度不得少于 32 位');
}
const jwtSecret = configuredJwtSecret;
const jwtExpires = (process.env.JWT_EXPIRES_IN?.trim() || '7d') as `${number}${'s' | 'm' | 'h' | 'd'}`;

/**
 * P4 Auth: Bearer JWT (design §16), global guard, and seeded login user.
 * The request identity is bound by AuthContextMiddleware (registered globally
 * in AppModule) and enforced by the JwtAuthGuard APP_GUARD below.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: jwtSecret,
      signOptions: { expiresIn: jwtExpires },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSeedService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
