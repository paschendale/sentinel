# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

# ---- Install all dependencies ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- Build API ----
FROM deps AS build-api
COPY packages/shared packages/shared
COPY apps/api apps/api
# Compile shared to JS first so pnpm deploy doesn't include raw .ts at runtime
RUN pnpm --filter @sentinel/shared build
RUN pnpm --filter @sentinel/api build
# Create production deployment with only prod node_modules
RUN pnpm --filter @sentinel/api deploy --prod /api-prod
# pnpm deploy respects .gitignore and skips dist/; copy compiled shared manually
RUN cp -r /app/packages/shared/dist /api-prod/node_modules/@sentinel/shared/dist

# ---- Build Web ----
FROM deps AS build-web
# Bake /api as the client-side API base path so browser calls go through Caddy
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @sentinel/web build
# Ensure public dir exists (Next.js requires it but the project may not have one)
RUN mkdir -p apps/web/public

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache caddy

# API: prod node_modules (from pnpm deploy, with compiled shared) + compiled dist
COPY --from=build-api /api-prod/node_modules /app/apps/api/node_modules
COPY --from=build-api /app/apps/api/dist /app/apps/api/dist
# SQL migrations are not processed by tsc — copy from source
COPY --from=build-api /app/apps/api/src/db/migrations /app/apps/api/dist/db/migrations
# package.json needed so Node resolves the dist as ESM ("type": "module")
COPY --from=build-api /app/apps/api/package.json /app/apps/api/package.json

# Web: outputFileTracingRoot places standalone relative to repo root, so server.js
# ends up at apps/web/server.js inside the standalone directory
COPY --from=build-web /app/apps/web/.next/standalone /app/
COPY --from=build-web /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build-web /app/apps/web/public /app/apps/web/public

# Caddy config and startup script
COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
# Server components call the API directly (bypasses Caddy)
ENV API_URL=http://localhost:3001
# HOSTNAME for Next.js standalone server
ENV HOSTNAME=0.0.0.0

EXPOSE 80

# Targets the API directly (bypassing Caddy) so an unresponsive API is reported
# even if Caddy is still up and serving other routes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["/app/docker-entrypoint.sh"]
