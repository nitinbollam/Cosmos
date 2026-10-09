terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
  backend "s3" {
    bucket = "pleros-tfstate"
    key    = "staging/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.region
}

variable "region" { type = string  default = "us-east-1" }

module "networking" {
  source      = "../../modules/networking"
  environment = "staging"
}

module "rds" {
  source             = "../../modules/rds"
  environment        = "staging"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  instance_class     = "db.t3.small"
  allocated_storage  = 20
}

module "redis" {
  source             = "../../modules/redis"
  environment        = "staging"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  node_type          = "cache.t3.micro"
}

module "s3" {
  source      = "../../modules/s3"
  environment = "staging"
}

module "eks" {
  source             = "../../modules/eks"
  environment        = "staging"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
}

output "rds_endpoint"   { value = module.rds.endpoint }
output "redis_endpoint" { value = module.redis.endpoint }
output "s3_bucket"      { value = module.s3.bucket_name }
output "eks_cluster"    { value = module.eks.cluster_name }
