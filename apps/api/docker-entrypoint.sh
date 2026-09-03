#!/bin/sh
set -eu

cd /app/apps/api
# 首版无历史迁移：直接把 schema 推到数据库（greenfield，无数据需保留）。
# 后续如需可回放的迁移，改回 `npx prisma migrate deploy`。
npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss
exec node dist/main.js
