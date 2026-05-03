process.env.INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ?? 'payment-idem-test-internal'
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/cosmos?schema=payment_idem_test'
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret'
