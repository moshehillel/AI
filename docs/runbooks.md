# Runbooks

## Production Clerk auth (Railway or AWS)

Customers sign in via Clerk on `clerk.advancedautomations.net`. Required on **web** and **worker**:

```bash
# Railway example:
railway variable set --service web \
  OPEN_ACCESS=0 NEXT_PUBLIC_OPEN_ACCESS=0 \
  ALLOW_DEMO_AUTH=0 NEXT_PUBLIC_ALLOW_DEMO_AUTH=0
railway variable set --service worker \
  OPEN_ACCESS=0 NEXT_PUBLIC_OPEN_ACCESS=0 \
  ALLOW_DEMO_AUTH=0 NEXT_PUBLIC_ALLOW_DEMO_AUTH=0
# NEXT_PUBLIC_* is baked at image build — redeploy web from source:
railway up --service web -d -y -m "Clerk auth enabled"
railway up --service worker -d -y -m "Clerk auth enabled"
```

On AWS, set the same values in Secrets Manager (`infra/aws/terraform/secrets.tf`) and rebuild the web image with `NEXT_PUBLIC_OPEN_ACCESS=0`.

Then open https://koda.advancedautomations.net — Sign in → select organization → Programs.

Staff developer tools: sign in with Clerk `org:developer` / `org:admin`, or use `/staff` password fallback (`ADMIN_PASSWORD`).

## Local open access (no login)

```bash
cp .env.example .env
# Production-like local: OPEN_ACCESS=0 + Clerk keys in .env
# No-login local dev: OPEN_ACCESS=1, ALLOW_DEMO_AUTH=0, mocks on

# Start Postgres + Redis (docker compose or local services)
pnpm install
# postinstall runs db:generate + packages:build
pnpm db:push   # or: pnpm db:migrate
pnpm db:seed
pnpm packages:build   # only needed if dist/ is missing
pnpm dev:web
pnpm dev:worker
```

Open http://localhost:3000 — redirects to `/projects` as the seeded customer (EMPLOYEE). No Sign in / role switcher.

## Hosted open access (local dev pattern only)

> **Deprecated for production.** NetFree whitelabel allows Clerk — use production Clerk auth above.

Single-customer mode for temporary testing:

```bash
railway variable set --service web \
  OPEN_ACCESS=1 NEXT_PUBLIC_OPEN_ACCESS=1 \
  ALLOW_DEMO_AUTH=0 NEXT_PUBLIC_ALLOW_DEMO_AUTH=0
railway variable set --service worker \
  OPEN_ACCESS=1 NEXT_PUBLIC_OPEN_ACCESS=1 \
  ALLOW_DEMO_AUTH=0 NEXT_PUBLIC_ALLOW_DEMO_AUTH=0
# NEXT_PUBLIC_* is baked at image build — redeploy from source:
railway up --service web -d -y -m "Open access no login"
railway up --service worker -d -y -m "Open access no login"
```

Then open https://koda.advancedautomations.net — onboarding loads with no login.

### Program lifecycle (plan → build → verify → deploy)

```mermaid
stateDiagram-v2
  direction LR
  [*] --> PLANNING
  PLANNING --> AWAITING_DEV_BUILD: Customer submits plan\n(planning locks)
  AWAITING_DEV_BUILD --> BUILDING: Developer starts build
  BUILDING --> TESTING: Grant Test & Improve (optional)
  BUILDING --> CLIENT_VERIFY: Ready for client testing
  TESTING --> CLIENT_VERIFY: Ready for client testing
  CLIENT_VERIFY --> AWAITING_FINAL_REVIEW: Customer submits for final review
  AWAITING_FINAL_REVIEW --> DONE: Developer approves & deploys
  AWAITING_DEV_BUILD --> PLANNING: Staff reopens planning only
```

| Phase | Status | Customer sees |
| --- | --- | --- |
| Planning | `PLANNING` | Living plan chat, attach docs/secrets, submit modal with lock warning |
| Submitted / building | `AWAITING_DEV_BUILD`, `BUILDING`, `TESTING` | “Submitted — your developer is building. Planning is closed.” Chat composer disabled |
| Test & request changes | `CLIENT_VERIFY`, `PREVIEW_READY`, `CHANGES_REQUESTED` | New chat phase (not planning). Ask how to test, request edits. Agent edits live repo branch |
| Final review | `AWAITING_FINAL_REVIEW` | Chat closed; developer reviews in queue |
| Complete | `DONE` / `DEPLOYED` | Program complete |

Submit requires **two confirmations** plus checkbox: “I understand I cannot change the plan after submit.”
Customers cannot reopen planning — only staff (`DEVELOPER` / `ADMIN`) via Actions.

Developer flow:

1. **Open in Cursor** — review plan (plan mode)
2. **Build** — agent/build mode on branch
3. **Grant Test & Improve** (optional) — developer workspace
4. **Ready for client testing** — opens `CLIENT_VERIFY`, posts phase-break message, starts verify chat for customer
5. Customer **Submit for final review** → notify email (`NOTIFY_EMAIL`)
6. **Approve & deploy** from review queue / Build desk

### Accidental program submit / staff reopen planning

Submit requires explicit confirmation (`confirmSubmit: true`) and acknowledgment
(`confirmNoPlanChange: true`). Chat and file attach never submit a program.

Customers **cannot** reopen planning after submit. If the plan was wrong:

1. Staff unlocks at `/staff`
2. Open the program → Actions → **Reopen planning (staff)**
3. Status returns to `PLANNING` for the customer


### Customer secrets (plan prerequisites + secure paste)

Living plans include **## What you need to provide** (accounts, API keys,
logins, sample files, VPN access). Koda keeps this list updated while planning.

**Customer — add credentials**

1. Open a program in Planning
2. Click **Add secrets / credentials** under the composer
3. Enter a clear name (e.g. `HHA_PASSWORD`) and the value
4. Click **Save securely** — chat shows only `Secret saved: HHA_PASSWORD`
5. Values are AES-GCM encrypted in `secret_refs` (`ENCRYPTION_KEY`); never
   appear in chat logs, plan markdown, or SSE snapshots

Do **not** paste passwords into the normal chat box. Auto-detection still
redacts common patterns if they slip through.

**Developer — retrieve for Build**

1. Unlock staff: open `/staff`, enter `ADMIN_PASSWORD` (or `STAFF_ACCESS_TOKEN`)
2. Open the submitted program → **Build desk**
3. Under **Customer secrets**, click **Reveal** then **Copy once**
4. Use the value in the build environment / Cursor session manually
5. Never commit secrets to git or PR bodies; audit logs store key names only

Open in Cursor / Build / Test & Improve prompts include secret **names** only
(so you know what to look up). Decrypt happens only on the Build desk.

### Developer flow: Open in Cursor → Build → Test & Improve

While `OPEN_ACCESS=1`, the public site is always the seeded **EMPLOYEE**.
Developers unlock staff tools with a password (`ADMIN_PASSWORD` or
`STAFF_ACCESS_TOKEN`) via the `/staff` form — the password is never put in the
URL (query tokens leak in history and logs). After login, an httpOnly signed
cookie unlocks `/admin`, `/review`, and `/usage`.

```bash
# Set once (reuse STAFF_ACCESS_TOKEN if already configured):
railway variable set --service web ADMIN_PASSWORD="$(openssl rand -hex 24)"
# Or keep using the existing alias:
# railway variable set --service web STAFF_ACCESS_TOKEN="$(openssl rand -hex 24)"
# Redeploy web after setting. Then open:
# https://koda.advancedautomations.net/staff
```

Then for each submitted program:

1. Open **Review queue** → program (or the link from the notify email)
2. Click **Open in Cursor** — resumes/creates a plan-mode agent with the
   customer's living plan and opens `cursor.com/background-agent?bcId=…`
   (falls back to `cursor.com/agents/{id}` in the browser)
3. Click **Build** (server label + auto-deploy) → status `BUILDING`, agent
   switches to agent/build mode on the plan
4. Confirm **Grant Test & Improve workspace** → status `TESTING`, workspace
   panel with Continue in Cursor + Deploy
5. Click **Ready for client testing** → status `CLIENT_VERIFY`, customer
   Test & request changes chat opens (planning stays closed)
6. Customer verifies in Koda chat only — they never see Cursor / Git / Railway
7. Customer **Submit for final review** → developer notify email

### Developer email on submit

On submit, Koda queues (and sends via Resend when configured) a notify email.

Set on Railway **web** (and worker if it ever sends mail):

```bash
# Recipient (owner) — required while seed users use @demo.local
railway variable set --service web NOTIFY_EMAIL=you@yourdomain.com

# Delivery — create a Resend API key; without it, rows stay QUEUED in Admin inbox
railway variable set --service web RESEND_API_KEY=re_...
railway variable set --service web 'EMAIL_FROM=Koda <onboarding@resend.dev>'
# Prefer a verified domain sender once Resend domain is set up:
# railway variable set --service web 'EMAIL_FROM=Koda <noreply@advancedautomations.net>'
```

Without `RESEND_API_KEY`, notifications are stored in Admin → Notification inbox only
(open access runs as EMPLOYEE, so use Railway logs / DB / a developer session to inspect).

### Restore Clerk (if open access was re-enabled)

```bash
railway variable set --service web OPEN_ACCESS=0 NEXT_PUBLIC_OPEN_ACCESS=0
railway variable set --service worker OPEN_ACCESS=0 NEXT_PUBLIC_OPEN_ACCESS=0
railway up --service web -d -y -m "Restore Clerk auth"
railway up --service worker -d -y -m "Restore Clerk auth"
```

See also [aws-migration.md](./aws-migration.md) for AWS cutover.

## Local demo mode (optional, role switcher)

For local explore with Employee / Developer / Admin switching, set
`ALLOW_DEMO_AUTH=1` / `NEXT_PUBLIC_ALLOW_DEMO_AUTH=1` and leave `OPEN_ACCESS=0`.
Do **not** enable demo auth on production while using open access.

## Connect a repository

1. Use Clerk admin once wired, or temporarily seed admin locally with demo auth
2. Open Admin → Install GitHub App (mock callback works without credentials)
3. Connect `owner/repo` on a project (installation id optional in mock mode)
4. Open project as customer → create a program

## Failed request recovery

- Employee/developer opens the change request
- Click **Retry** (only available in `FAILED`)
- Worker re-enters `ANALYZING` and resumes from branch creation or agent start

## High-risk workflow

1. Employee submits auth/payment/security related request
2. Status becomes `AWAITING_HIGH_RISK_APPROVAL`
3. Developer approves high-risk in Actions or Review queue
4. Implementation proceeds on an isolated branch only

## Production wiring checklist

1. Deploy hosting per [deploy.md](./deploy.md) (`pnpm railway:bootstrap` or Railway dashboard)
2. Configure Clerk Organizations + roles (`org:employee`, `org:developer`, `org:admin`)
3. Prefer Clerk **Production** instance keys (`pk_live_` / `sk_live_`) on the custom domain — see [deploy.md](./deploy.md#clerk-keys-development-vs-production)
4. Point Clerk webhook at `https://koda.advancedautomations.net/api/webhooks/clerk`
5. Set `OPEN_ACCESS=0` / `NEXT_PUBLIC_OPEN_ACCESS=0` (and keep demo auth at `0`)
6. Set agent API key and remove mock flags as needed
7. Register GitHub App; set `GITHUB_APP_*`; remove `GITHUB_MOCK`
8. Configure Railway PR Environments to inherit **staging/preview-base**
9. Set `RAILWAY_API_TOKEN` and project/env ids on repositories
10. Protect `main` with required reviews + checks
11. Set company usage soft caps in Admin settings
12. Confirm `ENCRYPTION_KEY` is set (same value on web + worker)
13. After first sign-in, open `/select-org` if prompted — Koda JIT-links the org to `demo-co` when `clerkOrgId` was unset

## Scaling for production

Koda runs on Railway as **web** (Next.js) + **worker** (BullMQ) + **Postgres** + **Redis**. Use this section when moving from single-customer open access to many users.

### Multi-tenant readiness

| Layer | Today (OPEN_ACCESS=1) | Many customers (OPEN_ACCESS=0) |
| --- | --- | --- |
| Identity | Seeded `seed_employee` on `demo-co` | Clerk org → `Company.clerkOrgId` |
| Data scope | All queries filter `companyId` via `requireChangeRequestAccess` | Same — each org is isolated |
| Staff routes | `/staff` password → signed cookie for `/admin`, `/review`, `/usage` | Clerk `DEVELOPER` / `ADMIN` roles |
| Secrets | AES-GCM in `secret_refs`, scoped by `companyId` | Optional `ENCRYPTION_KEY_PER_ORG=1` for per-org key derivation |

**Before launch:** set `OPEN_ACCESS=0`, verify Clerk webhook sync, confirm each customer has their own Clerk org (not shared `demo-co`). The seed company remains for local dev only.

### Recommended Railway scaling

Start conservative; scale horizontally before raising per-process concurrency.

| Component | Starter (≤10 active users) | Growth (10–100 users) | High load (100+) |
| --- | --- | --- | --- |
| **web** | 1 replica, 1 vCPU / 1 GB | 2–3 replicas | 3–5 replicas + CDN for static |
| **worker** | 1 replica, `WORKER_CONCURRENCY=5` | 2 replicas, `WORKER_CONCURRENCY=5` each | 3+ replicas; tune `MAX_CONCURRENT_CURSOR_AGENTS` |
| **Postgres** | Railway Postgres (shared) | Upgrade plan; add `?connection_limit=10` per service | Dedicated Postgres; read replicas later |
| **Redis** | Railway Redis | Same; monitor memory | Dedicated Redis; increase `maxmemory` |

```bash
# Example production tuning (adjust to your plan):
railway variable set --service worker WORKER_CONCURRENCY=5 MAX_CONCURRENT_CURSOR_AGENTS=8
railway variable set --service web SSE_MAX_CONNECTIONS_PER_PROGRAM=8 SSE_MAX_CONNECTIONS_TOTAL=500
railway variable set --service web RATE_LIMIT_MESSAGES_PER_MIN=30 RATE_LIMIT_SUBMIT_PER_MIN=10
# Postgres pool — append to DATABASE_URL on both services:
# ?connection_limit=10&pool_timeout=20
railway up --service worker -d -y -m "Scale worker concurrency"
railway up --service web -d -y -m "Scale web SSE + rate limits"
```

### Environment flags (reference)

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKER_CONCURRENCY` | 5 | BullMQ jobs per worker replica |
| `MAX_CONCURRENT_CURSOR_AGENTS` | 8 | Global Redis semaphore — prevents Cursor API stampede |
| `QUEUE_MAX_WAITING` | 0 (unlimited) | Set e.g. 500 to reject enqueue when backlog is huge |
| `SSE_MAX_CONNECTIONS_PER_PROGRAM` | 8 | Live chat SSE tabs per program per web replica |
| `SSE_MAX_CONNECTION_AGE_MS` | 7200000 | Auto-close stale SSE (2h) |
| `RATE_LIMIT_*` | see `.env.example` | Per-user API throttles (Redis-backed) |
| `ENCRYPTION_KEY_PER_ORG` | 0 | Set `1` for per-company secret keys (re-save secrets after) |
| `STAFF_SESSION_MAX_AGE_SEC` | 28800 | Staff cookie lifetime (8h) |

Planning jobs get **higher BullMQ priority** than build jobs automatically.

### Health checks

| Endpoint | Service | Use |
| --- | --- | --- |
| `GET /api/health` | web | Liveness |
| `GET /api/ready` | web | Readiness (Postgres + Redis) |
| `GET :8081/health` | worker | Liveness (`WORKER_HEALTH_PORT`) |
| `GET :8081/ready` | worker | Queue + cursor slot stats |

Point Railway health checks at `/api/ready` once stable (stricter than `/api/health`).

### What to do before many users

1. **Turn off open access** — `OPEN_ACCESS=0`, Clerk production keys, webhook wired.
2. **Run migrations** — `pnpm db:migrate:deploy` (includes scale indexes on messages, agent_runs, programs).
3. **Set scaling env vars** on web + worker (see table above).
4. **Cap Cursor concurrency** — `MAX_CONCURRENT_CURSOR_AGENTS` ≤ your Cursor plan limits.
5. **Enable rate limits** — tune `RATE_LIMIT_*` for your expected traffic.
6. **Staff hardening** — strong `ADMIN_PASSWORD`, shorter `STAFF_SESSION_MAX_AGE_SEC`, never share password in URLs.
7. **Monitor** — worker `/ready` queue depth, Railway Postgres connections, Redis memory, failed BullMQ jobs (`removeOnFail` keeps last 5000).
8. **Optional per-org encryption** — `ENCRYPTION_KEY_PER_ORG=1` only after planning a secret re-save window.

### Graceful degradation under load

When Cursor slots are full or the queue is deep, customers see plain-English status in chat: *“Koda is in high demand…”* with queue position when available. Jobs dedupe per program (`jobId: cursor-start-{id}`, `cursor-follow-up-{id}`) to prevent duplicate agents.
