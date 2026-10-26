# Security

## Non-negotiables

1. Employees cannot merge to `main` or deploy production.
2. Cursor API keys, GitHub App private keys, and Railway tokens never ship to the browser.
3. Preview/staging secrets are isolated from production secrets.
4. HIGH_RISK classification is enforced in backend job gates, not only prompts.
5. GitHub branch protection/rulesets enforce review + required checks independently of the app.

## Authorization

Server-side helpers in `@automation-studio/auth` and permissions in `@automation-studio/domain`.

Roles:

- `EMPLOYEE` — create/chat/submit/approve plan
- `DEVELOPER` — review/merge/high-risk approve
- `ADMIN` — members/projects/settings (no prod deploy by default)

## Secrets

`secret_refs` stores encrypted CHAT credentials (AES-GCM via `ENCRYPTION_KEY`,
optionally scoped per company with `ENCRYPTION_KEY_PER_ORG=1`) and env/vault
pointers for preview/platform. All secret queries include `companyId` from the
authenticated context. Plaintext values are never returned to customers after
save, never written to plan markdown or SSE, and never committed to git. Staff with `program:reveal_secrets` can decrypt on the Build
desk (copy-once). Attachment payloads use `planning-file-*` keys and are not
customer credentials.

Customers add labeled secrets via **Add secrets / credentials** in planning
chat. Living plans list prerequisites under **## What you need to provide**.

## Audit trail

Important actions write `audit_events` (create, classify, branch, plan, preview, submit, approve, merge, `secret.saved_labeled`, `secret.revealed` with key names only).

## Webhooks

- Clerk: Svix signature verification
- GitHub: HMAC `x-hub-signature-256`

## Rate limiting

Public write APIs (messages, submit, secrets, uploads, staff unlock) use
Redis-backed fixed-window limits (`RATE_LIMIT_*` env vars). Limits apply per
company/user or per IP for staff unlock.

## Known MVP tradeoffs

- Demo auth fallback (`ALLOW_DEMO_AUTH=1`) is for local development only.
- Mock integrations intentionally simulate success paths for UX development.
- Postgres RLS is planned as defense-in-depth after the app-layer tenant filters prove out.
