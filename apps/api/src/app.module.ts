import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { OpenCodeModule } from './opencode/opencode.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { AuthContextMiddleware } from './auth/auth-context.middleware';
import { SessionModule } from './session/session.module';
import { MessageModule } from './message/message.module';
import { FileModule } from './file/file.module';
import { ArtifactModule } from './artifact/artifact.module';
import { MetricProfileModule } from './metric-profile/metric-profile.module';
import { AdminModule } from './admin/admin.module';

/**
 * JWT 认证 + 租户/用户隔离。AuthContextMiddleware 把请求身份绑定进
 * AsyncLocalStorage；JwtAuthGuard (APP_GUARD) 强制访问控制，各业务模块
 * 通过 getIdentity() 自动按身份 scope。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    OpenCodeModule,
    CommonModule,
    AuthModule,
    SessionModule,
    MessageModule,
    FileModule,
    ArtifactModule,
    MetricProfileModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthContextMiddleware).forRoutes('*path');
  }
}
