# Koda AWS cutover — operator steps

**Status (2026-09-01):** AWS infrastructure is provisioned (VPC, RDS, Redis, ECS, ALB, ECR, Secrets Manager shells). The public app is **still on Railway** until you complete the steps below. **Do not delete Railway** until every verification step passes.

**Domain:** `koda.advancedautomations.net`  
**ALB target:** `koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com`  
**Railway project:** `bountiful-fascination` (production still live at `j8333zn7.up.railway.app`)

---

## 1. Validate the ACM certificate (Netlify DNS)

AWS Certificate Manager needs a DNS validation record before HTTPS can attach to the ALB.

1. Open **Netlify DNS** for `advancedautomations.net`.
2. Add a **CNAME** record:

   | Field | Value |
   | --- | --- |
   | **Host / name** | `_f4d69fe3488c23263a3dd02306fb074e.koda` |
   | **Type** | `CNAME` |
   | **Value / target** | `_6969413c5df1bf87d4002a0f948f9553.jkddzztszm.acm-validations.aws.` |
   | **TTL** | `300` (or lowest available) |

   Full record names (if your DNS UI expects FQDN):

   - **Name:** `_f4d69fe3488c23263a3dd02306fb074e.koda.advancedautomations.net`
   - **Value:** `_6969413c5df1bf87d4002a0f948f9553.jkddzztszm.acm-validations.aws.`

3. Wait 5–30 minutes, then confirm in **AWS Console → Certificate Manager (us-east-1)** that the certificate status is **Issued**.
4. Copy the certificate ARN (format: `arn:aws:acm:us-east-1:065194293782:certificate/…`).

---

## 2. Configure GitHub repository settings

In **GitHub → Repository → Settings**:

### Variables (Settings → Secrets and variables → Actions → Variables)

| Name | Value |
| --- | --- |
| `AWS_DEPLOY_ENABLED` | `true` |

### Secrets (Settings → Secrets and variables → Actions → Secrets)

| Name | Where to get it |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::065194293782:role/koda-platform-production-github-deploy` (or `terraform output -raw github_deploy_role_arn` from `infra/aws/terraform`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → Production → API Keys → Publishable key (`pk_live_…`) |
| `RAILWAY_API_TOKEN` | Railway Dashboard → Account → Tokens (only needed if you export vars via Railway CLI; not used by the deploy workflow itself) |

**Never commit secret values to git.**

---

## 3. Populate Secrets Manager from Railway

Terraform created three secrets in **AWS Secrets Manager (us-east-1)**:

| Secret name | Contents | Action |
| --- | --- | --- |
| `koda-platform-production/database-url` | Postgres URL | **Auto** — Terraform wrote this after RDS was created |
| `koda-platform-production/redis-url` | Redis URL | **Auto** — Terraform wrote this after ElastiCache was created |
| `koda-platform-production/app-env` | JSON blob of app env vars | **You must populate** from Railway production |

### Export from Railway

```bash
railway link -p bountiful-fascination -e production
railway variables --service web --json > /tmp/railway-web.json
```

Or copy values manually from **Railway → bountiful-fascination → production → web → Variables**.

### Keys to copy into `koda-platform-production/app-env`

Build a JSON file locally (e.g. `/tmp/koda-app-secrets.json`). **Do not commit this file.**

| Key | Source (Railway web service) | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Railway var | Also set as GitHub secret (build-time bake) |
| `CLERK_SECRET_KEY` | Railway var | `sk_live_…` |
| `CLERK_WEBHOOK_SECRET` | Railway var | Update Clerk webhook URL in step 8 |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Railway var or `/sign-in` | |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Railway var or `/sign-up` | |
| `OPEN_ACCESS` | Set to `0` | Production auth required |
| `NEXT_PUBLIC_OPEN_ACCESS` | Set to `0` | Baked into web Docker image at build |
| `ALLOW_DEMO_AUTH` | Set to `0` | |
| `NEXT_PUBLIC_ALLOW_DEMO_AUTH` | Set to `0` | Baked into web Docker image at build |
| `NEXT_PUBLIC_APP_URL` | Set to `https://koda.advancedautomations.net` | |
| `ENCRYPTION_KEY` | Railway var | **Must match Railway** if you migrate DB data |
| `ADMIN_PASSWORD` | Railway var (`ADMIN_PASSWORD` or `STAFF_ACCESS_TOKEN`) | Staff `/staff` fallback |
| `CURSOR_API_KEY` | Railway var | |
| `CURSOR_MOCK` | Set to `0` | |
| `GITHUB_MOCK` | Set to `0` | |
| `RAILWAY_MOCK` | Set to `1` | Railway integration not used on AWS |

**Optional** (copy from Railway if present — add to the same JSON):

| Key | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | GitHub App integration |
| `GITHUB_APP_PRIVATE_KEY` | PEM (escape newlines as `\n` in JSON) |
| `GITHUB_APP_WEBHOOK_SECRET` | GitHub webhook verification |
| `GITHUB_APP_CLIENT_ID` | OAuth |
| `GITHUB_APP_CLIENT_SECRET` | OAuth |
| `GITHUB_APP_SLUG` | App slug |
| `RESEND_API_KEY` | Email notifications |
| `EMAIL_FROM` | Sender address |
| `NOTIFY_EMAIL` / `DEVELOPER_NOTIFY_EMAIL` | Program submit alerts |
| `CURSOR_MODEL_ID` | Optional model override |
| `DEFAULT_GITHUB_OWNER` / `DEFAULT_GITHUB_REPO` / `DEFAULT_GITHUB_INSTALLATION_ID` | Default repo for planning |

**Not needed on AWS** (omit or ignore): `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_WORKER_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID`, `DATABASE_URL`, `REDIS_URL` (those last two come from separate Secrets Manager entries).

### Upload to Secrets Manager

```bash
cd infra/aws/terraform
APP_SECRET_ARN=$(terraform output -raw app_secrets_arn)

aws secretsmanager put-secret-value \
  --secret-id "$APP_SECRET_ARN" \
  --secret-string file:///tmp/koda-app-secrets.json \
  --region us-east-1
```

---

## 4. Attach ACM certificate to the ALB (Terraform)

After ACM shows **Issued**:

```bash
cd infra/aws/terraform
```

Edit `terraform.tfvars` (gitignored) and set:

```hcl
acm_certificate_arn = "arn:aws:acm:us-east-1:065194293782:certificate/YOUR_CERT_ID"
```

Then apply:

```bash
terraform init
terraform apply
```

This enables HTTPS on the ALB (HTTP → HTTPS redirect). Confirm in the AWS Console that the ALB listener on port 443 is active.

---

## 5. Deploy application images to ECS

### Option A — GitHub Actions (recommended)

1. Confirm step 2 is complete (`AWS_DEPLOY_ENABLED=true` and secrets set).
2. Go to **Actions → Deploy Koda to AWS → Run workflow**.
3. Branch: `main` or `cursor/koda-program-lifecycle-8b33`
4. `image_tag`: `latest` or a git SHA
5. `environment`: `production`
6. Wait for the workflow to finish (build ECR images → Terraform task defs → ECS rolling deploy).

CLI equivalent (requires `gh auth login`):

```bash
gh workflow run aws-deploy.yml \
  --ref cursor/koda-program-lifecycle-8b33 \
  -f image_tag=latest \
  -f environment=production
```

### Option B — Manual Docker push

See [infra/aws/README.md](../infra/aws/README.md#push-images-to-ecr).

### Verify before DNS cutover

```bash
# HTTP health via ALB directly (before custom domain)
curl -fsS http://koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com/api/ready

# After ACM attached:
curl -fsS https://koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com/api/ready
```

Check ECS: both `koda-platform-production-web` and `koda-platform-production-worker` should be **RUNNING** with healthy tasks.

```bash
aws ecs describe-services \
  --cluster koda-platform-production-cluster \
  --services koda-platform-production-web koda-platform-production-worker \
  --region us-east-1
```

---

## 6. DNS cutover (Netlify)

**Prerequisite:** Step 5 passes — ALB `/api/ready` returns `{"ok":true}`.

1. **24 hours before cutover:** Lower TTL on `koda.advancedautomations.net` to `300` seconds.
2. In **Netlify DNS**, update the existing `koda` record:

   | Field | Value |
   | --- | --- |
   | **Type** | `CNAME` |
   | **Host** | `koda` |
   | **Value** | `koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com` |
   | **TTL** | `300` |

   **Previous value (Railway):** `j8333zn7.up.railway.app` — keep this noted for rollback.

3. Wait for propagation (5–30 min). Verify:

   ```bash
   dig +short koda.advancedautomations.net CNAME
   # Expected: koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com.

   curl -fsS https://koda.advancedautomations.net/api/ready
   curl -fsS https://koda.advancedautomations.net/api/health
   ```

---

## 7. Update Clerk

In **Clerk Dashboard → Production** (custom domain `clerk.advancedautomations.net`):

1. **Allowed origins:** ensure `https://koda.advancedautomations.net` is listed.
2. **Webhooks:** set endpoint to `https://koda.advancedautomations.net/api/webhooks/clerk`
3. Copy the webhook signing secret into Secrets Manager `CLERK_WEBHOOK_SECRET` if it changed.
4. Force ECS redeploy after secret update:

   ```bash
   aws ecs update-service --cluster koda-platform-production-cluster \
     --service koda-platform-production-web --force-new-deployment --region us-east-1
   aws ecs update-service --cluster koda-platform-production-cluster \
     --service koda-platform-production-worker --force-new-deployment --region us-east-1
   ```

---

## 8. Smoke test (before deleting Railway)

| # | Check | Expected |
| --- | --- | --- |
| 1 | `curl https://koda.advancedautomations.net/api/ready` | `{"ok":true}` |
| 2 | Homepage logged out | Marketing + Sign in |
| 3 | `/projects` logged out | Redirect to `/sign-in` |
| 4 | Clerk sign-in | UI on `clerk.advancedautomations.net` |
| 5 | After sign-in, no org | `/select-org` |
| 6 | Customer program | Submit planning message |
| 7 | Worker | CloudWatch `/ecs/koda-platform-production/worker` shows job processed |
| 8 | Developer | `/review` queue loads (`org:developer` or `/staff` password) |
| 9 | DNS | `dig +short koda.advancedautomations.net CNAME` → `*.elb.amazonaws.com` (not `*.up.railway.app`) |

**Wait at least 24 hours** of stable AWS traffic before decommissioning Railway.

---

## 9. Decommission Railway

Only after **every** row in step 8 passes.

```bash
railway link -p bountiful-fascination -e production

# 1. Remove custom domain from Railway web service (dashboard)
# 2. Scale down app services
railway down --service worker -y
railway down --service web -y

# 3. Snapshot Postgres if you need a backup (dashboard → Postgres → backup)
# 4. Delete data services
railway down --service Postgres -y
railway down --service Redis -y

# 5. Delete project (dashboard: Project Settings → Delete Project)
```

**Do not delete:** GitHub repo, AWS Whiteglove resources, or other Railway projects.

### Rollback (if needed)

1. Repoint Netlify `koda` CNAME back to `j8333zn7.up.railway.app`
2. `railway up --service web -d -y` and `railway up --service worker -d -y` if scaled down
3. AWS stack can remain for a retry

---

## 10. Rotate the AWS access key (security)

If you shared an IAM access key file (e.g. `1.txt`) with an agent or operator for the initial deploy:

1. **AWS Console → IAM → Users** → select the user that owns the key.
2. **Security credentials → Create access key** (or use a new dedicated deploy user).
3. Update your local `aws configure` / env vars with the new key.
4. **Deactivate then delete** the old access key.
5. Confirm GitHub Actions still deploys (it uses OIDC role `koda-platform-production-github-deploy`, not the access key — no GitHub change needed for deploy).
6. Confirm Terraform state access still works (`terraform plan` from `infra/aws/terraform`).

---

## Quick reference

| Item | Value |
| --- | --- |
| AWS account | `065194293782` |
| Region | `us-east-1` |
| ECS cluster | `koda-platform-production-cluster` |
| GitHub deploy role | `arn:aws:iam::065194293782:role/koda-platform-production-github-deploy` |
| ALB DNS | `koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com` |
| App secret | `koda-platform-production/app-env` |
| Workflow | `.github/workflows/aws-deploy.yml` |

Further detail: [aws-migration.md](./aws-migration.md), [infra/aws/README.md](../infra/aws/README.md), [deploy.md](./deploy.md).
