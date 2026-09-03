import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import type { Response } from 'express';
import { FileService, MAX_UPLOAD_BYTES, UploadInput } from './file.service';
import { FileView } from './file.view';
import { WorkbookSnapshot } from './workbook.util';
import { ApiError, ApiErrorCode } from '../common/errors';

/**
 *   POST   /api/v1/files            multipart: file + sessionId
 *   GET    /api/v1/files/:id
 *   GET    /api/v1/files/:id/workbook   → Univer 快照
 *   GET    /api/v1/files/:id/original   → 原始 xlsx 下载
 *   DELETE /api/v1/files/:id
 */
@Controller('files')
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async create(
    @UploadedFile() file: UploadInput,
    @Body('sessionId') sessionId?: string,
  ): Promise<FileView> {
    if (!sessionId) throw new ApiError(ApiErrorCode.BAD_REQUEST, '缺少 sessionId', 400);
    if (!file) throw new ApiError(ApiErrorCode.BAD_REQUEST, '缺少文件', 400);
    return this.files.create(sessionId, file);
  }

  @Get()
  listBySession(@Query('sessionId') sessionId?: string): Promise<FileView[]> {
    if (!sessionId) throw new ApiError(ApiErrorCode.BAD_REQUEST, '缺少 sessionId', 400);
    return this.files.listBySession(sessionId);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<FileView> {
    return this.files.get(id);
  }

  @Get(':id/workbook')
  workbook(@Param('id') id: string): Promise<WorkbookSnapshot> {
    return this.files.workbook(id);
  }

  @Get(':id/original')
  async original(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const original = await this.files.original(id);
    response.setHeader('Content-Type', original.mimeType);
    response.setHeader('Content-Length', String(original.size));
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(original.name)}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(original.stream);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    await this.files.remove(id);
    return { deleted: true };
  }
}
