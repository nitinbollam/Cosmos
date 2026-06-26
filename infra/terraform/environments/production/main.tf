terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
  backend "s3" {
    bucket = "pleros-tfstate"
    key    = "production/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.region
}

variable "region" { type = string  default = "us-east-1" }

module "networking" {
  source      = "../../modules/networking"
  environment = "production"
}

module "rds" {
  source             = "../../modules/rds"
  environment        = "production"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  instance_class     = "db.r6g.xlarge"
  allocated_storage  = 200
}

module "redis" {
  source             = "../../modules/redis"
  environment        = "production"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  node_type          = "cache.r6g.large"
}

module "s3" {
  source      = "../../modules/s3"
  environment = "production"
}

module "eks" {
  source             = "../../modules/eks"
  environment        = "production"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
}
