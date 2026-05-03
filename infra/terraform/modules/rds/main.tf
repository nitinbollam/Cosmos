terraform {
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.50" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

variable "environment"        { type = string }
variable "vpc_id"              { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "db_name"             { type = string  default = "cosmos" }
variable "instance_class"      { type = string  default = "db.t3.medium" }
variable "allocated_storage"   { type = number  default = 50 }

resource "random_password" "master" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "cosmos-${var.environment}"
  subnet_ids = var.private_subnet_ids
  tags       = { Environment = var.environment }
}

resource "aws_security_group" "rds" {
  name   = "cosmos-${var.environment}-rds"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}

resource "aws_db_instance" "postgres" {
  identifier              = "cosmos-${var.environment}"
  engine                  = "postgres"
  engine_version          = "16.3"
  instance_class          = var.instance_class
  allocated_storage       = var.allocated_storage
  max_allocated_storage   = var.allocated_storage * 5
  db_name                 = var.db_name
  username                = "cosmos"
  password                = random_password.master.result
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  multi_az                = var.environment == "production"
  backup_retention_period = var.environment == "production" ? 30 : 7
  deletion_protection     = var.environment == "production"
  skip_final_snapshot     = var.environment != "production"
  storage_encrypted       = true

  tags = { Environment = var.environment, Project = "cosmos" }
}

output "endpoint"        { value = aws_db_instance.postgres.endpoint }
output "master_password" { value = random_password.master.result, sensitive = true }
