FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_TIMEOUT=120000 \
    PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --ignore-scripts --include=optional --no-audit --no-fund

COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/prisma apps/api/prisma
COPY apps/api/src apps/api/src

WORKDIR /app/apps/api
RUN npx prisma generate --schema prisma/schema.prisma
RUN npx tsc -p tsconfig.json

FROM node:22-bookworm-slim

WORKDIR /app/apps/api
ENV NODE_ENV=production \
    PORT=3000 \
    OPENCODE_WORKDIR=/app/services/excel-agent

RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# npm workspaces 未把依赖全部提升到根 node_modules，两处都要带上
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY apps/api/package.json ./package.json
COPY apps/api/docker-entrypoint.sh /usr/local/bin/zhishu-api-entrypoint
RUN chmod +x /usr/local/bin/zhishu-api-entrypoint

RUN mkdir -p /app/services/excel-agent/workspaces

EXPOSE 3000
ENTRYPOINT ["zhishu-api-entrypoint"]
