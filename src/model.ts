// Shape of the JSON file stored in the user's Drive. Bump `version` on breaking changes.

export const ASSET_CATEGORIES = ['現金', '股票', '基金', '加密貨幣', '不動產', '其他'] as const
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export interface Asset {
  id: string
  name: string
  category: AssetCategory
  currency: string
  amount: number
}

export interface WealthData {
  version: 1
  updatedAt: string
  assets: Asset[]
}

export function emptyData(): WealthData {
  return { version: 1, updatedAt: new Date().toISOString(), assets: [] }
}

// Totals per currency, then per category within each currency.
export function totalsByCurrency(assets: Asset[]): Map<string, { total: number; byCategory: Map<AssetCategory, number> }> {
  const out = new Map<string, { total: number; byCategory: Map<AssetCategory, number> }>()
  for (const a of assets) {
    const entry = out.get(a.currency) ?? { total: 0, byCategory: new Map() }
    entry.total += a.amount
    entry.byCategory.set(a.category, (entry.byCategory.get(a.category) ?? 0) + a.amount)
    out.set(a.currency, entry)
  }
  return out
}
