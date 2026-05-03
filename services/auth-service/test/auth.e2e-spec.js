"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const common_1 = require("@nestjs/common");
const request = __importStar(require("supertest"));
const app_module_1 = require("../src/app.module");
const prisma_service_1 = require("../src/prisma/prisma.service");
describe('Auth (e2e)', () => {
    let app;
    let prisma;
    let tenantId;
    beforeAll(async () => {
        const moduleFixture = await testing_1.Test.createTestingModule({
            imports: [app_module_1.AppModule],
        }).compile();
        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
        app.setGlobalPrefix('api/v1');
        await app.init();
        prisma = app.get(prisma_service_1.PrismaService);
        const tenant = await prisma.tenant.create({
            data: { name: 'Test Tenant', slug: `test-${Date.now()}` },
        });
        tenantId = tenant.id;
    });
    afterAll(async () => {
        if (prisma) {
            await prisma.user.deleteMany({ where: { tenantId } });
            await prisma.tenant.deleteMany({ where: { id: tenantId } });
        }
        await app.close();
    });
    it('rejects login for unknown email', async () => {
        await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email: 'nobody@example.com', password: 'password123' })
            .expect(401);
    });
    it('registers, logs in, refreshes, logs out', async () => {
        const email = `user-${Date.now()}@example.com`;
        const reg = await request(app.getHttpServer())
            .post('/api/v1/auth/register')
            .send({ tenantId, email, password: 'password123', firstName: 'A', lastName: 'B' })
            .expect(201);
        expect(reg.body.accessToken).toBeDefined();
        expect(reg.body.refreshToken).toBeDefined();
        const login = await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email, password: 'password123' })
            .expect(200);
        const access = login.body.accessToken;
        const refresh = login.body.refreshToken;
        const refreshed = await request(app.getHttpServer())
            .post('/api/v1/auth/refresh')
            .set('Authorization', `Bearer ${refresh}`)
            .expect(200);
        expect(refreshed.body.accessToken).toBeDefined();
        await request(app.getHttpServer())
            .post('/api/v1/auth/logout')
            .set('Authorization', `Bearer ${access}`)
            .expect(204);
    });
    it('returns 200 on health', async () => {
        await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });
});
//# sourceMappingURL=auth.e2e-spec.js.map