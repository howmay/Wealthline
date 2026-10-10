import type { HistoricalPoint, QuantityDay } from '../quantityHistory'
import { entryValue } from '../quantityHistory'
import { fmt } from '../format'
import { accountLabel, type WealthData, CATEGORIES, COMMON_CURRENCIES, COUNTRIES, countryLabel, type Slice } from '../model'
import { colorize } from '../chartColors'
import { Allocation } from './charts'

const money = (value: number | null | undefined) => value == null ? '資料不完整' : `NT$ ${fmt(value, 0)}`
function slices(values: Record<string, number | null>): Slice[] | null {
  if (Object.values(values).some(v => v === null)) return null
  const total = Object.values(values).reduce<number>((sum, v) => sum + (v ?? 0), 0)
  return Object.entries(values).map(([label, v]) => ({ label, value: v!, share: total ? v! / total : 0 })).sort((a,b) => b.value-a.value)
}

export function SnapshotDetails({ point, day, accounts }: { point: HistoricalPoint; day?: QuantityDay; accounts: WealthData['accounts'] }) {
  const grouped = (key: 'currency' | 'country') => {
    if (!day || point.total === null) return null
    const values: Record<string, number | null> = Object.create(null)
    for (const entry of day.entries) {
      const label = key === 'country' ? countryLabel(entry.country) : entry.currency
      const value = entryValue(entry)
      values[label] = value === null || values[label] === null ? null : (values[label] ?? 0) + value
    }
    return slices(values)
  }
  const category = point.total === null ? null : slices(point.categories), currency = grouped('currency'), country = grouped('country')
  return <>
    <section className="panel hero" aria-label="快照總資產">
      <span className="eyebrow">{point.date.replaceAll('-', '/')} · {point.periodDerived ? '期間推算' : point.manual ? '補登快照' : '歷史快照'}</span>
      <div className="hero-figure">{money(point.total)}</div>
      <p className="muted">{point.accounts.length} 個帳戶 · 總資產</p>
    </section>
    <section className="panel stat" aria-label="總負債"><span className="eyebrow">總負債{point.liabilityEstimated && '（預估）'}</span><strong>{point.liabilityAssumed ? '未記錄（以 0 計）' : money(point.liabilityTotal)}</strong></section>
    <section className="panel stat" aria-label="淨資產"><span className="eyebrow">淨資產{point.liabilityEstimated && '（預估）'}</span><strong>{money(point.netWorth)}</strong><span className="muted small">總資產 − 總負債{point.liabilityAssumed && ' · 負債未記錄，以 0 計'}</span></section>
    <section className="panel span-2"><h3>資產配置</h3>{category ? <Allocation slices={colorize(category, CATEGORIES)} /> : <p className="muted">缺少歷史數量或行情，配置尚不完整。</p>}</section>
    <section className="panel" aria-label="快照帳戶"><h3>當時的帳戶餘額</h3><ul className="snapshot-accounts">{point.accounts.map(a => <li key={a.id}><span>{accountLabel({ name: a.name, country: day?.entries.find(e => e.accountId === a.id)?.country ?? accounts.find(x => x.id === a.id)?.country })}</span><strong>{money(a.value)}</strong></li>)}</ul></section>
    <section className="panel"><h3>幣別曝險</h3>{currency ? <Allocation slices={colorize(currency, COMMON_CURRENCIES)} /> : <p className="muted">這份快照沒有完整的幣別明細。</p>}</section>

    <section className="panel"><h3>國家</h3>{country ? <Allocation slices={colorize(country, Object.values(COUNTRIES))} /> : <p className="muted">這份快照沒有完整的國家明細。</p>}</section>
  </>
}
