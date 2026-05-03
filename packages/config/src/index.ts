import { z } from 'zod'
import * as dotenv from 'dotenv'

dotenv.config()

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
})

export type BaseEnv = z.infer<typeof baseEnvSchema>

export const interServiceUrlsSchema = z.object({
  AUTH_SERVICE_URL: z.string().url().optional(),
  TENANT_SERVICE_URL: z.string().url().optional(),
  INVENTORY_SERVICE_URL: z.string().url().optional(),
  WMS_SERVICE_URL: z.string().url().optional(),
  ORDER_SERVICE_URL: z.string().url().optional(),
  PURCHASING_SERVICE_URL: z.string().url().optional(),
  COMPLIANCE_SERVICE_URL: z.string().url().optional(),
  PAYMENT_SERVICE_URL: z.string().url().optional(),
  LEDGER_SERVICE_URL: z.string().url().optional(),
  ANALYTICS_SERVICE_URL: z.string().url().optional(),
  NOTIFICATION_SERVICE_URL: z.string().url().optional(),
  DISPATCH_SERVICE_URL: z.string().url().optional(),
  CRM_SERVICE_URL: z.string().url().optional(),
  STOREFRONT_SERVICE_URL: z.string().url().optional(),
  POS_SERVICE_URL: z.string().url().optional(),
  GATEWAY_SERVICE_URL: z.string().url().optional(),
  LLM_SERVICE_URL: z.string().url().optional(),
  FORECASTING_SERVICE_URL: z.string().url().optional(),
  OCR_SERVICE_URL: z.string().url().optional(),
})

export const awsEnvSchema = z.object({
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_CLOUDFRONT_URL: z.string().url().optional(),
})

export const stripeEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_RETURN_URL: z.string().url().optional(),
})

export function loadEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}

export function loadServiceEnv<T extends z.ZodTypeAny>(extra: T) {
  return loadEnv(baseEnvSchema.merge(interServiceUrlsSchema).merge(awsEnvSchema).merge(extra as unknown as z.ZodObject<z.ZodRawShape>))
}
