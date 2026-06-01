import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

type DocChunk = { id: string; heading: string; body: string }

let cachedChunks: DocChunk[] | null = null

function loadDocChunks(): DocChunk[] {
  if (cachedChunks) return cachedChunks

  const candidates = [
    path.resolve(process.cwd(), 'PLATFORM_FEATURES.md'),
    path.resolve(process.cwd(), '../../PLATFORM_FEATURES.md'),
    path.resolve(process.cwd(), '../../../PLATFORM_FEATURES.md'),
  ]
  const file = candidates.find((p) => existsSync(p))
  if (!file) {
    cachedChunks = [
      {
        id: 'fallback',
        heading: 'Cosmos',
        body: 'Cosmos is a wholesale ERP with catalog, orders, invoices, quotes, warehouse, and finance modules.',
      },
    ]
    return cachedChunks
  }

  const raw = readFileSync(file, 'utf8')
  const chunks: DocChunk[] = []
  const sections = raw.split(/^## /m).slice(1)
  for (const section of sections) {
    const nl = section.indexOf('\n')
    const heading = nl === -1 ? section.trim() : section.slice(0, nl).trim()
    const body = (nl === -1 ? '' : section.slice(nl + 1)).trim().slice(0, 1800)
    if (heading && body) chunks.push({ id: heading.toLowerCase().replace(/\W+/g, '-'), heading, body })
  }
  cachedChunks = chunks.length > 0 ? chunks : [{ id: 'cosmos', heading: 'Cosmos', body: raw.slice(0, 2000) }]
  return cachedChunks
}

function scoreChunk(query: string, chunk: DocChunk): number {
  const q = query.toLowerCase()
  const terms = q.split(/\s+/).filter((t) => t.length > 2)
  let score = 0
  const hay = `${chunk.heading}\n${chunk.body}`.toLowerCase()
  for (const term of terms) {
    if (hay.includes(term)) score += 1
  }
  if (hay.includes(q)) score += 3
  return score
}

export function retrievePlatformDocs(query: string, limit = 4): DocChunk[] {
  const chunks = loadDocChunks()
  return [...chunks]
    .map((c) => ({ c, score: scoreChunk(query, c) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c)
}

export function formatDocContext(chunks: DocChunk[]): string {
  if (chunks.length === 0) return '(No matching platform documentation found.)'
  return chunks.map((c) => `### ${c.heading}\n${c.body}`).join('\n\n')
}

/** Test helper */
export function clearRetrievalCache() {
  cachedChunks = null
}
