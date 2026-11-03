/** Editable customer fields, as the form holds them (all text). */
export type CustomerForm = {
  name: string
  email: string
  phone: string
  firstName: string
  lastName: string
  taxId: string
  externalRef: string
  paymentTermsDays: string
  primaryAddressLine1: string
  primaryCity: string
  primaryState: string
  primaryZip: string
}

export const CUSTOMER_FORM_FIELDS = [
  'name',
  'email',
  'phone',
  'firstName',
  'lastName',
  'taxId',
  'externalRef',
  'paymentTermsDays',
  'primaryAddressLine1',
  'primaryCity',
  'primaryState',
  'primaryZip',
] as const satisfies ReadonlyArray<keyof CustomerForm>

type CustomerLike = Partial<Record<keyof CustomerForm, string | number | null | undefined>>

export function customerFormFrom(c: CustomerLike): CustomerForm {
  const form = {} as CustomerForm
  for (const key of CUSTOMER_FORM_FIELDS) form[key] = c[key] == null ? '' : String(c[key])
  if (!form.paymentTermsDays) form.paymentTermsDays = '0'
  return form
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Field errors, matching the server's checks so most mistakes are caught before saving. */
export function customerFormErrors(form: CustomerForm): Partial<Record<keyof CustomerForm, string>> {
  const errors: Partial<Record<keyof CustomerForm, string>> = {}
  if (!form.name.trim()) errors.name = 'Name is required'
  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errors.email = 'Enter a valid email address'
  const days = Number(form.paymentTermsDays)
  if (form.paymentTermsDays.trim() === '' || !Number.isInteger(days) || days < 0 || days > 365) {
    errors.paymentTermsDays = 'Whole number of days, 0 to 365'
  }
  return errors
}

/** Only the fields that changed, trimmed; a cleared optional field is sent as null. */
export function customerPatch(original: CustomerForm, form: CustomerForm): Record<string, string | number | null> {
  const patch: Record<string, string | number | null> = {}
  for (const key of CUSTOMER_FORM_FIELDS) {
    const next = form[key].trim()
    if (next === original[key].trim()) continue
    if (key === 'paymentTermsDays') patch[key] = Number(next)
    else if (key === 'name') patch[key] = next
    else patch[key] = next === '' ? null : next
  }
  return patch
}
