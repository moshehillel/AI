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

`secret_refs` stores references only (env/vault pointers), never plaintext third-party production credentials.

## Audit trail

Important actions write `audit_events` (create, classify, branch, plan, preview, submit, approve, merge).

## Webhooks

- Clerk: Svix signature verification
- GitHub: HMAC `x-hub-signature-256`

## Known MVP tradeoffs

- Demo auth fallback (`ALLOW_DEMO_AUTH=1`) is for local development only.
- Mock integrations intentionally simulate success paths for UX development.
- Postgres RLS is planned as defense-in-depth after the app-layer tenant filters prove out.
