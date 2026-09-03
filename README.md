# 智数AI助手

左边看数据，右边问 AI —— 面向经营分析人员的本地优先 AI Excel 分析工作台。

上传一堆 Excel，左侧用 [Univer](https://github.com/dream-num/univer) 表格查看和框选，右侧用自然语言做**操作**（计算 / 清洗 / 汇总 / 透视 / 合并拆分）或生成**完整分析报告**（核验 / 分析 / 图表 / HTML·DOCX·XLSX）。所有真实的 Excel 分析能力由 vendored 的 `huashu-excel` skill 提供，后端不重写分析逻辑。

## 能力

- **两种模式**：`operate`（只操作 Excel，处理后的工作簿写入 `output/tables/`）/ `report`（走 `huashu-excel` 完整流程，写入 `output/{reports,charts,tables}/`）
- 任务（会话）管理、历史任务、任务级物理隔离
- 多 Excel 上传（`.xlsx/.xlsm/.xltx/.xltm`，单个 ≤ 100 MB），Univer 只读渲染 + 多 Sheet + 框选联动 Copilot
- 流式查看处理过程（折叠面板），Markdown / GFM 表格渲染，复制、耗时与 Token 统计
- 成果（处理后 xlsx、图表、报告）自动登记，在线预览与下载
- 手机号注册、登录，普通用户 / 管理员两类角色
- 管理员：用户管理、统计分析（Token、DAU、任务趋势、分析类型分布与用户 Top 5）

## 工程结构

```text
apps/
  web/                  React + Vite + Univer 前端
  api/                  NestJS + Prisma + PostgreSQL，OpenCode 运行时网关
services/
  excel-agent/          opencode serve 容器 + vendored huashu-excel skill
docs/                   文档
scripts/                本地开发脚本
```

## 架构

```
浏览器 SPA ──REST /api/v1 + SSE /sessions/:id/events──▶ NestJS API ──┐
                                                                     │ Postgres = 事实来源
                                                                     │ (任务/消息/执行/成果/文件)
   NestJS ──HTTP + Basic Auth（内网）──▶ OpenCode Server（opencode serve :4096）
     · POST /session/:id/prompt_async   发起（立即返回）
     · GET  /event                      一条常驻 SSE，接收所有事件 → 翻译成前端协议 → 按任务扇出
                                              │
                    excel-agent 容器：opencode + Python + openpyxl/pandas/matplotlib + LibreOffice
                       agent: zhishu-assistant  →  skill: huashu-excel
                       在 workspaces/{tenant}/{session}/{input, output/{charts,tables,reports}}/ 读写
```

- **会话连续性**：PostgreSQL 是唯一事实来源；OpenCode 的 session 只是可重建的执行上下文。运行时重启导致 session 失效时，API 检测到明确的 `404` → 在现有容器内新建 session → 把历史对话（按 `OPENCODE_HISTORY_MAX_CHARS` 预算）作为背景重新注入。只对 404 重试一次。
- **成果发现**：`huashu-excel` 把成果写进 `output/`，API 扫描目录登记为 `AiArtifact`（不由 model 显式注册，防路径注入）。
- **xlsx → Univer 快照**：API 用 `exceljs` 把 `.xlsx` 转成 Univer `IWorkbookData` 下发前端渲染；磁盘上的 `.xlsx` 才是事实来源，AI 用 Python 直接读写，每轮结束后前端重载快照。

## 环境要求

- Docker Desktop（含 Docker Compose v2）
- 可访问的 OpenAI-compatible 模型服务地址和 API Key（若模型服务在宿主机，用 `http://host.docker.internal:<端口>/v1`）

## Docker Compose 部署（推荐）

Compose 会构建并启动 PostgreSQL、excel-agent（OpenCode）、API、Web 四个服务。

```powershell
Copy-Item .env.docker.example .env
# 编辑 .env，至少填写：POSTGRES_PASSWORD / OPENCODE_PASSWORD / MODEL_BASE_URL / MODEL_API_KEY /
#                        JWT_SECRET（≥32 位）/ SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
docker compose build
docker compose up -d
docker compose ps
```

- Web 前端：<http://localhost:18180>（Compose 只发布 Web 的这一个端口，其余仅内网通信；如需换端口，在 `.env` 里设 `WEB_PORT=8180` 之类即可）
- API 容器启动时执行 `prisma db push` 同步表结构，并按 `.env` seed 首个管理员。
- OpenCode provider 和默认模型配置在 `services/excel-agent/opencode.json`（当前 `my-newapi/ds4f-0731-75`）；模型地址与密钥通过 `MODEL_BASE_URL` / `MODEL_API_KEY` 注入，不写入配置文件。

### 持久化数据

```text
data/
├── postgres/      PostgreSQL 数据库文件
└── workspaces/    每个任务的 input/ 上传文件与 output/ 成果
```

`data/` 已被 Git 忽略。`data/workspaces` 同时挂载进 `api` 和 `excel-agent` 两个容器，使 API 能落盘、agent 能读取。

### 排障

```powershell
docker compose logs -f api
docker compose logs -f excel-agent
docker compose exec excel-agent opencode debug skill   # 输出应含 name: huashu-excel
```

- 页面显示“AI 服务未返回有效内容”：同时看 `api` 和 `excel-agent` 日志，确认 `MODEL_BASE_URL` 从容器内可达、API Key 有效、模型名与 `opencode.json` 一致。
- 上传返回 `413`：检查前置代理请求体大小限制（内置 Web Nginx 为 `110m`）。

## Node 本地开发模式

要求宿主机安装 Node.js 22+、PostgreSQL 14+、OpenCode CLI，以及 Python 3.12 + openpyxl/pandas（供 huashu-excel 运行）。

```bash
npm install
cp apps/api/.env.example apps/api/.env       # 填 DATABASE_URL / OpenCode 凭据 / JWT_SECRET
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:push        # 或 prisma:migrate
npm run dev                                   # 同时起 excel-agent(opencode serve) + api + web
```

前端默认 `http://localhost:3001`，API 为 `http://127.0.0.1:3000/api/v1`。

## 检查与构建

```bash
npm run lint          # 前端 eslint
npm run build          # 前端 tsc+vite、后端 tsc
```

## huashu-excel skill

`services/excel-agent/.opencode/skills/huashu-excel/` 是 **vendored** 的分析 skill，固定来源版本见 `.source-revision`（commit `9348581a`）。**不在原地修改**：更新时人工审查新版本后整体替换目录并同步 `.source-revision`。

`zhishu-assistant` agent（`services/excel-agent/.opencode/agents/`）的权限锁定：禁子 Agent、禁联网、禁访问工作区外路径，skill 仅放行 `huashu-excel`，bash 仅放行 `python* / uv* / libreoffice* / pandoc*`，允许 `edit`（生成成果）。

## 隐私与安全边界

- `.env`、`apps/api/.env`、数据库连接串、JWT 密钥、模型 API Key 均不得提交。
- 密码只保存 bcrypt 哈希；注册只能获得普通用户角色，管理员由 seed 创建。
- 上传原文件、成果、日志均被 `.gitignore` 排除。
- 发送真实业务数据前，确认模型服务的数据处理条款。AI 输出仅供分析参考，结果请结合源数据复核。
