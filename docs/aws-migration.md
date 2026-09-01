# Koda — Railway → AWS migration

Migrate **Koda platform hosting only** from Railway to the dedicated `koda-platform` AWS stack. Whiteglove client automations stay in their own AWS project/account.

## Before you start

- [ ] Clerk production on `clerk.advancedautomations.net` (NetFree whitelabel complete)
- [ ] `OPEN_ACCESS=0` / `NEXT_PUBLIC_OPEN_ACCESS=0` on current Railway (or set during cutover)
- [ ] Terraform applied: `infra/aws/terraform` (see [infra/aws/README.md](../infra/aws/README.md))
- [ ] Secrets Manager populated with production keys
- [ ] ACM certificate issued and attached to ALB
- [ ] Docker images pushed to ECR (or GitHub Actions deploy enabled)

## Environment variable mapping

| Variable | Railway | AWS |
| --- | --- | --- |
| `DATABASE_URL` | Postgres plugin | Secrets Manager `…/database-url` (auto) |
| `REDIS_URL` | Redis plugin | Secrets Manager `…/redis-url` (auto) |
| `NEXT_PUBLIC_APP_URL` | Railway domain / custom | `https://koda.advancedautomations.net` |
| Clerk keys | Railway web vars | Secrets Manager `…/app-env` |
| `ENCRYPTION_KEY` | Railway web + worker | Same secret on both ECS services |
| `OPEN_ACCESS` | `0` | `0` |
| `NEXT_PUBLIC_OPEN_ACCESS` | `0` (rebuild web image) | `0` (baked at Docker build) |
| `CURSOR_API_KEY` | Railway worker + web | Secrets Manager |
| `GITHUB_APP_*` | Railway web | Secrets Manager (add keys to JSON) |
| `ADMIN_PASSWORD` | Railway web | Secrets Manager (staff fallback) |
| `RAILWAY_*` | Railway tokens | Not needed on AWS (`RAILWAY_MOCK=1` or omit) |

Add any optional vars from [`.env.example`](../.env.example) to the app secret JSON.

## Optional: export Railway Postgres

Only if you need existing production data (programs, secrets metadata, users):

```bash
# On a machine that can reach Railway private DATABASE_URL (railway ssh):
railway ssh --service web -- pg_dump "$DATABASE_URL" --no-owner --format=custom -f koda-railway.dump

# Restore into AWS RDS (from bastion or one-off task with network access):
pg_restore -d "$AWS_DATABASE_URL" --no-owner --clean koda-railway.dump
```

Skip DB export for a greenfield cutover — customers re-sign in via Clerk and orgs JIT-sync.

**Important:** `ENCRYPTION_KEY` must be the same after restore or customer secrets cannot be decrypted.

## DNS cutover (Netlify)

Current: `koda` CNAME → Railway hostname.

1. `terraform output alb_dns_name` (e.g. `koda-platform-production-123456789.us-east-1.elb.amazonaws.com`)
2. Lower TTL on `koda.advancedautomations.net` to 300s (5 min) 24h before cutover
3. At cutover window:
   - Update Netlify DNS: `koda` CNAME → ALB DNS name
   - Or use Route53: set `hosted_zone_id` in Terraform and apply
4. Verify HTTPS (ACM cert must cover `koda.advancedautomations.net`)
5. Update Clerk allowed origins + webhook URL to `https://koda.advancedautomations.net`
6. Smoke test (see checklist below)

## Cutover checklist

### T-24h

- [ ] Apply Terraform; confirm ECS services healthy in private subnets
- [ ] Populate Secrets Manager; force ECS redeploy
- [ ] Build web image with `NEXT_PUBLIC_OPEN_ACCESS=0` and Clerk `pk_live_`
- [ ] Run `pnpm db:migrate:deploy` (web container startup does this automatically)
- [ ] Lower DNS TTL

### Cutover window

- [ ] Set Railway `OPEN_ACCESS=0` (if not already) — optional pre-test on Railway
- [ ] Point DNS CNAME to ALB
- [ ] Wait for propagation; `curl -I https://koda.advancedautomations.net/api/ready`
- [ ] Sign in via Clerk → `/select-org` → `/projects`
- [ ] Submit test message in planning (non-production program)
- [ ] Developer: `/review` queue loads (Clerk `org:developer` or `/staff` password)
- [ ] Worker: confirm job processed (`aws logs tail /ecs/koda-platform-production/worker`)

### T+24h

- [ ] Monitor ALB 5xx, ECS CPU, RDS connections, Redis memory
- [ ] Disable Railway public domain or scale services to 0
- [ ] Archive Railway Postgres snapshot if data was migrated
- [ ] Document rollback: repoint CNAME to Railway hostname

## Rollback

1. Repoint `koda` CNAME back to Railway hostname
2. Redeploy Railway web+worker if env changed
3. AWS stack can remain running for retry

## Post-cutover

- Enable GitHub Actions: `AWS_DEPLOY_ENABLED=true`
- Remove Railway-specific secrets from customer-facing docs
- Keep Railway project read-only for one week, then decommission

## Auth verification

| Check | Expected |
| --- | --- |
| `/` logged out | Marketing home + Sign in |
| `/projects` logged out | Redirect to `/sign-in` |
| Sign in | Clerk UI on `clerk.advancedautomations.net` |
| After sign-in, no org | `/select-org` |
| Customer role | Programs only; no Review/Admin |
| `org:developer` | Review queue + Build desk |
| `/staff` | Password unlock still works as fallback |
