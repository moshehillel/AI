# Koda platform — AWS hosting (separate stack)

This directory defines **Koda-only** AWS infrastructure. It is intentionally **not** part of the Whiteglove client automation project.

**Same AWS account as Whiteglove is OK** — you must use a **separate Terraform state** (dedicated S3 bucket + key), a **dedicated VPC**, and the `koda-platform` resource prefix. All resources are tagged `Scope=koda-only`. Do **not** modify Whiteglove Terraform or share state buckets.

## Stack layout

| Component | AWS service | Resource names (prefix) |
| --- | --- | --- |
| Web | ECS Fargate + ALB | `koda-platform-production-web` |
| Worker | ECS Fargate | `koda-platform-production-worker` |
| Database | RDS PostgreSQL 15 | `koda-platform-production-postgres` |
| Queue | ElastiCache Redis 7 | `koda-platform-production-redis` |
| Secrets | Secrets Manager | `koda-platform-production/app-env`, `…/database-url`, `…/redis-url` |
| Images | ECR | `koda-platform/web`, `koda-platform/worker` |
| DNS | Route53 (optional) or Netlify CNAME | `koda.advancedautomations.net` → ALB |
| TLS | ACM certificate on ALB | HTTPS |

```
Internet → ALB (443) → ECS web (×N) → RDS Postgres
                              ↓
                         ECS worker (×N) → ElastiCache Redis
```

## Prerequisites

1. AWS CLI + Terraform ≥ 1.5, configured with **Whiteglove account** credentials (`aws configure` or env vars).
2. Verify VPC CIDR does not overlap Whiteglove VPCs (default `10.20.0.0/16`).
3. ACM certificate in **us-east-1** for `koda.advancedautomations.net` (DNS validation).
4. Clerk production keys on custom domain `clerk.advancedautomations.net`.
5. Copy `terraform/terraform.tfvars.example` → `terraform/terraform.tfvars` (gitignored).

## Terraform state bootstrap

Create a **Koda-only** state backend. Do **not** use Whiteglove's state bucket or key.

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

Uncomment the `backend "s3"` block in `terraform/versions.tf`:

```hcl
backend "s3" {
  bucket         = "koda-platform-tfstate"
  key            = "koda-platform/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "koda-platform-tflock"
  encrypt        = true
}
```

## First-time apply

Run from your machine with Whiteglove account credentials:

```bash
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit: acm_certificate_arn, hosted_zone_id (optional), vpc_cidr if needed

terraform init          # add -migrate-state after enabling S3 backend
terraform plan
terraform apply
```

After apply:

```bash
terraform output alb_dns_name          # CNAME target if DNS is at Netlify
terraform output app_secrets_arn       # Populate Clerk/Cursor/GitHub keys
terraform output ecr_web_repository_url
terraform output ecr_worker_repository_url
terraform output github_deploy_role_arn
```

### Shared account notes

| Setting | Value | Why |
| --- | --- | --- |
| `create_github_oidc_provider` | `false` (default) | Whiteglove account already has GitHub OIDC provider |
| `project_name` | `koda-platform` | All ECR/ECS/RDS/Redis names are koda-prefixed |
| `Scope` tag | `koda-only` | Filter resources in AWS console |
| State key | `koda-platform/terraform.tfstate` | Isolated from Whiteglove state |

### Populate Secrets Manager

Copy values from Railway production into a local JSON file (never commit):

```bash
APP_SECRET_ARN=$(terraform output -raw app_secrets_arn)

aws secretsmanager put-secret-value \
  --secret-id "$APP_SECRET_ARN" \
  --secret-string file://koda-app-secrets.json
```

Required keys mirror [`.env.example`](../../.env.example). Production auth:

- `OPEN_ACCESS=0`, `NEXT_PUBLIC_OPEN_ACCESS=0`
- `ALLOW_DEMO_AUTH=0`, `NEXT_PUBLIC_ALLOW_DEMO_AUTH=0`
- Clerk live keys + webhook secret
- `ENCRYPTION_KEY` — same value on web and worker (`openssl rand -hex 32`)

`DATABASE_URL` and `REDIS_URL` are auto-written by Terraform into separate secrets.

### Push images to ECR

```bash
AWS_ACCOUNT=$(terraform output -raw aws_account_id)
AWS_REGION=us-east-1
ECR_WEB=$(terraform output -raw ecr_web_repository_url)
ECR_WORKER=$(terraform output -raw ecr_worker_repository_url)
IMAGE_TAG=latest

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

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

## GitHub Actions deploy

Workflow: [`.github/workflows/aws-deploy.yml`](../../.github/workflows/aws-deploy.yml)

Enable after Terraform apply:

| GitHub setting | Value |
| --- | --- |
| Repository variable `AWS_DEPLOY_ENABLED` | `true` |
| Secret `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_deploy_role_arn` |
| Secret `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` (build-time bake for Next.js) |

Trigger manually (**Actions → Deploy Koda to AWS**) or push to `main`.

## Migration from Railway

See [docs/aws-migration.md](../../docs/aws-migration.md) for cutover checklist, env mapping, Railway → Secrets Manager steps, and DNS cutover.

## Cost notes

Starter footprint (2× web, 1× worker, `db.t4g.small`, `cache.t4g.small`) is roughly $150–250/mo depending on region and data transfer. Scale `web_desired_count` / `worker_desired_count` in `terraform.tfvars`.

## Whiteglove separation

Do **not** add Whiteglove Lambda, Step Functions, or client-specific resources to this stack. Do **not** edit Whiteglove Terraform. Client automations belong in their own stack. Koda platform resources are tagged `Scope=koda-only`.
