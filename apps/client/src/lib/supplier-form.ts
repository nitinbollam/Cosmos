export type SupplierFormValues = { code: string; name: string; email: string }
export type SupplierFormErrors = { code: string; name: string; email: string }

export function supplierFormErrors(values: SupplierFormValues): SupplierFormErrors {
  const email = values.email.trim()
  return {
    code: values.code.trim() ? '' : 'Enter a supplier code.',
    name: values.name.trim() ? '' : 'Enter a supplier name.',
    email: !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'Enter a valid email address.',
  }
}
