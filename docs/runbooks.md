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

## Production wiring checklist

1. Configure Clerk Organizations + roles (`org:employee`, `org:developer`, `org:admin`)
2. Disable `ALLOW_DEMO_AUTH` / `NEXT_PUBLIC_ALLOW_DEMO_AUTH`
3. Set `CURSOR_API_KEY` and remove `CURSOR_MOCK`
4. Register GitHub App; set `GITHUB_APP_*`; remove `GITHUB_MOCK`
5. Configure Railway PR Environments to inherit **staging/preview-base**
6. Set `RAILWAY_API_TOKEN` and project/env ids on repositories
7. Protect `main` with required reviews + checks
8. Set company usage soft caps in Admin settings
