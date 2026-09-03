import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { ArtifactService, ArtifactView } from './artifact.service';
import { xlsxToSnapshot, WorkbookSnapshot } from '../file/workbook.util';
import { ApiError, ApiErrorCode } from '../common/errors';

@Controller()
export class ArtifactController {
  constructor(private readonly artifacts: ArtifactService) {}

  @Get('sessions/:id/artifacts')
  list(@Param('id') id: string): Promise<ArtifactView[]> {
    return this.artifacts.list(id);
  }

  @Get('artifacts/:id/workbook')
  async workbook(@Param('id') id: string): Promise<WorkbookSnapshot> {
    if (!(await this.artifacts.isExcel(id))) {
      throw new ApiError(ApiErrorCode.FILE_TYPE_NOT_SUPPORTED, '该成果不是 Excel', 400);
    }
    const resolved = await this.artifacts.resolve(id);
    return xlsxToSnapshot(resolved.abs, resolved.name);
  }

  @Get('artifacts/:id')
  async download(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const resolved = await this.artifacts.resolve(id);
    const disposition = download === 'true' || download === '1' ? 'attachment' : 'inline';
    response.setHeader('Content-Type', resolved.mediaType);
    response.setHeader('Content-Length', String(resolved.size));
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(resolved.name)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(resolved.abs));
  }
}
