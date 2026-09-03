import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../common/identity.service';
import { ApiError, ApiErrorCode } from '../common/errors';
import { WorkspaceService } from '../common/workspace.service';
import { FileView } from './file.view';
import { xlsxToSnapshot, WorkbookSnapshot } from './workbook.util';

/** 只接受 Office Open XML 电子表格族。宏按数据解析，绝不执行。 */
const ALLOWED_EXT = new Set(['xlsx', 'xlsm', 'xltx', 'xltm']);

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB 硬上限

/**
 * Busboy/Multer 可能把 UTF-8 multipart 文件名暴露成 latin1 字符串。
 * 还原这种可逆形式，同时保留本已正确的 Unicode 名。
 */
function normalizeOriginalName(value?: string): string {
  const name = (value || 'file').trim();
  if (!name || [...name].some((character) => character.charCodeAt(0) > 0xff)) return name || 'file';
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

export interface UploadInput {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

export interface PromptDocument {
  fileId: string;
  name: string;
  /** 相对 OpenCode 工作目录的输入文件路径，如 workspaces/<t>/<s>/input/<stored>。 */
  relInputPath: string;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly workspace: WorkspaceService,
  ) {}

  /** 把上传的 Excel 存进会话工作区 input/ 并登记 ai_file。 */
  async create(sessionId: string, file: UploadInput): Promise<FileView> {
    const { tenantId } = this.identity.getIdentity();
    await this.findOwnedSession(sessionId);

    const originalName = normalizeOriginalName(file.originalname);
    const ext = path.extname(originalName).slice(1).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (!ALLOWED_EXT.has(ext)) {
      throw new ApiError(ApiErrorCode.FILE_TYPE_NOT_SUPPORTED, `仅支持 .xlsx / .xlsm / .xltx / .xltm 文件`, 400);
    }
    const size = file.size ?? file.buffer?.length ?? 0;
    if (size > this.maxSize()) {
      throw new ApiError(ApiErrorCode.FILE_TYPE_NOT_SUPPORTED, '文件超过大小限制', 400);
    }
    if ((file.buffer?.length ?? 0) === 0) {
      throw new ApiError(ApiErrorCode.BAD_REQUEST, '文件内容为空', 400);
    }
    // xlsx 是 zip 容器：校验 PK 魔数
    if (!file.buffer!.subarray(0, 2).equals(Buffer.from([0x50, 0x4b]))) {
      throw new ApiError(ApiErrorCode.FILE_TYPE_NOT_SUPPORTED, '文件内容不是有效的 Excel', 400);
    }

    const id = randomUUID();
    const storedName = `${id.replace(/-/g, '')}.${ext}`;
    this.workspace.ensureSessionWorkspace(tenantId, sessionId);
    const absPath = path.join(this.workspace.inputDir(tenantId, sessionId), storedName);
    fs.writeFileSync(absPath, file.buffer ?? Buffer.alloc(0));

    const relPath = this.workspace.relInputPath(tenantId, sessionId, storedName);
    const row = await this.prisma.aiFile.create({
      data: {
        id,
        tenantId,
        sessionId,
        originalName,
        storedName,
        mimeType: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: BigInt(size),
        path: relPath,
      },
    });

    this.logger.log(`uploaded ${originalName} -> ${relPath} (${size}B)`);
    return this.toView(row);
  }

  async get(id: string): Promise<FileView> {
    return this.toView(await this.findOwnedFile(id));
  }

  /** 原始 xlsx 流，用于下载。 */
  async original(id: string) {
    const row = await this.findOwnedFile(id);
    const absolutePath = this.resolveInside(row.path);
    return {
      stream: fs.createReadStream(absolutePath),
      name: normalizeOriginalName(row.originalName),
      mimeType: row.mimeType || 'application/octet-stream',
      size: Number(row.size),
    };
  }

  /** 把上传的 xlsx 转成 Univer 快照供前端渲染。 */
  async workbook(id: string): Promise<WorkbookSnapshot> {
    const row = await this.findOwnedFile(id);
    const absolutePath = this.resolveInside(row.path);
    try {
      return await xlsxToSnapshot(absolutePath, normalizeOriginalName(row.originalName));
    } catch (cause) {
      this.logger.warn(`workbook 转换失败 ${id}: ${(cause as Error).message}`);
      throw new ApiError(ApiErrorCode.FILE_TYPE_NOT_SUPPORTED, '无法解析该 Excel，请确认文件未损坏', 422);
    }
  }

  async remove(id: string): Promise<void> {
    const row = await this.findOwnedFile(id);
    await this.prisma.aiFile.delete({ where: { id: row.id } });
    if (row.path) {
      fs.rmSync(path.join(this.workspace.workDir, row.path), { force: true });
    }
  }

  async listBySession(sessionId: string): Promise<FileView[]> {
    const { tenantId } = this.identity.getIdentity();
    const rows = await this.prisma.aiFile.findMany({
      where: { tenantId, sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * 把 fileIds 解析成传给 agent 的输入文件相对路径。按归属过滤；未知/他人的 id 报错。
   */
  async resolvePromptDocuments(sessionId: string, fileIds?: string[]): Promise<PromptDocument[]> {
    if (!fileIds?.length) return [];
    const { tenantId } = this.identity.getIdentity();
    const rows = await this.prisma.aiFile.findMany({
      where: { id: { in: fileIds }, tenantId, sessionId },
    });
    if (rows.length !== new Set(fileIds).size) {
      throw new ApiError(ApiErrorCode.FILE_NOT_FOUND, '部分附件不存在或不属于当前任务', 404);
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return fileIds.map((id) => byId.get(id)!).map((row) => ({
      fileId: row.id,
      name: normalizeOriginalName(row.originalName),
      relInputPath: row.path,
    }));
  }

  private resolveInside(relPath: string): string {
    const absolutePath = path.resolve(this.workspace.workDir, relPath);
    const workspaceRoot = `${path.resolve(this.workspace.workDir)}${path.sep}`;
    if (!absolutePath.startsWith(workspaceRoot) || !fs.existsSync(absolutePath)) {
      throw new ApiError(ApiErrorCode.FILE_NOT_FOUND, '原始文件不存在', 404);
    }
    return absolutePath;
  }

  private async findOwnedSession(sessionId: string) {
    const { tenantId, userId } = this.identity.getIdentity();
    const row = await this.prisma.aiSession.findFirst({
      where: { id: sessionId, tenantId, userId, deletedAt: null },
    });
    if (!row) throw new ApiError(ApiErrorCode.SESSION_NOT_FOUND, '任务不存在', 404);
    return row;
  }

  private async findOwnedFile(id: string) {
    const { tenantId } = this.identity.getIdentity();
    const row = await this.prisma.aiFile.findFirst({ where: { id, tenantId } });
    if (!row) throw new ApiError(ApiErrorCode.FILE_NOT_FOUND, '文件不存在', 404);
    return row;
  }

  private maxSize(): number {
    const v = Number(process.env.FILE_MAX_SIZE ?? MAX_UPLOAD_BYTES);
    return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_UPLOAD_BYTES) : MAX_UPLOAD_BYTES;
  }

  toView(r: {
    id: string; originalName: string; mimeType?: string; size: bigint; createdAt: Date;
  }): FileView {
    return {
      id: r.id,
      name: normalizeOriginalName(r.originalName),
      mimeType: r.mimeType ?? '',
      size: Number(r.size),
      createdAt: r.createdAt,
    };
  }
}
