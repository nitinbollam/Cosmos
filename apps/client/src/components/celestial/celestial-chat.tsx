import { Link, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api as shopApi, gatewayApiBaseUrl as shopGateway } from '@/lib/api'
import { api as adminApi, gatewayApiBaseUrl as adminGateway } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'
import { CelestialMarkdown } from '@/components/celestial/celestial-markdown'
import { streamCelestialChat } from '@/components/celestial/celestial-stream'
import { useCelestialStore, type CelestialSurface } from '@/stores/celestial-store'

const BUYER_SUGGESTIONS = [
  'Where are my recent orders?',
  'Do I have open invoices?',
  'Search catalog for energy drinks',
  'How does order tracking work?',
]

const ADMIN_SUGGESTIONS = [
  'What warehouses do we have?',
  'Show low stock SKUs',
  'Search for Acme customer',
  'How does wave picking work?',
]

const RESERVED_ROUTE_IDS = new Set(['new', 'confirmation', 'edit', 'create'])

function routeEntityId(pathname: string, pattern: RegExp): string | undefined {
  const match = pathname.match(pattern)
  const id = match?.[1]
  if (!id || RESERVED_ROUTE_IDS.has(id)) return undefined
  return id
}

export function CelestialChat({
  surface,
  variant = 'floating',
}: {
  surface: CelestialSurface
  variant?: 'floating' | 'page'
}) {
  const location = useLocation()
  const api = surface === 'admin' ? adminApi : shopApi
  const gatewayBase = surface === 'admin' ? adminGateway : shopGateway
  const loginPath = surface === 'admin' ? '/admin/login' : '/login'
  const isPage = variant === 'page'

  const messages = useCelestialStore((s) => s[surface].messages)
  const conversationId = useCelestialStore((s) => s[surface].conversationId)
  const floatingOpen = useCelestialStore((s) => s[surface].floatingOpen)
  const providerInfo = useCelestialStore((s) => s[surface].providerInfo)
  const setFloatingOpen = useCelestialStore((s) => s.setFloatingOpen)
  const setProviderInfo = useCelestialStore((s) => s.setProviderInfo)
  const setConversationId = useCelestialStore((s) => s.setConversationId)
  const setMessages = useCelestialStore((s) => s.setMessages)
  const updateMessage = useCelestialStore((s) => s.updateMessage)
  const clearChat = useCelestialStore((s) => s.clearChat)
  const skipHistoryRestore = useCelestialStore((s) => s[surface].skipHistoryRestore)
  const setSkipHistoryRestore = useCelestialStore((s) => s.setSkipHistoryRestore)

  const open = isPage || floatingOpen
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [hasToken, setHasToken] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  useEffect(() => {
    const refreshAuth = () =>
      setHasToken(Boolean(typeof window !== 'undefined' && window.localStorage.getItem('pleros.accessToken')))
    refreshAuth()
    window.addEventListener('storage', refreshAuth)
    return () => window.removeEventListener('storage', refreshAuth)
  }, [])

  useEffect(() => {
    if (surface === 'shop' && !hasToken) {
      setEnabled(null)
      return
    }
    void api
      .get<{ enabled?: boolean }>('/celestial/status')
      .then((s) => setEnabled(s.enabled !== false))
      .catch(() => setEnabled(null))
  }, [api, surface, hasToken])

  useEffect(() => {
    if (!open || (surface === 'shop' && !hasToken)) return
    void api
      .get<{ provider: string; model: string; configured: boolean }>('/celestial/status')
      .then((s) =>
        setProviderInfo(surface, `${s.provider} · ${s.model}${s.configured ? '' : ' · demo mode'}`),
      )
      .catch(() => setProviderInfo(surface, null))
  }, [open, api, surface, setProviderInfo, hasToken])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!open || enabled === false || (surface === 'shop' && !hasToken)) return
    if (messages.length > 0 || skipHistoryRestore) return

    const loadHistory = async () => {
      try {
        const list = await api.get<{ items: Array<{ id: string }> }>(
          `/celestial/conversations?surface=${surface}&limit=5`,
        )
        const targetId = conversationId ?? list.items[0]?.id
        if (!targetId) return

        const detail = await api.get<{
          id: string
          messages: Array<{
            id: string
            role: 'user' | 'assistant'
            content: string
            links?: Array<{ label: string; href: string }>
            meta?: string
          }>
        }>(`/celestial/conversations/${targetId}`)

        if (detail.messages.length === 0) return

        setConversationId(surface, detail.id)
        setMessages(
          surface,
          detail.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            links: m.links,
            meta: m.meta,
          })),
        )
      } catch {
        // keep local-only state
      }
    }

    void loadHistory()
  }, [
    open,
    enabled,
    hasToken,
    surface,
    messages.length,
    skipHistoryRestore,
    conversationId,
    api,
    setConversationId,
    setMessages,
  ])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setBusy(true)
      setErr(null)
      setInput('')
      setSkipHistoryRestore(surface, false)

      const userId = `${Date.now()}-u`
      const assistantId = `${Date.now()}-a`
      setMessages(surface, (m) => [
        ...m,
        { id: userId, role: 'user', content: trimmed },
        { id: assistantId, role: 'assistant', content: '' },
      ])

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const orderId = routeEntityId(location.pathname, /\/orders\/([^/]+)/)
      const quoteId = routeEntityId(location.pathname, /\/quotes\/([^/]+)/)

      const runStream = async (activeConversationId?: string) => {
        await streamCelestialChat(
          gatewayBase,
          loginPath,
          {
            message: trimmed,
            conversationId: activeConversationId,
            surface,
            context: {
              page: location.pathname,
              orderId,
              quoteId,
            },
          },
          {
            onDelta: (chunk) => {
              setMessages(surface, (m) =>
                m.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: msg.content + chunk } : msg,
                ),
              )
            },
            onDone: (payload) => {
              setConversationId(surface, payload.conversationId)
              updateMessage(surface, assistantId, {
                links: payload.links,
                meta: `${payload.provider}/${payload.model}${payload.toolsUsed.length ? ` · ${payload.toolsUsed.join(', ')}` : ''}`,
              })
            },
            onError: (message) => setErr(message),
          },
          controller.signal,
        )
      }

      try {
        try {
          await runStream(conversationId)
        } catch (retryErr) {
          const retryMsg = axiosErr(retryErr)
          if (conversationId && /conversation not found/i.test(retryMsg)) {
            setConversationId(surface, undefined)
            await runStream(undefined)
            return
          }
          throw retryErr
        }
      } catch (e) {
        if (controller.signal.aborted) return
        setErr(axiosErr(e))
        setMessages(surface, (m) => m.filter((msg) => msg.id !== assistantId))
      } finally {
        setBusy(false)
      }
    },
    [
      busy,
      conversationId,
      gatewayBase,
      location.pathname,
      loginPath,
      setConversationId,
      setMessages,
      setSkipHistoryRestore,
      surface,
      updateMessage,
    ],
  )

  const suggestions = surface === 'shop' ? BUYER_SUGGESTIONS : ADMIN_SUGGESTIONS

  if (surface === 'shop' && !hasToken) return null
  if (enabled === false) {
    if (isPage) {
      return (
        <div className="celestial-page">
          <div className="pleros-card p-8 text-center">
            <h2 className="text-lg font-semibold mb-2">Celestial is not enabled</h2>
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
              Enable the Celestial AI feature in Settings → Features, or upgrade your plan.
            </p>
          </div>
        </div>
      )
    }
    return null
  }

  if (!isPage && !open) {
    return (
      <button
        type="button"
        className="celestial-fab"
        aria-label="Open Celestial assistant"
        onClick={() => setFloatingOpen(surface, true)}
      >
        <span aria-hidden>✦</span>
        <span className="celestial-fab-label">Celestial</span>
        {messages.length > 0 ? <span className="celestial-fab-dot" aria-hidden /> : null}
      </button>
    )
  }

  const panel = (
    <div
      className={`celestial-panel pleros-card${isPage ? ' celestial-panel--page' : ''}`}
      role={isPage ? 'main' : 'dialog'}
      aria-label="Celestial assistant"
    >
      <div className="celestial-panel-header">
        <div className="celestial-panel-header-main">
          {!isPage ? <h2 className="celestial-panel-title">Celestial</h2> : null}
          <p className="celestial-panel-sub">
            {isPage ? 'Pleros AI copilot' : surface === 'shop' ? 'Buyer assistant' : 'Admin copilot'}
            {providerInfo ? (
              <span className="celestial-provider-badge">{providerInfo}</span>
            ) : null}
          </p>
        </div>
        <div className="celestial-panel-actions">
          {messages.length > 0 ? (
            <button
              type="button"
              className="btn-ghost !py-1 !px-2 !text-xs"
              onClick={() => {
                abortRef.current?.abort()
                clearChat(surface)
                setErr(null)
              }}
            >
              New chat
            </button>
          ) : null}
          {!isPage ? (
            <button type="button" className="btn-ghost !py-1 !px-2" onClick={() => setFloatingOpen(surface, false)}>
              Close
            </button>
          ) : null}
        </div>
      </div>

      <div className="celestial-messages">
        {messages.length === 0 ? (
          <div className="celestial-empty">
            <div className="celestial-empty-icon" aria-hidden>
              ✦
            </div>
            <h3 className="celestial-empty-title">How can I help?</h3>
            <p className="celestial-empty-text">
              {isPage
                ? 'Ask how Pleros works, or about your orders, stock, and invoices.'
                : 'Ask how Pleros works, or look up orders, inventory, warehouses, and finance.'}
            </p>
            <div className="celestial-suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" className="celestial-suggestion-chip" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`celestial-msg celestial-msg--${m.role}`}>
            {m.role === 'assistant' ? (
              <>
                {m.content ? <CelestialMarkdown content={m.content} /> : busy ? <p className="celestial-meta">Thinking…</p> : null}
                {busy && m.id === messages[messages.length - 1]?.id && m.content ? (
                  <span className="celestial-stream-cursor" aria-hidden />
                ) : null}
              </>
            ) : (
              <p className="celestial-user-text">{m.content}</p>
            )}
            {m.links && m.links.length > 0 ? (
              <div className="celestial-links">
                {m.links.map((l) => (
                  <Link key={`${l.href}-${l.label}`} to={l.href} className="celestial-link-chip">
                    {l.label} →
                  </Link>
                ))}
              </div>
            ) : null}
            {m.meta ? <p className="celestial-meta">{m.meta}</p> : null}
          </div>
        ))}
        {err ? <p className="celestial-error">{err}</p> : null}
        <div ref={bottomRef} />
      </div>

      <form
        className="celestial-input-row"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <input
          className="pleros-input celestial-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Celestial…"
          disabled={busy}
        />
        <button type="submit" className="btn-primary celestial-send" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )

  if (isPage) {
    return <div className="celestial-page">{panel}</div>
  }

  return (
    <>
      <button
        type="button"
        className="celestial-fab"
        aria-label="Close Celestial"
        onClick={() => setFloatingOpen(surface, false)}
      >
        <span aria-hidden>✕</span>
        <span className="celestial-fab-label">Celestial</span>
      </button>
      {panel}
    </>
  )
}
