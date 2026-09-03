import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * 会话工作区解析。
 *
 * OpenCode agent 以 cwd = OPENCODE_WORKDIR 运行，且 `read: allow` +
 * `external_directory: deny`，所以用户文件必须位于该目录内 agent 才能读到。
 * 工作区结构：
 *
 *   {OPENCODE_WORKDIR}/workspaces/{tenantId}/{sessionId}/
 *     ├── input/                  上传的 Excel 原文件
 *     └── output/{charts,tables,reports}/   AI 生成的成果
 *
 * 只有仓库相对路径会进入 prompt / 数据库 —— 绝不写绝对服务器路径。
 */
@Injectable()
export class WorkspaceService {
  private readonly workdir: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('OPENCODE_WORKDIR')?.trim() || '../../services/excel-agent';
    this.workdir = path.resolve(process.cwd(), configured);
  }

  /** OpenCode 工作目录绝对路径（含 opencode.json）。 */
  get workDir(): string {
    return this.workdir;
  }

  private relBase(tenantId: string, sessionId: string): string {
    return `workspaces/${tenantId}/${sessionId}`;
  }

  inputDir(tenantId: string, sessionId: string): string {
    return path.join(this.workdir, this.relBase(tenantId, sessionId), 'input');
  }

  outputDir(tenantId: string, sessionId: string): string {
    return path.join(this.workdir, this.relBase(tenantId, sessionId), 'output');
  }

  /** 传给 agent 的输入文件相对路径（相对 OpenCode 工作目录）。 */
  relInputPath(tenantId: string, sessionId: string, storedName: string): string {
    return `${this.relBase(tenantId, sessionId)}/input/${storedName}`;
  }

  ensureSessionWorkspace(tenantId: string, sessionId: string): void {
    for (const dir of [
      this.inputDir(tenantId, sessionId),
      path.join(this.outputDir(tenantId, sessionId), 'charts'),
      path.join(this.outputDir(tenantId, sessionId), 'tables'),
      path.join(this.outputDir(tenantId, sessionId), 'reports'),
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** 会话工作区根目录（用于整体删除）。 */
  sessionRoot(tenantId: string, sessionId: string): string {
    return path.join(this.workdir, this.relBase(tenantId, sessionId));
  }
}
