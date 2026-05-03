import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Auth (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let tenantId: string

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.setGlobalPrefix('api/v1')
    await app.init()

    prisma = app.get(PrismaService)

    const tenant = await prisma.tenant.create({
      data: { name: 'Test Tenant', slug: `test-${Date.now()}` },
    })
    tenantId = tenant.id
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { tenantId } })
      await prisma.tenant.deleteMany({ where: { id: tenantId } })
    }
    await app.close()
  })

  it('rejects login for unknown email', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' })
      .expect(401)
  })

  it('registers, logs in, refreshes, logs out', async () => {
    const email = `user-${Date.now()}@example.com`

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantId, email, password: 'password123', firstName: 'A', lastName: 'B' })
      .expect(201)
    expect(reg.body.accessToken).toBeDefined()
    expect(reg.body.refreshToken).toBeDefined()

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(200)
    const access = login.body.accessToken
    const refresh = login.body.refreshToken

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Authorization', `Bearer ${refresh}`)
      .expect(200)
    expect(refreshed.body.accessToken).toBeDefined()

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .expect(204)
  })

  it('returns 200 on health', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200)
  })
})
