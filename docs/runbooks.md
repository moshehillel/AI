# Runbooks

## Local open access (no login)

```bash
cp .env.example .env
# Ensure:
# OPEN_ACCESS=1
# NEXT_PUBLIC_OPEN_ACCESS=1
# ALLOW_DEMO_AUTH=0
# NEXT_PUBLIC_ALLOW_DEMO_AUTH=0
# CURSOR_MOCK=1
# GITHUB_MOCK=1
# RAILWAY_MOCK=1

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

## Hosted open access (temporary, until NetFree allows Clerk)

Single-customer mode on Railway **web** and **worker**:

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

### Accidental program submit / reopen planning

Submit requires an explicit confirmation step (`confirmSubmit: true`). Chat and
file attach never submit a program.

If a program is in **Submitted — waiting for developer** (`AWAITING_DEV_BUILD`):

1. Open the program
2. Click **Continue planning (reopen)** in chat or Actions
3. Status returns to **Planning with Koda** (`PLANNING`)


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
5. Customer verifies in Koda chat only — they never see Cursor / Git / Railway

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

### Restore Clerk later

```bash
railway variable set --service web OPEN_ACCESS=0 NEXT_PUBLIC_OPEN_ACCESS=0
railway variable set --service worker OPEN_ACCESS=0 NEXT_PUBLIC_OPEN_ACCESS=0
railway up --service web -d -y -m "Restore Clerk auth"
railway up --service worker -d -y -m "Restore Clerk auth"
```

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
