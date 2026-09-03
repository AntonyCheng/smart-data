import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Local Vite development server calls the API through a same-origin proxy.
    cors: true,
  });
  // All business APIs live under /api/v1 (design §16)
  app.setGlobalPrefix('api/v1');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[zhishu-api] listening on http://127.0.0.1:${port}/api/v1`);
}

void bootstrap();
