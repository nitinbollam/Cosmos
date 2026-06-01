import { Link, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api as shopApi } from '@/lib/api'
import { api as adminApi } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'

type ChatLink = { label: string; href: string }

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  links?: ChatLink[]
  meta?: string
}

type ChatResponse = {
  conversationId: string
  reply: string
  links: ChatLink[]
  toolsUsed: string[]
  provider: string
  model: string
}

const BUYER_SUGGESTIONS = [
  'Where are my recent orders?',
  'Do I have open invoices?',
  'Search catalog for energy drinks',
  'How does order tracking work?',
]

const ADMIN_SUGGESTIONS = [
  'Show low stock SKUs',
  'Search for Acme customer',
  'How does wave picking work?',
  'Explain AP 3-way match',
]

export function CelestialChat({ surface }: { surface: 'shop' | 'admin' }) {
  const location = useLocation()
  const api = surface === 'admin' ? adminApi : shopApi
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [providerInfo, setProviderInfo] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  useEffect(() => {
    if (!open) return
    void api
      .get<{ provider: string; model: string; configured: boolean }>('/celestial/status')
      .then((s) => setProviderInfo(`${s.provider} · ${s.model}${s.configured ? '' : ' (demo mode)'}`))
      .catch(() => setProviderInfo(null))
  }, [open])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setBusy(true)
      setErr(null)
      setInput('')
      setMessages((m) => [...m, { id: `${Date.now()}-u`, role: 'user', content: trimmed }])
      try {
        const orderMatch = location.pathname.match(/\/orders\/([^/]+)/)
        const quoteMatch = location.pathname.match(/\/quotes\/([^/]+)/)
        const res = await api.post<ChatResponse>('/celestial/chat', {
          message: trimmed,
          conversationId,
          surface,
          context: {
            page: location.pathname,
            orderId: orderMatch?.[1],
            quoteId: quoteMatch?.[1],
          },
        })
        setConversationId(res.conversationId)
        setMessages((m) => [
          ...m,
          {
            id: `${Date.now()}-a`,
            role: 'assistant',
            content: res.reply,
            links: res.links,
            meta: `${res.provider}/${res.model}${res.toolsUsed.length ? ` · ${res.toolsUsed.join(', ')}` : ''}`,
          },
        ])
      } catch (e) {
        setErr(axiosErr(e))
      } finally {
        setBusy(false)
      }
    },
    [busy, conversationId, location.pathname, surface, api],
  )

  const suggestions = surface === 'shop' ? BUYER_SUGGESTIONS : ADMIN_SUGGESTIONS

  return (
    <>
      <button
        type="button"
        className="celestial-fab"
        aria-label={open ? 'Close Celestial' : 'Open Celestial assistant'}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>{open ? '✕' : '✦'}</span>
        <span className="celestial-fab-label">Celestial</span>
      </button>

      {open ? (
        <div className="celestial-panel cosmos-card" role="dialog" aria-label="Celestial assistant">
          <div className="celestial-panel-header">
            <div>
              <h2 className="celestial-panel-title">Celestial</h2>
              <p className="celestial-panel-sub">
                Cosmos AI · {surface === 'shop' ? 'buyer assistant' : 'admin copilot'}
                {providerInfo ? ` · ${providerInfo}` : ''}
              </p>
            </div>
            <button type="button" className="btn-ghost !py-1 !px-2" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="celestial-messages">
            {messages.length === 0 ? (
              <div className="celestial-empty">
                <p>Ask about orders, invoices, catalog, quotes, or how Cosmos works.</p>
                <div className="celestial-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="btn-ghost !text-xs" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={`celestial-msg celestial-msg--${m.role}`}>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.content}</p>
                {m.links && m.links.length > 0 ? (
                  <div className="celestial-links">
                    {m.links.map((l) => (
                      <Link key={`${l.href}-${l.label}`} to={l.href} className="cosmos-shop-link-accent text-xs">
                        {l.label} →
                      </Link>
                    ))}
                  </div>
                ) : null}
                {m.meta ? <p className="celestial-meta">{m.meta}</p> : null}
              </div>
            ))}
            {busy ? <p className="celestial-meta">Celestial is thinking…</p> : null}
            {err ? <p style={{ color: 'var(--c-danger)', fontSize: 12 }}>{err}</p> : null}
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
              className="cosmos-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Celestial…"
              disabled={busy}
            />
            <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      ) : null}
    </>
  )
}
