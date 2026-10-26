import { tenantDb } from './db'
import { runUnscoped } from './tenant-scope'

/**
 * Cleans up POS registers that share a name within a company (e.g. "Register 4" three times).
 * A register is never deleted: shifts, till sessions and sales point at it.
 *   - the first register of each name stays untouched (one that has been used wins over one that has not);
 *   - a duplicate nobody has used is deactivated, so it drops out of every list but can be reactivated;
 *   - a duplicate that has history is renamed "Name (2)", "Name (3)", ... so that history stays readable.
 */

export type RegisterRow = { id: string; tenantId: string; name: string; isActive: boolean; createdAt: Date }
export type DedupeAction =
  | { kind: 'deactivate'; id: string; tenantId: string; name: string }
  | { kind: 'rename'; id: string; tenantId: string; name: string; newName: string }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** Pure planning step: which registers to deactivate or rename. `usedIds` = registers with a shift or till session. */
export function planRegisterDedupe(registers: RegisterRow[], usedIds: Set<string>): DedupeAction[] {
  const actions: DedupeAction[] = []
  const byTenant = new Map<string, RegisterRow[]>()
  for (const r of registers) {
    if (!r.isActive) continue
    byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r])
  }
  for (const [tenantId, rows] of byTenant) {
    const taken = new Set(rows.map((r) => norm(r.name)))
    const groups = new Map<string, RegisterRow[]>()
    for (const r of rows) groups.set(norm(r.name), [...(groups.get(norm(r.name)) ?? []), r])
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const ordered = [...group].sort((a, b) => {
        const used = Number(usedIds.has(b.id)) - Number(usedIds.has(a.id))
        if (used !== 0) return used
        const time = a.createdAt.getTime() - b.createdAt.getTime()
        return time !== 0 ? time : a.id.localeCompare(b.id)
      })
      let suffix = 2
      for (const dup of ordered.slice(1)) {
        if (!usedIds.has(dup.id)) {
          actions.push({ kind: 'deactivate', id: dup.id, tenantId, name: dup.name })
          continue
        }
        let newName = `${dup.name.trim()} (${suffix})`
        while (taken.has(norm(newName))) newName = `${dup.name.trim()} (${++suffix})`
        taken.add(norm(newName))
        suffix++
        actions.push({ kind: 'rename', id: dup.id, tenantId, name: dup.name, newName })
      }
    }
  }
  return actions
}

/** Finds the duplicates and, with `apply`, fixes them. Without it nothing is written. Safe to re-run. */
export async function dedupePosRegisters(opts: { apply: boolean }): Promise<DedupeAction[]> {
  return runUnscoped('POS register duplicate cleanup (scripts/dedupe-pos-registers.ts)', async () => {
    const registers = await tenantDb.posRegister.findMany({
      where: { isActive: true },
      select: { id: true, tenantId: true, name: true, isActive: true, createdAt: true },
    })
    const [shiftRegs, tillRegs] = await Promise.all([
      tenantDb.shift.findMany({ distinct: ['registerId'], select: { registerId: true } }),
      tenantDb.tillSession.findMany({ distinct: ['registerId'], select: { registerId: true } }),
    ])
    const used = new Set([...shiftRegs, ...tillRegs].map((r) => r.registerId))
    const actions = planRegisterDedupe(registers, used)
    if (opts.apply) {
      for (const a of actions) {
        await tenantDb.posRegister.update({
          where: { id: a.id },
          data: a.kind === 'deactivate' ? { isActive: false } : { name: a.newName },
        })
      }
    }
    return actions
  })
}
