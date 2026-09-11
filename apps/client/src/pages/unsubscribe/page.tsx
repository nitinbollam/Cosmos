import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'

export default function UnsubscribePage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('Missing unsubscribe token.')
      return
    }

    let isMounted = true
    api
      .get<{ valid: boolean; message?: string }>(`/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(() => {
        if (isMounted) setStatus('success')
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setStatus('error')
          setErrorMsg(axiosErr(err))
        }
      })

    return () => {
      isMounted = false
    }
  }, [token])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="pleros-card max-w-md w-full text-center space-y-4">
        {status === 'loading' && (
          <div>
            <div className="skeleton h-8 w-48 mx-auto mb-2" />
            <p className="text-sm text-pleros-text-3">Processing your unsubscribe request…</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto text-xl font-bold">
              ✓
            </div>
            <h1 className="text-xl font-bold font-display text-pleros-white">You have been unsubscribed</h1>
            <p className="text-sm text-pleros-text-3">
              You will no longer receive marketing emails from this distributor.
            </p>
            <div className="pt-3">
              <Link to="/login" className="btn-ghost text-sm inline-block">
                Return to Login
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto text-xl font-bold">
              ✕
            </div>
            <h1 className="text-xl font-bold font-display text-pleros-white">Unsubscribe Failed</h1>
            <p className="text-sm text-red-300">{errorMsg || 'Invalid or expired unsubscribe link.'}</p>
            <div className="pt-3">
              <Link to="/login" className="btn-ghost text-sm inline-block">
                Return to Login
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
