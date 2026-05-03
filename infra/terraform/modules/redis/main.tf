terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

variable "environment"        { type = string }
variable "vpc_id"              { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "node_type"           { type = string  default = "cache.t3.small" }

resource "aws_elasticache_subnet_group" "this" {
  name       = "cosmos-${var.environment}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "redis" {
  name   = "cosmos-${var.environment}-redis"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "cosmos-${var.environment}"
  description          = "Cosmos ${var.environment} Redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.node_type
  num_cache_clusters   = var.environment == "production" ? 2 : 1
  automatic_failover_enabled = var.environment == "production"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.redis.id]

  tags = { Environment = var.environment, Project = "cosmos" }
}

output "endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
