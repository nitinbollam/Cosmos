import { hasClientPermission, type Viewer } from '@/lib/requisitions'

/**
 * What each Settings action needs, mirroring the checks the server makes. The screens use this to hide or disable
 * actions the signed-in person cannot use, instead of letting them press a button that answers "Forbidden".
 *
 * `admin` means the server only accepts the tenant admin roles for that action.
 */
export type SettingsAction =
  | 'company'
  | 'onboarding'
  | 'workflow'
  | 'finance'
  | 'features'
  | 'billing'
  | 'salesChannels'
  | 'tax'
  | 'ageVerification'
  | 'msa'
  | 'users'
  | 'warehouses'
  | 'edi'
  | 'webhooks'
  | 'stripeConnect'

type Rule = { permission: string } | { admin: true }

const RULES: Record<SettingsAction, Rule> = {
  company: { permission: 'settings.write' },
  onboarding: { permission: 'settings.write' },
  workflow: { permission: 'settings.write' },
  finance: { permission: 'settings.write' },
  features: { permission: 'settings.write' },
  billing: { permission: 'settings.write' },
  salesChannels: { permission: 'settings.write' },
  tax: { permission: 'compliance.write' },
  ageVerification: { permission: 'compliance.write' },
  msa: { permission: 'compliance.write' },
  users: { permission: 'users.write' },
  warehouses: { permission: 'inventory.write' },
  edi: { permission: 'edi.write' },
  webhooks: { admin: true },
  stripeConnect: { admin: true },
}

const isAdmin = (viewer: Viewer | undefined) => viewer?.role === 'SUPER_ADMIN' || viewer?.role === 'TENANT_ADMIN'

/** Whether the viewer may use this Settings action. False until the viewer has loaded. */
export function settingsActionAllowed(viewer: Viewer | undefined, action: SettingsAction): boolean {
  const rule = RULES[action]
  return 'admin' in rule ? isAdmin(viewer) : hasClientPermission(viewer, rule.permission)
}

/** The short reason shown beside a disabled action, or null when the viewer may use it. */
export function settingsActionReason(viewer: Viewer | undefined, action: SettingsAction): string | null {
  if (settingsActionAllowed(viewer, action)) return null
  return 'admin' in RULES[action] ? 'Only an administrator can do this.' : 'Your role can view this but not change it.'
}
