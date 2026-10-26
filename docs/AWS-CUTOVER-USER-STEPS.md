# Koda AWS cutover — operator steps

**Status (2026-09-02):** ACM **ISSUED**; ALB has HTTPS (443) and HTTP→HTTPS redirect (Step 5 applied); DNS `koda` → ALB; ECS web targets **healthy** (verify app/secrets and Railway decommission separately).

| Resource | Value |
| --- | --- |
| AWS account | `065194293782` |
| ALB DNS | `koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com` |
| ECS cluster | `koda-platform-production-cluster` |
| GitHub repo | `moshehillel/AI` |
| GitHub deploy role ARN | `arn:aws:iam::065194293782:role/koda-platform-production-github-deploy` |
| ACM cert ARN | `arn:aws:acm:us-east-1:065194293782:certificate/53467e0d-25e7-4b28-a06e-32cece4be5c7` |
| Railway project | `bountiful-fascination` (still live) |

**Order matters.** Complete steps 1–4 before DNS cutover (step 6). Do **not** delete Railway until step 8.

---

## Step 1 — ACM DNS validation (Netlify)

ACM must be **ISSUED** before HTTPS works. Add the validation CNAME in Netlify DNS (same zone as `koda.advancedautomations.net`).

### 1a. Confirm the validation record (re-run anytime)

```bash
aws acm describe-certificate \
  --certificate-arn "arn:aws:acm:us-east-1:065194293782:certificate/53467e0d-25e7-4b28-a06e-32cece4be5c7" \
  --region us-east-1 \
  --query "Certificate.DomainValidationOptions[0].ResourceRecord" \
  --output table
```

**Current record (as of 2026-09-02):**

| Netlify field | Value |
| --- | --- |
| **Type** | `CNAME` |
| **Name / Host** | `_f4d69fe3488c23263a3dd02306fb074e.koda` |
| **Value / Target** | `_6969413c5df1bf87d4002a0f948f9553.jkddzztszm.acm-validations.aws` |
| **TTL** | `300` (or Netlify default) |

### Netlify Name field (do not use the full FQDN)

In Netlify DNS for zone `advancedautomations.net`, put **only** this in **Name**:

`_f4d69fe3488c23263a3dd02306fb074e.koda`

**Do not** paste ACM's full hostname (`_f4d69fe3488c23263a3dd02306fb074e.koda.advancedautomations.net`) into Name. Netlify appends the zone automatically; using the FQDN creates a **wrong** record such as:

`_f4d69fe3488c23263a3dd02306fb074e.koda.advancedautomations.net.advancedautomations.net`

If that doubled-zone record exists, **delete it** and add the CNAME again with Name `_f4d69fe3488c23263a3dd02306fb074e.koda` only.

### Keep this separate from the app CNAME

The ACM validation CNAME is **not** the same as the `koda` → ALB record (Step 6). You need **both**:

- Validation: `_f4d69fe3488c23263a3dd02306fb074e.koda` → `_6969413c5df1bf87d4002a0f948f9553.jkddzztszm.acm-validations.aws`
- App traffic (after cutover): `koda` → `koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com`

### Verify DNS before waiting on ACM

```bash
nslookup -type=CNAME _f4d69fe3488c23263a3dd02306fb074e.koda.advancedautomations.net
```

Expected: CNAME to `_6969413c5df1bf87d4002a0f948f9553.jkddzztszm.acm-validations.aws` (not NXDOMAIN).

### 1b. Wait for ACM to issue

```bash
aws acm wait certificate-validated \
  --certificate-arn "arn:aws:acm:us-east-1:065194293782:certificate/53467e0d-25e7-4b28-a06e-32cece4be5c7" \
  --region us-east-1

aws acm describe-certificate \
  --certificate-arn "arn:aws:acm:us-east-1:065194293782:certificate/53467e0d-25e7-4b28-a06e-32cece4be5c7" \
  --region us-east-1 \
  --query "Certificate.Status" \
  --output text
```

Expected: `ISSUED` (can take 5–30 minutes after DNS propagates).

---

## Step 2 — GitHub repo secrets and variables

The deploy workflow (`.github/workflows/aws-deploy.yml`) is **skipped** until `AWS_DEPLOY_ENABLED=true`.

### 2a. Sign in to GitHub CLI (one-time)

```bash
gh auth login
```

### 2b. Set repository variable

```bash
gh variable set AWS_DEPLOY_ENABLED --body "true" --repo moshehillel/AI
```

### 2c. Set repository secrets

Get your Clerk **publishable** key from [Clerk Dashboard → API Keys](https://dashboard.clerk.com) (Production instance, `pk_live_…`).

```bash
gh secret set AWS_DEPLOY_ROLE_ARN \
  --body "arn:aws:iam::065194293782:role/koda-platform-production-github-deploy" \
  --repo moshehillel/AI

gh secret set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
  --body "pk_live_YOUR_KEY_HERE" \
  --repo moshehillel/AI
```

### 2d. Verify settings

```bash
gh variable list --repo moshehillel/AI | findstr AWS_DEPLOY
gh secret list --repo moshehillel/AI
```

| Setting | Type | Value |
| --- | --- | --- |
| `AWS_DEPLOY_ENABLED` | **Variable** | `true` |
| `AWS_DEPLOY_ROLE_ARN` | **Secret** | `arn:aws:iam::065194293782:role/koda-platform-production-github-deploy` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **Secret** | `pk_live_…` |

Or set the same values in GitHub UI: **Settings → Secrets and variables → Actions**.

---

## Step 3 — Run GitHub Actions deploy (ECR + ECS)

This builds Docker images on GitHub runners (bypasses NetFree blocking local Docker) and pushes to ECR.

### 3a. Trigger workflow

```bash
gh workflow run "Deploy Koda to AWS" \
  --repo moshehillel/AI \
  --ref cursor/koda-program-lifecycle-8b33 \
  -f image_tag=latest \
  -f environment=production
```

Or: **Actions → Deploy Koda to AWS → Run workflow** (branch `cursor/koda-program-lifecycle-8b33` or `main`).

### 3b. Watch the run

```bash
gh run list --workflow="Deploy Koda to AWS" --repo moshehillel/AI --limit 3
gh run watch --repo moshehillel/AI
```

### 3c. Verify ECR images exist

```bash
aws ecr describe-images --repository-name koda-platform/web --region us-east-1
aws ecr describe-images --repository-name koda-platform/worker --region us-east-1
```

### 3d. Verify ECS tasks are running

```bash
aws ecs describe-services \
  --cluster koda-platform-production-cluster \
  --services koda-platform-production-web koda-platform-production-worker \
  --region us-east-1 \
  --query "services[*].{name:serviceName,running:runningCount,desired:desiredCount,status:status}" \
  --output table
```

Expected: `runningCount` matches `desiredCount` (web=2, worker=1).

### 3e. Smoke test via ALB (HTTP only until step 5)

```bash
curl -fsS "http://koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com/api/ready"
```

If this fails, check logs:

```bash
aws logs tail /ecs/koda-platform-production/web --since 30m --region us-east-1
aws logs tail /ecs/koda-platform-production/worker --since 30m --region us-east-1
```

> **Note:** Tasks will crash-loop until Step 4 secrets are populated (Clerk keys, `ENCRYPTION_KEY`, etc.).

---

## Step 4 — Populate Secrets Manager

`DATABASE_URL` and `REDIS_URL` are already auto-written by Terraform. The **app-env** secret still has `REPLACE_ME` placeholders.

### 4a. Export Railway production vars

From a machine with Railway access:

```bash
railway link -p bountiful-fascination -e production
railway variables --service web --json > railway-web.json
railway variables --service worker --json > railway-worker.json
```

### 4b. Build `koda-app-secrets.json` locally (never commit)

Create a JSON file with these keys (copy values from Railway dashboard → **web** service → Variables):

| Key | Source (Railway web vars) | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Railway `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` |
| `CLERK_SECRET_KEY` | Railway `CLERK_SECRET_KEY` | `sk_live_…` |
| `CLERK_WEBHOOK_SECRET` | Railway `CLERK_WEBHOOK_SECRET` | `whsec_…` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` | |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` | |
| `OPEN_ACCESS` | `0` | |
| `NEXT_PUBLIC_OPEN_ACCESS` | `0` | |
| `ALLOW_DEMO_AUTH` | `0` | |
| `NEXT_PUBLIC_ALLOW_DEMO_AUTH` | `0` | |
| `NEXT_PUBLIC_APP_URL` | `https://koda.advancedautomations.net` | |
| `ENCRYPTION_KEY` | Railway `ENCRYPTION_KEY` | **Must match Railway** if migrating DB data |
| `ADMIN_PASSWORD` | Railway `ADMIN_PASSWORD` | Staff fallback |
| `CURSOR_API_KEY` | Railway `CURSOR_API_KEY` | |
| `CURSOR_MOCK` | `0` | |
| `GITHUB_MOCK` | `0` | |
| `RAILWAY_MOCK` | `1` | |

Optional (add if used on Railway): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `RESEND_API_KEY`, `NOTIFY_EMAIL`.

**Example template** (replace values, do not commit):

```json
{
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "pk_live_...",
  "CLERK_SECRET_KEY": "sk_live_...",
  "CLERK_WEBHOOK_SECRET": "whsec_...",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL": "/sign-in",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL": "/sign-up",
  "OPEN_ACCESS": "0",
  "NEXT_PUBLIC_OPEN_ACCESS": "0",
  "ALLOW_DEMO_AUTH": "0",
  "NEXT_PUBLIC_ALLOW_DEMO_AUTH": "0",
  "NEXT_PUBLIC_APP_URL": "https://koda.advancedautomations.net",
  "ENCRYPTION_KEY": "your-64-char-hex-from-railway",
  "ADMIN_PASSWORD": "your-staff-password",
  "CURSOR_API_KEY": "your-cursor-key",
  "CURSOR_MOCK": "0",
  "GITHUB_MOCK": "0",
  "RAILWAY_MOCK": "1"
}
```

### 4c. Upload to Secrets Manager

```bash
aws secretsmanager put-secret-value \
  --secret-id "koda-platform-production/app-env" \
  --secret-string file://koda-app-secrets.json \
  --region us-east-1
```

### 4d. Force ECS to pick up new secrets

```bash
aws ecs update-service --cluster koda-platform-production-cluster \
  --service koda-platform-production-web --force-new-deployment --region us-east-1

aws ecs update-service --cluster koda-platform-production-cluster \
  --service koda-platform-production-worker --force-new-deployment --region us-east-1

aws ecs wait services-stable \
  --cluster koda-platform-production-cluster \
  --services koda-platform-production-web \
  --region us-east-1
```

### 4e. (Optional) Migrate Postgres data from Railway

Only if you need existing programs/users. **Same `ENCRYPTION_KEY` is required.**

```bash
# On Railway (railway ssh --service web):
pg_dump "$DATABASE_URL" --no-owner --format=custom -f koda-railway.dump

# Restore to AWS RDS (from a host that can reach RDS):
aws secretsmanager get-secret-value \
  --secret-id koda-platform-production/database-url \
  --region us-east-1 \
  --query SecretString --output text > aws-database-url.txt

pg_restore -d "$(cat aws-database-url.txt)" --no-owner --clean koda-railway.dump
rm aws-database-url.txt
```

Skip this for a greenfield cutover — users re-sign in via Clerk.

---

## Step 5 — Terraform re-apply for HTTPS

Once ACM status is **ISSUED**, attach the certificate to the ALB.

### 5a. Edit `infra/aws/terraform/terraform.tfvars` (local only, gitignored)

```hcl
acm_certificate_arn = "arn:aws:acm:us-east-1:065194293782:certificate/53467e0d-25e7-4b28-a06e-32cece4be5c7"
```

### 5b. Apply

```bash
cd infra/aws/terraform
terraform init
terraform apply -var="image_tag=latest"
```

This adds the HTTPS listener (443) and HTTP→HTTPS redirect.

### 5c. Verify HTTPS on ALB

```bash
curl -fsSI "https://koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com/api/ready" \
  --resolve "koda.advancedautomations.net:443:koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com"
```

---

## Step 6 — DNS cutover (Netlify)

**Prerequisites:** Steps 1–5 complete; ALB `/api/ready` returns 200 over HTTPS (using `--resolve` test above).

### 6a. Lower TTL (24h before cutover)

In Netlify DNS for `advancedautomations.net`, set TTL on the `koda` record to **300** seconds.

### 6b. Update CNAME

| Field | Old (Railway) | New (AWS) |
| --- | --- | --- |
| **Type** | `CNAME` | `CNAME` |
| **Name** | `koda` | `koda` |
| **Value** | `j8333zn7.up.railway.app` | `koda-platform-production-alb-128154713.us-east-1.elb.amazonaws.com` |
| **TTL** | `300` | `300` |

### 6c. Wait for propagation

```bash
nslookup -type=CNAME koda.advancedautomations.net
```

Expected: CNAME points to `*.elb.amazonaws.com` (not `*.up.railway.app`).

### 6d. Verify public HTTPS

```bash
curl -fsSI https://koda.advancedautomations.net/api/ready
```

---

## Step 7 — Verify sign-in, planning, worker

### 7a. Clerk dashboard

In [Clerk Dashboard](https://dashboard.clerk.com) (Production):

1. **Allowed origins:** add `https://koda.advancedautomations.net`
2. **Webhooks:** endpoint `https://koda.advancedautomations.net/api/webhooks/clerk`  
   Events: `user.*`, `organization.created`, `organizationMembership.*`
3. Confirm `CLERK_WEBHOOK_SECRET` in Secrets Manager matches the webhook signing secret

### 7b. Smoke test checklist

| Check | How |
| --- | --- |
| Health | `curl -fsS https://koda.advancedautomations.net/api/ready` |
| Sign in | Open `https://koda.advancedautomations.net/sign-in` → Clerk UI on `clerk.advancedautomations.net` |
| Org select | After sign-in without org → `/select-org` |
| Projects | `/projects` loads for org member |
| Planning | Submit a test message in a non-production program |
| Worker | `aws logs tail /ecs/koda-platform-production/worker --since 10m --region us-east-1` shows job processed |
| Review desk | Developer role or `/staff` password unlock |

---

## Step 8 — Delete Railway (only after stable)

**Wait at least 24h** after DNS cutover with no 5xx errors.

### Prerequisites (all must pass)

```bash
# ECS healthy
aws ecs describe-services --cluster koda-platform-production-cluster \
  --services koda-platform-production-web koda-platform-production-worker \
  --region us-east-1 \
  --query "services[*].{name:serviceName,running:runningCount}" --output table

# DNS on AWS
nslookup -type=CNAME koda.advancedautomations.net

# Public health
curl -fsS https://koda.advancedautomations.net/api/ready
```

### Decommission commands

```bash
railway link -p bountiful-fascination -e production

# 1. Remove custom domain from Railway web (dashboard)
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

### Rollback (if needed)

Repoint Netlify `koda` CNAME back to `j8333zn7.up.railway.app` and redeploy Railway services.

---

## Step 9 — Rotate AWS access key

The `WGDeploy` IAM user key was shared in chat. **Rotate immediately** after cutover is stable.

### 9a. Create new key (AWS Console)

1. IAM → Users → `WGDeploy` → Security credentials
2. **Create access key** → save the new key securely
3. Update wherever the old key is stored (local `aws configure`, CI, `1.txt`, etc.)
4. **Deactivate** then **delete** the old key

### 9b. Verify new key works

```bash
aws sts get-caller-identity
```

### 9c. Delete the old key

Only after confirming all tools and scripts use the new key.

---

## Quick status commands

```bash
# ACM
aws acm describe-certificate \
  --certificate-arn "arn:aws:acm:us-east-1:065194293782:certificate/53467e0d-25e7-4b28-a06e-32cece4be5c7" \
  --region us-east-1 --query "Certificate.Status" --output text

# ECR images
aws ecr describe-images --repository-name koda-platform/web --region us-east-1 --query "imageDetails[*].imageTags"

# ECS
aws ecs describe-services --cluster koda-platform-production-cluster \
  --services koda-platform-production-web koda-platform-production-worker \
  --region us-east-1 --query "services[*].{name:serviceName,running:runningCount,failed:deployments[0].failedTasks}"

# ALB target health
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups --region us-east-1 \
    --query "TargetGroups[?contains(TargetGroupName,'koda-platform-production-web')].TargetGroupArn" --output text) \
  --region us-east-1
```

---

## Blockers summary

| Blocker | Who fixes | Step |
| --- | --- | --- |
| ACM validation CNAME not in Netlify | You | 1 |
| `gh` not logged in / GitHub vars not set | You | 2 |
| No ECR images (local Docker blocked by NetFree) | GitHub Actions | 3 |
| App secrets still `REPLACE_ME` | You (from Railway dashboard) | 4 |
| ~~ALB HTTP-only~~ HTTPS listener applied | Done | 5 |
| ~~DNS still on Railway~~ `koda` → ALB | Done | 6 |
