export type CardSubmitSteps = {
  /** A reason not to go ahead (such as an invalid amount), or null. Runs before Stripe is called. */
  validate?: () => string | null
  /** Tokenizes the card with Stripe. */
  createPaymentMethod: () => Promise<{ error?: { message?: string }; paymentMethod?: { id: string } }>
  onSubmit: (result: { paymentMethodId: string }) => void | Promise<void>
  setErr: (message: string | null) => void
}

/** Submits a card form: validation first, so nothing reaches Stripe for a request that would be refused. */
export async function submitCard({ validate, createPaymentMethod, onSubmit, setErr }: CardSubmitSteps): Promise<void> {
  const invalid = validate?.() ?? null
  if (invalid) {
    setErr(invalid)
    return
  }
  setErr(null)
  const { error, paymentMethod } = await createPaymentMethod()
  if (error) {
    setErr(error.message ?? 'Card error')
    return
  }
  if (paymentMethod) await onSubmit({ paymentMethodId: paymentMethod.id })
}
