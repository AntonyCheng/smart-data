import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OpenCodeEventService } from '../opencode/opencode-event.service';
import { OpenCodeService } from '../opencode/opencode.service';
import { PrismaService } from '../prisma/prisma.service';
import { SseHub } from './sse-hub';
import { ExecutionStatus } from '../common/errors';
import { ArtifactService } from '../artifact/artifact.service';
import {
  chineseLivePreview,
  containsEnglishProse,
  extractFinalAnswer,
  hideUntranslatedEnglish,
  removeEnglishProcessNarration,
  stripTranslationPreamble,
} from '../message/assistant-output.util';

type SessionMode = 'operate' | 'report';

interface TrackedExecution {
  businessSessionId: string;
  tenantId: string;
  executionId: string;
  opencodeSessionId: string;
  mode: SessionMode;
  started: boolean;
  startedAt?: number;
  /** 最近一次收到本会话 OpenCode 事件的时间戳，用于看门狗判定卡死。 */
  lastEventAt: number;
  registeredAt: number;
  timedOut: boolean;
  /** 本轮已发起的工具调用数，用于步数上限（弱模型钻牛角尖时会无限循环）。 */
  toolCalls: number;
  toolCallIds: Set<string>;
}

const num = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

/** 看门狗：agent 已开工但持续无事件多久判为卡死（模型服务流式响应挂死等）。 */
const STALL_TIMEOUT_MS = num('AGENT_STALL_TIMEOUT_MS', 4 * 60_000);
/** agent 迟迟不开工（prompt_async 已受理但 OpenCode 无 busy 事件）多久判为失败。 */
const START_TIMEOUT_MS = num('AGENT_START_TIMEOUT_MS', 2.5 * 60_000);
const WATCHDOG_INTERVAL_MS = num('AGENT_WATCHDOG_INTERVAL_MS', 30_000);

/**
 * 工具调用步数上限。ds4f-0731-75 在报告模式偶尔钻牛角尖（比如手搓 DOCX XML
 * 反复失败重试），看门狗因为一直有事件而不触发。正常 operate 通常 <15 步、
 * report 30~45 步，这里留 2x 余量兜底。
 */
const OPERATE_STEP_LIMIT = num('AGENT_OPERATE_STEP_LIMIT', 35);
const REPORT_STEP_LIMIT = num('AGENT_REPORT_STEP_LIMIT', 90);

/** OpenCode 因权限规则拒绝某次工具调用时返回的固定话术片段。 */
const PERMISSION_DENIED_RE =
  /rule which prevents you from using|permission denied|not allowed to (?:run|use)|is not permitted/i;

interface MessageState {
  role?: string;
  hasTool: boolean;
  flushed: boolean;
  buffers: Map<string, string>;
}

/**
 * 消费 OpenCode 原始 /event 流，过滤/翻译成前端协议，按业务会话扇出，
 * 在 agent 空闲时把最终答复 + 执行记录 + 成果落库。
 *
 * 思维链 / 过程叙述文本、原始工具参数、skill 内容、OpenCode 会话 id、
 * 服务器路径 —— 一律不转发。
 */
@Injectable()
export class SessionEventWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionEventWatcher.name);
  private readonly executions = new Map<string, TrackedExecution>();
  private readonly messages = new Map<string, MessageState>();
  private readonly seenToolCalls = new Set<string>();
  private readonly finishedToolCalls = new Set<string>();
  private readonly toolStartedAt = new Map<string, number>();
  private cancel?: () => void;
  private stopped = false;
  private watchdog?: ReturnType<typeof setInterval>;

  constructor(
    private readonly events: OpenCodeEventService,
    private readonly opencode: OpenCodeService,
    private readonly prisma: PrismaService,
    private readonly sse: SseHub,
    private readonly artifacts: ArtifactService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.events.on('event', this.onEvent);
    const recovered = await this.prisma.aiExecution.updateMany({
      where: { status: { in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING] } },
      data: {
        status: ExecutionStatus.FAILED,
        errorCode: 'AGENT_INTERRUPTED',
        errorMessage: 'API 服务重启导致本次生成中断，可继续发送消息重试',
        completedAt: new Date(),
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(`marked ${recovered.count} interrupted execution(s) after API restart`);
    }
    this.watchdog = setInterval(() => {
      void this.sweepStalledExecutions();
    }, WATCHDOG_INTERVAL_MS);
    this.watchdog.unref?.();
    this.logger.log('event watcher started');
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.events.off('event', this.onEvent);
    if (this.watchdog) clearInterval(this.watchdog);
    this.cancel?.();
  }

  register(
    opencodeSessionId: string,
    businessSessionId: string,
    executionId: string,
    tenantId: string,
    mode: SessionMode = 'operate',
  ): void {
    const now = Date.now();
    this.executions.set(opencodeSessionId, {
      businessSessionId,
      tenantId,
      executionId,
      opencodeSessionId,
      mode,
      started: false,
      lastEventAt: now,
      registeredAt: now,
      timedOut: false,
      toolCalls: 0,
      toolCallIds: new Set(),
    });
  }

  unregister(opencodeSessionId: string): void {
    this.executions.delete(opencodeSessionId);
    for (const key of this.messages.keys()) {
      if (key.startsWith(`${opencodeSessionId}:`)) this.messages.delete(key);
    }
  }

  private onEvent = (raw: unknown): void => {
    void this.handle(raw as { type?: string; properties?: Record<string, unknown> });
  };

  private async handle(e: { type?: string; properties?: Record<string, unknown> }): Promise<void> {
    const p = e.properties ?? {};
    const ocSid = p.sessionID as string | undefined;
    if (!ocSid) return;
    const exec = this.executions.get(ocSid.trim() ?? '');
    if (!exec || exec.timedOut) return;
    exec.lastEventAt = Date.now();

    switch (e.type) {
      case 'session.status': {
        if ((p.status as { type?: string })?.type === 'busy' && !exec.started) {
          exec.started = true;
          exec.startedAt = Date.now();
          this.sse.publish(exec.businessSessionId, 'agent.started', {});
        }
        break;
      }
      case 'message.part.updated': {
        const part = p.part as Record<string, unknown> | undefined;
        const mid = part?.messageID as string | undefined;
        if (!mid || !part) break;
        const st = this.state(ocSid, mid);
        if (part.type === 'text') {
          st.role = 'assistant';
        } else if (part.type === 'tool') {
          st.hasTool = true;
          st.buffers.clear();
          const state = part.state as
            | { status?: string; input?: unknown; output?: unknown; error?: unknown }
            | undefined;
          const status = state?.status ?? '';
          const callID = (part.callID as string) ?? '';
          const tool = String(part.tool ?? 'tool');
          const name =
            tool === 'skill'
              ? String((state?.input as { name?: unknown } | undefined)?.name ?? 'skill')
              : tool;
          const isSkill = tool === 'skill';
          const detail = this.toolDetail(tool, state?.input);
          if (callID) exec.toolCallIds.add(callID);

          if (status === 'running' && (!callID || !this.seenToolCalls.has(callID))) {
            if (callID) {
              this.seenToolCalls.add(callID);
              this.toolStartedAt.set(callID, Date.now());
            }
            exec.toolCalls += 1;
            this.sse.publish(exec.businessSessionId, isSkill ? 'skill.started' : 'tool.started', {
              name,
              ...(detail ? { detail } : {}),
            });
            const limit = exec.mode === 'report' ? REPORT_STEP_LIMIT : OPERATE_STEP_LIMIT;
            if (exec.toolCalls > limit) {
              exec.timedOut = true;
              this.logger.warn(
                `watchdog: 执行 ${exec.executionId} 工具调用超过 ${limit} 步（${exec.mode}），中止`,
              );
              await this.failExecution(
                ocSid,
                exec,
                'AGENT_STEP_LIMIT',
                '本次处理步骤过多（可能模型陷入反复重试），已终止。可尝试拆分需求或稍后重试。',
              );
            }
          } else if (
            (status === 'completed' || status === 'error')
            && (!callID || !this.finishedToolCalls.has(callID))
          ) {
            if (callID) this.finishedToolCalls.add(callID);
            const startedAt = callID ? this.toolStartedAt.get(callID) : undefined;
            const resultText = `${this.stringify(state?.output)} ${this.stringify(state?.error)}`;
            const denied = status === 'error' && PERMISSION_DENIED_RE.test(resultText);
            if (denied) {
              // 沙箱按规则拦下了模型的越权/探查动作 —— 这是护栏在生效，不是任务失败，
              // 前端把对应的“正在执行”步骤悄悄撤掉，不显示成红叉。
              this.sse.publish(exec.businessSessionId, 'tool.dropped', {
                name,
                ...(detail ? { detail } : {}),
              });
            } else {
              this.sse.publish(exec.businessSessionId, isSkill ? 'skill.completed' : 'tool.completed', {
                name,
                ok: status === 'completed',
                ...(detail ? { detail } : {}),
                ...(startedAt ? { durationMs: Date.now() - startedAt } : {}),
              });
            }
          }
        } else if (part.type === 'step-finish' && part.reason === 'stop') {
          this.flushText(ocSid, mid, exec);
        }
        break;
      }
      case 'message.part.delta': {
        const mid = p.messageID as string | undefined;
        const partID = p.partID as string | undefined;
        if (!mid || !partID || p.field !== 'text') break;
        const st = this.state(ocSid, mid);
        if (st.role === 'user' || st.hasTool) break;
        st.buffers.set(partID, (st.buffers.get(partID) ?? '') + String(p.delta ?? ''));
        break;
      }
      case 'session.idle': {
        await this.finalize(ocSid, exec);
        break;
      }
    }
  }

  private state(ocSid: string, mid: string): MessageState {
    const key = `${ocSid}:${mid}`;
    let s = this.messages.get(key);
    if (!s) {
      s = { hasTool: false, flushed: false, buffers: new Map() };
      this.messages.set(key, s);
    }
    return s;
  }

  private flushText(ocSid: string, mid: string, exec: TrackedExecution): void {
    const st = this.state(ocSid, mid);
    if (st.flushed) return;
    st.flushed = true;
    const chunks: string[] = [];
    for (const text of st.buffers.values()) {
      const visible = chineseLivePreview(text);
      if (!visible) continue;
      for (let i = 0; i < visible.length; i += 200) chunks.push(visible.slice(i, i + 200));
    }
    st.buffers.clear();
    for (const c of chunks) {
      this.sse.publish(exec.businessSessionId, 'message.delta', { content: c });
    }
  }

  private async finalize(ocSid: string, exec: TrackedExecution): Promise<void> {
    try {
      // 竞态保护：用户中止后 session.idle 仍可能到达；若执行已被置为终态
      // （ABORTED / FAILED / COMPLETED），不要再覆盖状态或补落答复。
      const current = await this.prisma.aiExecution.findUnique({
        where: { id: exec.executionId },
        select: { status: true },
      });
      if (current && current.status !== ExecutionStatus.RUNNING && current.status !== ExecutionStatus.PENDING) {
        return;
      }
      const msgs = await this.opencode.getMessages(ocSid);
      let last: { info: { role?: string; error?: unknown; tokens?: { input?: number; output?: number }; modelID?: string }; parts?: Array<{ type: string; text?: string }> } | undefined;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.info?.role === 'assistant') {
          last = msgs[i] as typeof last;
          break;
        }
      }

      const reportedError = last?.info?.error ?? null;
      let content = '';
      if (last?.parts) {
        const textOf = (parts: Array<{ type: string; text?: string }>) =>
          parts.filter((x) => x.type === 'text').map((x) => x.text ?? '').join('');
        // 最终答复只可能出现在最后一次工具调用之后；之前的 text 片段是模型
        // 在工具之间的思考/自述。取不到时退回全部 text（不比旧逻辑更差）。
        const lastToolIdx = last.parts.map((x) => x.type).lastIndexOf('tool');
        const afterTool = textOf(last.parts.slice(lastToolIdx + 1));
        // 弱模型仍可能把推理和答复塞进同一段 text，按标记/启发式再剥一层。
        content = extractFinalAnswer(afterTool.trim() ? afterTool : textOf(last.parts));
      }
      if (content.trim()) content = await this.ensureChineseOutput(content);

      const execId = exec.executionId;

      if (reportedError || !content.trim()) {
        await this.prisma.aiExecution.update({
          where: { id: execId },
          data: {
            status: ExecutionStatus.FAILED,
            errorCode: 'AGENT_EXECUTION_ERROR',
            errorMessage: reportedError ? 'Agent 执行失败' : 'Agent 未返回有效内容',
            completedAt: new Date(),
          },
        });
        this.sse.publish(exec.businessSessionId, 'agent.error', {
          code: 'AGENT_EXECUTION_ERROR',
          message: reportedError ? 'Agent 执行失败' : 'AI 服务未返回有效内容，请检查模型配置',
        });
      } else {
        // 登记本轮生成的成果文件
        const artifacts = await this.artifacts
          .register(exec.tenantId, exec.businessSessionId)
          .catch((cause) => {
            this.logger.warn(`成果登记失败 ${exec.businessSessionId}: ${(cause as Error).message}`);
            return [];
          });

        await this.prisma.aiExecution.update({
          where: { id: execId },
          data: {
            status: ExecutionStatus.COMPLETED,
            model: last?.info?.modelID ?? null,
            inputTokens: last?.info?.tokens?.input ?? 0,
            outputTokens: last?.info?.tokens?.output ?? 0,
            artifactCount: artifacts.length,
            completedAt: new Date(),
          },
        });

        const saved = await this.prisma.aiMessage.create({
          data: {
            tenantId: exec.tenantId,
            sessionId: exec.businessSessionId,
            role: 'assistant',
            content: content || '(无内容)',
            status: 'COMPLETED',
          },
        });
        for (const artifact of artifacts) {
          this.sse.publish(exec.businessSessionId, 'artifact', artifact as unknown as Record<string, unknown>);
        }
        this.sse.publish(exec.businessSessionId, 'agent.completed', {
          messageId: saved.id,
          ...(exec.startedAt ? { durationMs: Date.now() - exec.startedAt } : {}),
        });
      }
    } catch (err) {
      this.logger.error(`finalize failed for ${ocSid}: ${(err as Error).message}`);
    } finally {
      this.cleanupExecution(ocSid, exec);
    }
  }

  private cleanupExecution(ocSid: string, exec: TrackedExecution): void {
    for (const callID of exec.toolCallIds) {
      this.seenToolCalls.delete(callID);
      this.finishedToolCalls.delete(callID);
      this.toolStartedAt.delete(callID);
    }
    this.sse.clearExecution(exec.businessSessionId);
    this.executions.delete(ocSid);
  }

  /**
   * 看门狗：OpenCode 可能在模型服务流式响应挂死时既不发 session.idle
   * 也不报错，执行会永远停在 RUNNING、前端一直转圈。这里定期扫描，
   * 把长时间无事件的执行判失败并中止 OpenCode 会话。
   */
  private async sweepStalledExecutions(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    for (const [ocSid, exec] of [...this.executions]) {
      if (exec.timedOut) continue;
      const idleFor = now - exec.lastEventAt;
      const stalled = exec.started
        ? idleFor > STALL_TIMEOUT_MS
        : now - exec.registeredAt > START_TIMEOUT_MS;
      if (!stalled) continue;
      exec.timedOut = true;
      const reason = exec.started
        ? `agent 持续 ${Math.round(idleFor / 1000)}s 无响应`
        : `agent 超过 ${Math.round((now - exec.registeredAt) / 1000)}s 未开工`;
      this.logger.warn(`watchdog: 中止卡死执行 ${exec.executionId}（${reason}）`);
      await this.failExecution(
        ocSid,
        exec,
        'AGENT_TIMEOUT',
        'AI 长时间无响应（可能是模型服务超时），本次已终止，请重试',
      );
    }
  }

  /** 中止 OpenCode 会话、把执行判失败、推 agent.error、清理跟踪状态。 */
  private async failExecution(
    ocSid: string,
    exec: TrackedExecution,
    errorCode: string,
    message: string,
  ): Promise<void> {
    if (this.executions.get(ocSid) !== exec) return; // 已被清理/并发处理
    try {
      await this.opencode.abortSession(ocSid).catch(() => undefined);
      await this.prisma.aiExecution.update({
        where: { id: exec.executionId },
        data: {
          status: ExecutionStatus.FAILED,
          errorCode,
          errorMessage: message,
          completedAt: new Date(),
        },
      }).catch((cause) => {
        this.logger.error(`标记执行失败出错 ${exec.executionId}: ${(cause as Error).message}`);
      });
      this.sse.publish(exec.businessSessionId, 'agent.error', { code: errorCode, message });
    } finally {
      this.cleanupExecution(ocSid, exec);
    }
  }

  private stringify(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private async ensureChineseOutput(value: string): Promise<string> {
    const cleaned = removeEnglishProcessNarration(value);
    if (!containsEnglishProse(cleaned)) return cleaned;

    let translationSessionId = '';
    try {
      const session = await this.opencode.createSession('中文答复转换');
      translationSessionId = session.id;
      const response = await this.opencode.sendPrompt(session.id, {
        agent: 'chinese-output',
        parts: [{ type: 'text', text: cleaned }],
      });
      const translated = response.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
        .trim();
      const normalized = stripTranslationPreamble(
        extractFinalAnswer(removeEnglishProcessNarration(translated)),
      );
      return normalized && !containsEnglishProse(normalized)
        ? normalized
        : hideUntranslatedEnglish(normalized || cleaned);
    } catch (cause) {
      this.logger.warn(`答复中文转换失败，已隐藏未翻译段落：${(cause as Error).message}`);
      return hideUntranslatedEnglish(cleaned);
    } finally {
      if (translationSessionId) await this.opencode.deleteSession(translationSessionId).catch(() => undefined);
    }
  }

  /** 不暴露原始参数或服务器路径的简短白名单摘要。 */
  private toolDetail(tool: string, rawInput: unknown): string | undefined {
    const input = rawInput && typeof rawInput === 'object'
      ? rawInput as Record<string, unknown>
      : {};
    const value = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        if (typeof input[key] !== 'string') continue;
        const clean = String(input[key]).replace(/\s+/g, ' ').trim().slice(0, 80);
        if (clean) return clean;
      }
      return undefined;
    };
    const basename = (filePath?: string) => filePath?.split(/[\\/]/).filter(Boolean).pop();

    if (tool.endsWith('read')) {
      const fileName = basename(value('filePath', 'file_path', 'path'));
      return fileName ? `读取文件：${fileName}` : '读取工作簿';
    }
    if (tool.endsWith('write') || tool.endsWith('edit')) {
      const fileName = basename(value('filePath', 'file_path', 'path'));
      return fileName ? `写入文件：${fileName}` : '生成成果文件';
    }
    if (tool.endsWith('glob')) {
      const pattern = value('pattern', 'glob');
      return pattern ? `匹配范围：${pattern}` : '查找相关文件';
    }
    if (tool.endsWith('grep')) {
      const pattern = value('pattern', 'query');
      return pattern ? `检索内容：${pattern}` : '检索工作簿内容';
    }
    if (tool.endsWith('bash')) {
      const command = value('command', 'cmd') ?? '';
      if (/profile_table/.test(command)) return '体检工作簿结构';
      if (/clean_table/.test(command)) return '清洗为规范分析表';
      if (/scan_traps/.test(command)) return '扫描分析陷阱';
      if (/verify_numbers/.test(command)) return '数字对账核验';
      if (/verify_xlsx/.test(command)) return '复核 Excel 成果';
      if (/verify_docx/.test(command)) return '复核 Word 报告';
      if (/verify_visual/.test(command)) return '复核报告渲染';
      if (/make_chart/.test(command)) return '生成图表';
      if (/make_report/.test(command)) return '渲染报告';
      return '执行数据计算与处理';
    }
    if (tool.endsWith('todowrite')) return '更新处理任务清单';
    return undefined;
  }
}
