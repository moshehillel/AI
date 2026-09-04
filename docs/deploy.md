# Deploy Automation Studio (Koda)

Production hosting options:

| Platform | Guide | Status |
| --- | --- | --- |
| **AWS** | [infra/aws/README.md](../infra/aws/README.md) + [aws-migration.md](./aws-migration.md) | **Production target** (`koda-platform` stack, same AWS account as Whiteglove) |
| **Railway** | Legacy section below | **Legacy** — project `bountiful-fascination`; decommission after AWS cutover |

## AWS (production)

ECS Fargate web + worker, RDS Postgres, ElastiCache Redis, ALB + ACM. Full guide: [infra/aws/README.md](../infra/aws/README.md).

### First-time apply

```bash
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit acm_certificate_arn, hosted_zone_id (optional), create_github_oidc_provider

terraform init
terraform plan
terraform apply
```

After apply:

```bash
terraform output alb_dns_name          # Netlify CNAME target
terraform output app_secrets_arn       # Populate Clerk/Cursor/GitHub keys
terraform output github_deploy_role_arn
```

Populate Secrets Manager, then enable GitHub Actions:

| GitHub setting | Value |
| --- | --- |
| Variable `AWS_DEPLOY_ENABLED` | `true` |
| Secret `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_deploy_role_arn` |
| Secret `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |

Trigger **Actions → Deploy Koda to AWS** or push to `main`.

### DNS

Point `koda.advancedautomations.net` CNAME to `terraform output -raw alb_dns_name`. See [aws-migration.md](./aws-migration.md) for cutover checklist.

### What gets deployed

| Resource | Role |
|---|---|
| ECS `web` | Next.js UI + API (`Dockerfile.web`) |
| ECS `worker` | BullMQ runner (`Dockerfile.worker`) |
| RDS Postgres | Prisma / app data |
| ElastiCache Redis | BullMQ job queue |

First deploy expects **Clerk auth**:

- `OPEN_ACCESS=0` / `NEXT_PUBLIC_OPEN_ACCESS=0` (secret + web image build-args)
- `ALLOW_DEMO_AUTH=0` / `NEXT_PUBLIC_ALLOW_DEMO_AUTH=0`
- Clerk production keys on `clerk.advancedautomations.net`
- Set `CURSOR_MOCK=0` + `CURSOR_API_KEY` when live agents are ready

Web container runs `prisma migrate deploy` before `next start`.

## Clerk keys (development vs production)

For `https://koda.advancedautomations.net`, use a **Production** Clerk instance:

1. Clerk Dashboard → **Production** instance
2. Enable **Organizations** with membership required
3. Roles: `org:admin`, `org:developer`, `org:employee`
4. API Keys → `pk_live_…` / `sk_live_…`
5. Webhooks → `https://koda.advancedautomations.net/api/webhooks/clerk`  
   Events: `user.*`, `organization.created`, `organizationMembership.*`  
   Signing secret → `CLERK_WEBHOOK_SECRET`
6. Allowed origins / redirect URLs: `https://koda.advancedautomations.net`
7. Add keys to Secrets Manager app secret; rebuild web image; redeploy ECS

## Turning on Clerk auth (production)

1. Set Clerk credentials in Secrets Manager
2. `OPEN_ACCESS=0` / `NEXT_PUBLIC_OPEN_ACCESS=0` in secret + web build-args
3. Redeploy web + worker ECS services
4. Follow [runbooks.md](./runbooks.md) production wiring checklist

### Local open access (dev only)

Set `OPEN_ACCESS=1` / `NEXT_PUBLIC_OPEN_ACCESS=1` in `.env` — never on production.

## Turning off mock integrations

1. Set `CURSOR_API_KEY`, `GITHUB_APP_*` in Secrets Manager
2. Remove `CURSOR_MOCK`, `GITHUB_MOCK`, `RAILWAY_MOCK` from app secret
3. Redeploy worker + web

### GitHub App (one-click)

See [github-app-setup.md](./github-app-setup.md). On AWS, paste `GITHUB_APP_*` into Secrets Manager after Admin → Register GitHub App.

## Local Docker smoke test

```bash
docker build -f Dockerfile.web -t automation-studio-web .
docker build -f Dockerfile.worker -t automation-studio-worker .
```

## Troubleshooting (AWS)

- **Build fails on Prisma/OpenSSL** — images install `openssl` + `ca-certificates` in the base stage.
- **Web unhealthy** — `curl https://koda.advancedautomations.net/api/ready`; check RDS/ElastiCache from ECS task logs.
- **Worker idle** — same Redis URL as web; `aws logs tail /ecs/koda-platform-production/worker`.
- **Deploy workflow skipped** — set repository variable `AWS_DEPLOY_ENABLED=true`.

---

## Railway (legacy — decommission after AWS cutover)

> **Do not use for production.** Koda currently runs on Railway project `bountiful-fascination` until DNS cutover. See [aws-migration.md](./aws-migration.md).

Production hosting used **Railway** with Postgres, Redis, **web**, and **worker** services.

### One-command bootstrap (historical)

```bash
chmod +x scripts/railway-bootstrap.sh
./scripts/railway-bootstrap.sh
```

Topology in [`.railway/railway.ts`](../.railway/railway.ts). IaC: `railway config plan` / `railway config apply`.

### Manual deploy (historical)

```bash
railway up --service web -m "deploy web"
railway up --service worker -m "deploy worker"
```

### Railway troubleshooting

- **Worker idle** — `railway logs --service worker --lines 100`
- **Web unhealthy** — `/api/health` and `DATABASE_URL` / `REDIS_URL`
