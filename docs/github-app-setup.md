# GitHub App setup (Automation Studio)

Automation Studio needs one GitHub App per deployment. Most fields are pre-filled via the **manifest flow** — you only need a single GitHub login + confirmation.

## Option A — NetFree / no Railway URL (recommended when Railway is blocked)

You never visit your Railway domain. Only **github.com** is opened in the browser.

```bash
APP_URL=https://web-production-98ce0.up.railway.app \
GITHUB_APP_ORG=moshehillel \
pnpm register:github-app
```

Steps:

1. Open the generated `register-github-app.html` in your browser (double-click or `file://`).
2. Sign into GitHub as a **moshehillel org owner** if prompted; review the app and click **Create GitHub App**.
3. GitHub redirects to `https://github.com/organizations/moshehillel/settings/apps?code=…` — copy the **`code`** query param from the address bar.
4. Paste the code to the cloud agent, or exchange it locally:

```bash
APP_URL=https://web-production-98ce0.up.railway.app \
GITHUB_APP_ORG=moshehillel \
pnpm register:github-app -- --code=PASTE_CODE_HERE
```

This calls `POST /app-manifests/{code}/conversions` (no auth required) and writes `GITHUB_APP_*` + `GITHUB_MOCK=0` to Railway via the CLI.

5. Install the app: `https://github.com/apps/<slug>/installations/new`

### Why this works

The manifest `redirect_url` points at **github.com**, not Railway. NetFree typically allows github.com. The one-time `code` in the redirect URL is exchanged server-side (cloud agent or your machine) — credentials never pass through the blocked domain.

## Option B — Hosted one-click (Railway reachable)

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

## Option C — Local localhost callback

For developers with Railway CLI linked:

```bash
APP_URL=https://web-production-98ce0.up.railway.app \
GITHUB_APP_ORG=moshehillel \
pnpm register:github-app -- --mode=local
```

Opens `http://127.0.0.1:8765/start` — callback stays on localhost; only github.com is contacted for app creation.

## Option D — Manual dashboard

1. https://github.com/organizations/moshehillel/settings/apps/new
2. Use the values in the table below.
3. Generate a private key and set on Railway:

```bash
railway variable set --service web GITHUB_APP_ID="..."
railway variable set --service web GITHUB_APP_SLUG="..."
# repeat for worker; use --stdin for GITHUB_APP_PRIVATE_KEY PEM
railway variable set --service web GITHUB_MOCK=0
railway variable set --service worker GITHUB_MOCK=0
```

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

## Verify

- Admin shows **Register** hidden once `GITHUB_APP_ID` is set.
- `/api/github/install` redirects to `github.com/apps/<slug>/installations/new` (not mock callback).
- Webhook deliveries succeed in the GitHub App settings → Recent deliveries.

## Still required from you

| Credential | Why |
|---|---|
| GitHub login (one click) | GitHub does not allow fully headless App creation |
| One-time manifest `code` (NetFree path) | Copy from github.com redirect URL after Create |
| Clerk (`CLERK_*`) | Account/org auth — dashboard only |
| `CURSOR_API_KEY` | Cursor Cloud Agents API — your Cursor account |

## gh CLI reference

Manifest conversion (unauthenticated — `code` is the secret):

```bash
gh api -X POST "app-manifests/CODE/conversions" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28"
```

Returns `id`, `slug`, `client_id`, `client_secret`, `webhook_secret`, `pem`.

A PAT cannot create apps via API without the manifest flow — org owners must click **Create** on github.com.
