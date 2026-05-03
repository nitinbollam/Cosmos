import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { AuthService } from '../auth.service'
import { PrismaService } from '../../prisma/prisma.service'
import * as bcrypt from 'bcrypt'

describe('AuthService', () => {
  let auth: AuthService
  let prisma: { user: any; tenant: any }
  let jwt: { signAsync: jest.Mock }

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tenant: { findUnique: jest.fn() },
    }
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') }

    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({ JWT_SECRET: 's1', JWT_REFRESH_SECRET: 's2', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '7d' }[k]),
          },
        },
      ],
    }).compile()

    auth = mod.get(AuthService)
  })

  it('rejects login for unknown user', async () => {
    prisma.user.findFirst.mockResolvedValue(null)
    await expect(auth.login({ email: 'a@b.c', password: 'pw12345678' })).rejects.toThrow('Invalid credentials')
  })

  it('rejects login for wrong password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', email: 'a@b.c', tenantId: 't1', isActive: true,
      passwordHash: await bcrypt.hash('correct', 4), role: 'STAFF',
    })
    await expect(auth.login({ email: 'a@b.c', password: 'wrong' })).rejects.toThrow('Invalid credentials')
  })

  it('issues tokens on valid login', async () => {
    const hash = await bcrypt.hash('correct', 4)
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', email: 'a@b.c', tenantId: 't1', isActive: true,
      passwordHash: hash, role: 'STAFF',
    })
    prisma.user.update.mockResolvedValue({})
    const r = await auth.login({ email: 'a@b.c', password: 'correct' })
    expect(r.accessToken).toBe('signed-token')
    expect(r.refreshToken).toBe('signed-token')
  })

  it('refuses to register if tenant missing', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null)
    await expect(
      auth.register({ tenantId: 't1', email: 'a@b.c', password: 'pw12345678', firstName: 'A', lastName: 'B' }),
    ).rejects.toThrow('Tenant does not exist')
  })

  it('refuses register on duplicate email', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1' })
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' })
    await expect(
      auth.register({ tenantId: 't1', email: 'a@b.c', password: 'pw12345678', firstName: 'A', lastName: 'B' }),
    ).rejects.toThrow('Email already registered')
  })

  it('refresh refuses when no stored hash', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', refreshTokenHash: null })
    await expect(auth.refreshTokens('u1', 'tok')).rejects.toThrow('Access denied')
  })
})
