# GitHub App setup (Automation Studio)

Automation Studio needs one GitHub App per deployment. Most fields are pre-filled via the **manifest flow** — you only need a single GitHub login + confirmation.

## Option A — Hosted one-click (recommended for Railway)

Prerequisites on Railway **web** service:

- `RAILWAY_API_TOKEN` — account or project token with variable write access
- `RAILWAY_WORKER_SERVICE_ID` — worker service id (web already has `RAILWAY_SERVICE_ID`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`)

Steps:

1. Open **Admin** on your deployment (demo mode: switch to Admin role).
2. Click **Register GitHub App (one-time)** — or visit:
   `https://<your-app>/api/github/app-manifest/start`
3. Sign into GitHub if prompted, review the pre-filled app, click **Create GitHub App**.
4. GitHub redirects back; credentials are written to Railway (`GITHUB_APP_*`, `GITHUB_MOCK=0`) and services redeploy.
5. Click **Install / manage GitHub App** and install into your org/user.
6. Connect repositories from Admin.

### Pre-filled app settings

| Field | Value |
|---|---|
| Homepage | `NEXT_PUBLIC_APP_URL` |
| Setup URL | `{APP_URL}/api/github/install/callback` |
| Webhook | `{APP_URL}/api/webhooks/github` |
| Permissions | Contents RW, PRs RW, Commit statuses R, Checks R, Administration R |
| Events | `pull_request`, `check_suite`, `check_run`, `status` |

Optional env:

- `GITHUB_APP_ORG` — register under an org (`moshehillel`) instead of your user account
- `GITHUB_APP_NAME` — default `Automation Studio`

## Option B — Local script

```bash
APP_URL=https://web-production-98ce0.up.railway.app node scripts/register-github-app.mjs
```

Opens `http://127.0.0.1:8765/start` in your browser. Requires `railway` CLI linked to the project.

## Option C — Manual dashboard

1. https://github.com/settings/apps/new
2. Use the values in the table above.
3. Generate a private key and set on Railway:

```bash
railway variable set --service web GITHUB_APP_ID="..."
railway variable set --service web GITHUB_APP_SLUG="..."
# repeat for worker; use --stdin for GITHUB_APP_PRIVATE_KEY PEM
railway variable set --service web GITHUB_MOCK=0
railway variable set --service worker GITHUB_MOCK=0
```

## Verify

- Admin shows **Register** hidden once `GITHUB_APP_ID` is set.
- `/api/github/install` redirects to `github.com/apps/<slug>/installations/new` (not mock callback).
- Webhook deliveries succeed in the GitHub App settings → Recent deliveries.

## Still required from you

| Credential | Why |
|---|---|
| GitHub login (one click) | GitHub does not allow fully headless App creation |
| Clerk (`CLERK_*`) | Account/org auth — dashboard only |
| `CURSOR_API_KEY` | Cursor Cloud Agents API — your Cursor account |
