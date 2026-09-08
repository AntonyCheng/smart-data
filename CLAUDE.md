# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

智数AI分析师 (zhìshù AI fēnxīshī) — a local-first AI Excel analysis workbench for business/operations analysts. VS Code / Cursor-style split: **left = Univer spreadsheet viewer, right = AI Copilot**. Upload Excel files, then use natural language to either **operate** on them (calc / clean / dedupe / pivot / merge / split) or generate a **full analysis report** (verification / analysis / charts / HTML·DOCX·XLSX).

**All real Excel analysis is delegated to the OpenCode CLI running the vendored `huashu-excel` skill.** The backend never reimplements analysis logic — this is a stated product principle.

This repo was refactored from an earlier FastAPI prototype ("经分助手") onto the architecture of a sibling project (`C:\projects\kLeagl`, a legal Q&A app); much of `apps/api` and `apps/web` derives from it. Comments referencing "design §N" are leftovers from that project's design doc.

## Commands

### Whole stack (Docker Compose — the primary path)

```powershell
Copy-Item .env.docker.example .env   # fill DEEPSEEK_API_KEY/JWT_SECRET/SEED_ADMIN_*/passwords (MODEL_* optional — dormant fallback)
docker compose build                 # excel-agent is slow (~10 min: LibreOffice + Python)
docker compose up -d
docker compose ps                    # all healthy
```

Web: <http://localhost:18180> (host port is `${WEB_PORT:-18180}` — 8180 collides with a Windows/WinNAT reserved range on this machine). Compose services: `postgres` + `excel-agent` (opencode serve :4096) + `api` (:3000) + `web` (nginx :18180→80). The api entrypoint runs `prisma db push` (no migration files — greenfield) then seeds the admin from `.env`.

### Backend (`apps/api`, NestJS + Prisma, Node 22+)

```bash
npm install                                    # npm workspaces; deps land in apps/*/node_modules, NOT hoisted
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:push          # sync schema to a dev DB (or prisma:migrate)
npm --prefix apps/api run build                # tsc -p tsconfig.json → dist/
npm --prefix apps/api run dev                  # build + node dist/main.js
```

### Frontend (`apps/web`, React 19 + Vite)

```bash
npm --prefix apps/web run dev      # Vite on localhost:3001, proxies /api → 127.0.0.1:3000 (ZHISHU_BACKEND_URL)
npm --prefix apps/web run build    # tsc --noEmit && vite build
npm --prefix apps/web run lint     # eslint (react-hooks v7 rules are strict — no setState in effect bodies)
```

### OpenCode preflight (inside the excel-agent container)

```powershell
docker compose exec excel-agent opencode debug skill   # output must contain a skill named "huashu-excel"
docker compose exec excel-agent python3 -c "import openpyxl, pandas"
docker compose exec excel-agent soffice --version
```

## Architecture

### Request flow

```
React SPA ──REST /api/v1 + SSE /sessions/:id/events──▶ NestJS API ──┐
                                                                     │ PostgreSQL = source of truth
   NestJS ──HTTP + Basic Auth (internal net)──▶ OpenCode Server (opencode serve :4096)
     · POST /session/:id/prompt_async   (fire; returns immediately)
     · GET  /event                      (one persistent SSE of ALL events)
```

Every chat turn: `POST /sessions/:id/messages` creates an `AiMessage` + `AiExecution`, resolves attached Excel paths, ensures a live OpenCode session, then `prompt_async`. Results arrive on the single global `GET /event` stream, are filtered/translated by `SessionEventWatcher` into the frontend protocol (`agent.started`, `tool.*`, `skill.*`, `message.delta`, `artifact`, `agent.completed`, `agent.error`), and fanned out per business session via `SseHub`.

### Backend (`apps/api/src/`)

- **`opencode/`** — the integration core (kept nearly verbatim from kLeagl). `opencode.client.ts` (HTTP + Basic Auth, timeouts, `OpenCodeApiError`), `opencode.service.ts` (typed OpenCode HTTP API), `opencode-event.service.ts` (one auto-reconnecting SSE to `/event`).
- **`session/session-event-watcher.ts`** — consumes raw OpenCode events, drops chain-of-thought / narration, collapses tool events into localized progress steps (`toolDetail` maps `bash` commands like `profile_table` / `clean_table` / `verify_*` to Chinese stages), enforces Simplified-Chinese output (falls back to a `chinese-output` agent), and on `session.idle` persists the final answer + token metrics + calls `ArtifactService.register()`.
- **`session/sse-hub.ts`** — per-business-session event fanout + active-execution registry (replays `agent.started` on SSE connect).
- **`message/message.service.ts`** — `send()`: the chat orchestration. `buildPrompt()` builds the two-mode prompt (operate / report) + injects the "user feedback protocol" + the `【当前 Excel 上下文】` line from the frontend's file/sheet/selection + (report mode only) the `【企业指标定义 · {name}】` block from the session's selected `AiMetricProfile`. Retries once on an explicit OpenCode `404` (stale session) with history re-injected within `OPENCODE_HISTORY_MAX_CHARS`.
- **`metric-profile/`** — 企业指标定义集: reusable, per-tenant analysis briefs (calibers + focus dimensions + report outline) that a **report**-mode run can opt into. `MetricProfileService` seeds 14 built-ins (see `metric-profile.seed.ts` — 自研产品收入 / 财务四大能力 / 国资委一利五率 / 预算执行 / …) create-only per tenant on boot. `GET /metric-profiles` (all logged-in users, `?all=1` for admin), writes are admin-only (`assertAdmin`), `builtin` rows can't be deleted only disabled. Injected as prompt context only — no analysis logic; still 100% huashu-excel. Selected id persists on `AiSession.metricProfileId`; per-message override via `POST /sessions/:id/messages` body `metricProfileId` (`''` clears, omitted keeps).
- **`session/session.service.ts`** — task (session) CRUD; each business session maps 1:1 to an OpenCode session (id never returned to the client). `mode` (`operate`/`report`) lives on the session.
- **`file/`** — `file.service.ts` writes uploads to `workspaces/{tenant}/{session}/input/` (xlsx family only, ZIP magic check, no OCR/extraction). `workbook.util.ts` converts `.xlsx` → Univer `WorkbookSnapshot` via `exceljs` (values + merges + column widths; capped at 2000 rows / 200 cols).
- **`artifact/`** — `ArtifactService.register()` scans `workspaces/{tenant}/{session}/output/` and upserts `AiArtifact` rows (discovered by filesystem scan, not registered by the model). `GET /sessions/:id/artifacts`, `GET /artifacts/:id?download=`, `GET /artifacts/:id/workbook`.
- **`common/workspace.service.ts`** — `@Global`; resolves `{OPENCODE_WORKDIR}/workspaces/{tenant}/{session}/{input,output/{charts,tables,reports}}`. Path-traversal guarded (`resolve` + prefix check).
- **`auth/`** — JWT (Bearer, `localStorage` on the client so login survives tab/browser close until logout or JWT expiry), phone-number registration (always `user` role). Login `account` matches `email` OR `phone`; `SEED_ADMIN_EMAIL` doubles as the admin login account and may be a plain name (default `admin`). `AuthSeedService` creates the seed admin (fixed id `…002`) **only when the tenant has no active admin** — afterwards the admin's own account/password (panel `重置密码`) persists across restarts and is not reconciled from `.env`. `AuthContextMiddleware` binds identity into `AsyncLocalStorage`; every service is tenant/user-scoped via `IdentityService.getIdentity()`.
- **`admin/`** — user management + stats (Token/DAU/session trends, analysis-category pie via `session/analysis-category.ts::inferAnalysisCategory`). Knowledge base was removed.
- **`prisma/schema.prisma`** — `SysTenant`, `SysUser`, `AiSession` (+`mode`, +`metricProfileId`), `AiMessage`, `AiFile` (slim: no chunks/OCR fields), `AiArtifact`, `AiMetricProfile`, `AiExecution`. Managed by `prisma db push`, no migration files.

### Frontend (`apps/web/src/`)

- **`App.tsx`** — one big component (kLeagl style). Two-pane workbench via `react-resizable-panels`: left `DataPane` (tab strip + Univer / artifact preview + file/artifact chips), right Copilot (chat header + streaming conversation + composer with the operate/report mode toggle + — in report mode — the 企业指标定义 selector (custom `.profile-menu` popover, not a native `<select>`; `groupedProfiles` by category, outside-click via `profileSelectRef`, "查看口径" peek panel) + selection context bar). The `.data-tabs-scroll` tab strip hides its scrollbar (`scrollbar-width:none`) so an overflow scrollbar can't shove tabs off-center; a non-passive `wheel` listener (via `dataTabsScrollRef`) maps vertical wheel to horizontal scroll so plain wheel still works. Admin `指标定义` view is the `MetricsAdmin` component. SSE handling in `connectStream`; the strict `react-hooks/set-state-in-effect` lint rule is satisfied by keyed-result patterns (`loadedWorkbook`, AdminPanel `loaded`) instead of `setState` in effect bodies.
- **`components/UniverViewer.tsx`** — wraps `createUniver` (`@univerjs/presets` + `@univerjs/preset-sheets-core`, zh-CN, read-only: `header:false`, `contextMenu:false`, `setEditable(false)`). Loads a `WorkbookSnapshot` via `univerAPI.createWorkbook`; emits `SelectionChanged` → `{ sheet, range }` up to `App`. Univer bundles large (~1.5 MB gzip) so `App.tsx` `lazy()`-loads `UniverViewer` behind a `Suspense` boundary — it splits into its own chunk that only downloads when a spreadsheet is opened (initial bundle ~130 KB gzip). `AdminPanel` / `ArtifactPreview` are still in `App.tsx` (full component split is a later task).
- **`lib/api.ts`** — REST client + `streamSessionEvents` (hand-rolled SSE reader over `fetch`, not `EventSource`, so it POSTs and aborts). 401 → `zhishu:auth-expired` event → logout.
- **`quick-commands.ts`** — preset prompts, each tagged with its `mode`.
- **`index.css`** + **`workbench.css`** — kLeagl's warm palette (`--accent: #8e2634`), single hand-written stylesheet; `workbench.css` holds the two-pane + Univer container rules.

### OpenCode runtime (`services/excel-agent/`)

- **`opencode.json`** — active model `deepseek/deepseek-v4-flash` (DeepSeek official, `https://api.deepseek.com/v1` hardcoded, key via `{env:DEEPSEEK_API_KEY}`); a dormant fallback provider `my-newapi/ds4f-0731-71` (OpenAI-compatible gateway, `{env:MODEL_BASE_URL}`/`{env:MODEL_API_KEY}`) stays configured — flip `model`/`small_model` back to use it. `skills.paths: [".opencode/skills"]`, `external_directory: deny`. Baked into the image → `docker compose build excel-agent` after any edit.
- **`.opencode/agents/zhishu-assistant.md`** — the locked-down runtime agent: no subagents/web, skills denied except `huashu-excel`, bash denied except `python* / uv* / libreoffice* / pandoc*`, `edit: allow`. Two modes in the body.
- **`.opencode/agents/chinese-output.md`** — translation-only agent used by the event watcher's Chinese-enforcement fallback.
- **`.opencode/skills/huashu-excel/`** — **vendored**, pinned to commit `9348581a` (`.source-revision`). Do not edit in place — replace the whole directory after human review and update `.source-revision`.
- **`Dockerfile`** — `ghcr.io/anomalyco/opencode` binary + `node:22-bookworm-slim` + LibreOffice + `python3` + `openpyxl pandas matplotlib Pillow`. Playwright is intentionally NOT installed (huashu-excel's `verify_visual.py` degrades to "check manually"; report generation still works).

## Conventions

- Keep the backend thin: route new analysis capability through OpenCode / `huashu-excel`, not new NestJS code.
- All user-facing AI text is Simplified Chinese; the event watcher enforces this.
- `data/` (Postgres + workspaces) is runtime data, gitignored. `data/workspaces` is bind-mounted into **both** `api` and `excel-agent`.
- OpenCode failures (missing runtime, missing skill, crash, cancel) surface as `agent.error` SSE events — follow the paths in `session-event-watcher.ts` / `message.service.ts`.
- npm workspaces here do **not** hoist to root `node_modules`; Dockerfiles copy `apps/*/node_modules` too, and run `prisma`/`tsc` from within the workspace dir.
- `.npmrc` pins the npmmirror registry; Dockerfiles set `NPM_CONFIG_REGISTRY` + `PRISMA_ENGINES_MIRROR` for CN-network reliability.
