import { Module } from '@nestjs/common';
import { MetricProfileController } from './metric-profile.controller';
import { MetricProfileService } from './metric-profile.service';

@Module({
  controllers: [MetricProfileController],
  providers: [MetricProfileService],
  exports: [MetricProfileService],
})
export class MetricProfileModule {}
