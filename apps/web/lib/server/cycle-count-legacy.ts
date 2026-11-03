/**
 * Review classification of stock postings that cycle-count approvals made before ticket 49 (no idempotency key).
 * Pure: used by scripts/cycle-count-legacy-postings-report.ts, which only reads. Nothing here marks a line as
 * posted or changes stock; a finding is a suggestion for a person to check, not proof that the line was posted.
 */

export type LegacyCount = {
  id: string
  tenantId: string
  warehouseId: string
  status: string
  submittedAt: Date | null
}

export type LegacyLine = {
  id: string
  skuId: string
  systemQty: number
  countedQty: number | null
  postedLedgerId: string | null
}

export type LegacyEntry = {
  id: string
  tenantId: string
  skuId: string
  warehouseId: string
  batchId: string | null
  quantityDelta: number
  correlationId: string
  occurredAt: Date
}

export type LegacyClassification = 'NO_HISTORICAL_POSTINGS' | 'POTENTIALLY_RECOVERABLE' | 'AMBIGUOUS' | 'POSSIBLE_DUPLICATE'

export type EntryFinding = {
  entryId: string
  skuId: string
  warehouseId: string
  batchId: string
  quantityDelta: number
  occurredAt: string
  correlationId: string
  /** A person already accepted this entry by recording it as the posting of this line. */
  recordedOnLineId: string | null
  /** The line this entry is the only candidate for, when every check passed. */
  candidateLineId: string | null
  problems: string[]
}

export type CountFinding = {
  countId: string
  tenantId: string | null
  status: string | null
  /** Over the entries nobody has reviewed yet; NO_HISTORICAL_POSTINGS when there are none. */
  classification: LegacyClassification
  /** Separate approval attempts that posted (each attempt shared one correlation id). */
  attempts: number
  unreviewed: number
  entries: EntryFinding[]
  problems: string[]
}

const expectedDelta = (l: LegacyLine) => (l.countedQty == null ? 0 : l.countedQty - l.systemQty)

/**
 * One count's legacy entries against its lines. An entry is a recovery candidate only when nothing could make it
 * belong elsewhere: among the entries and lines not yet reviewed, the count has a single line for the SKU and a
 * single entry for it, and the entry is in the count's tenant and warehouse, unbatched, for exactly the line's
 * variance, and posted after the count was submitted. Entries a line already records are reviewed and only listed.
 */
export function classifyLegacyPostings(count: LegacyCount | null, lines: LegacyLine[], entries: LegacyEntry[], countId: string): CountFinding {
  const base = { countId, tenantId: count?.tenantId ?? entries[0]?.tenantId ?? null, status: count?.status ?? null }
  const lineByRecorded = new Map(lines.filter((l) => l.postedLedgerId).map((l) => [l.postedLedgerId!, l]))
  const open = entries.filter((e) => !lineByRecorded.has(e.id))
  const openLines = lines.filter((l) => !l.postedLedgerId)

  const problems: string[] = []
  if (open.length > 0 && !count) problems.push('no cycle count with this id exists in WMS')
  if (open.length > 0 && count && !count.submittedAt) problems.push('the count has no submission time to compare postings with')

  const linesBySku = new Map<string, LegacyLine[]>()
  for (const l of openLines) linesBySku.set(l.skuId, [...(linesBySku.get(l.skuId) ?? []), l])
  const entriesBySku = new Map<string, LegacyEntry[]>()
  for (const e of open) entriesBySku.set(e.skuId, [...(entriesBySku.get(e.skuId) ?? []), e])
  const allLinesForSku = (skuId: string) => lines.filter((l) => l.skuId === skuId).length

  let duplicate = false
  const found: EntryFinding[] = entries.map((e) => {
    const shared = {
      entryId: e.id,
      skuId: e.skuId,
      warehouseId: e.warehouseId,
      batchId: e.batchId ?? '',
      quantityDelta: e.quantityDelta,
      occurredAt: e.occurredAt.toISOString(),
      correlationId: e.correlationId,
    }
    const reviewedLine = lineByRecorded.get(e.id)
    if (reviewedLine) return { ...shared, recordedOnLineId: reviewedLine.id, candidateLineId: null, problems: [] }

    const p: string[] = []
    const skuLines = linesBySku.get(e.skuId) ?? []
    const skuEntries = entriesBySku.get(e.skuId) ?? []
    if (count && e.tenantId !== count.tenantId) p.push('posted in a different tenant than the count')
    if (count && e.warehouseId !== count.warehouseId) p.push("posted in a different warehouse than the count's")
    if ((e.batchId ?? '') !== '') p.push('posted to a batch; cycle counts post unbatched stock')
    if (allLinesForSku(e.skuId) === 0) p.push('the count has no line for this SKU')
    else if (skuLines.length === 0) p.push("every line for this SKU already records a posting")
    if (allLinesForSku(e.skuId) > 1) p.push('the count has more than one line for this SKU')
    if (skuEntries.length > skuLines.length && allLinesForSku(e.skuId) > 0) {
      duplicate = true
      p.push(`${skuEntries.length} unreviewed posting(s) for this SKU but ${skuLines.length} unrecorded line(s): possibly posted more than once`)
    } else if (skuEntries.length > 1) {
      p.push('more than one posting for this SKU')
    }
    const line = skuLines.length === 1 ? skuLines[0]! : null
    if (line && e.quantityDelta !== expectedDelta(line)) p.push(`delta ${e.quantityDelta} differs from the line's variance ${expectedDelta(line)}`)
    if (count?.submittedAt && e.occurredAt < count.submittedAt) p.push('posted before the count was submitted')
    return { ...shared, recordedOnLineId: null, candidateLineId: p.length === 0 && problems.length === 0 && line ? line.id : null, problems: p }
  })

  const openFindings = found.filter((f) => !f.recordedOnLineId)
  const classification: LegacyClassification =
    open.length === 0
      ? 'NO_HISTORICAL_POSTINGS'
      : duplicate
        ? 'POSSIBLE_DUPLICATE'
        : problems.length > 0 || openFindings.some((f) => f.problems.length > 0)
          ? 'AMBIGUOUS'
          : 'POTENTIALLY_RECOVERABLE'
  return {
    ...base,
    classification,
    attempts: new Set(entries.map((e) => e.correlationId)).size,
    unreviewed: open.length,
    entries: found,
    problems,
  }
}
