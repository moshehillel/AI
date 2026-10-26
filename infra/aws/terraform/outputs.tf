output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "alb_dns_name" {
  description = "ALB hostname — point koda.advancedautomations.net CNAME here (Netlify DNS) if not using Route53."
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  value = aws_lb.main.zone_id
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecr_worker_repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_web_service_name" {
  value = aws_ecs_service.web.name
}

output "ecs_worker_service_name" {
  value = aws_ecs_service.worker.name
}

output "app_secrets_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "database_secret_arn" {
  value = aws_secretsmanager_secret.database_url.arn
}

output "redis_secret_arn" {
  value = aws_secretsmanager_secret.redis_url.arn
}

output "github_deploy_role_arn" {
  value = var.enable_github_oidc ? aws_iam_role.github_deploy[0].arn : null
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}
