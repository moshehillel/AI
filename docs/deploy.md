# Deploy Automation Studio (Railway)

Production hosting uses **Railway** with Postgres, Redis, a **web** service, and a **worker** service.

## What gets deployed

| Resource | Role |
|---|---|
| Postgres | Prisma / app data |
| Redis | BullMQ job queue |
| `web` | Next.js UI + API (`Dockerfile.web`) |
| `worker` | BullMQ runner (`Dockerfile.worker`) |

First deploy runs in **demo mode** (no Clerk / Cursor / GitHub required):

- `ALLOW_DEMO_AUTH=1` / `NEXT_PUBLIC_ALLOW_DEMO_AUTH=1`
- `CURSOR_MOCK=1` / `GITHUB_MOCK=1` / `RAILWAY_MOCK=1`

Web start runs `prisma migrate deploy` before `next start`.

## Prerequisites

1. [Railway account](https://railway.com) and CLI (`railway` ≥ 5.44)
2. Auth for the CLI:
   - Interactive: `railway login`
   - Headless / CI: set **`RAILWAY_TOKEN`** (project token) or **`RAILWAY_API_TOKEN`** (account token)
3. Optional: GitHub connected to Railway if you prefer git-triggered deploys over `railway up`

## One-command bootstrap

From the repo root (with `RAILWAY_TOKEN` set or after `railway login`):

```bash
chmod +x scripts/railway-bootstrap.sh
./scripts/railway-bootstrap.sh
```

The script:

1. Creates/links project `automation-studio` (override with `RAILWAY_PROJECT_NAME`)
2. Adds Postgres + Redis if missing
3. Creates `web` + `worker` services
4. Points each service at **`Dockerfile.web`** / **`Dockerfile.worker`** (Railway does not reliably support `dockerBuildTarget`)
5. Sets demo-mode variables and a generated **`ENCRYPTION_KEY`**
6. Deploys both services, attaches a public domain, sets `NEXT_PUBLIC_APP_URL`, seeds demo data

Useful env overrides:

| Variable | Meaning |
|---|---|
| `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN` | Auth (required headless) |
| `ENCRYPTION_KEY` | Use your own 32-byte hex key instead of generating one |
| `SKIP_DEPLOY=1` | Configure only; do not `railway up` |
| `SKIP_SEED=1` | Skip `pnpm db:seed:deploy` |

After bootstrap, open the printed **Live URL** (or `railway open`).

Demo seed runs inside the web service over `railway ssh` (private `DATABASE_URL` is not reachable from the local agent). If seed was skipped:

```bash
railway ssh --service web -- pnpm db:seed:deploy
```

## ENCRYPTION_KEY

Generate a 32-byte hex secret (never commit it):

```bash
openssl rand -hex 32
```

Set it on both services:

```bash
railway variable set --service web ENCRYPTION_KEY="<value>"
railway variable set --service worker ENCRYPTION_KEY="<value>"
```

If you omit it, `scripts/railway-bootstrap.sh` generates one for you.

## Infrastructure as Code

Desired topology lives in [`.railway/railway.ts`](../.railway/railway.ts) (Postgres, Redis, web, worker, demo env references).

```bash
railway link          # once
railway config plan   # preview
railway config apply  # apply after review
```

**Note:** The current Railway IaC DSL does not fully express `build.dockerfilePath`. Bootstrap (or dashboard) still sets `Dockerfile.web` / `Dockerfile.worker`. Prefer IaC for services, databases, and variables; keep CaC files (`railway.json` / `railway.toml`) out of the repo so they do not conflict with IaC.

## Manual deploy (after bootstrap)

```bash
railway up --service web -m "deploy web"
railway up --service worker -m "deploy worker"
railway domain --service web   # if no public URL yet
railway run --service web pnpm db:seed:deploy
```

## Clerk keys (development vs production)

Railway currently can run with Clerk **development** keys (`pk_test_` / `sk_test_`). That works, but:

- The browser shows a Clerk warning that development keys are loaded
- Development instances have stricter limits and weaker custom-domain behavior
- For `https://koda.advancedautomations.net`, prefer a **Production** Clerk instance

### Switch to production keys

1. Clerk Dashboard → create / open the **Production** instance (not Development)
2. Enable **Organizations** (Configure → Organizations settings) with membership required
3. Add roles with keys `org:admin`, `org:developer`, `org:employee`
4. Configure → API Keys → copy **live** keys:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_live_…`
   - `CLERK_SECRET_KEY` = `sk_live_…`
5. Webhooks → endpoint `https://koda.advancedautomations.net/api/webhooks/clerk`  
   Events: `user.*`, `organization.created`, `organizationMembership.*`  
   Paste signing secret as `CLERK_WEBHOOK_SECRET`
6. Allowed origins / redirect URLs: `https://koda.advancedautomations.net`
7. Set the three vars on the Railway **web** service and redeploy

Until live keys are pasted, test keys remain usable for smoke tests after signing in and selecting an organization (`/select-org`).

## Turning off demo mode

When Clerk / Cursor / GitHub are ready:

1. Set real credentials (`NEXT_PUBLIC_CLERK_*`, `CLERK_SECRET_KEY`, `CURSOR_API_KEY`, `GITHUB_APP_*`, …)
2. Remove or set to `0`: `ALLOW_DEMO_AUTH`, `NEXT_PUBLIC_ALLOW_DEMO_AUTH`, `CURSOR_MOCK`, `GITHUB_MOCK`, `RAILWAY_MOCK`
3. Redeploy web + worker
4. Follow [runbooks.md](./runbooks.md) production wiring checklist
5. Prefer `pk_live_` / `sk_live_` on the custom domain (see above)

### GitHub App (one-click)

See [github-app-setup.md](./github-app-setup.md). On Railway, set `RAILWAY_API_TOKEN` and `RAILWAY_WORKER_SERVICE_ID` on the **web** service, then open Admin → **Register GitHub App (one-time)** while logged into GitHub.

## Local Docker smoke test

```bash
docker build -f Dockerfile.web -t automation-studio-web .
docker build -f Dockerfile.worker -t automation-studio-worker .
```

## Troubleshooting

- **Build fails on Prisma/OpenSSL** — images install `openssl` + `ca-certificates` in the base stage.
- **Web unhealthy** — confirm `/api/health` returns 200 and `DATABASE_URL` / `REDIS_URL` reference the Postgres/Redis services.
- **Worker idle** — same Redis URL as web; check `railway logs --service worker --lines 100`.
- **Auth required** — without `RAILWAY_TOKEN`, bootstrap cannot create the project. Add the token to the Cloud Agent environment and re-run.
