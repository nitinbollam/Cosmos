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

  const open = isPage || floatingOpen
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  useEffect(() => {
    if (!open) return
    void api
      .get<{ provider: string; model: string; configured: boolean }>('/celestial/status')
      .then((s) =>
        setProviderInfo(surface, `${s.provider} · ${s.model}${s.configured ? '' : ' · demo mode'}`),
      )
      .catch(() => setProviderInfo(surface, null))
  }, [open, api, surface, setProviderInfo])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setBusy(true)
      setErr(null)
      setInput('')

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

      try {
        const orderMatch = location.pathname.match(/\/orders\/([^/]+)/)
        const quoteMatch = location.pathname.match(/\/quotes\/([^/]+)/)

        await streamCelestialChat(
          gatewayBase,
          loginPath,
          {
            message: trimmed,
            conversationId,
            surface,
            context: {
              page: location.pathname,
              orderId: orderMatch?.[1],
              quoteId: quoteMatch?.[1],
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
      surface,
      updateMessage,
    ],
  )

  const suggestions = surface === 'shop' ? BUYER_SUGGESTIONS : ADMIN_SUGGESTIONS

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
      className={`celestial-panel cosmos-card${isPage ? ' celestial-panel--page' : ''}`}
      role={isPage ? 'main' : 'dialog'}
      aria-label="Celestial assistant"
    >
      <div className="celestial-panel-header">
        <div className="celestial-panel-header-main">
          {!isPage ? <h2 className="celestial-panel-title">Celestial</h2> : null}
          <p className="celestial-panel-sub">
            {isPage ? 'Cosmos AI copilot' : surface === 'shop' ? 'Buyer assistant' : 'Admin copilot'}
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
                ? 'Ask about orders, inventory, warehouses, finance, or how Cosmos works.'
                : 'Ask about orders, invoices, catalog, quotes, or platform features.'}
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
          className="cosmos-input celestial-input"
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
