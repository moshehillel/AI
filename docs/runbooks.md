# Runbooks

## Local demo

```bash
cp .env.example .env
# Ensure:
# ALLOW_DEMO_AUTH=1
# NEXT_PUBLIC_ALLOW_DEMO_AUTH=1
# CURSOR_MOCK=1
# GITHUB_MOCK=1
# RAILWAY_MOCK=1

# Start Postgres + Redis (docker compose or local services)
pnpm install
pnpm db:generate
pnpm db:push   # or: pnpm db:migrate
pnpm db:seed
pnpm dev:web
pnpm dev:worker
```

Open http://localhost:3000 and use the role switcher (Employee / Developer / Admin).

## Connect a repository (demo)

1. Switch to Admin
2. Open Admin → Install GitHub App (mock callback works without credentials)
3. Connect `owner/repo` on a project (installation id optional in mock mode)
4. Switch to Employee → open project → create a change request

## Failed request recovery

- Employee/developer opens the change request
- Click **Retry** (only available in `FAILED`)
- Worker re-enters `ANALYZING` and resumes from branch creation or Cursor start

## High-risk workflow

1. Employee submits auth/payment/security related request
2. Status becomes `AWAITING_HIGH_RISK_APPROVAL`
3. Developer approves high-risk in Actions or Review queue
4. Implementation proceeds on an isolated branch only

## Clerk CORS / custom domain

Browser errors fetching `https://clerk.advancedautomations.net/v1/...` from
`https://koda.advancedautomations.net` are **Clerk DNS + dashboard**, not Next.js
CORS. Full DNS table, dashboard clicks, and probes:
[clerk-custom-domain.md](./clerk-custom-domain.md).

## Hosted demo (temporary, while Clerk domain is fixed)

When Production Clerk / custom FAPI is broken or still propagating:

```bash
railway variable set --service web ALLOW_DEMO_AUTH=1 NEXT_PUBLIC_ALLOW_DEMO_AUTH=1
railway variable set --service worker ALLOW_DEMO_AUTH=1 NEXT_PUBLIC_ALLOW_DEMO_AUTH=1
railway up --service web -d -y -m "Re-enable demo auth"
railway up --service worker -d -y -m "Re-enable demo auth"
```

Open https://koda.advancedautomations.net → **Enter demo**. Set both vars back
to `0` and redeploy before relying on real org tenancy.

## Production wiring checklist

1. Configure Clerk Organizations + roles (`org:employee`, `org:developer`, `org:admin`)
2. Complete Clerk custom domain + allowlist per [clerk-custom-domain.md](./clerk-custom-domain.md)
3. Disable `ALLOW_DEMO_AUTH` / `NEXT_PUBLIC_ALLOW_DEMO_AUTH`
4. Set `CURSOR_API_KEY` and remove `CURSOR_MOCK`
5. Register GitHub App; set `GITHUB_APP_*`; remove `GITHUB_MOCK`
6. Configure Railway PR Environments to inherit **staging/preview-base**
7. Set `RAILWAY_API_TOKEN` and project/env ids on repositories
8. Protect `main` with required reviews + checks
9. Set company usage soft caps in Admin settings
