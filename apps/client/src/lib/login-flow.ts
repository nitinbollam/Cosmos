/**
 * Sign-in is two steps when one email has accounts in several companies: the password is checked
 * first, and if it opens more than one company the server answers with a short-lived selection
 * token and the company names instead of a session. The person picks one and the token is traded
 * for that company's tokens.
 */
export type LoginTokens = { accessToken: string; refreshToken: string }
export type TenantChoice = { id: string; slug: string; name: string }
export type TenantPrompt = { selectionToken: string; tenants: TenantChoice[] }
export type LoginResponse = LoginTokens | ({ requiresTenantSelection: true } & TenantPrompt)

export function tenantPromptOf(r: LoginResponse): TenantPrompt | null {
  return 'requiresTenantSelection' in r && r.requiresTenantSelection
    ? { selectionToken: r.selectionToken, tenants: r.tenants }
    : null
}

export function tokensOf(r: LoginResponse): LoginTokens {
  if ('accessToken' in r) return r
  throw new Error('Sign-in needs a company choice first')
}
