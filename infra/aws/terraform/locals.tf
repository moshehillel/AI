locals {
  name_prefix = "${var.project_name}-${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    Scope       = "koda-only"
  }

  # Repos created after 2026-07-15 use immutable OIDC subjects:
  # repo:owner@OWNER_ID/repo@REPO_ID:ref:refs/heads/BRANCH
  github_repo_owner = split("/", var.github_repository)[0]
  github_repo_name  = split("/", var.github_repository)[1]
  github_oidc_repo_prefix = var.github_oidc_immutable_subject ? (
    "${local.github_repo_owner}@${var.github_repository_owner_id}/${local.github_repo_name}@${var.github_repository_id}"
  ) : var.github_repository
}
