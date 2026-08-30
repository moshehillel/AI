# Runbooks

## Local / open access (no login)

```bash
cp .env.example .env
# Ensure:
# OPEN_ACCESS=1
# NEXT_PUBLIC_OPEN_ACCESS=1
# ALLOW_DEMO_AUTH=1
# NEXT_PUBLIC_ALLOW_DEMO_AUTH=1
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

Open http://localhost:3000 — redirects to `/projects` as the seeded employee. No Sign in / role switcher.

## Hosted open access (temporary, until Clerk works)

Single-customer mode on Railway **web** and **worker**:

```bash
railway variable set --service web OPEN_ACCESS=1 NEXT_PUBLIC_OPEN_ACCESS=1 ALLOW_DEMO_AUTH=1 NEXT_PUBLIC_ALLOW_DEMO_AUTH=1
railway variable set --service worker OPEN_ACCESS=1 ALLOW_DEMO_AUTH=1
# NEXT_PUBLIC_* is baked at image build — redeploy from source:
railway up --service web -d -y -m "Open access no login"
railway up --service worker -d -y -m "Open access no login"
```

Then open https://koda.advancedautomations.net — onboarding dashboard loads with no login. Turn `OPEN_ACCESS=0` / `ALLOW_DEMO_AUTH=0` (and NEXT_PUBLIC_* counterparts) when Clerk is usable again.

## Connect a repository (admin seed)

1. Temporarily set `DEMO_ROLE=admin` on web (with OPEN_ACCESS off) or use Clerk admin once wired
2. Open Admin → Install GitHub App (mock callback works without credentials)
3. Connect `owner/repo` on a project (installation id optional in mock mode)
4. Return to employee open access → open project → create a program

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
5. Disable `OPEN_ACCESS` / `NEXT_PUBLIC_OPEN_ACCESS` / `ALLOW_DEMO_AUTH` / `NEXT_PUBLIC_ALLOW_DEMO_AUTH`
6. Set agent API key and remove mock flags as needed
7. Register GitHub App; set `GITHUB_APP_*`; remove `GITHUB_MOCK`
8. Configure Railway PR Environments to inherit **staging/preview-base**
9. Set `RAILWAY_API_TOKEN` and project/env ids on repositories
10. Protect `main` with required reviews + checks
11. Set company usage soft caps in Admin settings
12. Confirm `ENCRYPTION_KEY` is set (same value on web + worker)
13. After first sign-in, open `/select-org` if prompted — Koda JIT-links the org to `demo-co` when `clerkOrgId` was unset
