import { z } from 'zod'

export const cuidSchema = z.string().regex(/^c[a-z0-9]{24}$/i, 'invalid cuid')
export const uuidSchema = z.string().uuid()
export const idSchema = z.string().min(1)
export const emailSchema = z.string().email()
export const moneySchema = z.number().nonnegative().finite()
export const positiveIntSchema = z.number().int().positive()

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
})
export type Pagination = z.infer<typeof paginationSchema>

export const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(2),
  postalCode: z.string().min(3),
  country: z.string().length(2).default('US'),
})

export const skuCodeSchema = z.string().min(1).max(64).regex(/^[A-Z0-9\-_.]+$/i)
export const upcSchema = z.string().regex(/^\d{12,14}$/, 'invalid UPC')

export const correlationIdSchema = z.string().min(1)

export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')
    throw new Error(`Validation failed: ${msg}`)
  }
  return r.data
}
