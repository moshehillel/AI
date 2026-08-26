# Automation Studio

Multi-tenant portal where non-developers request software changes in plain English. AI prepares isolated feature-branch changes and temporary previews; developers review and merge to production.

## Safety model

- AI freedom only in isolated development environments
- Strict human control at the production boundary
- Employees never see GitHub credentials, Cursor API keys, or production secrets

## Monorepo layout

```text
apps/web                 Next.js UI + API
workers/runner           BullMQ job worker
packages/db              Prisma schema + client
packages/domain          Status machine, classification, permissions
packages/auth            Server-side authorization helpers
packages/jobs            Queue types + enqueue helpers
packages/cursor-adapter  Thin @cursor/sdk wrapper (mockable)
packages/github          GitHub App helpers (mockable)
packages/railway         Railway GraphQL preview helpers (mockable)
docs/                    Architecture and security notes
```

## Prerequisites

- Node.js ≥ 22.13
- pnpm 9+
- Docker (Postgres + Redis)

## Quick start (local mock mode)

```bash
cp .env.example .env
# Defaults work for local mock mode. Set ALLOW_DEMO_AUTH=1

docker compose up -d
pnpm install
# postinstall builds workspace packages (dist/) and generates Prisma client
pnpm db:push
pnpm db:seed

# Terminal 1
pnpm dev:web

# Terminal 2
pnpm dev:worker
```

If the worker fails with `Cannot find module .../packages/*/dist/index.js`, rebuild packages:

```bash
pnpm packages:build
```

Open http://localhost:3000

Without Clerk keys, the app uses seeded demo users/company when `ALLOW_DEMO_AUTH=1`.

## External credentials (production wiring)

| Service | Purpose |
|---|---|
| Clerk | Auth + Organizations (`org:employee`, `org:developer`, `org:admin`) |
| Cursor | `CURSOR_API_KEY` service account for Cloud Agents |
| GitHub App | Branch/PR/check access per customer install |
| Railway | PR Environments inheriting from staging/preview-base |
| Postgres / Redis | App data + job queue |

See [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).

## Scripts

- `pnpm typecheck` — TypeScript across packages
- `pnpm test` — domain unit tests
- `pnpm db:seed` — demo company + projects
- `pnpm db:migrate` — apply Prisma migrations (`packages/db`)

## MVP phase completion

| Phase | Coverage |
|---|---|
| 0 Foundations | Monorepo, Prisma + migration, Clerk/demo auth, docs |
| 1 Change requests | Chat, FSM, SSE progress, retry/cancel |
| 2 GitHub | App install flow, branch/PR helpers, protection verify |
| 3 Cursor | `@cursor/sdk` adapter, plan/agent, cancel, usage capture |
| 4 Preview/review | Railway sync retries, CI status, developer merge + freshness |
| 5 Hardening | Usage dashboard, soft caps, member assignment, runbooks |

Mock providers (`CURSOR_MOCK`, `GITHUB_MOCK`, `RAILWAY_MOCK`) exercise the full loop without live credentials.
