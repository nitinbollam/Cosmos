import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { logger } from '@cosmos/logger'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } })
    if (!tenant) throw new ConflictException('Tenant does not exist')

    const existing = await this.prisma.user.findFirst({
      where: { tenantId: dto.tenantId, email: dto.email },
    })
    if (existing) throw new ConflictException('Email already registered for this tenant')

    const passwordHash = await bcrypt.hash(dto.password, 12)
    const user = await this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role ?? 'STAFF',
      },
      select: { id: true, email: true, role: true, tenantId: true },
    })

    logger.info({ userId: user.id, tenantId: user.tenantId }, 'User registered')
    return this.generateTokenPair(user)
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, isActive: true },
    })
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials')

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    logger.info({ userId: user.id, tenantId: user.tenantId }, 'User logged in')
    return this.generateTokenPair(user)
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user?.refreshTokenHash) throw new ForbiddenException('Access denied')

    const tokenValid = await bcrypt.compare(refreshToken, user.refreshTokenHash)
    if (!tokenValid) throw new ForbiddenException('Access denied')

    return this.generateTokenPair(user)
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    })
  }

  private async generateTokenPair(user: {
    id: string
    email: string
    role: string
    tenantId: string
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    }

    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m'
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d'

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: accessTtl,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      }),
    ])

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10)
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash },
    })

    return { accessToken, refreshToken, userId: user.id, role: user.role }
  }
}
