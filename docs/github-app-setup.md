# GitHub App setup (Automation Studio)

Automation Studio needs one GitHub App per deployment. Most fields are pre-filled via the **manifest flow** — you only need a single GitHub login + confirmation.

> **NetFree / cloud agent blocked?** The cloud agent’s `gh` CLI **cannot** create a GitHub App by itself (integration token, no create-app API). Use the copy-paste manual guide: **[github-app-manual-netfree.md](./github-app-manual-netfree.md)** — github.com only, no HTML file, no Railway visit.

## Option A — NetFree / no Railway URL (recommended when Railway is blocked)

You never visit your Railway domain. Only **github.com** is opened in the browser.

```bash
APP_URL=https://web-production-98ce0.up.railway.app \
pnpm register:github-app
```

Steps:

1. Save the generated file as **`register-github-app.html`** (not `.txt`).
2. Right-click the file → **Open with** → Chrome or Edge (do not open in a plain-text editor).
3. Click **Continue to GitHub** on the page (there is no auto-redirect — you must click the button).
4. Sign into GitHub as **moshehillel** (user account); review the app and click **Create GitHub App**.
5. GitHub redirects to `https://github.com/settings/apps?code=…` — copy the **`code`** query param from the address bar.
6. Paste the code to the cloud agent, or exchange it locally:

```bash
APP_URL=https://web-production-98ce0.up.railway.app \
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
pnpm register:github-app -- --mode=local
```

Opens `http://127.0.0.1:8765/start` — callback stays on localhost; only github.com is contacted for app creation.

## Option D — Manual dashboard (copy-paste fallback)

Use this when NetFree blocks the HTML form POST or the file opens as raw HTML text.

**Full step-by-step (recommended):** [github-app-manual-netfree.md](./github-app-manual-netfree.md)

1. Open https://github.com/settings/apps/new (signed in as **moshehillel** — a user account, not an org).

   > For a GitHub **organization**, use `https://github.com/organizations/ORG_NAME/settings/apps/new` and set `GITHUB_APP_ORG=ORG_NAME`.
2. Fill in every field exactly as below (replace `{APP_URL}` with your deployment URL, e.g. `https://web-production-98ce0.up.railway.app`):

| Field | Value |
|---|---|
| **GitHub App name** | `Automation Studio` |
| **Description** | `Automation Studio — AI-assisted change requests with branch/PR workflows.` |
| **Homepage URL** | `{APP_URL}` |
| **Callback URL** | `{APP_URL}/api/github/install/callback` |
| **Setup URL** | `{APP_URL}/api/github/install/callback` (optional; same as callback) |
| **Webhook URL** | `{APP_URL}/api/webhooks/github` |
| **Webhook secret** | *(leave blank — GitHub generates one; copy it after creation)* |
| **Active** | ✓ checked |
| **Request user authorization (OAuth) during installation** | unchecked |
| **Expire user authorization tokens** | unchecked |
| **Where can this GitHub App be installed?** | Only on this account |

**Repository permissions**

| Permission | Access |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Commit statuses | Read-only |
| Checks | Read-only |
| Administration | Read-only |

**Organization permissions** — leave all at No access.

**Subscribe to events** — check all of:

- `pull_request`
- `check_suite`
- `check_run`
- `status`

3. Click **Create GitHub App**.
4. On the app settings page, click **Generate a private key** and download the `.pem` file.
5. Note the **App ID** and **Client ID** from the app settings page.
6. Set Railway variables on **web** and **worker** services:

```bash
railway variable set --service web GITHUB_APP_ID="YOUR_APP_ID"
railway variable set --service web GITHUB_APP_SLUG="automation-studio"   # slug from app URL
railway variable set --service web GITHUB_APP_CLIENT_ID="YOUR_CLIENT_ID"
railway variable set --service web GITHUB_APP_CLIENT_SECRET="YOUR_CLIENT_SECRET"
railway variable set --service web GITHUB_APP_WEBHOOK_SECRET="YOUR_WEBHOOK_SECRET"
railway variable set --service web GITHUB_MOCK=0
# repeat GITHUB_APP_* + GITHUB_MOCK for worker
# private key (PEM) — paste file contents:
railway variable set --service web GITHUB_APP_PRIVATE_KEY --stdin < downloaded-key.pem
railway variable set --service worker GITHUB_APP_PRIVATE_KEY --stdin < downloaded-key.pem
```

7. Install the app: `https://github.com/apps/<slug>/installations/new`

### Pre-filled app settings (manifest reference)

| Field | Value |
|---|---|
| Homepage | `NEXT_PUBLIC_APP_URL` |
| Setup URL | `{APP_URL}/api/github/install/callback` |
| Webhook | `{APP_URL}/api/webhooks/github` |
| Permissions | Contents RW, PRs RW, Commit statuses R, Checks R, Administration R |
| Events | `pull_request`, `check_suite`, `check_run`, `status` |

Optional env:

- `GITHUB_APP_ORG` — optional; set only when registering under a GitHub **organization** (not a user account like `moshehillel`)
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

### What works in the cloud agent today

| Check | Typical result |
|---|---|
| `gh auth status` | Logged in as **`cursor[bot]`** (Cursor integration token) |
| `gh api user` | **403** — integration cannot impersonate you |
| `gh api orgs/moshehillel` | **404** — `moshehillel` is a user account, not an org |
| `gh api -X POST app-manifests/{code}/conversions` | Works **only** after you paste a valid one-time `code` from github.com |

### Manifest conversion (unauthenticated — `code` is the secret)

```bash
gh api -X POST "app-manifests/CODE/conversions" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28"
```

Returns `id`, `slug`, `client_id`, `client_secret`, `webhook_secret`, `pem`.

### What does **not** exist

- No REST/GraphQL endpoint to create a GitHub App from scratch (no PAT, no `gh` flag skips the browser)
- No `gh extension` for app registration
- `gh auth login` with your account helps run **other** `gh` commands — it still cannot click **Create GitHub App** for you

Org owners must click **Create** on github.com (manifest flow or [manual form](./github-app-manual-netfree.md)). For user accounts, sign in as that user and use `https://github.com/settings/apps/new`.
