export const fmt = (n: number, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString('zh-TW', { maximumFractionDigits: digits }) : '—'

export const pct = (share: number) => `${(share * 100).toFixed(2)}%`
