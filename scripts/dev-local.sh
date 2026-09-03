#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$WORKSPACE_DIR/apps/web"
BACKEND_DIR="$WORKSPACE_DIR/apps/api"
RUNTIME_DIR="$WORKSPACE_DIR/services/excel-agent"

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "缺少 $BACKEND_DIR/.env，请先根据 .env.example 配置后端。"
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "未找到 opencode 命令，无法启动 AI 运行时。"
  exit 1
fi

echo "注意：提交给 AI 的问题和附件会发送到 OpenCode 配置的模型服务。"
read -r -p "确认已获授权并继续启动本地联调环境？[y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "已取消。"
  exit 0
fi

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$RUNTIME_DIR"
  set -a
  source "$BACKEND_DIR/.env"
  set +a
  export OPENCODE_SERVER_USERNAME="$OPENCODE_USERNAME"
  export OPENCODE_SERVER_PASSWORD="$OPENCODE_PASSWORD"
  exec opencode serve --hostname 127.0.0.1 --port 4096
) &
PIDS+=("$!")

(
  cd "$BACKEND_DIR"
  exec npm run dev
) &
PIDS+=("$!")

(
  cd "$FRONTEND_DIR"
  exec npm run dev
) &
PIDS+=("$!")

echo "本地服务正在启动。请使用前端终端打印的 Local URL；按 Ctrl+C 全部停止。"
wait
