import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MetricProfileService } from './metric-profile.service';
import { MetricProfileView, UpsertMetricProfileDto } from './metric-profile.types';

@Controller('metric-profiles')
export class MetricProfileController {
  constructor(private readonly profiles: MetricProfileService) {}

  /** 报告选择器用；默认只返回启用项，?all=1 返回全部（管理端）。 */
  @Get()
  list(@Query('all') all?: string): Promise<MetricProfileView[]> {
    return this.profiles.list(all === '1' || all === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<MetricProfileView> {
    return this.profiles.get(id);
  }

  @Post()
  create(@Body() dto: UpsertMetricProfileDto): Promise<MetricProfileView> {
    return this.profiles.create(dto ?? {});
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpsertMetricProfileDto): Promise<MetricProfileView> {
    return this.profiles.update(id, dto ?? {});
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.profiles.remove(id);
    return { deleted: true };
  }
}
