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

// The file sits in the user's Drive and may have been edited by hand, so check it before use.
// Throws instead of guessing, so a broken file is never silently overwritten.
export function parseWealthData(raw: unknown): WealthData {
  const fail = (why: string): never => {
    throw new Error(`Drive 中的資料檔格式不正確：${why}。請修正或刪除該檔案後重新登入。`)
  }
  if (typeof raw !== 'object' || raw === null) fail('不是 JSON 物件')
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) fail(`不支援的版本 ${String(obj.version)}`)
  if (!Array.isArray(obj.assets)) fail('缺少 assets 陣列')
  const assets = (obj.assets as unknown[]).map((item, i): Asset => {
    const a = (typeof item === 'object' && item !== null ? item : fail(`第 ${i + 1} 筆資產不是物件`)) as Record<string, unknown>
    if (typeof a.name !== 'string' || !a.name.trim()) fail(`第 ${i + 1} 筆資產缺少名稱`)
    if (typeof a.amount !== 'number' || !Number.isFinite(a.amount)) fail(`第 ${i + 1} 筆資產的金額不是數字`)
    return {
      id: typeof a.id === 'string' && a.id ? a.id : crypto.randomUUID(),
      name: a.name as string,
      category: ASSET_CATEGORIES.includes(a.category as AssetCategory) ? (a.category as AssetCategory) : '其他',
      currency: typeof a.currency === 'string' && a.currency.trim() ? a.currency.trim().toUpperCase() : 'TWD',
      amount: a.amount as number,
    }
  })
  return {
    version: 1,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
    assets,
  }
}
