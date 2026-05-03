terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

variable "environment"        { type = string }
variable "vpc_id"              { type = string }
variable "private_subnet_ids" { type = list(string) }

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "cosmos-${var.environment}"
  cluster_version = "1.29"
  vpc_id          = var.vpc_id
  subnet_ids      = var.private_subnet_ids

  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  eks_managed_node_groups = {
    general = {
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 10
      desired_size   = 3
    }
    ai_gpu = {
      instance_types = ["g4dn.xlarge"]
      min_size       = 0
      max_size       = 3
      desired_size   = var.environment == "production" ? 1 : 0
      labels         = { accelerator = "gpu" }
      taints         = [{ key = "gpu", value = "true", effect = "NO_SCHEDULE" }]
    }
  }

  tags = { Environment = var.environment, Project = "cosmos" }
}

output "cluster_name"      { value = module.eks.cluster_name }
output "cluster_endpoint"  { value = module.eks.cluster_endpoint }
output "cluster_ca_data"   { value = module.eks.cluster_certificate_authority_data, sensitive = true }
