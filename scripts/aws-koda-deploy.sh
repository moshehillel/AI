#!/usr/bin/env bash
# Koda platform — full AWS deploy from Railway cutover.
# Usage: AWS creds via env or 1.txt, then: ./scripts/aws-koda-deploy.sh
# NEVER commit credentials or generated secret files.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$ROOT/infra/aws/terraform"
AWS_REGION="${AWS_REGION:-us-east-1}"
TF_STATE_BUCKET="${TF_STATE_BUCKET:-koda-platform-tfstate}"
TF_LOCK_TABLE="${TF_LOCK_TABLE:-koda-platform-tflock}"
DOMAIN="koda.advancedautomations.net"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CREDS_FILE="${AWS_CREDS_FILE:-}"

log() { echo "[aws-koda-deploy] $*"; }
die() { echo "[aws-koda-deploy] ERROR: $*" >&2; exit 1; }

# --- Load AWS credentials (never log values) ---
load_aws_creds() {
  if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    log "Using AWS credentials from environment"
    return 0
  fi

  for candidate in \
    "${CREDS_FILE}" \
    "$ROOT/1.txt" \
    "$ROOT/Downloads/1.txt" \
    "/workspace/1.txt" \
    "$HOME/Downloads/1.txt"; do
  [[ -z "$candidate" || ! -f "$candidate" ]] && continue
    log "Loading credentials from file (masked): ${candidate}"
    if jq -e '.AccessKeyId // .aws_access_key_id // .AWS_ACCESS_KEY_ID' "$candidate" &>/dev/null; then
      export AWS_ACCESS_KEY_ID
      AWS_ACCESS_KEY_ID=$(jq -r '.AccessKeyId // .aws_access_key_id // .AWS_ACCESS_KEY_ID' "$candidate")
      export AWS_SECRET_ACCESS_KEY
      AWS_SECRET_ACCESS_KEY=$(jq -r '.SecretAccessKey // .aws_secret_access_key // .AWS_SECRET_ACCESS_KEY' "$candidate")
    else
      read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY < <(grep -v '^#' "$candidate" | awk 'NF{print $1,$2; exit}')
      export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    fi
    export AWS_DEFAULT_REGION="$AWS_REGION"
    return 0
  done

  die "No AWS credentials found. Place key id + secret in 1.txt or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY"
}

verify_aws() {
  aws sts get-caller-identity --region "$AWS_REGION" >/dev/null \
    || die "AWS credentials invalid or insufficient permissions"
  log "AWS account: $(aws sts get-caller-identity --query Account --output text)"
}

bootstrap_state() {
  log "Bootstrapping Terraform state backend..."
  if ! aws s3api head-bucket --bucket "$TF_STATE_BUCKET" 2>/dev/null; then
    aws s3api create-bucket --bucket "$TF_STATE_BUCKET" --region "$AWS_REGION"
    aws s3api put-bucket-versioning --bucket "$TF_STATE_BUCKET" \
      --versioning-configuration Status=Enabled
    log "Created S3 bucket $TF_STATE_BUCKET"
  else
    log "S3 bucket $TF_STATE_BUCKET already exists"
  fi

  if ! aws dynamodb describe-table --table-name "$TF_LOCK_TABLE" --region "$AWS_REGION" &>/dev/null; then
    aws dynamodb create-table --table-name "$TF_LOCK_TABLE" \
      --attribute-definitions AttributeName=LockID,AttributeType=S \
      --key-schema AttributeName=LockID,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST --region "$AWS_REGION"
    aws dynamodb wait table-exists --table-name "$TF_LOCK_TABLE" --region "$AWS_REGION"
    log "Created DynamoDB lock table $TF_LOCK_TABLE"
  else
    log "DynamoDB table $TF_LOCK_TABLE already exists"
  fi
}

find_acm_cert() {
  local arn
  arn=$(aws acm list-certificates --region "$AWS_REGION" \
    --query "CertificateSummaryList[?DomainName=='$DOMAIN' || contains(SubjectAlternativeNameSummaries, '$DOMAIN')].CertificateArn | [0]" \
    --output text 2>/dev/null || echo "None")
  if [[ "$arn" != "None" && -n "$arn" ]]; then
    echo "$arn"
    return 0
  fi
  return 1
}

request_acm_cert() {
  log "Requesting ACM certificate for $DOMAIN..."
  local arn
  arn=$(aws acm request-certificate \
    --domain-name "$DOMAIN" \
    --validation-method DNS \
    --region "$AWS_REGION" \
    --query CertificateArn --output text)
  log "ACM cert requested: ${arn:0:20}... (ARN masked)"
  log "DNS validation records (add at Netlify DNS):"
  aws acm describe-certificate --certificate-arn "$arn" --region "$AWS_REGION" \
    --query 'Certificate.DomainValidationOptions[*].{Name:ResourceRecord.Name,Type:ResourceRecord.Type,Value:ResourceRecord.Value}' \
    --output table
  echo "$arn"
}

ensure_tfvars() {
  local acm_arn="${1:-}"
  if [[ ! -f "$TF_DIR/terraform.tfvars" ]]; then
    cp "$TF_DIR/terraform.tfvars.example" "$TF_DIR/terraform.tfvars"
  fi
  if [[ -n "$acm_arn" ]]; then
    if grep -q '^acm_certificate_arn' "$TF_DIR/terraform.tfvars"; then
      sed -i "s|^acm_certificate_arn.*|acm_certificate_arn = \"$acm_arn\"|" "$TF_DIR/terraform.tfvars"
    else
      echo "acm_certificate_arn = \"$acm_arn\"" >> "$TF_DIR/terraform.tfvars"
    fi
  fi
  grep -q 'create_github_oidc_provider' "$TF_DIR/terraform.tfvars" \
    || echo 'create_github_oidc_provider = false' >> "$TF_DIR/terraform.tfvars"
}

terraform_apply() {
  cd "$TF_DIR"
  if ! grep -q 'backend "s3"' versions.tf || grep -q '# backend "s3"' versions.tf; then
    log "Enabling S3 backend in versions.tf..."
    sed -i 's|# backend "s3"|backend "s3"|' versions.tf
    sed -i 's|#   bucket|  bucket|' versions.tf
    sed -i 's|#   key|  key|' versions.tf
    sed -i 's|#   region|  region|' versions.tf
    sed -i 's|#   dynamodb_table|  dynamodb_table|' versions.tf
    sed -i 's|#   encrypt|  encrypt|' versions.tf
    sed -i 's|# }|}|' versions.tf
  fi
  terraform init -input=false
  terraform plan -out=tfplan -input=false
  terraform apply -auto-approve tfplan
}

build_secrets_json() {
  local out="${1:-/tmp/koda-app-secrets.json}"
  export PATH="$HOME/.railway/bin:$HOME/.local/bin:$PATH"
  unset RAILWAY_API_TOKEN 2>/dev/null || true

  railway variables --service web --json > /tmp/rw-web.json 2>/dev/null \
    || die "Railway CLI failed — link project bountiful-fascination first"

  jq -n \
    --argjson rw "$(cat /tmp/rw-web.json)" \
    '{
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: $rw.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      CLERK_SECRET_KEY: $rw.CLERK_SECRET_KEY,
      CLERK_WEBHOOK_SECRET: $rw.CLERK_WEBHOOK_SECRET,
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: ($rw.NEXT_PUBLIC_CLERK_SIGN_IN_URL // "/sign-in"),
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: ($rw.NEXT_PUBLIC_CLERK_SIGN_UP_URL // "/sign-up"),
      OPEN_ACCESS: "0",
      NEXT_PUBLIC_OPEN_ACCESS: "0",
      ALLOW_DEMO_AUTH: "0",
      NEXT_PUBLIC_ALLOW_DEMO_AUTH: "0",
      NEXT_PUBLIC_APP_URL: "https://koda.advancedautomations.net",
      ENCRYPTION_KEY: $rw.ENCRYPTION_KEY,
      ADMIN_PASSWORD: ($rw.ADMIN_PASSWORD // $rw.STAFF_ACCESS_TOKEN // ""),
      CURSOR_API_KEY: $rw.CURSOR_API_KEY,
      CURSOR_MOCK: ($rw.CURSOR_MOCK // "0"),
      GITHUB_MOCK: ($rw.GITHUB_MOCK // "0"),
      RAILWAY_MOCK: "1"
    }' > "$out"
  log "Secrets JSON written to $out ($(jq 'keys | length' "$out") keys, values masked)"
}

populate_secrets() {
  local secrets_file="${1:-/tmp/koda-app-secrets.json}"
  cd "$TF_DIR"
  local arn
  arn=$(terraform output -raw app_secrets_arn)
  aws secretsmanager put-secret-value \
    --secret-id "$arn" \
    --secret-string "file://$secrets_file" \
    --region "$AWS_REGION" >/dev/null
  log "App secrets populated in Secrets Manager (ARN masked)"
}

build_and_push_images() {
  cd "$TF_DIR"
  local account ecr_web ecr_worker pk
  account=$(terraform output -raw aws_account_id)
  ecr_web=$(terraform output -raw ecr_web_repository_url)
  ecr_worker=$(terraform output -raw ecr_worker_repository_url)
  pk=$(jq -r '.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' /tmp/koda-app-secrets.json)

  aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "${account}.dkr.ecr.${AWS_REGION}.amazonaws.com"

  log "Building web image..."
  docker build -f "$ROOT/Dockerfile.web" \
    --build-arg NEXT_PUBLIC_OPEN_ACCESS=0 \
    --build-arg NEXT_PUBLIC_ALLOW_DEMO_AUTH=0 \
    --build-arg NEXT_PUBLIC_APP_URL="https://$DOMAIN" \
    --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$pk" \
    -t "$ecr_web:$IMAGE_TAG" "$ROOT"
  docker push "$ecr_web:$IMAGE_TAG"

  log "Building worker image..."
  docker build -f "$ROOT/Dockerfile.worker" \
    -t "$ecr_worker:$IMAGE_TAG" "$ROOT"
  docker push "$ecr_worker:$IMAGE_TAG"

  terraform apply -auto-approve -var="image_tag=$IMAGE_TAG" -input=false
}

force_ecs_redeploy() {
  cd "$TF_DIR"
  local cluster web_svc worker_svc
  cluster=$(terraform output -raw ecs_cluster_name)
  web_svc=$(terraform output -raw ecs_web_service_name)
  worker_svc=$(terraform output -raw ecs_worker_service_name)

  aws ecs update-service --cluster "$cluster" --service "$web_svc" \
    --force-new-deployment --region "$AWS_REGION" >/dev/null
  aws ecs update-service --cluster "$cluster" --service "$worker_svc" \
    --force-new-deployment --region "$AWS_REGION" >/dev/null
  log "ECS redeploy triggered for web + worker"
  log "Waiting for web service stable (up to 10 min)..."
  aws ecs wait services-stable --cluster "$cluster" --services "$web_svc" --region "$AWS_REGION" \
    || log "WARN: web service not stable yet — check ECS console"
}

verify_health() {
  cd "$TF_DIR"
  local alb
  alb=$(terraform output -raw alb_dns_name)
  log "ALB DNS: $alb"

  local ready health
  ready=$(curl -fsS "http://$alb/api/ready" 2>/dev/null || echo '{"ok":false}')
  health=$(curl -fsS "http://$alb/api/health" 2>/dev/null || echo '{"ok":false}')
  log "/api/ready: $ready"
  log "/api/health: $health"

  if jq -e '.ok == true' <<<"$ready" &>/dev/null; then
    log "ALB health check PASSED"
    log "DNS cutover: set koda CNAME at Netlify → $alb"
    return 0
  fi
  log "WARN: ALB not healthy yet — ECS tasks may still be starting"
  return 1
}

main() {
  load_aws_creds
  export AWS_DEFAULT_REGION="$AWS_REGION"
  verify_aws
  bootstrap_state

  local acm_arn=""
  if acm_arn=$(find_acm_cert); then
    log "Found existing ACM cert for $DOMAIN"
  else
    acm_arn=$(request_acm_cert)
    log "ACM cert pending DNS validation — apply may fail HTTPS until validated"
  fi

  ensure_tfvars "$acm_arn"
  build_secrets_json
  terraform_apply
  populate_secrets
  build_and_push_images
  force_ecs_redeploy
  verify_health

  log "Done. Railway remains live until DNS cutover + verification."
  log "Do NOT delete Railway until https://$DOMAIN/api/ready passes on AWS."
}

main "$@"
