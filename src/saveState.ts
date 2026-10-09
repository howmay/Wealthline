import type { WealthData } from './model'

// Only merge metadata produced by this save. All edits made after submission win.
export function finishSave(current: WealthData, submitted: WealthData, persisted: WealthData): WealthData {
  if (current === submitted) return persisted
  const stamps = new Map(persisted.accounts.flatMap((a) => a.positions.map((p) => [p.id, p.addedAt])))
  return {
    ...current,
    version: persisted.version,
    liabilities: current.liabilities ?? [],
    updatedAt: persisted.updatedAt,
    history: current.history === submitted.history ? persisted.history : current.history,
    accounts: current.accounts.map((a) => ({
      ...a,
      positions: a.positions.map((p) => p.addedAt || !stamps.has(p.id) ? p : { ...p, addedAt: stamps.get(p.id) }),
    })),
  }
}
