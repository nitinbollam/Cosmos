import type { ReactNode } from 'react'
import { useViewer } from '@/components/purchasing/use-viewer'
import { settingsActionAllowed, settingsActionReason, type SettingsAction } from '@/lib/settings-permissions'

/** Whether the signed-in person may use a Settings action, and why not. Allowed while loading would flash buttons, so not. */
export function useSettingsAccess(action: SettingsAction): { allowed: boolean; reason: string | null } {
  const { viewer } = useViewer()
  return { allowed: settingsActionAllowed(viewer, action), reason: settingsActionReason(viewer, action) }
}

/**
 * Wraps a form or group of controls. Without access every control inside is disabled (a disabled fieldset covers
 * inputs, selects and buttons) and a short reason is shown once, so the person can still read the values.
 */
export function PermissionGate({ action, children }: { action: SettingsAction; children: ReactNode }) {
  const { allowed, reason } = useSettingsAccess(action)
  return (
    <fieldset disabled={!allowed} className="min-w-0 border-0 p-0 m-0">
      {children}
      {!allowed && reason ? <p className="text-pleros-text-3 text-xs mt-2">{reason}</p> : null}
    </fieldset>
  )
}
