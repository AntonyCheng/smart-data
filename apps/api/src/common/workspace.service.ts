import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { OpenCodePermissionRule } from '../opencode/opencode.types';

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
  private readonly logger = new Logger(WorkspaceService.name);
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

  /**
   * 会话级 OpenCode 权限规则：把 read / edit / glob / grep / list 这些
   * 文件工具锁死在本会话工作区目录内。
   *
   * OpenCode 把这些规则追加到 agent 权限之后，按「后匹配优先」求值，
   * 所以先 deny 掉整个 `workspaces/`，再 allow 回本会话目录，
   * 最后再把 `input/` 的写入 deny 掉（保护上传的原始文件）。
   *
   * 注意：`glob`/`grep`/`list` 的 pattern 匹配的是模型传入的查询串而非
   * 解析后的路径，模型可用花式通配符绕开（只能看到文件名，读不到内容）；
   * `read`/`edit` 匹配解析后的绝对路径，是真正的数据边界。
   * bash 里 `python` 脚本的 `open()` 不受此约束 —— 完整隔离需按会话
   * 拆进程/容器，属后续硬化项。
   */
  sessionPermissionRuleset(tenantId: string, sessionId: string): OpenCodePermissionRule[] {
    const base = this.relBase(tenantId, sessionId); // workspaces/{tenant}/{session}
    const denyGlobs = ['**/workspaces/**', 'workspaces/**', '*/workspaces/**', './workspaces/**'];
    const ownGlobs = [`**/${base}/**`, `${base}/**`, `./${base}/**`];
    const fileTools = ['read', 'edit', 'glob', 'grep', 'list'] as const;
    const rules: OpenCodePermissionRule[] = [];
    for (const permission of fileTools) {
      for (const pattern of denyGlobs) rules.push({ permission, pattern, action: 'deny' });
      for (const pattern of ownGlobs) rules.push({ permission, pattern, action: 'allow' });
    }
    // 原始输入文件只读：禁止 edit/写入 input/ 目录
    for (const pattern of [`**/${base}/input/**`, `${base}/input/**`, `./${base}/input/**`]) {
      rules.push({ permission: 'edit', pattern, action: 'deny' });
    }
    return rules;
  }

  /** 删除整个会话工作区目录（会话删除时调用）。仅允许删 workdir 之下的路径。 */
  removeSessionWorkspace(tenantId: string, sessionId: string): void {
    const root = this.sessionRoot(tenantId, sessionId);
    const resolved = path.resolve(root);
    const prefix = path.resolve(this.workdir, 'workspaces') + path.sep;
    if (!resolved.startsWith(prefix)) {
      this.logger.warn(`拒绝删除工作区外路径：${resolved}`);
      return;
    }
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
    } catch (cause) {
      this.logger.warn(`删除会话工作区失败 ${resolved}: ${(cause as Error).message}`);
    }
  }
}
