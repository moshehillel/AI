# Clerk custom domain (CORS / FAPI)

When the browser on `https://koda.advancedautomations.net` fails fetching
`https://clerk.advancedautomations.net/v1/...` with a **CORS** error, the fix is
almost always **Clerk dashboard + DNS** — not app code. The live publishable key
(`pk_live_…`) embeds the Frontend API host; if that host is incomplete, TLS fails,
or the app origin is not allowlisted, the browser reports CORS.

## Diagnosing (from any shell)

```bash
# 1) DNS must CNAME to Clerk (not Netlify CDN / Railway)
dig +short CNAME clerk.advancedautomations.net
# expect: frontend-api.clerk.services.  (then clerkprod Cloudflare)

dig +short CNAME accounts.advancedautomations.net
# expect: accounts.clerk.services.

# 2) FAPI + CORS for the app origin
curl -sI -H "Origin: https://koda.advancedautomations.net" \
  "https://clerk.advancedautomations.net/v1/environment" \
  | grep -iE 'HTTP/|access-control-allow-origin|x-clerk-instance'

# Healthy: HTTP/2 200 (or 405 on HEAD), Access-Control-Allow-Origin:
#   https://koda.advancedautomations.net
```

If dig fails, points at Netlify/Railway, or TLS errors, complete DNS first.
Browsers often label TLS/DNS failures as “CORS blocked.”

## Netlify DNS records (this domain)

`advancedautomations.net` is on **Netlify DNS** (NSONE:
`dns*.p04.nsone.net`, SOA contact `domains+netlify.netlify.com`).

In **Netlify → Domain management → advancedautomations.net → DNS**:

| Type  | Name       | Value                         | Notes |
|-------|------------|-------------------------------|--------|
| CNAME | `clerk`    | `frontend-api.clerk.services` | Frontend API (FAPI). Use the exact target Clerk shows if different. |
| CNAME | `accounts` | `accounts.clerk.services`     | Account Portal. Use the exact target Clerk shows if different. |

Do **not**:

- Point `clerk` / `accounts` at Netlify, Railway, or an A record you invent
- Put a Cloudflare “orange cloud” proxy in front of these names later
- Expect code or Railway env vars to repair FAPI CORS

Leave `koda` as whatever hosts the app (Railway CNAME/A today).

Propagation is usually minutes; Clerk also needs to finish cert issuance
(Google Trust Services via Clerk’s Cloudflare edge).

## Clerk Production dashboard clicks

Open [dashboard.clerk.com](https://dashboard.clerk.com) → instance **AI Studio** →
**Production** (not Development):

1. **Configure → Domains** (or **Custom domains**)
   - **Frontend API**: `clerk.advancedautomations.net` → status **Active / Verified**
   - **Accounts Portal**: `accounts.advancedautomations.net` → **Active / Verified**
   - Copy the CNAME targets Clerk displays into Netlify if they differ from the table above
2. **Paths / URLs**
   - Home / Application URL = `https://koda.advancedautomations.net`
   - After sign-in / sign-up = `https://koda.advancedautomations.net`
3. **Allowed origins / redirect URLs / authorized applications**
   - Include `https://koda.advancedautomations.net`
   - Add the Railway `*.up.railway.app` URL **only** if you still open that host
4. **Satellite domains** — only if you run a second app domain that shares the
   same Clerk session; `koda` alone does not need satellite mode when Account
   Portal is on `accounts.*`
5. Confirm Railway **web** has `pk_live_` / `sk_live_` for this Production
   instance and redeploy if keys changed

### Alternative if the custom domain stays broken

Create/use a Production instance **without** a custom FAPI host so the
publishable key targets `*.clerk.accounts.dev`, then put those keys on Railway
and redeploy. With the current `pk_live_` that already embeds
`clerk.advancedautomations.net`, DNS for that name **must** work — you cannot
override the FAPI host in app code.

## Temporary: demo auth while Clerk is fixed

Demo mode is already supported; Railway currently runs with demo **off**
(`ALLOW_DEMO_AUTH=0`). To let people use the app without Clerk:

```bash
railway variable set --service web ALLOW_DEMO_AUTH=1 NEXT_PUBLIC_ALLOW_DEMO_AUTH=1
railway variable set --service worker ALLOW_DEMO_AUTH=1 NEXT_PUBLIC_ALLOW_DEMO_AUTH=1
# NEXT_PUBLIC_* is baked at image build — redeploy from source:
railway up --service web -d -y -m "Re-enable demo auth"
railway up --service worker -d -y -m "Re-enable demo auth"
```

Then open https://koda.advancedautomations.net → **Enter demo**. Turn demo off
again before relying on real org tenancy.

## Snapshot (2026-08-30 probe)

| Check | Result |
|-------|--------|
| `clerk` CNAME | `frontend-api.clerk.services` → Clerk Cloudflare ✓ |
| `accounts` CNAME | `accounts.clerk.services` ✓ |
| TLS `clerk` / `accounts` | Certs issued ~20:52–20:54 UTC same day ✓ |
| `GET /v1/environment` + Origin `koda` | `200` + `Access-Control-Allow-Origin: https://koda.advancedautomations.net` ✓ |
| Clerk `home_url` | `https://koda.advancedautomations.net` ✓ |

If errors persist after a hard refresh, re-check Domains status in Clerk and
Netlify DNS; do not chase CORS middleware in Next.js for Clerk FAPI calls.
