import { Module } from '@nestjs/common';
import { OpenCodeModule } from '../opencode/opencode.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [OpenCodeModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
