import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma } from '../generated/prisma-client'
import { Role } from '../generated/prisma-client'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string, page = 1, pageSize = 20) {
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where: { tenantId } }),
    ])
    return { items, total, page, pageSize, hasMore: page * pageSize < total }
  }

  async findById(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        permissions: true,
        lastLoginAt: true,
        createdAt: true,
      },
    })
    if (!user) throw new NotFoundException('User not found')
    return user
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findFirst({
      where: { tenantId: dto.tenantId, email: dto.email },
    })
    if (exists) throw new ConflictException('Email already exists for this tenant')

    const passwordHash = await bcrypt.hash(dto.password, 12)
    return this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: (dto.role ?? 'STAFF') as
          | 'STAFF'
          | 'TENANT_ADMIN'
          | 'MANAGER'
          | 'WAREHOUSE_STAFF'
          | 'SALES_REP'
          | 'DRIVER'
          | 'ACCOUNTANT'
          | 'VIEWER',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    })
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    await this.findById(tenantId, id)
    const data: Prisma.UserUpdateInput = {}
    if (dto.firstName !== undefined) data.firstName = dto.firstName
    if (dto.lastName !== undefined) data.lastName = dto.lastName
    if (dto.isActive !== undefined) data.isActive = dto.isActive
    if (dto.role !== undefined) data.role = dto.role as Role

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    })
  }

  async deactivate(tenantId: string, id: string) {
    await this.findById(tenantId, id)
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false, refreshTokenHash: null },
    })
  }
}
