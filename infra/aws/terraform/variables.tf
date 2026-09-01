variable "aws_region" {
  description = "AWS region for the Koda platform stack (separate from Whiteglove)."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Resource name prefix for the Koda platform."
  type        = string
  default     = "koda-platform"
}

variable "environment" {
  description = "Deployment environment label (production, staging)."
  type        = string
  default     = "production"
}

variable "domain_name" {
  description = "Public hostname for Koda (e.g. koda.advancedautomations.net)."
  type        = string
  default     = "koda.advancedautomations.net"
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for domain_name. Leave empty to skip DNS records (manual Netlify cutover)."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS on the ALB (must cover domain_name). Create in us-east-1."
  type        = string
  default     = ""
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "worker_cpu" {
  type    = number
  default = 512
}

variable "worker_memory" {
  type    = number
  default = 1024
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "image_tag" {
  description = "Docker image tag pushed to ECR (web and worker share the same repo with different Dockerfiles)."
  type        = string
  default     = "latest"
}

variable "github_repository" {
  description = "GitHub repo for OIDC deploy role (moshehillel/AI)."
  type        = string
  default     = "moshehillel/AI"
}

variable "enable_github_oidc" {
  description = "Create IAM role for GitHub Actions OIDC deploy."
  type        = bool
  default     = true
}
