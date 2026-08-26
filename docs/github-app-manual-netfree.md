# GitHub App setup for NetFree (manual — github.com only)

Use this guide when:

- NetFree blocks Railway URLs (`*.up.railway.app`)
- `register-github-app.html` opens as raw text or the form POST to GitHub is blocked
- The cloud agent’s `gh` CLI cannot create the app for you (see [Why `gh` cannot do this alone](#why-gh-cannot-create-a-github-app-headlessly))

You only need **github.com** in a browser. You never visit Railway.

**Deployment URL used below:** `https://web-production-98ce0.up.railway.app`  
Replace if your live URL differs (check Railway dashboard → web service → domain).

---

## Step 1 — Open the org app creation form

1. Sign in to GitHub as a **moshehillel organization owner**.
2. Open: **https://github.com/organizations/moshehillel/settings/apps/new**

---

## Step 2 — Fill every field exactly

### General

| Form field | Value |
|---|---|
| **GitHub App name** | `Automation Studio` |
| **Description** | `Automation Studio — AI-assisted change requests with branch/PR workflows.` |
| **Homepage URL** | `https://web-production-98ce0.up.railway.app` |

### Identifying and authorizing users

| Form field | Value |
|---|---|
| **Callback URL** | `https://web-production-98ce0.up.railway.app/api/github/install/callback` |
| **Expire user authorization tokens** | **Unchecked** |
| **Request user authorization (OAuth) during installation** | **Unchecked** |
| **Enable Device Flow** | **Unchecked** (leave default) |

### Post installation

| Form field | Value |
|---|---|
| **Setup URL (optional)** | `https://web-production-98ce0.up.railway.app/api/github/install/callback` |
| **Redirect on update** | **Unchecked** (default) |

### Webhook

| Form field | Value |
|---|---|
| **Active** | **Checked** ✓ |
| **Webhook URL** | `https://web-production-98ce0.up.railway.app/api/webhooks/github` |
| **Secret** | Leave blank — GitHub generates one after creation (copy it in Step 3) |

### Permissions — Repository permissions

| Permission | Access level |
|---|---|
| **Contents** | **Read and write** |
| **Pull requests** | **Read and write** |
| **Commit statuses** | **Read-only** |
| **Checks** | **Read-only** |
| **Administration** | **Read-only** |

All other repository permissions: **No access** (default).

### Permissions — Organization permissions

Leave **all** at **No access**.

### Subscribe to events

Check **only** these four:

- [x] `pull_request`
- [x] `check_suite`
- [x] `check_run`
- [x] `status`

### Where can this GitHub App be installed?

Select: **Only on this account** (moshehillel org only).

---

## Step 3 — Create and collect credentials

1. Click **Create GitHub App**.
2. On the app settings page, note:
   - **App ID** (numeric, top of page)
   - **Client ID**
   - **Client secret** — click **Generate a new client secret**, copy immediately
   - **Webhook secret** — under Webhook → **Reveal** (or regenerate and copy)
3. Scroll to **Private keys** → **Generate a private key** → download the `.pem` file.
4. Note the app **slug** from the URL: `https://github.com/apps/<slug>` (often `automation-studio` or `automation-studio-<suffix>`).

---

## Step 4 — Give credentials to the cloud agent (or set Railway yourself)

Paste these to the cloud agent as **secrets** (preferred — agent can run `railway variable set` for you):

| Secret name | Value |
|---|---|
| `GITHUB_APP_ID` | App ID from step 3 |
| `GITHUB_APP_SLUG` | Slug from app URL |
| `GITHUB_APP_CLIENT_ID` | Client ID |
| `GITHUB_APP_CLIENT_SECRET` | Client secret |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook secret |
| `GITHUB_APP_PRIVATE_KEY` | Full contents of the `.pem` file (including `-----BEGIN/END-----` lines) |

Also set `GITHUB_MOCK=0` on both **web** and **worker** services.

### Or set Railway variables yourself

```bash
railway variable set --service web GITHUB_APP_ID="YOUR_APP_ID"
railway variable set --service web GITHUB_APP_SLUG="YOUR_SLUG"
railway variable set --service web GITHUB_APP_CLIENT_ID="YOUR_CLIENT_ID"
railway variable set --service web GITHUB_APP_CLIENT_SECRET="YOUR_CLIENT_SECRET"
railway variable set --service web GITHUB_APP_WEBHOOK_SECRET="YOUR_WEBHOOK_SECRET"
railway variable set --service web GITHUB_MOCK=0
railway variable set --service web GITHUB_APP_PRIVATE_KEY --stdin < downloaded-key.pem

# Repeat GITHUB_APP_* and GITHUB_MOCK=0 for worker:
railway variable set --service worker GITHUB_APP_ID="YOUR_APP_ID"
# … (same keys as web)
railway variable set --service worker GITHUB_APP_PRIVATE_KEY --stdin < downloaded-key.pem
```

---

## Step 5 — Install the app on repositories

Open (replace `<slug>`):

**https://github.com/apps/<slug>/installations/new**

Choose **moshehillel** and select repositories (or all repos). Confirm install.

---

## Verify

- Admin UI no longer shows “Register GitHub App”.
- `/api/github/install` redirects to `github.com/apps/<slug>/installations/new`.
- GitHub App settings → **Recent deliveries** shows successful webhook posts.

---

## Why `gh` cannot create a GitHub App headlessly

### What we tested in the cloud agent

| Command | Result |
|---|---|
| `gh auth status` | Logged in as **`cursor[bot]`** — Cursor’s **integration** token (`ghs_…`), not your personal account |
| `gh api user` | **403** — `Resource not accessible by integration` |
| `gh api orgs/moshehillel` | **404** — integration has no org admin access |
| `gh api user/orgs` | **403** — integration cannot list your orgs |
| `gh api -X POST app-manifests/{code}/conversions` | Works **only** with a valid one-time `code` from a browser redirect after you click **Create GitHub App** |
| Direct “create app” REST/GraphQL endpoint | **Does not exist** — GitHub has no API to register a new app without the manifest browser step |

### Plain-language reason

GitHub treats **creating an App** like creating a sensitive integration: an **org owner must approve it in the browser**. There is no PAT scope, no `gh` subcommand, and no REST endpoint that skips that click. The cloud agent’s `gh` runs as **`cursor[bot]`**, a limited integration — it cannot act as you or as a moshehillel org admin.

The manifest flow (`register-github-app.html` → github.com → copy `code` → `gh api …/conversions`) still requires **you** to click **Create GitHub App** on github.com. The CLI only **exchanges** the one-time code afterward; it cannot obtain the code without your browser session.

### What `gh auth login` would change (and what it would not)

If you run `gh auth login` in the cloud environment with **your** GitHub account (device flow or `--web` on github.com only):

- **Would help:** `gh api user`, listing repos, maybe setting Railway vars via scripts
- **Would NOT help:** Creating the App — you still must open github.com and click **Create**, or use the manual form above

There is also **no `gh extension`** for GitHub App registration.

---

## Alternative: manifest flow + code exchange (if HTML works)

If NetFree allows opening `register-github-app.html` in Chrome/Edge and POSTing to github.com:

1. Cloud agent generates the file (`pnpm register:github-app`).
2. You open it locally, click **Continue to GitHub**, click **Create GitHub App**.
3. Copy the `code=` from the redirect URL on github.com.
4. Paste the code to the agent — it runs:

```bash
APP_URL=https://web-production-98ce0.up.railway.app \
GITHUB_APP_ORG=moshehillel \
pnpm register:github-app -- --code=PASTE_CODE_HERE
```

That calls `POST /app-manifests/{code}/conversions` (no auth; the code is the secret) and writes all `GITHUB_APP_*` vars to Railway.

If HTML/POST is blocked, use **this manual guide** instead — same end result, no HTML file needed.

---

## Quick checklist (print-friendly)

```
[ ] Open https://github.com/organizations/moshehillel/settings/apps/new
[ ] App name: Automation Studio
[ ] Homepage: https://web-production-98ce0.up.railway.app
[ ] Callback: https://web-production-98ce0.up.railway.app/api/github/install/callback
[ ] Webhook:  https://web-production-98ce0.up.railway.app/api/webhooks/github
[ ] Perms: Contents RW, PRs RW, Statuses R, Checks R, Admin R
[ ] Events: pull_request, check_suite, check_run, status
[ ] Install: Only on this account
[ ] Create → Generate private key → Copy App ID, Client ID/secret, Webhook secret, PEM
[ ] Paste secrets to cloud agent OR railway variable set on web + worker
[ ] Install app: https://github.com/apps/<slug>/installations/new
```
