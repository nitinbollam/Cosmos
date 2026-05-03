import { BadRequestException } from '@nestjs/common'

export type PoLineForReceive = {
  id: string
  lineNo: number
  qtyOrdered: number
  qtyReceived: number
}

export function assertReceiveIncrementsValid(
  poLines: PoLineForReceive[],
  increments: { lineId: string; qtyReceived: number }[],
): void {
  const lineById = new Map(poLines.map((l) => [l.id, l]))
  for (const r of increments) {
    const line = lineById.get(r.lineId)
    if (!line) throw new BadRequestException(`Unknown line ${r.lineId}`)
    if (r.qtyReceived < 0) throw new BadRequestException('qtyReceived must be non-negative')
    const next = line.qtyReceived + r.qtyReceived
    if (next > line.qtyOrdered) {
      throw new BadRequestException(`Line ${line.lineNo} would exceed ordered quantity`)
    }
  }
}
