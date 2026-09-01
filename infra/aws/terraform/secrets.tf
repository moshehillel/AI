# Application secrets — populate values after first apply via AWS Console/CLI.
# Never commit real secret values to git.

resource "aws_secretsmanager_secret" "app" {
  name        = "${local.name_prefix}/app-env"
  description = "Koda platform environment variables (Clerk, Cursor, GitHub, etc.)"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    # Auth — production Clerk (clerk.advancedautomations.net)
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "REPLACE_ME_pk_live_..."
    CLERK_SECRET_KEY                  = "REPLACE_ME_sk_live_..."
    CLERK_WEBHOOK_SECRET              = "REPLACE_ME_whsec_..."
    NEXT_PUBLIC_CLERK_SIGN_IN_URL       = "/sign-in"
    NEXT_PUBLIC_CLERK_SIGN_UP_URL       = "/sign-up"

    # Access mode — Clerk required
    OPEN_ACCESS                = "0"
    NEXT_PUBLIC_OPEN_ACCESS    = "0"
    ALLOW_DEMO_AUTH            = "0"
    NEXT_PUBLIC_ALLOW_DEMO_AUTH = "0"

    # App
    NEXT_PUBLIC_APP_URL = "https://${var.domain_name}"
    ENCRYPTION_KEY      = "REPLACE_ME_openssl_rand_hex_32"

    # Staff fallback (optional when Clerk org roles are primary)
    ADMIN_PASSWORD = "REPLACE_ME"

    # Integrations
    CURSOR_API_KEY = "REPLACE_ME"
    CURSOR_MOCK    = "0"
    GITHUB_MOCK    = "0"
    RAILWAY_MOCK   = "1"

  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${local.name_prefix}/database-url"
  description = "Postgres connection string for Koda"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgresql://%s:%s@%s:5432/%s?schema=public&connection_limit=10&pool_timeout=20",
    aws_db_instance.main.username,
    random_password.db.result,
    aws_db_instance.main.address,
    aws_db_instance.main.db_name,
  )
}

resource "aws_secretsmanager_secret" "redis_url" {
  name        = "${local.name_prefix}/redis-url"
  description = "Redis connection string for Koda BullMQ"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}
