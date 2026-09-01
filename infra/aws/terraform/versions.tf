terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Uncomment after creating the S3 bucket + DynamoDB table for state locking.
  # backend "s3" {
  #   bucket         = "koda-platform-tfstate"
  #   key            = "koda-platform/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "koda-platform-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "koda-platform"
      ManagedBy   = "terraform"
      Application = "koda"
      Stack       = "platform"
      # Intentionally separate from Whiteglove client automation stacks.
      Scope = "koda-only"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}
