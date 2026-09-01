# Koda platform — AWS hosting (separate stack)

This directory defines **Koda-only** AWS infrastructure. It is intentionally **not** part of the Whiteglove client automation project — use a dedicated AWS account or at minimum a separate Terraform state, VPC, and resource prefix (`koda-platform`).

## Stack layout

| Component | AWS service | Purpose |
| --- | --- | --- |
| Web | ECS Fargate + ALB | Next.js UI + API (`Dockerfile.web`) |
| Worker | ECS Fargate | BullMQ runner (`Dockerfile.worker`) |
| Database | RDS PostgreSQL 15 | Prisma / app data |
| Queue | ElastiCache Redis 7 | BullMQ |
| Secrets | Secrets Manager | Clerk, Cursor, GitHub, `ENCRYPTION_KEY`, DB/Redis URLs |
| Images | ECR | `koda-platform/web`, `koda-platform/worker` |
| DNS | Route53 (optional) or Netlify CNAME | `koda.advancedautomations.net` → ALB |
| TLS | ACM certificate on ALB | HTTPS |

```
Internet → ALB (443) → ECS web (×N) → RDS Postgres
                              ↓
                         ECS worker (×N) → ElastiCache Redis
```

## Prerequisites

1. **Dedicated AWS account** (recommended) or isolated IAM boundary — not the Whiteglove stack.
2. Terraform ≥ 1.5, AWS CLI configured (`aws configure` or OIDC in CI).
3. ACM certificate in **us-east-1** for `koda.advancedautomations.net` (DNS validation).
4. Clerk production keys on custom domain `clerk.advancedautomations.net`.
5. Copy `terraform/terraform.tfvars.example` → `terraform/terraform.tfvars` (gitignored).

## First-time apply

```bash
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit domain_name, acm_certificate_arn, hosted_zone_id (optional)

terraform init
terraform plan
terraform apply
```

After apply:

```bash
terraform output alb_dns_name          # CNAME target if DNS is at Netlify
terraform output app_secrets_arn       # Populate Clerk/Cursor/GitHub keys
terraform output github_deploy_role_arn
```

### Populate Secrets Manager

Update the app secret (replace placeholders — never commit values):

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw app_secrets_arn)" \
  --secret-string file://koda-app-secrets.json
```

Required keys mirror [`.env.example`](../../.env.example). Production auth:

- `OPEN_ACCESS=0`, `NEXT_PUBLIC_OPEN_ACCESS=0`
- `ALLOW_DEMO_AUTH=0`, `NEXT_PUBLIC_ALLOW_DEMO_AUTH=0`
- Clerk live keys + webhook secret
- `ENCRYPTION_KEY` — same value on web and worker (`openssl rand -hex 32`)

`DATABASE_URL` and `REDIS_URL` are auto-written by Terraform into separate secrets.

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

See [docs/aws-migration.md](../../docs/aws-migration.md) for cutover checklist, env mapping, and optional DB export.

## Cost notes

Starter footprint (2× web, 1× worker, `db.t4g.small`, `cache.t4g.small`) is roughly $150–250/mo depending on region and data transfer. Scale `web_desired_count` / `worker_desired_count` in `terraform.tfvars`.

## Whiteglove separation

Do **not** add Whiteglove Lambda, Step Functions, or client-specific resources to this stack. Client automations belong in their own repo/account. Koda platform resources are tagged `Scope=koda-only`.
