import { fmt } from '../format'
import {
  CATEGORIES,
  COMMON_CURRENCIES,
  COUNTRIES,
  breakdown,
  countryLabel,
  missingRates,
  type WealthData,
} from '../model'
import { colorize } from '../chartColors'
import { Allocation, RankBars } from './charts'

interface Props {
  data: WealthData
  onGoRates: () => void
  onNewAccount: () => void
  onImport: () => void
  onOpenAccount: (name: string) => void
}

export function Overview({ data, onGoRates, onNewAccount, onImport, onOpenAccount }: Props) {
  if (data.accounts.length === 0) {
    return (
      <section className="panel empty">
        <div className="empty-mark" aria-hidden>
          ＄
        </div>
        <h2>開始記錄你的資產</h2>
        <p className="muted">先建立銀行或投資帳戶，再填入餘額與持倉。也可以直接貼上現有的試算表。</p>
        <div className="row center">
          <button className="primary" onClick={onNewAccount}>
            建立第一個帳戶
          </button>
          <button onClick={onImport}>從試算表匯入</button>
        </div>
      </section>
    )
  }

  const missing = missingRates(data)
  const byCategory = breakdown(data, (a) => a.category)
  const purposes = [...new Set(data.accounts.map((a) => a.purpose).filter(Boolean))]

  return (
    <div className="overview">
      <section className="panel hero">
        <span className="eyebrow">總資產</span>
        <div className="hero-figure">
          <small>NT$</small>
          {fmt(byCategory.total, 0)}
        </div>
        <p className="muted">
          {data.accounts.length} 個帳戶
          {data.fxUpdatedAt && ` · 匯率更新於 ${new Date(data.fxUpdatedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`}
        </p>
        {missing.length > 0 && (
          <p className="notice">
            <span aria-hidden>⚠</span> {missing.join('、')} 沒有匯率，未計入總額。
            <button className="link" onClick={onGoRates}>
              查看匯率
            </button>
          </p>
        )}
      </section>

      <section className="panel span-2">
        <h3>資產配置</h3>
        <Allocation slices={colorize(byCategory.slices, CATEGORIES)} />
      </section>

      <section className="panel">
        <h3>帳戶</h3>
        <RankBars slices={breakdown(data, (a) => a.name).slices} onSelect={onOpenAccount} />
      </section>

      <section className="panel">
        <h3>幣別曝險</h3>
        <Allocation slices={colorize(breakdown(data, (_, p) => p.currency).slices, COMMON_CURRENCIES)} />
      </section>

      <section className="panel">
        <h3>國家</h3>
        <Allocation
          slices={colorize(
            breakdown(data, (a) => (a.country ? countryLabel(a.country) : '')).slices,
            Object.values(COUNTRIES),
          )}
        />
      </section>

      <section className="panel">
        <h3>用途</h3>
        <Allocation slices={colorize(breakdown(data, (a) => a.purpose).slices, purposes)} />
      </section>
    </div>
  )
}

