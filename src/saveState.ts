import type { WealthData } from './model'

// Only merge metadata produced by this save. All edits made after submission win.
export function finishSave(current: WealthData, submitted: WealthData, persisted: WealthData): WealthData {
  if (current === submitted) return persisted
  const stamps = new Map(persisted.accounts.flatMap((a) => a.positions.map((p) => [p.id, p.addedAt])))
  return {
    ...current,
    version: current.version === 4 || persisted.version === 4 || current.liabilities?.some(d => d.schedule || d.basisHistory) ? 4 : current.version === 3 || current.history.quantityDays !== undefined ? 3 : persisted.version,
    liabilities: current.liabilities ?? [],
    updatedAt: persisted.updatedAt,
    history: current.history === submitted.history ? persisted.history :
      current.history.quantityDays !== submitted.history.quantityDays &&
      current.history.changes === submitted.history.changes &&
      current.history.snapshots === submitted.history.snapshots &&
      current.history.liabilityChanges === submitted.history.liabilityChanges
        ? { ...persisted.history, quantityDays: current.history.quantityDays }
        : current.history,
    accounts: current.accounts.map((a) => ({
      ...a,
      positions: a.positions.map((p) => p.addedAt || !stamps.has(p.id) ? p : { ...p, addedAt: stamps.get(p.id) }),
    })),
  }
}
