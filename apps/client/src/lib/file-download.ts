import { gatewayApiBaseUrl } from '@/lib/api-admin'
import { authFetch } from '@/lib/auth-session'

/**
 * Saves a blob as a file. The object URL is released a minute later: revoking it straight
 * after click() cancels the download in some browsers, so nothing seems to happen.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Downloads a file from the admin API (`path` is after `/api/v1`). Throws with the server's
 * message when the request fails, so the caller can show it instead of failing silently.
 */
export async function downloadApiFile(path: string, filename: string, accept: string): Promise<void> {
  const res = await authFetch(`${gatewayApiBaseUrl.replace(/\/$/, '')}${path}`, { headers: { Accept: accept } })
  if (!res.ok) {
    let message = `Download failed (${res.status})`
    try {
      const body = (await res.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // Not JSON: keep the status message.
    }
    throw new Error(message)
  }
  saveBlob(await res.blob(), filename)
}
