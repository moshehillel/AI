# Koda — Railway → AWS migration

Migrate **Koda platform hosting only** from Railway to the dedicated `koda-platform` AWS stack.

**Same AWS account as Whiteglove is OK** — use a **separate Terraform state** (dedicated S3 bucket/key), a **dedicated VPC** (`10.20.0.0/16` by default — verify no CIDR overlap with Whiteglove), and the `Scope=koda-only` tag. Do **not** share Whiteglove state buckets, VPCs, or resource name prefixes. Whiteglove client automations remain in their own Terraform stack.

## Before you start

- [ ] Clerk production on `clerk.advancedautomations.net` (NetFree whitelabel complete)
- [ ] `OPEN_ACCESS=0` / `NEXT_PUBLIC_OPEN_ACCESS=0` on current Railway (or set during cutover)
- [ ] Terraform applied: `infra/aws/terraform` (see [infra/aws/README.md](../infra/aws/README.md))
- [ ] Secrets Manager populated with production keys (from Railway vars — see below)
- [ ] ACM certificate issued and attached to ALB
- [ ] Docker images pushed to ECR (or GitHub Actions deploy enabled)

## Terraform state (separate from Whiteglove)

Koda state must live in its **own** S3 object — never reuse Whiteglove's state bucket or key.

| Setting | Koda value | Do **not** use |
| --- | --- | --- |
| S3 bucket | `koda-platform-tfstate` (or your choice) | Whiteglove tfstate bucket |
| State key | `koda-platform/terraform.tfstate` | Whiteglove state key |
| DynamoDB lock | `koda-platform-tflock` | Whiteglove lock table |

Bootstrap (run once with Whiteglove account credentials):

```bash
export AWS_REGION=us-east-1
export TF_STATE_BUCKET=koda-platform-tfstate
export TF_LOCK_TABLE=koda-platform-tflock

aws s3api create-bucket --bucket "$TF_STATE_BUCKET" --region "$AWS_REGION"
aws s3api put-bucket-versioning --bucket "$TF_STATE_BUCKET" \
  --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name "$TF_LOCK_TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region "$AWS_REGION"
```

Then uncomment the `backend "s3"` block in `infra/aws/terraform/versions.tf` and run `terraform init -migrate-state`.

## Environment variable mapping

| Variable | Railway | AWS |
| --- | --- | --- |
| `DATABASE_URL` | Postgres plugin | Secrets Manager `koda-platform-production/database-url` (auto) |
| `REDIS_URL` | Redis plugin | Secrets Manager `koda-platform-production/redis-url` (auto) |
| `NEXT_PUBLIC_APP_URL` | Railway domain / custom | `https://koda.advancedautomations.net` |
| Clerk keys | Railway web vars | Secrets Manager `koda-platform-production/app-env` |
| `ENCRYPTION_KEY` | Railway web + worker | Same secret on both ECS services |
| `OPEN_ACCESS` | `0` | `0` |
| `NEXT_PUBLIC_OPEN_ACCESS` | `0` (rebuild web image) | `0` (baked at Docker build) |
| `CURSOR_API_KEY` | Railway worker + web | Secrets Manager |
| `GITHUB_APP_*` | Railway web | Secrets Manager (add keys to JSON) |
| `ADMIN_PASSWORD` | Railway web | Secrets Manager (staff fallback) |
| `RAILWAY_*` | Railway tokens | Not needed on AWS (`RAILWAY_MOCK=1` or omit) |

Add any optional vars from [`.env.example`](../.env.example) to the app secret JSON.

## Populate Secrets Manager from Railway

Export Railway production vars (Railway dashboard or CLI), then map into `koda-app-secrets.json`:

```bash
cd infra/aws/terraform
APP_SECRET_ARN=$(terraform output -raw app_secrets_arn)

# Example: build JSON from Railway (adjust service names)
railway variables --service web --json > /tmp/railway-web.json
# Manually merge into koda-app-secrets.json — keys must match secrets.tf placeholders.
# Set NEXT_PUBLIC_APP_URL=https://koda.advancedautomations.net
# Set OPEN_ACCESS=0, NEXT_PUBLIC_OPEN_ACCESS=0, RAILWAY_MOCK=1

aws secretsmanager put-secret-value \
  --secret-id "$APP_SECRET_ARN" \
  --secret-string file://koda-app-secrets.json
```

`DATABASE_URL` and `REDIS_URL` are written automatically by Terraform after RDS/ElastiCache are created.

Force ECS to pick up new secrets:

```bash
aws ecs update-service --cluster koda-platform-production-cluster \
  --service koda-platform-production-web --force-new-deployment
aws ecs update-service --cluster koda-platform-production-cluster \
  --service koda-platform-production-worker --force-new-deployment
```

## Push Docker images to ECR

After `terraform apply`:

```bash
cd infra/aws/terraform
AWS_ACCOUNT=$(terraform output -raw aws_account_id)
AWS_REGION=us-east-1
ECR_WEB=$(terraform output -raw ecr_web_repository_url)
ECR_WORKER=$(terraform output -raw ecr_worker_repository_url)
IMAGE_TAG=latest  # or git SHA

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

# Web — bake NEXT_PUBLIC_* at build time
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_OPEN_ACCESS=0 \
  --build-arg NEXT_PUBLIC_ALLOW_DEMO_AUTH=0 \
  --build-arg NEXT_PUBLIC_APP_URL=https://koda.advancedautomations.net \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_live_..." \
  -t "$ECR_WEB:$IMAGE_TAG" .
docker push "$ECR_WEB:$IMAGE_TAG"

docker build -f Dockerfile.worker -t "$ECR_WORKER:$IMAGE_TAG" .
docker push "$ECR_WORKER:$IMAGE_TAG"

terraform apply -var="image_tag=$IMAGE_TAG"
```

Or enable GitHub Actions deploy (`AWS_DEPLOY_ENABLED=true`) — see [infra/aws/README.md](../infra/aws/README.md).

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

## Post-cutover

- Enable GitHub Actions: `AWS_DEPLOY_ENABLED=true`
- Remove Railway-specific secrets from customer-facing docs
- Decommission Railway — see [Railway decommission](#railway-decommission) below

## Railway decommission

**Prerequisites (all required before deleting Railway):**

| Check | Command / action |
| --- | --- |
| AWS ECS web + worker stable | `aws ecs describe-services --cluster koda-platform-production-cluster --services koda-platform-production-web koda-platform-production-worker` |
| AWS `/api/ready` healthy on public URL | `curl -fsS https://koda.advancedautomations.net/api/ready` |
| DNS on AWS ALB (not Railway) | `dig +short koda.advancedautomations.net CNAME` → `*.elb.amazonaws.com` (not `*.up.railway.app`) |
| Clerk webhook + origins on AWS URL | Clerk Dashboard → Webhooks + Allowed origins |
| Smoke test passed | Sign in, `/projects`, planning message, worker job in CloudWatch |

**Do not delete Railway until every row above passes.** Pre-cutover, DNS still points to Railway (`j8333zn7.up.railway.app`).

### Cutover + deletion checklist (operator)

#### Phase 1 — AWS live (before DNS)

1. `cd infra/aws/terraform && terraform apply` (same AWS account as Whiteglove; `create_github_oidc_provider=false` if OIDC exists)
2. Populate Secrets Manager app secret (Clerk live keys, `ENCRYPTION_KEY`, Cursor, GitHub, `OPEN_ACCESS=0`)
3. Set GitHub `AWS_DEPLOY_ENABLED=true`, `AWS_DEPLOY_ROLE_ARN`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
4. Run **Deploy Koda to AWS** workflow; wait for ECS stable
5. Optional DB migrate: `pg_dump` from Railway → `pg_restore` to RDS (**same `ENCRYPTION_KEY`**)
6. Hit ALB directly — `curl -fsS` against `terraform output -raw alb_dns_name` `/api/ready` (may need `--resolve` for ACM)

#### Phase 2 — DNS cutover

1. Lower TTL on `koda.advancedautomations.net` to 300s (24h before)
2. Netlify DNS: `koda` CNAME → `terraform output -raw alb_dns_name`
3. Wait propagation; verify CNAME is ALB
4. `curl -fsS https://koda.advancedautomations.net/api/ready`
5. Clerk: confirm webhook and allowed origin
6. Smoke: Clerk sign-in → org → program → planning message → worker log

#### Phase 3 — Railway decommission (T+24h after stable AWS)

Railway project: **`bountiful-fascination`** (ID `8aede5cc-a506-4971-9f4b-875de921da11`).

```bash
railway link -p bountiful-fascination -e production

# 1. Remove custom domain from Railway web (dashboard if CLI lacks remove)
# 2. Scale down app services
railway down --service worker -y
railway down --service web -y

# 3. Snapshot Postgres if data was not migrated (dashboard → Postgres → backup)
# 4. Delete data services
railway down --service Postgres -y
railway down --service Redis -y

# 5. Delete project (dashboard: Project Settings → Delete Project)
```

**Do not delete:** GitHub repo, AWS Whiteglove resources, or other Railway projects.

## Rollback

1. Repoint `koda` CNAME back to Railway hostname (`j8333zn7.up.railway.app` or `web-production-98ce0.up.railway.app`)
2. `railway up --service web -d -y` and `railway up --service worker -d -y` if services were scaled down
3. AWS stack can remain for retry

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
