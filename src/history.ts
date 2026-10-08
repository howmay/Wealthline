// History kept inside the data file: every edit to a balance or holding, and one
// value snapshot per day, so the user can see how their assets change over time.

import { accountBaseValue, baseValue, type Account, type Position, type WealthData } from './model'

export interface PositionState {
  quantity: number
  price: number
}

// One balance or holding as it was before and after a save.
export interface Change {
  at: string
  accountId: string
  account: string // the account's name at the time
  type: 'cash' | 'holding'
  symbol: string // ticker, or the currency code for a balance
  currency: string
  before: PositionState | null // null when it was added
  after: PositionState | null // null when it was removed
}

// Base-currency values on one day; a later save that day replaces it.
export interface Snapshot {
  date: string // local YYYY-MM-DD
  at: string
  total: number
  accounts: { id: string; name: string; value: number }[]
  categories: Record<string, number>
}

export interface History {
  changes: Change[]
  snapshots: Snapshot[]
}

export const emptyHistory = (): History => ({ changes: [], snapshots: [] })

export function localDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Positions are matched by what they are (a currency balance or a ticker), not by id,
// so re-importing a spreadsheet does not read as removing and re-adding everything.
const keyOf = (p: Position) => `${p.type}:${p.type === 'cash' ? p.currency : p.symbol.toUpperCase()}`

function states(a: Account | undefined): Map<string, { p: Position; s: PositionState }> {
  const m = new Map<string, { p: Position; s: PositionState }>()
  for (const p of a?.positions ?? []) {
    const k = keyOf(p)
    const prev = m.get(k)
    m.set(k, { p, s: { quantity: (prev?.s.quantity ?? 0) + p.quantity, price: p.price } })
  }
  return m
}

// What the user changed between two saved versions. Prices that moved with the market
// are not edits (the daily snapshot captures them); a price typed by hand is.
export function diffPositions(prev: WealthData, next: WealthData, at: string): Change[] {
  const changes: Change[] = []
  const ids = new Set([...prev.accounts.map((a) => a.id), ...next.accounts.map((a) => a.id)])
  for (const id of ids) {
    const pa = prev.accounts.find((a) => a.id === id)
    const na = next.accounts.find((a) => a.id === id)
    const before = states(pa)
    const after = states(na)
    for (const k of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(k)
      const n = after.get(k)
      const p = (n ?? b)!.p
      const edited =
        !b || !n || b.s.quantity !== n.s.quantity || (p.type === 'holding' && n.p.priceManual && b.s.price !== n.s.price)
      if (!edited) continue
      changes.push({
        at,
        accountId: id,
        account: (na ?? pa)!.name,
        type: p.type,
        symbol: p.type === 'cash' ? p.currency : p.symbol,
        currency: p.currency,
        before: b?.s ?? null,
        after: n?.s ?? null,
      })
    }
  }
  return changes
}

export function snapshotOf(data: WealthData, at: string): Snapshot {
  const categories: Record<string, number> = {}
  for (const a of data.accounts) {
    for (const p of a.positions) {
      const v = baseValue(data, p)
      if (Number.isFinite(v)) categories[a.category] = (categories[a.category] ?? 0) + v
    }
  }
  const accounts = data.accounts.map((a) => ({ id: a.id, name: a.name, value: accountBaseValue(data, a) }))
  return { date: localDate(at), at, total: accounts.reduce((s, a) => s + a.value, 0), accounts, categories }
}

function upsert(snapshots: Snapshot[], s: Snapshot): Snapshot[] {
  return [...snapshots.filter((x) => x.date !== s.date), s].sort((x, y) => x.date.localeCompare(y.date))
}

// Adds this save to the history: the edits since the last saved version, and today's snapshot.
// `saved` is the version currently in Drive (null before the first save).
export function recordSave(saved: WealthData | null, next: WealthData): WealthData {
  const at = next.updatedAt
  let snapshots = next.history.snapshots
  // Files saved before history existed: keep their last state as the starting point.
  if (saved && saved.accounts.length && snapshots.length === 0 && localDate(saved.updatedAt) !== localDate(at)) {
    snapshots = [snapshotOf(saved, saved.updatedAt)]
  }
  const changes = diffPositions(saved ?? { ...next, accounts: [] }, next, at)
  return {
    ...next,
    history: {
      changes: [...next.history.changes, ...changes],
      snapshots: next.accounts.length ? upsert(snapshots, snapshotOf(next, at)) : snapshots,
    },
  }
}

// Read side of parseWealthData: an absent history is fine, a malformed one is not.
export function parseHistory(raw: unknown, fail: (why: string) => never): History {
  if (raw === undefined) return emptyHistory()
  const h = (typeof raw === 'object' && raw !== null ? raw : fail('history 不是物件')) as Record<string, unknown>
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const isStr = (v: unknown): v is string => typeof v === 'string'
  const state = (v: unknown, where: string): PositionState | null => {
    if (v === null) return null
    const s = v as Record<string, unknown>
    if (typeof v !== 'object' || !isNum(s.quantity) || !isNum(s.price)) fail(`${where}格式不正確`)
    return { quantity: s.quantity as number, price: s.price as number }
  }
  const changes = (Array.isArray(h.changes) ? h.changes : []).map((item: unknown, i): Change => {
    const where = `第 ${i + 1} 筆異動紀錄`
    const c = (typeof item === 'object' && item !== null ? item : fail(`${where}不是物件`)) as Record<string, unknown>
    if (!isStr(c.at) || !isStr(c.accountId) || !isStr(c.symbol)) fail(`${where}缺少欄位`)
    return {
      at: c.at as string,
      accountId: c.accountId as string,
      account: isStr(c.account) ? c.account : '',
      type: c.type === 'holding' ? 'holding' : 'cash',
      symbol: c.symbol as string,
      currency: isStr(c.currency) ? c.currency : '',
      before: state(c.before ?? null, `${where}的 before `),
      after: state(c.after ?? null, `${where}的 after `),
    }
  })
  const snapshots = (Array.isArray(h.snapshots) ? h.snapshots : []).map((item: unknown, i): Snapshot => {
    const where = `第 ${i + 1} 筆每日紀錄`
    const s = (typeof item === 'object' && item !== null ? item : fail(`${where}不是物件`)) as Record<string, unknown>
    if (!isStr(s.date) || !isNum(s.total) || !Array.isArray(s.accounts)) fail(`${where}缺少欄位`)
    const categories: Record<string, number> = {}
    if (typeof s.categories === 'object' && s.categories !== null) {
      for (const [k, v] of Object.entries(s.categories)) if (isNum(v)) categories[k] = v
    }
    return {
      date: s.date as string,
      at: isStr(s.at) ? s.at : (s.date as string),
      total: s.total as number,
      accounts: (s.accounts as unknown[]).map((a) => {
        const r = a as Record<string, unknown>
        if (typeof a !== 'object' || a === null || !isStr(r.id) || !isNum(r.value)) fail(`${where}的帳戶格式不正確`)
        return { id: r.id as string, name: isStr(r.name) ? r.name : '', value: r.value as number }
      }),
      categories,
    }
  })
  return { changes, snapshots: snapshots.sort((x, y) => x.date.localeCompare(y.date)) }
}
