# Koda — Advanced Automations AI Builder

Multi-tenant portal where teams plan and ship business automations with AI.
Koda plans programs with clients, developers build and approve production deploys.

> **Koda is AI and can make mistakes.**

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
docs/                    Architecture, security, and deploy notes
infra/aws/               Koda platform AWS Terraform (separate from Whiteglove)
.railway/                Railway Infrastructure as Code (railway.ts)
scripts/                 railway-bootstrap.sh and helpers
```

## Prerequisites

- Node.js ≥ 22.13
- pnpm 9+
- Docker (Postgres + Redis)

## Quick start (local mock mode)

```bash
cp .env.example .env
# Defaults: OPEN_ACCESS=0 (Clerk auth). For no-login local dev set OPEN_ACCESS=1 in .env.

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

Open http://localhost:3000

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
docker compose up -d
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev:web   # other terminal: pnpm dev:worker
```

If the worker fails with `Cannot find module .../packages/*/dist/index.js`, rebuild packages:

```bash
pnpm packages:build
# or: pnpm -r --filter=./packages/* build
```

Open http://localhost:3000

Without Clerk keys, set `OPEN_ACCESS=1` in `.env` to open as the seeded employee on `demo-co` — no login.

## Deploy

| Target | Guide |
| --- | --- |
| Railway (current) | [docs/deploy.md](docs/deploy.md) |
| AWS (`koda-platform`, separate stack) | [infra/aws/README.md](infra/aws/README.md) |

### Railway

Host web + worker with managed Postgres and Redis. Full guide: [docs/deploy.md](docs/deploy.md).

```bash
# Headless: export RAILWAY_TOKEN=...   (or railway login)
pnpm railway:bootstrap
# equivalent: ./scripts/railway-bootstrap.sh
```

First deploy uses **Clerk auth** (`OPEN_ACCESS=0`). For local no-login dev, set `OPEN_ACCESS=1` in `.env`. Images: `Dockerfile.web` and `Dockerfile.worker`. Topology: [`.railway/railway.ts`](.railway/railway.ts).

Generate `ENCRYPTION_KEY` with `openssl rand -hex 32` (bootstrap can generate one if unset).

## External credentials (production wiring)

| Service | Purpose |
|---|---|
| Clerk | Auth + Organizations (`org:employee`, `org:developer`, `org:admin`) |
| Cursor | `CURSOR_API_KEY` service account for Cloud Agents |
| GitHub App | Branch/PR/check access per customer install |
| Railway | Hosting + PR Environments inheriting from staging/preview-base |
| Postgres / Redis | App data + job queue |

See [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), and [docs/deploy.md](docs/deploy.md).

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
