import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

type DocChunk = { id: string; heading: string; body: string; source?: string }

let cachedChunks: DocChunk[] | null = null

const MAX_CHUNK_BODY = 2400

/** Maps query terms to related keywords for better RAG matching */
const SYNONYMS: Record<string, string[]> = {
  pos: ['point of sale', 'register', 'checkout', 'retail', 'walk-in'],
  warehouse: ['wms', 'distribution center', 'dc', 'fulfillment center', 'location', 'bin'],
  order: ['sales order', 'shipment', 'fulfillment', 'pending', 'tracking'],
  invoice: ['ar', 'accounts receivable', 'bill', 'balance', 'payment due'],
  finance: ['gl', 'ledger', 'trial balance', 'ap', 'ar', 'cogs'],
  catalog: ['sku', 'product', 'inventory', 'stock', 'item'],
  buyer: ['b2b', 'shop', 'storefront', 'portal', 'customer'],
  quote: ['counter-offer', 'pricing', 'approval'],
  return: ['rma', 'credit memo', 'refund'],
  dispatch: ['delivery', 'driver', 'route', 'pod', 'proof of delivery'],
  compliance: ['msa', 'manufacturer', 'tax', 'regulated'],
  celestial: ['ai', 'assistant', 'chat', 'copilot', 'llm'],
  mobile: ['pwa', 'warehouse app', 'delivery app', 'sales app', 'field'],
  picking: ['pick', 'wave', 'bin location', 'pick path', 'fulfillment'],
  purchasing: ['po', 'purchase order', 'supplier', 'vendor', 'receive'],
  crm: ['customer', 'lead', 'activity', 'contract pricing'],
}

function repoRoots(): string[] {
  const cwd = process.cwd()
  return [cwd, path.resolve(cwd, '../..'), path.resolve(cwd, '../../..')]
}

function resolveDocFiles(): string[] {
  const files: string[] = []
  const seen = new Set<string>()

  for (const root of repoRoots()) {
    const celestialDir = path.join(root, 'docs/celestial')
    if (existsSync(celestialDir)) {
      for (const name of readdirSync(celestialDir).filter((f) => f.endsWith('.md')).sort()) {
        const full = path.join(celestialDir, name)
        if (!seen.has(full)) {
          seen.add(full)
          files.push(full)
        }
      }
    }

    const platform = path.join(root, 'PLATFORM_FEATURES.md')
    if (existsSync(platform) && !seen.has(platform)) {
      seen.add(platform)
      files.push(platform)
    }
  }

  return files
}

function parseMarkdownFile(filePath: string, raw: string): DocChunk[] {
  const source = path.basename(filePath)
  const chunks: DocChunk[] = []

  const sections = raw.split(/^## /m)
  const preamble = sections[0]?.trim()
  if (preamble && sections.length === 1) {
    chunks.push({
      id: `${source}-overview`,
      heading: path.basename(filePath, '.md'),
      body: preamble.slice(0, MAX_CHUNK_BODY),
      source,
    })
    return chunks
  }

  for (const section of sections.slice(1)) {
    const nl = section.indexOf('\n')
    const parentHeading = nl === -1 ? section.trim() : section.slice(0, nl).trim()
    const rest = nl === -1 ? '' : section.slice(nl + 1)

    const subsections = rest.split(/^### /m)
    const parentBody = subsections[0]?.trim()

    if (subsections.length === 1) {
      const body = parentBody.slice(0, MAX_CHUNK_BODY)
      if (parentHeading && body) {
        chunks.push({
          id: slug(`${source}-${parentHeading}`),
          heading: parentHeading,
          body,
          source,
        })
      }
      continue
    }

    if (parentBody) {
      chunks.push({
        id: slug(`${source}-${parentHeading}-intro`),
        heading: parentHeading,
        body: parentBody.slice(0, MAX_CHUNK_BODY),
        source,
      })
    }

    for (const sub of subsections.slice(1)) {
      const subNl = sub.indexOf('\n')
      const subHeading = subNl === -1 ? sub.trim() : sub.slice(0, subNl).trim()
      const subBody = (subNl === -1 ? '' : sub.slice(subNl + 1)).trim().slice(0, MAX_CHUNK_BODY)
      if (subHeading && subBody) {
        chunks.push({
          id: slug(`${source}-${parentHeading}-${subHeading}`),
          heading: `${parentHeading} — ${subHeading}`,
          body: subBody,
          source,
        })
      }
    }
  }

  return chunks
}

function slug(text: string): string {
  return text.toLowerCase().replace(/\W+/g, '-').replace(/-+/g, '-').slice(0, 80)
}

function loadDocChunks(): DocChunk[] {
  if (cachedChunks) return cachedChunks

  const files = resolveDocFiles()
  if (files.length === 0) {
    cachedChunks = [
      {
        id: 'fallback',
        heading: 'Cosmos',
        body: 'Cosmos is a wholesale ERP with catalog, orders, invoices, quotes, warehouse, finance, POS, and Celestial AI assistant.',
        source: 'fallback',
      },
    ]
    return cachedChunks
  }

  const chunks: DocChunk[] = []
  for (const file of files) {
    try {
      const raw = readFileSync(file, 'utf8')
      chunks.push(...parseMarkdownFile(file, raw))
    } catch {
      // skip unreadable files
    }
  }

  cachedChunks =
    chunks.length > 0
      ? chunks
      : [
          {
            id: 'fallback',
            heading: 'Cosmos',
            body: 'Cosmos is a wholesale ERP with catalog, orders, invoices, quotes, warehouse, and finance modules.',
            source: 'fallback',
          },
        ]
  return cachedChunks
}

function expandQueryTerms(query: string): string[] {
  const lower = query.toLowerCase()
  const terms = new Set(lower.split(/\s+/).filter((t) => t.length > 2))

  for (const [key, synonyms] of Object.entries(SYNONYMS)) {
    if (lower.includes(key) || synonyms.some((s) => lower.includes(s))) {
      terms.add(key)
      for (const s of synonyms) terms.add(s.split(/\s+/)[0]!)
    }
  }

  return [...terms]
}

const TECHNICAL_DOC_PATTERN =
  /\b(npm run|localhost:\d+|apps\/|prisma|schema\.prisma|monorepo|express|vite|sqlite|native-router|\.ts\b|```)/i

function scoreChunk(query: string, chunk: DocChunk, plainLanguage = false): number {
  const terms = expandQueryTerms(query)
  let score = 0
  const hay = `${chunk.heading}\n${chunk.body}`.toLowerCase()

  for (const term of terms) {
    if (term.length < 3) continue
    if (hay.includes(term)) score += 1
    if (chunk.heading.toLowerCase().includes(term)) score += 2
  }

  for (const acronym of ['pos', 'wms', 'crm', 'erp', 'msa', 'ap', 'ar', 'gl', 'edi', 'rma', 'b2b', 'pwa', 'cogs']) {
    if (query.toLowerCase().includes(acronym) && hay.includes(acronym)) score += 4
  }

  const q = query.toLowerCase()
  if (hay.includes(q)) score += 5

  if (/\bhow\b/.test(q) && /\bhow\b/.test(hay)) score += 2
  if (/\bfaq\b/.test(q) && chunk.source?.includes('faq')) score += 3

  if (plainLanguage) {
    if (/plain language|simple overview|end-to-end story/i.test(chunk.heading)) score += 20
    if (TECHNICAL_DOC_PATTERN.test(chunk.body)) score -= 6
    if (/architecture|tech stack|local development|data model/i.test(chunk.heading)) score -= 4
    if (/how it works/i.test(chunk.heading) && !TECHNICAL_DOC_PATTERN.test(chunk.body.slice(0, 400))) score += 5
  }

  return score
}

export function retrievePlatformDocs(query: string, limit = 6, plainLanguage = false): DocChunk[] {
  const chunks = loadDocChunks()
  const scored = [...chunks]
    .map((c) => ({ c, score: scoreChunk(query, c, plainLanguage) }))
    .sort((a, b) => b.score - a.score)

  const matched = scored.filter((x) => x.score > 0).slice(0, limit).map((x) => x.c)
  if (matched.length >= 2) return matched

  const fallback = scored
    .filter((x) =>
      /pos|warehouse|order|finance|celestial|faq|glossary|overview|module|buyer|mobile|api/i.test(
        `${x.c.heading} ${x.c.body}`,
      ),
    )
    .slice(0, limit)
    .map((x) => x.c)

  const combined: DocChunk[] = [...matched]
  for (const chunk of fallback) {
    if (combined.length >= limit) break
    if (!combined.some((c) => c.id === chunk.id)) combined.push(chunk)
  }
  if (combined.length > 0) return combined.slice(0, limit)

  return chunks.slice(0, Math.min(limit, chunks.length))
}

export function formatDocContext(chunks: DocChunk[]): string {
  if (chunks.length === 0) return '(No matching platform documentation found.)'
  return chunks.map((c) => `### ${c.heading}\n${c.body}`).join('\n\n')
}

/** Test helper */
export function clearRetrievalCache() {
  cachedChunks = null
}

/** Test helper — chunk count after load */
export function getDocChunkCount(): number {
  return loadDocChunks().length
}

export type { DocChunk }
