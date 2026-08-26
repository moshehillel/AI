# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
COPY workers/runner/package.json workers/runner/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/auth/package.json packages/auth/
COPY packages/jobs/package.json packages/jobs/
COPY packages/cursor-adapter/package.json packages/cursor-adapter/
COPY packages/github/package.json packages/github/
COPY packages/railway/package.json packages/railway/
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @automation-studio/db build \
 && pnpm --filter @automation-studio/domain build \
 && pnpm --filter @automation-studio/auth build \
 && pnpm --filter @automation-studio/jobs build \
 && pnpm --filter @automation-studio/cursor-adapter build \
 && pnpm --filter @automation-studio/github build \
 && pnpm --filter @automation-studio/railway build \
 && pnpm --filter @automation-studio/web build \
 && pnpm --filter @automation-studio/worker build

FROM base AS web
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]

FROM base AS worker
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/workers/runner
CMD ["pnpm", "start"]
