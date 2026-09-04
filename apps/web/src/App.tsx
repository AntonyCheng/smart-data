import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  CircleCheck,
  CircleStop,
  Clock3,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Tags,
  Trash2,
  TriangleAlert,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  ApiError,
  api,
  getAccessToken,
  streamSessionEvents,
  type AiMessage,
  type AiSession,
  type AdminStats,
  type AdminUser,
  type Artifact,
  type AuthUser,
  type RuntimeEvent,
  type SessionMode,
  type UploadedFile,
  type WorkbookSnapshot,
} from './lib/api';
import type { SheetSelection } from './components/UniverViewer';

// Univer 及其 @univerjs/* 依赖树约 1.7 MB gzip，是首屏包的最大来源。
// 拆成独立 chunk，只在真正打开表格时才下载，登录页/管理后台不受牵连。
const UniverViewer = lazy(() =>
  import('./components/UniverViewer').then((m) => ({ default: m.UniverViewer })),
);
import {
  FEATURED_COMMANDS,
  QUICK_COMMANDS,
  QUICK_COMMAND_CATEGORIES,
  type QuickCommand,
} from './quick-commands';

type AuthState = 'checking' | 'guest' | 'ready';
type ProcessStatus = 'running' | 'done' | 'error';
type AdminView = 'users' | 'stats';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_HINT = '支持 .xlsx / .xlsm / .xltx / .xltm，单个文件不超过 100 MB。';

type ProcessItem = {
  id: string;
  key: string;
  label: string;
  detail?: string;
  durationMs?: number;
  status: ProcessStatus;
};

type DataTab =
  | { kind: 'file'; item: UploadedFile }
  | { kind: 'artifact'; item: Artifact };

function tabKey(tab: DataTab): string {
  return `${tab.kind}:${tab.item.id}`;
}

const EXCEL_RE = /\.(xlsx|xlsm|xltx|xltm)$/i;

function displayName(user: AuthUser): string {
  return user.name?.trim() || user.phone || user.email?.split('@')[0] || '用户';
}

const AVATAR_COLORS = ['#8e2634', '#2f6b5f', '#375a7f', '#70558a', '#9a5b32', '#2f6d78', '#6b5b45'];
function avatarInitial(value: string): string {
  return (Array.from(value.trim())[0] || '用').toUpperCase();
}
function avatarColor(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = ((hash * 31) + character.codePointAt(0)!) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatQuestionTime(value?: string): string {
  if (!value) return '尚未提问';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', '');
}

function formatAdminDate(value?: string): string {
  if (!value) return '从未登录';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(value?: number): string | null {
  if (!value || value < 100) return null;
  if (value < 1000) return `${Math.round(value)} 毫秒`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
}

function formatResponseDuration(value?: number): string | null {
  if (value === undefined || value < 0) return null;
  const totalSeconds = Math.max(1, Math.round(value / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}
function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, value));
}

const CATEGORY_CHART_COLORS = ['#8e2634', '#c56a72', '#d99a72', '#6e7f9c', '#7a9a84', '#a185b2', '#b39a69', '#596b73'];

function categoryPieStyle(items: Array<{ count: number }>): CSSProperties {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (!total) return { background: '#efefec' };
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    cursor += item.count / total * 100;
    return `${CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length]} ${start}% ${cursor}%`;
  });
  return { background: `conic-gradient(${segments.join(', ')})` };
}

function MetricTrendChart({
  items, ariaLabel, gradientId, color, valueSuffix, integerValues = false,
}: {
  items: Array<{ date: string; label: string; value: number }>;
  ariaLabel: string; gradientId: string; color: string; valueSuffix: string; integerValues?: boolean;
}) {
  const width = 720;
  const height = 174;
  const chart = { left: 46, top: 12, right: 14, bottom: 30 };
  const chartWidth = width - chart.left - chart.right;
  const chartHeight = height - chart.top - chart.bottom;
  const maximum = Math.max(1, ...items.map((item) => item.value));
  const points = items.map((item, index) => ({
    ...item,
    x: chart.left + (items.length <= 1 ? chartWidth / 2 : index / (items.length - 1) * chartWidth),
    y: chart.top + chartHeight - item.value / maximum * chartHeight,
  }));
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaPoints = points.length
    ? `${chart.left},${chart.top + chartHeight} ${linePoints} ${chart.left + chartWidth},${chart.top + chartHeight}`
    : '';
  const tickValues = integerValues
    ? [...new Set([maximum, Math.round(maximum * .75), Math.round(maximum * .5), Math.round(maximum * .25), 0])].sort((a, b) => b - a)
    : [maximum, maximum * .75, maximum * .5, maximum * .25, 0];

  return (
    <svg className="token-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".24" />
          <stop offset="100%" stopColor={color} stopOpacity=".02" />
        </linearGradient>
      </defs>
      {tickValues.map((value) => {
        const y = chart.top + chartHeight - value / maximum * chartHeight;
        return (
          <g key={value}>
            <line x1={chart.left} x2={chart.left + chartWidth} y1={y} y2={y} />
            <text x={chart.left - 8} y={y + 3} textAnchor="end">{integerValues ? formatTokenCount(value) : formatCompactNumber(value)}</text>
          </g>
        );
      })}
      {areaPoints ? <polygon className="token-trend-area" points={areaPoints} style={{ fill: `url(#${gradientId})` }} /> : null}
      {linePoints ? <polyline className="token-trend-line" points={linePoints} style={{ stroke: color }} /> : null}
      {points.map((point, index) => (
        <g key={point.date}>
          <circle cx={point.x} cy={point.y} r="3.2" style={{ stroke: color }}><title>{point.date}：{formatTokenCount(point.value)} {valueSuffix}</title></circle>
          {(index % 2 === 0 || index === points.length - 1) && <text className="token-date-label" x={point.x} y={height - 8} textAnchor="middle">{point.label}</text>}
        </g>
      ))}
    </svg>
  );
}

function friendlyToolName(name: unknown): string {
  const text = typeof name === 'string' ? name : '专业工具';
  const names: Record<string, string> = {
    'huashu-excel': '数据分析规范',
    skill: '专业能力',
    read: '读取工作簿',
    write: '生成成果文件',
    edit: '编辑成果文件',
    bash: '数据计算与处理',
    glob: '查找文件',
    grep: '检索内容',
    list: '浏览工作区',
    todowrite: '更新处理计划',
  };
  return names[text] || text.replaceAll('_', ' · ').replaceAll('-', ' ');
}

function processLabel(event: RuntimeEvent): Omit<ProcessItem, 'id'> | null {
  const rawName = typeof event.data.name === 'string' ? event.data.name : '专业工具';
  const name = friendlyToolName(rawName);
  const detail = typeof event.data.detail === 'string' ? event.data.detail : undefined;
  const durationMs = typeof event.data.durationMs === 'number' ? event.data.durationMs : undefined;
  const kind = event.type.startsWith('skill.') ? 'skill' : event.type.startsWith('tool.') ? 'tool' : 'agent';
  const key = kind === 'agent' ? 'agent' : `${kind}:${rawName}:${detail ?? ''}`;

  if (event.type === 'agent.started') {
    return { key, label: '理解需求并规划处理步骤', detail: '正在确定任务类型、数据范围和处理顺序', status: 'running' };
  }
  if (event.type === 'skill.started') return { key, label: `调用专业能力：${name}`, detail, status: 'running' };
  if (event.type === 'skill.completed') {
    return { key, label: `专业能力已完成：${name}`, detail, durationMs, status: event.data.ok === false ? 'error' : 'done' };
  }
  if (event.type === 'tool.started') return { key, label: `正在执行：${name}`, detail, status: 'running' };
  if (event.type === 'tool.completed') {
    return { key, label: `执行完成：${name}`, detail, durationMs, status: event.data.ok === false ? 'error' : 'done' };
  }
  if (event.type === 'agent.completed') return { key, label: '处理完成，结果已保存', durationMs, status: 'done' };
  if (event.type === 'agent.error') {
    return { key, label: typeof event.data.message === 'string' ? event.data.message : '处理未完成', status: 'error' };
  }
  return null;
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: linkChildren, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">{linkChildren}</a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function ProcessPanel({ items, running }: { items: ProcessItem[]; running: boolean }) {
  const [open, setOpen] = useState(running);
  if (!items.length) return null;
  const completed = items.filter((item) => item.status === 'done').length;
  const totalDuration = items.reduce((total, item) => Math.max(total, item.durationMs ?? 0), 0);
  const duration = formatDuration(totalDuration);

  return (
    <section className={`process-panel ${open ? 'open' : ''}`}>
      <button type="button" className="process-toggle" onClick={() => setOpen((value) => !value)}>
        <span className="process-heading">
          {running ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
          {running ? `正在处理 · ${items.length} 个步骤` : `处理过程 · ${completed || items.length} 个步骤`}
          {duration ? <small>{duration}</small> : null}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="process-list">
          {items.map((item) => (
            <div className={`process-row ${item.status}`} key={item.id}>
              <i>
                {item.status === 'running'
                  ? <LoaderCircle className="spin" size={13} />
                  : item.status === 'error' ? <X size={13} /> : <Check size={13} />}
              </i>
              <span className="process-copy">
                <strong>{item.label}</strong>
                {(item.detail || formatDuration(item.durationMs)) && (
                  <small>
                    {item.detail}
                    {item.detail && formatDuration(item.durationMs) ? ' · ' : ''}
                    {formatDuration(item.durationMs)}
                  </small>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SessionTitle({ title, running }: { title: string; running?: boolean }) {
  return (
    <span className="session-copy">
      <span className="session-title-viewport"><strong>{title}</strong></span>
      {running ? (
        <span className="session-running-indicator" title="正在处理" aria-label="正在处理">
          <LoaderCircle className="spin" size={14} />
        </span>
      ) : null}
    </span>
  );
}

function AssistantMessage({ message, processItems }: { message: AiMessage; processItems?: ProcessItem[] }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const duration = formatResponseDuration(message.metrics?.durationMs);
  const tokenDetail = message.metrics?.inputTokens !== undefined && message.metrics.outputTokens !== undefined
    ? `输入 ${formatTokenCount(message.metrics.inputTokens)} · 输出 ${formatTokenCount(message.metrics.outputTokens)}`
    : '根据回答文本长度估算';

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied by the browser; keep the action retryable.
    }
  }

  return (
    <article className="message-row assistant-message">
      <div className="message-avatar ai-avatar"><Sparkles size={17} /></div>
      <div className="message-body">
        <div className="message-author">智数 AI 助手</div>
        {processItems && <ProcessPanel items={processItems} running={false} />}
        <Markdown>{message.content}</Markdown>
        <div className="message-footer">
          <button
            type="button"
            className={`copy-answer ${copied ? 'copied' : ''}`}
            onClick={() => void copyAnswer()}
            title={copied ? '已复制' : '复制回答'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
          <div className="message-metrics" aria-label="本次回答统计">
            {duration ? <span>用时 {duration}</span> : null}
            {message.metrics ? (
              <span title={tokenDetail}>
                {message.metrics.tokenEstimated ? '约 ' : ''}{formatTokenCount(message.metrics.tokenCount)} tokens
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function UserMessage({ message, user }: { message: AiMessage; user: AuthUser }) {
  return (
    <article className="message-row user-message">
      <div className="message-avatar user-avatar" style={{ backgroundColor: avatarColor(`${user.id}:${displayName(user)}`) }}>
        {avatarInitial(displayName(user))}
      </div>
      <div className="message-body">
        <div className="message-author">{displayName(user)}</div>
        {message.attachments?.length ? (
          <div className="message-attachments">
            {message.attachments.map((file) => (
              <span className="message-attachment" key={file.id}>
                <FileSpreadsheet size={15} />{file.name}
              </span>
            ))}
          </div>
        ) : null}
        <p className="user-content">{message.content}</p>
      </div>
    </article>
  );
}

function LoginScreen({
  onLogin, onRegister,
}: {
  onLogin: (account: string, password: string) => Promise<void>;
  onRegister: (name: string, phone: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [phone, setPhone] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'register') {
        if (registerPassword !== confirmPassword) {
          setError('两次输入的密码不一致');
          return;
        }
        await onRegister(registerName.trim(), phone.trim(), registerPassword);
      } else {
        await onLogin(account.trim(), password);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : mode === 'register' ? '注册失败，请稍后重试' : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-visual">
          <div className="login-visual-brand">
            <span><Table2 size={21} /></span>
            <div>
              <strong>智数AI助手</strong>
              <small>你身边的私人数据分析师</small>
            </div>
          </div>
          <div className="login-visual-copy">
            <h1>左边看数据，<br />右边问 AI。</h1>
            <p>上传一堆 Excel，用自然语言做清洗、计算、透视和统计，并能持续分析、生成经营分析报告。</p>
            <div className="login-proof-line">体检脏表 · 定口径 · 算指标 · 对账 · 出报告</div>
            <div className="login-stats" aria-label="能力数据">
              <div><strong>操作</strong><span>计算 / 清洗 / 汇总 / 透视 / 合并拆分</span></div>
              <div><strong>报告</strong><span>核验 / 分析 / 图表 / HTML·DOCX·XLSX</span></div>
              <div><strong>可追问</strong><span>让算出来的数字经得起追问</span></div>
            </div>
            <div className="login-domains" aria-label="覆盖的分析场景">
              {['统计汇总', '数据清洗', '公式计算', '透视合并', '经营分析', '趋势分析', '预算执行', '业务结构', '对账核验'].map((domain) => (
                <span key={domain}>{domain}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="login-panel">
          <div className="login-panel-inner">
            <div className="login-mobile-brand"><span><Table2 size={19} /></span><strong>智数AI助手</strong></div>
            <div className="login-copy">
              {mode === 'register' && <span>创建账号</span>}
              <h2>{mode === 'login' ? '欢迎回来' : '注册普通用户'}</h2>
              <p>{mode === 'login' ? '登录后继续你的数据分析工作' : '使用手机号创建你的分析助手账号'}</p>
            </div>
            <div className="auth-mode-switch" role="tablist" aria-label="登录或注册">
              <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>登录</button>
              <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>手机号注册</button>
            </div>
            <form onSubmit={submit}>
              {mode === 'login' ? (
                <>
                  <label>
                    <span>账号</span>
                    <input autoComplete="username" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="手机号、邮箱或管理员账号" />
                  </label>
                  <label>
                    <span>密码</span>
                    <input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>用户名</span>
                    <input autoComplete="name" maxLength={30} value={registerName} onChange={(e) => setRegisterName(e.target.value)} placeholder="请输入用户名" />
                  </label>
                  <label>
                    <span>手机号</span>
                    <input autoComplete="tel" inputMode="tel" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="请输入 11 位手机号" />
                  </label>
                  <label>
                    <span>密码</span>
                    <input autoComplete="new-password" type="password" value={registerPassword} onChange={(e) => setRegisterPassword(e.target.value)} placeholder="请输入 8 至 64 位密码" />
                  </label>
                  <label>
                    <span>确认密码</span>
                    <input autoComplete="new-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="请再次输入密码" />
                  </label>
                </>
              )}
              {error && <div className="login-error">{error}</div>}
              <button
                type="submit"
                disabled={submitting || (mode === 'login' ? !account || !password : !registerName.trim() || phone.length !== 11 || registerPassword.length < 8 || !confirmPassword)}
              >
                {submitting ? <LoaderCircle className="spin" size={17} /> : null}
                {submitting ? (mode === 'login' ? '正在登录' : '正在注册') : (mode === 'login' ? '登录' : '注册并登录')}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function AdminUserDialog({
  mode, onClose, onCreate, onReset,
}: {
  mode: { kind: 'create' } | { kind: 'reset'; user: AdminUser };
  onClose: () => void;
  onCreate: (input: { account: string; name: string; password: string }) => Promise<void>;
  onReset: (user: AdminUser, password: string) => Promise<void>;
}) {
  const [account, setAccount] = useState('');
  const [name, setName] = useState(mode.kind === 'reset' ? mode.user.name || mode.user.account : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, submitting]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (mode.kind === 'create' && (!account.trim() || !name.trim())) {
      setError('请填写账号和用户名');
      return;
    }
    if (password.length < 8 || password.length > 64) {
      setError('密码长度需为 8 至 64 位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      if (mode.kind === 'create') await onCreate({ account: account.trim(), name: name.trim(), password });
      else await onReset(mode.user, password);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  const isCreate = mode.kind === 'create';
  return (
    <div className="admin-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section className="admin-dialog" role="dialog" aria-modal="true">
        <header>
          <div className="admin-dialog-title">
            <span><Users size={18} /></span>
            <div><strong>{isCreate ? '添加用户' : '重置密码'}</strong><small>{isCreate ? '创建普通用户账号' : `为 ${mode.user.name || mode.user.account} 设置新密码`}</small></div>
          </div>
          <button type="button" className="preview-close" aria-label="关闭" onClick={onClose} disabled={submitting}><X size={18} /></button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          {isCreate && (
            <>
              <label><span>邮箱或手机号</span><input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="例如 name@example.com 或 13800000000" autoComplete="username" autoFocus /></label>
              <label><span>用户名</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入用户名" maxLength={30} /></label>
            </>
          )}
          <label><span>{isCreate ? '初始密码' : '新密码'}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 至 64 位" autoComplete="new-password" autoFocus={!isCreate} /></label>
          <label><span>确认密码</span><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入密码" autoComplete="new-password" /></label>
          {error && <div className="admin-dialog-error"><TriangleAlert size={15} />{error}</div>}
          <footer>
            <button type="button" className="admin-dialog-cancel" onClick={onClose} disabled={submitting}>取消</button>
            <button type="submit" className="admin-dialog-submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" size={15} /> : isCreate ? <Users size={15} /> : <KeyRound size={15} />}
              {submitting ? '正在保存' : isCreate ? '创建用户' : '保存新密码'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function AdminPanel({
  view, currentUserId, onView, onClose, onLogout, onOpenSidebar,
}: {
  view: AdminView;
  currentUserId: string;
  onView: (view: AdminView) => void;
  onClose: () => void;
  onLogout: () => void;
  onOpenSidebar: () => void;
}) {
  const [loaded, setLoaded] = useState<{ view: AdminView; users?: AdminUser[]; stats?: AdminStats; error?: string } | null>(null);
  const [userOverrides, setUserOverrides] = useState<{ view: AdminView; rows: AdminUser[] } | null>(null);
  const [busyUserId, setBusyUserId] = useState('');
  const [panelError, setPanelError] = useState('');
  const [userDialog, setUserDialog] = useState<{ kind: 'create' } | { kind: 'reset'; user: AdminUser } | null>(null);

  const ready = loaded?.view === view;
  const loading = !ready;
  const users = (userOverrides?.view === view ? userOverrides.rows : null) ?? loaded?.users ?? [];
  const stats = ready ? loaded?.stats ?? null : null;
  const dataError = ready ? loaded?.error : undefined;
  const setUsers = (updater: AdminUser[] | ((rows: AdminUser[]) => AdminUser[])) =>
    setUserOverrides({ view, rows: typeof updater === 'function' ? updater(users) : updater });

  useEffect(() => {
    let active = true;
    const request = view === 'users' ? api.admin.users() : api.admin.stats();
    void request.then((result) => {
      if (!active) return;
      setLoaded(view === 'users' ? { view, users: result as AdminUser[] } : { view, stats: result as AdminStats });
    }).catch((cause) => {
      if (active) setLoaded({ view, error: cause instanceof ApiError ? cause.message : '管理数据加载失败' });
    });
    return () => { active = false; };
  }, [view]);

  async function toggleUser(item: AdminUser) {
    if (item.role === 'admin' || item.id === currentUserId) return;
    setBusyUserId(item.id);
    setPanelError('');
    try {
      const updated = await api.admin.updateUserStatus(item.id, item.status === 'active' ? 'disabled' : 'active');
      setUsers((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : '用户状态更新失败');
    } finally {
      setBusyUserId('');
    }
  }

  async function createUser(input: { account: string; name: string; password: string }) {
    const created = await api.admin.createUser(input);
    setUsers((rows) => [created, ...rows]);
  }

  async function resetUserPassword(item: AdminUser, newPassword: string) {
    setBusyUserId(item.id);
    try {
      await api.admin.resetUserPassword(item.id, newPassword);
    } finally {
      setBusyUserId('');
    }
  }

  async function removeUser(item: AdminUser) {
    const deletingSelf = item.id === currentUserId;
    if (!window.confirm(`确定删除${item.role === 'admin' ? '管理员' : '用户'}“${item.name || item.account}”吗？该账号的任务、消息、文件和成果将一并永久删除。${deletingSelf ? '删除当前账号后将立即退出登录。' : ''}`)) return;
    setBusyUserId(item.id);
    setPanelError('');
    try {
      await api.admin.removeUser(item.id);
      if (deletingSelf) onLogout();
      else setUsers((rows) => rows.filter((row) => row.id !== item.id));
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : '用户删除失败');
    } finally {
      setBusyUserId('');
    }
  }

  const categories = stats?.categories ?? [];
  const dailyTokens = stats?.dailyTokens ?? [];
  const topCommands = stats?.topCommands ?? [];
  const dailyActiveTrend = stats?.dailyActiveTrend ?? [];
  const dailySessionTrend = stats?.dailySessionTrend ?? [];
  const topUsers = stats?.topUsers ?? [];
  const totalCategoryCount = categories.reduce((sum, item) => sum + item.count, 0);
  const maxCommandCount = Math.max(1, ...topCommands.map((item) => item.count));
  const maxUserSessionCount = Math.max(1, ...topUsers.map((item) => item.count));

  return (
    <section className="admin-workspace" aria-label="管理员控制台">
      <header>
        <div>
          <button type="button" className="mobile-menu" aria-label="打开历史任务" onClick={onOpenSidebar}><Menu size={20} /></button>
          <span><ShieldCheck size={19} /></span><div><strong>管理员控制台</strong><small>用户与统计分析</small></div>
        </div>
        <button type="button" className="admin-return" onClick={onClose}><MessageSquareText size={16} />返回工作台</button>
      </header>
      <nav aria-label="管理功能">
        <button type="button" className={view === 'users' ? 'active' : ''} onClick={() => onView('users')}><Users size={16} />用户管理</button>
        <button type="button" className={view === 'stats' ? 'active' : ''} onClick={() => onView('stats')}><BarChart3 size={16} />统计分析</button>
      </nav>
      <div className="admin-panel-content">
        {loading ? (
          <div className="admin-state"><LoaderCircle className="spin" size={20} />正在加载</div>
        ) : (panelError || dataError) ? (
          <div className="admin-state error"><TriangleAlert size={19} />{panelError || dataError}</div>
        ) : view === 'users' ? (
          <section className="admin-users">
            <div className="admin-section-heading">
              <div><h2>用户管理</h2><p>注册用户只能获得普通用户角色</p></div>
              <div className="admin-heading-actions"><span>{users.length} 个账号</span><button type="button" className="admin-add-user" onClick={() => setUserDialog({ kind: 'create' })}><Plus size={15} />添加用户</button></div>
            </div>
            <div className="admin-user-list">
              {users.map((item) => (
                <div className="admin-user-row" key={item.id}>
                  <span className="admin-user-avatar" style={{ backgroundColor: avatarColor(`${item.id}:${item.name || item.account}`) }}>
                    {avatarInitial(item.name || item.account)}
                  </span>
                  <div className="admin-user-identity"><strong>{item.name || item.account}</strong><small>{item.account}</small></div>
                  <span className={`role-badge ${item.role}`}>{item.role === 'admin' ? '管理员' : '用户'}</span>
                  <div className="admin-user-data"><strong>{item.sessionCount}</strong><small>任务</small></div>
                  <div className="admin-user-login"><strong>{formatAdminDate(item.lastLoginAt)}</strong><small>最近登录</small></div>
                  <div className="admin-user-actions">
                    <button type="button" className={`user-status-button ${item.status}`}
                      disabled={item.role === 'admin' || item.id === currentUserId || busyUserId === item.id}
                      onClick={() => void toggleUser(item)}>
                      {busyUserId === item.id ? <LoaderCircle className="spin" size={14} /> : item.status === 'active' ? <CircleCheck size={14} /> : <TriangleAlert size={14} />}
                      {item.status === 'active' ? '已启用' : '已停用'}
                    </button>
                    <button type="button" className="admin-user-action" disabled={busyUserId === item.id} onClick={() => setUserDialog({ kind: 'reset', user: item })}>
                      <KeyRound size={14} />重置密码
                    </button>
                    <button type="button" className="admin-user-action danger" disabled={busyUserId === item.id} onClick={() => void removeUser(item)}>
                      <Trash2 size={14} />删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : stats ? (
          <section className="admin-stats">
            <div className="admin-section-heading"><div><h2>统计分析</h2><p>当前租户的实时汇总数据</p></div><span>今日</span></div>
            <div className="stats-grid">
              <div><span><Users size={16} /></span><strong>{formatTokenCount(stats.totalUsers)}</strong><small>用户数 · {stats.activeUsers} 个启用</small></div>
              <div><span><UserRound size={16} /></span><strong>{formatTokenCount(stats.dailyActiveUsers)}</strong><small>今日活跃用户</small></div>
              <div><span><MessageSquareText size={16} /></span><strong>{formatTokenCount(stats.totalSessions)}</strong><small>任务数 · 今日 {stats.todaySessions}</small></div>
              <div><span><Sparkles size={16} /></span><strong>{formatTokenCount(stats.totalTokens)}</strong><small>tokens · 今日 {formatTokenCount(stats.todayTokens)}</small></div>
              <div><span><FileText size={16} /></span><strong>{formatTokenCount(stats.artifactCount)}</strong><small>生成成果 · 今日 {stats.todayArtifactCount}</small></div>
              <div><span><Table2 size={16} /></span><strong>{formatTokenCount(stats.inputTokens)}</strong><small>输入 tokens</small></div>
            </div>
            <div className="stats-analytics-grid">
              <section className="analytics-card token-trend-card">
                <header><div><h3>每日 Token 消耗</h3><p>最近 14 天 · 输入与输出合计</p></div><span>趋势</span></header>
                <MetricTrendChart items={dailyTokens.map((i) => ({ date: i.date, label: i.label, value: i.tokens }))}
                  ariaLabel="每日 Token 消耗折线图" gradientId="token-trend-area" color="#8e2634" valueSuffix="tokens" />
              </section>
              <section className="analytics-card active-trend-card">
                <header><div><h3>日活用户趋势</h3><p>最近 14 天 · 发起任务的去重用户</p></div><span>DAU</span></header>
                <MetricTrendChart items={dailyActiveTrend.map((i) => ({ date: i.date, label: i.label, value: i.count }))}
                  ariaLabel="日活用户折线图" gradientId="active-trend-area" color="#547c8f" valueSuffix="位用户" integerValues />
              </section>
              <section className="analytics-card session-trend-card">
                <header><div><h3>每日任务趋势</h3><p>最近 14 天 · 新建任务数量</p></div><span>任务</span></header>
                <MetricTrendChart items={dailySessionTrend.map((i) => ({ date: i.date, label: i.label, value: i.count }))}
                  ariaLabel="每日任务数量折线图" gradientId="session-trend-area" color="#3f7f68" valueSuffix="个任务" integerValues />
              </section>
              <section className="analytics-card category-pie-card">
                <header><div><h3>分析类型占比</h3><p>按一级任务分类</p></div><span>占比</span></header>
                {categories.length ? (
                  <div className="category-pie-layout">
                    <div className="category-pie" style={categoryPieStyle(categories)}>
                      <span><strong>{totalCategoryCount}</strong><small>个任务</small></span>
                    </div>
                    <div className="category-pie-legend">
                      {categories.map((item, index) => (
                        <div key={item.name}>
                          <i style={{ background: CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length] }} />
                          <span>{item.name}</span>
                          <strong>{totalCategoryCount ? Math.round(item.count / totalCategoryCount * 100) : 0}%</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <div className="admin-state compact">暂无分类统计</div>}
              </section>
              <section className="analytics-card command-ranking-card">
                <header><div><h3>分析类型 Top 5</h3><p>按二级任务统计</p></div><span>排行</span></header>
                <div className="command-ranking">
                  {topCommands.length ? topCommands.map((item, index) => (
                    <div className="command-ranking-row" key={item.name}>
                      <b className={index < 3 ? 'top' : ''}>{index + 1}</b>
                      <span>{item.name}</span>
                      <i><em style={{ width: `${Math.max(5, item.count / maxCommandCount * 100)}%` }} /></i>
                      <strong>{item.count}</strong>
                    </div>
                  )) : <div className="admin-state compact">暂无排行数据</div>}
                </div>
              </section>
              <section className="analytics-card user-ranking-card">
                <header><div><h3>用户任务数量 Top 5</h3><p>按用户累计新建任务统计</p></div><span>用户</span></header>
                <div className="command-ranking">
                  {topUsers.length ? topUsers.map((item, index) => (
                    <div className="command-ranking-row" key={item.userId} title={`${item.name} · ${item.account}`}>
                      <b className={index < 3 ? 'top' : ''}>{index + 1}</b>
                      <span>{item.name}</span>
                      <i><em style={{ width: `${Math.max(5, item.count / maxUserSessionCount * 100)}%` }} /></i>
                      <strong>{item.count}</strong>
                    </div>
                  )) : <div className="admin-state compact">暂无用户排行</div>}
                </div>
              </section>
            </div>
          </section>
        ) : null}
      </div>
      {userDialog && <AdminUserDialog mode={userDialog} onClose={() => setUserDialog(null)} onCreate={createUser} onReset={resetUserPassword} />}
    </section>
  );
}

type ChatMessage = AiMessage & { local?: boolean };
type LoadedWorkbook = { key: string; data?: WorkbookSnapshot; error?: string };

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadArtifact(artifact: Artifact): Promise<void> {
  saveBlob(await api.artifacts.blob(artifact.id), artifact.name);
}

export default function ZhishuApp() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [tabs, setTabs] = useState<DataTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [loadedWorkbook, setLoadedWorkbook] = useState<LoadedWorkbook | null>(null);
  const [selection, setSelection] = useState<SheetSelection | null>(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<SessionMode>('operate');
  const [processItems, setProcessItems] = useState<ProcessItem[]>([]);
  const [processArchive, setProcessArchive] = useState<Record<string, ProcessItem[]>>({});
  const [liveMarkdown, setLiveMarkdown] = useState('');
  const [running, setRunning] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [adminView, setAdminView] = useState<AdminView | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const streamControllerRef = useRef<AbortController | null>(null);
  const currentSessionRef = useRef<string | null>(null);
  const processRef = useRef<ProcessItem[]>([]);
  const processSequenceRef = useRef(0);
  const bootedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const commandMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const currentSession = sessions.find((session) => session.id === currentSessionId) ?? null;
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const activeTab = tabs.find((tab) => tabKey(tab) === activeTabKey) ?? null;
  const query = historyQuery.trim().toLocaleLowerCase('zh-CN');
  const filteredSessions = sessions.filter((session) => session.title.toLocaleLowerCase('zh-CN').includes(query));
  const normalizedCommandQuery = commandQuery.trim().toLocaleLowerCase('zh-CN');
  const visibleCommandGroups = QUICK_COMMAND_CATEGORIES.map((category) => ({
    category,
    commands: QUICK_COMMANDS.filter((command) => {
      if (command.category !== category) return false;
      if (!normalizedCommandQuery) return true;
      return `${command.title} ${command.description} ${command.keywords}`.toLocaleLowerCase('zh-CN').includes(normalizedCommandQuery);
    }),
  })).filter((group) => group.commands.length > 0);

  function setCurrentProcess(items: ProcessItem[]) {
    processRef.current = items;
    setProcessItems(items);
  }

  function appendProcess(next: Omit<ProcessItem, 'id'>) {
    const items = [...processRef.current];
    if (next.status === 'running') {
      if (items.some((item) => item.key === next.key && item.status === 'running')) return;
    } else {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]?.key === next.key && items[index]?.status === 'running') {
          items[index] = { ...items[index], ...next };
          setCurrentProcess(items.slice(-20));
          return;
        }
      }
      const last = items.at(-1);
      if (last?.key === next.key && last.status === next.status && last.label === next.label) return;
    }
    processSequenceRef.current += 1;
    setCurrentProcess([...items, { id: `process-${processSequenceRef.current}`, ...next }].slice(-20));
  }

  function dropRunningProcess(key: string) {
    const items = [...processRef.current];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index]?.key === key && items[index]?.status === 'running') {
        items.splice(index, 1);
        setCurrentProcess(items);
        return;
      }
    }
  }

  function markSessionRunning(sessionId: string, isRunning: boolean) {
    setSessions((rows) => rows.map((session) => (session.id === sessionId ? { ...session, running: isRunning } : session)));
  }

  async function refreshSessions(): Promise<AiSession[]> {
    const rows = await api.sessions.list();
    setSessions(rows);
    const activeSessionId = currentSessionRef.current;
    if (activeSessionId) setRunning(Boolean(rows.find((session) => session.id === activeSessionId)?.running));
    return rows;
  }

  async function refreshMessages(sessionId: string) {
    const rows = await api.messages.list(sessionId);
    if (currentSessionRef.current === sessionId) setMessages(rows);
    return rows;
  }

  async function refreshArtifacts(sessionId: string) {
    const nextArtifacts = await api.artifacts.list(sessionId);
    if (currentSessionRef.current === sessionId) setArtifacts(nextArtifacts);
  }

  function openTab(tab: DataTab) {
    const key = tabKey(tab);
    setTabs((current) => current.some((item) => tabKey(item) === key) ? current : [...current, tab]);
    setActiveTabKey(key);
  }

  function closeTab(key: string) {
    setTabs((current) => {
      const index = current.findIndex((item) => tabKey(item) === key);
      const next = current.filter((item) => tabKey(item) !== key);
      if (activeTabKey === key) {
        const fallback = next[Math.max(0, index - 1)];
        setActiveTabKey(fallback ? tabKey(fallback) : null);
      }
      return next;
    });
  }

  const activeTabIsExcel = Boolean(activeTab && EXCEL_RE.test(activeTab.item.name));
  const wbForActive = loadedWorkbook && loadedWorkbook.key === activeTabKey ? loadedWorkbook : null;
  const workbook = wbForActive?.data ?? null;
  const workbookError = wbForActive?.error ?? null;
  const workbookLoading = activeTabIsExcel && !wbForActive;
  const activeSelection = activeTabIsExcel ? selection : null;

  // Load the workbook for the active Excel tab. State updates happen only from
  // the resolved request, never synchronously in the effect body.
  useEffect(() => {
    if (!activeTab || !EXCEL_RE.test(activeTab.item.name)) return;
    const key = tabKey(activeTab);
    let active = true;
    const request = activeTab.kind === 'file'
      ? api.files.workbook(activeTab.item.id)
      : api.artifacts.workbook(activeTab.item.id);
    request
      .then((snapshot) => { if (active) setLoadedWorkbook({ key, data: snapshot }); })
      .catch((cause) => {
        if (active) setLoadedWorkbook({ key, error: cause instanceof ApiError ? cause.message : 'Excel 加载失败' });
      });
    return () => { active = false; };
  }, [activeTab]);

  async function connectStream(sessionId: string): Promise<void> {
    streamControllerRef.current?.abort();
    const controller = new AbortController();
    streamControllerRef.current = controller;

    let markOpen: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => { markOpen = resolve; });

    const onEvent = (event: RuntimeEvent) => {
      if (event.sessionId !== currentSessionRef.current) return;

      if (event.type === 'tool.dropped') {
        // 沙箱按规则拦下了模型的越权/探查动作 —— 撤掉对应的“正在执行”步骤，不显示成错误。
        const rawName = typeof event.data.name === 'string' ? event.data.name : '专业工具';
        const detail = typeof event.data.detail === 'string' ? event.data.detail : '';
        dropRunningProcess(`tool:${rawName}:${detail}`);
        return;
      }

      const process = processLabel(event);
      if (process) appendProcess(process);

      if (event.type === 'agent.started') {
        appendProcess({ key: 'submission', label: '问题已提交', detail: '智数 AI 助手已开始处理', status: 'done' });
        markSessionRunning(event.sessionId, true);
        setRunning(true);
        setError('');
      }
      if (event.type === 'message.delta' && typeof event.data.content === 'string') {
        setLiveMarkdown((value) => value + event.data.content);
      }
      if (event.type === 'artifact') {
        const artifact = event.data as unknown as Artifact;
        setArtifacts((current) => current.some((a) => a.id === artifact.id) ? current.map((a) => a.id === artifact.id ? artifact : a) : [artifact, ...current]);
        openTab({ kind: 'artifact', item: artifact });
      }
      if (event.type === 'agent.completed') {
        markSessionRunning(event.sessionId, false);
        setRunning(false);
        const messageId = typeof event.data.messageId === 'string' ? event.data.messageId : '';
        if (messageId) setProcessArchive((archive) => ({ ...archive, [messageId]: [...processRef.current] }));
        void Promise.all([refreshMessages(event.sessionId), refreshSessions(), refreshArtifacts(event.sessionId)])
          .then(() => { setLiveMarkdown(''); setCurrentProcess([]); })
          .catch(() => undefined);
      }
      if (event.type === 'agent.error') {
        markSessionRunning(event.sessionId, false);
        setRunning(false);
        setError(typeof event.data.message === 'string' ? event.data.message : '本次处理未完成');
        void refreshSessions().catch(() => undefined);
      }
    };

    void streamSessionEvents(sessionId, onEvent, { signal: controller.signal, onOpen: markOpen })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof ApiError ? cause.message : '实时连接已中断');
      });

    await Promise.race([opened, new Promise<void>((resolve) => window.setTimeout(resolve, 2200))]);
  }

  async function openSession(sessionId: string) {
    setAdminView(null);
    currentSessionRef.current = sessionId;
    setCurrentSessionId(sessionId);
    setSidebarOpen(false);
    setLoadingChat(true);
    setError('');
    setLiveMarkdown('');
    setCurrentProcess([]);
    setTabs([]);
    setActiveTabKey(null);
    setLoadedWorkbook(null);
    setRunning(Boolean(sessions.find((s) => s.id === sessionId)?.running));
    try {
      const [, , sessionDetail, nextFiles, nextArtifacts] = await Promise.all([
        refreshMessages(sessionId),
        connectStream(sessionId),
        api.sessions.get(sessionId),
        api.files.listBySession(sessionId),
        api.artifacts.list(sessionId),
      ]);
      if (currentSessionRef.current !== sessionId) return;
      setSessions((rows) => rows.map((row) => row.id === sessionDetail.id ? sessionDetail : row));
      setFiles(nextFiles);
      setArtifacts(nextArtifacts);
      setRunning(sessionDetail.running);
      setMode(sessionDetail.mode);
      const firstExcel = nextFiles.find((f) => EXCEL_RE.test(f.name));
      if (firstExcel) openTab({ kind: 'file', item: firstExcel });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '无法打开历史任务');
    } finally {
      setLoadingChat(false);
    }
  }

  function startNewChat() {
    setAdminView(null);
    streamControllerRef.current?.abort();
    currentSessionRef.current = null;
    setCurrentSessionId(null);
    setMessages([]);
    setFiles([]);
    setArtifacts([]);
    setTabs([]);
    setActiveTabKey(null);
    setLoadedWorkbook(null);
    setLiveMarkdown('');
    setCurrentProcess([]);
    setRunning(false);
    setError('');
    setSidebarOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function createSession(title: string): Promise<string> {
    const session = await api.sessions.create(title.slice(0, 42) || '新任务', mode);
    setSessions((rows) => [session, ...rows]);
    currentSessionRef.current = session.id;
    setCurrentSessionId(session.id);
    setMessages([]);
    setFiles([]);
    setArtifacts([]);
    setTabs([]);
    setActiveTabKey(null);
    await connectStream(session.id);
    return session.id;
  }

  async function enterWorkspace(nextUser: AuthUser) {
    setUser(nextUser);
    setAuthState('ready');
    const rows = await refreshSessions();
    if (rows[0]) await openSession(rows[0].id);
  }

  async function login(account: string, password: string) {
    const result = await api.auth.login(account, password);
    await enterWorkspace(result.user);
  }

  async function register(name: string, phone: string, password: string) {
    const result = await api.auth.register(name, phone, password);
    await enterWorkspace(result.user);
  }

  function logout() {
    streamControllerRef.current?.abort();
    api.auth.logout();
    currentSessionRef.current = null;
    setUser(null);
    setSessions([]);
    setMessages([]);
    setAdminView(null);
    setAccountMenuOpen(false);
    setAuthState('guest');
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selected.length || uploading) return;
    const oversized = selected.filter((file) => file.size > MAX_UPLOAD_BYTES);
    if (oversized.length) {
      setError(`文件不能超过 100 MB：${oversized.map((file) => file.name).join('、')}`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      let sessionId = currentSessionRef.current;
      if (!sessionId) sessionId = await createSession(selected[0]?.name.replace(/\.[^.]+$/, '') || '数据分析');
      let firstUploaded: UploadedFile | null = null;
      for (const file of selected) {
        const uploaded = await api.files.upload(sessionId, file);
        setFiles((rows) => [...rows, uploaded]);
        if (!firstUploaded) firstUploaded = uploaded;
      }
      if (firstUploaded) openTab({ kind: 'file', item: firstUploaded });
      textareaRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '文件上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function removeFile(file: UploadedFile) {
    if (!window.confirm(`删除文件“${file.name}”？仅删除当前任务中的副本。`)) return;
    try {
      await api.files.remove(file.id);
      closeTab(`file:${file.id}`);
      setFiles((rows) => rows.filter((row) => row.id !== file.id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '删除失败');
    }
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || running || uploading || !user) return;
    setError('');
    let sessionId = currentSessionRef.current;
    if (!sessionId) {
      try {
        sessionId = await createSession(content.replace(/\s+/g, ' ').slice(0, 30));
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : '无法创建新任务');
        return;
      }
    }

    const attachedFileIds = files.map((file) => file.id);
    const context = {
      file: activeTab?.item.name,
      sheet: activeSelection?.sheet || undefined,
      selection: activeSelection?.range || undefined,
    };
    const optimistic: ChatMessage = {
      id: `local-${sessionId}-${messages.length}`,
      role: 'user',
      content,
      status: 'COMPLETED',
      createdAt: new Date().toISOString(),
      attachments: [...files],
      local: true,
    };
    setMessages((rows) => [...rows, optimistic]);
    setDraft('');
    setLiveMarkdown('');
    setCurrentProcess([]);
    appendProcess({ key: 'submission', label: '问题已提交', detail: '等待智数 AI 助手开始分析', status: 'running' });
    markSessionRunning(sessionId, true);
    setRunning(true);

    try {
      await api.messages.send(sessionId, content, attachedFileIds, mode, context);
      const session = sessions.find((row) => row.id === sessionId);
      if (session && (session.title === '新任务' || session.title === '数据分析')) {
        await api.sessions.update(sessionId, { title: content.replace(/\s+/g, ' ').slice(0, 30) }).catch(() => undefined);
      }
      await refreshSessions();
    } catch (cause) {
      const sessionBusy = cause instanceof ApiError && cause.code === 'SESSION_BUSY';
      setRunning(sessionBusy);
      markSessionRunning(sessionId, sessionBusy);
      setError(sessionBusy ? '当前任务已有处理在进行，完成后即可继续提问。' : cause instanceof ApiError ? cause.message : '消息发送失败');
      await Promise.all([refreshMessages(sessionId), refreshSessions()]).catch(() => undefined);
    }
  }

  async function abortRun() {
    const sessionId = currentSessionRef.current;
    if (!sessionId || !running) return;
    try {
      await api.messages.abort(sessionId);
      markSessionRunning(sessionId, false);
      setRunning(false);
      await refreshSessions().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '停止失败');
    }
  }

  async function deleteSession(session: AiSession) {
    if (!window.confirm(`删除任务“${session.title}”？其中的文件、对话和成果将一并删除，且无法恢复。`)) return;
    try {
      await api.sessions.remove(session.id);
      const rows = await refreshSessions();
      if (session.id === currentSessionRef.current) {
        if (rows[0]) await openSession(rows[0].id);
        else startNewChat();
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '删除任务失败');
    }
  }

  function applyCommand(command: QuickCommand) {
    setMode(command.mode);
    setDraft(command.prompt);
    setCommandOpen(false);
    setCommandQuery('');
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(command.prompt.length, command.prompt.length);
    }, 0);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const boot = async () => {
      if (!getAccessToken()) { setAuthState('guest'); return; }
      try {
        const me = await api.auth.me();
        await enterWorkspace(me);
      } catch {
        api.auth.logout();
        setAuthState('guest');
      }
    };
    void boot();
    return () => streamControllerRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const expired = () => logout();
    window.addEventListener('zhishu:auth-expired', expired);
    return () => window.removeEventListener('zhishu:auth-expired', expired);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: running ? 'smooth' : 'auto', block: 'end' });
  }, [messages, liveMarkdown, processItems, running]);

  const hasRunningSessions = sessions.some((session) => session.running);
  useEffect(() => {
    if (authState !== 'ready' || !hasRunningSessions) return;
    const timer = window.setInterval(() => {
      void api.sessions.list().then((rows) => {
        setSessions(rows);
        const activeSessionId = currentSessionRef.current;
        if (activeSessionId) setRunning(Boolean(rows.find((session) => session.id === activeSessionId)?.running));
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [authState, hasRunningSessions]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(200, Math.max(48, textarea.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    if (!commandOpen) return;
    const closeWhenOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !commandMenuRef.current?.contains(target)) setCommandOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setCommandOpen(false); };
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [commandOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeWhenOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !accountMenuRef.current?.contains(target)) setAccountMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeWhenOutside);
    return () => document.removeEventListener('pointerdown', closeWhenOutside);
  }, [accountMenuOpen]);

  if (authState === 'checking') {
    return (
      <main className="boot-screen">
        <span><Table2 size={22} /></span>
        <LoaderCircle className="spin" size={22} />
      </main>
    );
  }

  if (authState === 'guest' || !user) return <LoginScreen onLogin={login} onRegister={register} />;

  const contextParts = [activeTab?.item.name, activeSelection?.sheet, activeSelection?.range].filter(Boolean) as string[];
  const contextSummary = activeSelection?.range ?? activeSelection?.sheet ?? activeTab?.item.name ?? '未选择数据';

  return (
    <div className="chat-app">
      <button type="button" aria-label="关闭历史任务" className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span><Table2 size={20} /></span>
          <div><strong>智数AI助手</strong><small>你身边的私人数据分析师</small></div>
          <button type="button" aria-label="关闭侧边栏" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>

        <button type="button" className="new-chat-button" onClick={startNewChat}><Plus size={17} />新任务</button>

        <label className="history-search">
          <Search size={15} />
          <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索历史任务" />
        </label>

        <div className="history-heading"><History size={14} />历史任务</div>
        <nav className="session-list" aria-label="历史任务">
          {filteredSessions.map((session) => (
            <div className={`session-item ${session.id === currentSessionId ? 'active' : ''} ${session.running ? 'running' : ''}`} key={session.id}>
              <button type="button" className="session-open" onClick={() => void openSession(session.id)}>
                <MessageSquareText size={15} />
                <SessionTitle title={session.title} running={session.running} />
              </button>
              <button type="button" className="session-delete" aria-label={`删除 ${session.title}`} onClick={() => void deleteSession(session)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!filteredSessions.length && (
            <div className="history-empty">{historyQuery ? '没有匹配的任务' : '还没有历史任务'}</div>
          )}
        </nav>

        <div className="sidebar-account" ref={accountMenuRef}>
          {accountMenuOpen && (
            <div className="account-menu" role="menu" aria-label="账号功能">
              {user.role === 'admin' && (
                <>
                  <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setSidebarOpen(false); setAdminView('stats'); }}>
                    <BarChart3 size={17} />
                    <span><strong>统计分析</strong><small>查看用户、任务和 Token 数据</small></span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setSidebarOpen(false); setAdminView('users'); }}>
                    <Users size={17} />
                    <span><strong>用户管理</strong><small>管理用户账号与启用状态</small></span>
                  </button>
                  <i />
                </>
              )}
              <button type="button" role="menuitem" className="account-menu-logout" onClick={logout}>
                <LogOut size={17} />
                <span><strong>退出登录</strong><small>安全退出当前账号</small></span>
              </button>
            </div>
          )}
          <button type="button" className="sidebar-user" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>
            <span style={{ backgroundColor: avatarColor(`${user.id}:${displayName(user)}`) }}>{avatarInitial(displayName(user))}</span>
            <div><strong>{displayName(user)}</strong><small>{user.role === 'admin' ? '管理员' : '普通用户'} · {user.tenantName}</small></div>
            <ChevronDown className={accountMenuOpen ? 'open' : ''} size={16} />
          </button>
        </div>
      </aside>

      <main className="chat-main">
        {adminView && user.role === 'admin' ? (
          <AdminPanel key={adminView} view={adminView} currentUserId={user.id} onView={setAdminView}
            onClose={() => setAdminView(null)} onLogout={logout} onOpenSidebar={() => setSidebarOpen(true)} />
        ) : (
          <PanelGroup direction="horizontal" className="workbench">
            <Panel defaultSize={58} minSize={30} className="data-pane">
              <div className="data-tabs">
                <button type="button" className="mobile-menu" aria-label="打开历史任务" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
                {tabs.map((tab) => {
                  const key = tabKey(tab);
                  return (
                    <button key={key} className={`data-tab ${key === activeTabKey ? 'active' : ''} ${tab.kind === 'artifact' ? 'artifact' : ''}`} onClick={() => setActiveTabKey(key)}>
                      {tab.kind === 'artifact' ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
                      <span>{tab.item.name}</span>
                      <small>{tab.kind === 'file' ? '输入' : '成果'}</small>
                      <X size={13} onClick={(e) => { e.stopPropagation(); closeTab(key); }} />
                    </button>
                  );
                })}
                {tabs.length === 0 && <span className="data-tab-placeholder"><LayoutGrid size={14} /> 数据工作区</span>}
                <label className="data-upload">
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm,.xltx,.xltm" multiple hidden onChange={(event) => void uploadFiles(event)} />
                  <span onClick={() => fileInputRef.current?.click()}>
                    {uploading ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}上传 Excel
                  </span>
                </label>
              </div>

              <div className="data-content">
                {!activeTab ? (
                  <div className="data-empty">
                    <div className="data-empty-icon"><FileSpreadsheet size={30} /></div>
                    <h2>上传 Excel 开始分析</h2>
                    <p>{UPLOAD_HINT}</p>
                    <button type="button" className="data-empty-upload" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}选择文件
                    </button>
                  </div>
                ) : activeTabIsExcel ? (
                  workbook ? (
                    <>
                      {workbook.truncated && <div className="data-truncated"><TriangleAlert size={14} />工作簿较大，仅预览部分行列；AI 分析仍基于完整文件。</div>}
                      <Suspense fallback={<div className="data-state"><LoaderCircle className="spin" size={20} />正在加载表格组件</div>}>
                        <UniverViewer workbook={workbook} onSelectionChange={setSelection} />
                      </Suspense>
                    </>
                  ) : workbookLoading ? (
                    <div className="data-state"><LoaderCircle className="spin" size={20} />正在解析工作簿</div>
                  ) : (
                    <div className="data-state error"><TriangleAlert size={18} />{workbookError ?? '无法渲染该工作簿'}</div>
                  )
                ) : activeTab.kind === 'artifact' ? (
                  <ArtifactPreview artifact={activeTab.item} />
                ) : (
                  <div className="data-state">该文件类型暂不支持预览</div>
                )}
              </div>

              <div className="data-footer">
                <div className="data-lists">
                  <div className="data-list">
                    <span className="data-list-label"><FileSpreadsheet size={13} /> 输入文件 {files.length}</span>
                    {files.map((file) => (
                      <span key={file.id} className={`data-chip ${activeTab?.kind === 'file' && activeTab.item.id === file.id ? 'active' : ''}`}>
                        <button type="button" onClick={() => openTab({ kind: 'file', item: file })}>{file.name}<small>{formatFileSize(file.size)}</small></button>
                        <X size={12} onClick={() => void removeFile(file)} />
                      </span>
                    ))}
                  </div>
                  <div className="data-list">
                    <span className="data-list-label"><FileText size={13} /> 分析成果 {artifacts.length}</span>
                    {artifacts.map((artifact) => (
                      <span key={artifact.id} className={`data-chip artifact ${activeTab?.kind === 'artifact' && activeTab.item.id === artifact.id ? 'active' : ''}`}>
                        <button type="button" onClick={() => openTab({ kind: 'artifact', item: artifact })}>{artifact.name}<small>{formatFileSize(artifact.size)}</small></button>
                        <Download size={12} onClick={() => void downloadArtifact(artifact)} />

                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="resize-handle" />

            <Panel defaultSize={42} minSize={28} className="copilot-pane">
              <header className="chat-header">
                <span className="chat-title-icon"><Sparkles size={16} /></span>
                <div className="chat-title-copy">
                  <strong>{currentSession?.title || '新任务'}</strong>
                  <span className="chat-meta">
                    <span><UserRound size={11} />{displayName(user)}</span>
                    <span><Clock3 size={11} />{formatQuestionTime(latestUserMessage?.createdAt)}</span>
                    <span><Tags size={11} />{currentSession ? `${currentSession.categoryPrimary} · ${currentSession.categorySecondary}` : '综合分析 · 一般咨询'}</span>
                    {running ? <em>正在处理</em> : null}
                  </span>
                </div>
              </header>

              <section className="conversation">
                <div className={`conversation-inner ${!messages.length && !running ? 'empty' : ''}`}>
                  {loadingChat ? (
                    <div className="chat-loading"><LoaderCircle className="spin" size={20} />正在加载任务</div>
                  ) : !messages.length && !running ? (
                    <div className="welcome">
                      <div className="welcome-mark"><Sparkles size={25} /></div>
                      <h1>今天要分析什么数据？</h1>
                      <p>上传 Excel 后，用自然语言操作数据或生成完整报告。也可以从常用指令开始。</p>
                      <div className="command-grid">
                        {FEATURED_COMMANDS.map((command) => (
                          <button type="button" key={command.title} onClick={() => applyCommand(command)}>
                            <strong>{command.title}</strong>
                            <span>{command.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map((message) =>
                        message.role === 'assistant'
                          ? <AssistantMessage key={message.id} message={message} processItems={processArchive[message.id]} />
                          : <UserMessage key={message.id} message={message} user={user} />,
                      )}
                      {(running || liveMarkdown || processItems.length > 0) && (
                        <article className="message-row assistant-message live-message">
                          <div className="message-avatar ai-avatar"><Sparkles size={17} /></div>
                          <div className="message-body">
                            <div className="message-author">智数 AI 助手</div>
                            <ProcessPanel items={processItems} running={running} />
                            {liveMarkdown ? <Markdown>{liveMarkdown}</Markdown> : running ? <div className="thinking-line"><i /><i /><i /></div> : null}
                          </div>
                        </article>
                      )}
                    </>
                  )}
                  <div ref={bottomRef} />
                </div>
              </section>

              <footer className="composer-wrap">
                {error && (() => {
                  const sessionBusy = error.includes('当前任务已有处理在进行');
                  return (
                    <div className={`chat-error composer-error ${sessionBusy ? 'busy' : ''}`} role={sessionBusy ? 'status' : 'alert'}>
                      {sessionBusy ? <LoaderCircle className="spin" size={16} /> : <TriangleAlert size={16} />}
                      <span><strong>{sessionBusy ? '任务处理中' : '操作未完成'}</strong><small>{error}</small></span>
                      <button type="button" onClick={() => setError('')}>关闭</button>
                    </div>
                  );
                })()}

                <div className="composer-shell">
                  <div className="composer-top">
                    <div className="interaction-mode" role="tablist" aria-label="交互模式">
                      <button type="button" role="tab" aria-selected={mode === 'operate'} className={mode === 'operate' ? 'active' : ''} onClick={() => setMode('operate')} disabled={running}>
                        <FileSpreadsheet size={14} /> 操作 Excel
                      </button>
                      <button type="button" role="tab" aria-selected={mode === 'report'} className={mode === 'report' ? 'active' : ''} onClick={() => setMode('report')} disabled={running}>
                        <FileText size={14} /> 完整报告
                      </button>
                    </div>
                    <span className={`context-bar ${contextParts.length ? 'has-context' : ''}`} title={contextParts.join(' / ') || '打开 Excel 并框选后自动带入'}>
                      <Table2 size={13} /><span>{contextSummary}</span>
                    </span>
                  </div>

                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={mode === 'operate' ? '描述要执行的计算、清洗、汇总或拆分操作…' : '描述报告主题、分析范围、重点问题与交付要求…'}
                    aria-label="输入分析需求"
                    disabled={uploading}
                  />

                  <div className="composer-actions">
                    <div>
                      <button type="button" className="icon-action" aria-label="上传文件" onClick={() => fileInputRef.current?.click()} disabled={uploading || running}>
                        {uploading ? <LoaderCircle className="spin" size={18} /> : <Paperclip size={18} />}
                      </button>
                      <div className="command-menu-wrap" ref={commandMenuRef}>
                        <button type="button" className={`command-button ${commandOpen ? 'active' : ''}`} aria-expanded={commandOpen} onClick={() => setCommandOpen((value) => !value)}>
                          <Sparkles size={16} />常用指令
                        </button>
                        {commandOpen && (
                          <div className="command-menu" role="dialog" aria-label="常用指令">
                            <label className="command-search">
                              <Search size={15} />
                              <input type="search" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="搜索清洗、透视、报告……" autoFocus />
                            </label>
                            <div className="command-menu-scroll">
                              {visibleCommandGroups.map((group) => (
                                <section className="command-category" key={group.category}>
                                  <h2>{group.category}</h2>
                                  <div className="command-category-grid">
                                    {group.commands.map((command) => (
                                      <button type="button" key={command.title} onClick={() => applyCommand(command)}>
                                        <strong>{command.title}</strong>
                                        <span>{command.description}</span>
                                      </button>
                                    ))}
                                  </div>
                                </section>
                              ))}
                              {visibleCommandGroups.length === 0 && <div className="command-empty">没有匹配的指令，换个关键词试试</div>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {running ? (
                      <button type="button" className="send-button stop" aria-label="停止生成" onClick={() => void abortRun()}>
                        <CircleStop size={19} />
                      </button>
                    ) : (
                      <button type="button" className="send-button" aria-label="发送" disabled={!draft.trim() || uploading} onClick={() => void sendMessage()}>
                        <ArrowUp size={19} />
                      </button>
                    )}
                  </div>
                </div>
                <p className="composer-hint">Enter 发送 · Shift + Enter 换行 · 结果请结合源数据复核，AI 输出仅供参考</p>
              </footer>
            </Panel>
          </PanelGroup>
        )}
      </main>
    </div>
  );
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const canEmbed = artifact.mediaType.startsWith('image/')
    || artifact.mediaType.startsWith('text/')
    || artifact.mediaType === 'text/html'
    || artifact.mediaType === 'application/pdf';

  useEffect(() => {
    if (!canEmbed) return;
    let url = '';
    let active = true;
    api.artifacts.blob(artifact.id)
      .then((blob) => { if (active) { url = URL.createObjectURL(blob); setObjectUrl(url); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [artifact.id, canEmbed]);

  return (
    <div className="artifact-preview">
      <div className="artifact-preview-bar">
        <span><FileText size={15} /> {artifact.name}</span>
        <button type="button" className="artifact-download" onClick={() => void downloadArtifact(artifact)}>
          <Download size={14} />下载
        </button>
      </div>
      {canEmbed && !failed ? (
        objectUrl ? (
          artifact.mediaType.startsWith('image/')
            ? <img className="artifact-frame" src={objectUrl} alt={artifact.name} />
            : <iframe className="artifact-frame" src={objectUrl} title={artifact.name} sandbox="allow-popups allow-downloads" referrerPolicy="no-referrer" />
        ) : (
          <div className="data-state"><LoaderCircle className="spin" size={20} />正在加载成果</div>
        )
      ) : (
        <div className="data-state">
          <FileText size={22} />
          {failed ? '成果加载失败，请重试或下载查看。' : '该成果无法在线渲染，请下载后查看。'}
          <button type="button" className="artifact-download" onClick={() => void downloadArtifact(artifact)}>
            <Download size={14} />下载成果
          </button>
        </div>
      )}
    </div>
  );
}
