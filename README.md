# 智数AI助手

左边看数据，右边问 AI —— 面向经营分析人员的本地优先 AI Excel 分析工作台。

上传一堆 Excel，左侧用 [Univer](https://github.com/dream-num/univer) 表格查看和框选，右侧用自然语言做**操作**（计算 / 清洗 / 汇总 / 透视 / 合并拆分）或生成**完整分析报告**（核验 / 分析 / 图表 / HTML·DOCX·XLSX）。所有真实的 Excel 分析能力由 vendored 的 `huashu-excel` skill 提供，后端不重写分析逻辑。

## 能力

- **两种模式**：`operate`（只操作 Excel，处理后的工作簿写入 `output/tables/`）/ `report`（走 `huashu-excel` 完整流程，写入 `output/{reports,charts,tables}/`）
- 任务（会话）管理、历史任务、任务级物理隔离
- 多 Excel 上传（`.xlsx/.xlsm/.xltx/.xltm`，单个 ≤ 100 MB），Univer 只读渲染 + 多 Sheet + 框选联动 Copilot
- 流式查看处理过程（折叠面板），Markdown / GFM 表格渲染，复制、耗时与 Token 统计
- 成果（处理后 xlsx、图表 SVG、HTML 报告）自动登记，按类型分组收进右侧「成果」抽屉，在线预览与下载；任务完成后自动打开主交付物（报告 / 处理后工作簿）并给出提示条
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

- Linux / macOS / Windows 均可，需 **Docker Engine 24+ 与 Docker Compose v2**（`docker compose version` 能跑即可）
- 一个可访问的 OpenAI-compatible 模型服务地址和 API Key
- 首次 `docker compose build` 较慢：`excel-agent` 镜像要装 LibreOffice + Python 科学库，约 **8–12 分钟**；`api` / `web` 各 1–3 分钟

## Docker Compose 部署（推荐）

Compose 构建并启动 4 个服务：PostgreSQL、excel-agent（OpenCode 运行时）、API、Web。
**只有 Web 的端口对外发布**（默认 `18180`），其余服务仅在内网互通。

### 在一台新机器上从零部署

```bash
git clone <仓库地址> zhishu && cd zhishu

# 1) 准备 .env —— 必须由人工填写，Agent 无法代填（含模型密钥等机密）
cp .env.docker.example .env
$EDITOR .env
#   必填：POSTGRES_PASSWORD  OPENCODE_PASSWORD  MODEL_BASE_URL  MODEL_API_KEY
#         JWT_SECRET（≥32 位随机串）  SEED_ADMIN_EMAIL  SEED_ADMIN_PASSWORD
#   可选：WEB_PORT（默认 18180）  SEED_TENANT_NAME  AGENT_*_STEP_LIMIT 等

# 2) 构建并启动（首次约 10~15 分钟，主要耗在 excel-agent 镜像）
docker compose build
docker compose up -d

# 3) 等全部 healthy / running
docker compose ps
docker compose logs -f api        # 看到 "listening on http://127.0.0.1:3000/api/v1" 即就绪
```

打开 `http://<主机 IP>:18180`，用 `.env` 里的 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` 登录。

> **给自动化 Agent 的提示**：`.env` 不在仓库里（`.gitignore` 排除）。如果目标目录没有 `.env` 或其中还是 `change-this-*` 占位值，**不要启动**，先要求人工补全机密，再执行 `docker compose up -d`。

### Linux 上模型服务在宿主机时

Linux 的 Docker 默认没有 `host.docker.internal`。若模型服务跑在宿主机：

- 用宿主机在局域网里的真实 IP：`MODEL_BASE_URL=http://192.168.x.x:<端口>/v1`，或
- 在 `docker-compose.yml` 的 `excel-agent` 服务下加
  `extra_hosts: ["host.docker.internal:host-gateway"]`，再用 `http://host.docker.internal:<端口>/v1`

### 更新代码后重启

```bash
git pull
docker compose up -d --build      # 重建镜像（未变化的层走缓存），Postgres 数据与 workspaces 保留
docker compose ps
```

- 纯重启（不更新代码）：`docker compose restart` 或 `docker compose up -d`
- `apps/web`、`apps/api`、`services/excel-agent/.opencode/` 的改动都编译进镜像，改完必须 `--build`
- API 容器每次启动都会执行 `prisma db push` 同步表结构，并在租户内还没有管理员时按 `.env` seed 一个

### 端口与模型配置

- 换 Web 端口：`.env` 里设 `WEB_PORT=8080` 之类后 `docker compose up -d`
- OpenCode provider 与默认模型名在 `services/excel-agent/opencode.json`（当前 `my-newapi/ds4f-0731-75`）；模型地址与密钥只通过 `MODEL_BASE_URL` / `MODEL_API_KEY` 注入，不写进配置文件

### 持久化数据

```text
data/
├── postgres/      PostgreSQL 数据库文件
└── workspaces/    每个任务的 input/ 上传文件与 output/ 成果
```

`data/` 目录随仓库存在（只跟踪一个 `.gitignore`），`data/postgres` 与 `data/workspaces` 由 Docker 在首次 `up` 时自动创建。`data/workspaces` 同时挂载进 `api` 和 `excel-agent` 两个容器，使 API 能落盘、agent 能读取。备份 / 迁移只需整体拷贝 `data/`。

### 排障

```bash
docker compose logs -f api
docker compose logs -f excel-agent
docker compose exec excel-agent opencode debug skill   # 输出应含 name: huashu-excel
docker compose exec excel-agent python3 -c "import openpyxl, pandas"
```

- `docker compose up` 报缺变量（`POSTGRES_PASSWORD is not set` 等）：`.env` 没建或没填全，见上面「从零部署」。
- 页面显示"AI 服务未返回有效内容" / `agent.error`：同时看 `api` 和 `excel-agent` 日志，确认 `MODEL_BASE_URL` 从容器内可达（`docker compose exec excel-agent wget -qO- $MODEL_BASE_URL/models`）、API Key 有效、模型名与 `opencode.json` 一致。
- 上传返回 `413`：检查前置代理请求体大小限制（内置 Web Nginx 为 `110m`）。
- 换了机器后端口冲突：`.env` 改 `WEB_PORT`。
- Postgres 起不来、日志有权限报错：`sudo chown -R 999:999 data/postgres`（`postgres:15` 镜像内 uid 为 999）。

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
