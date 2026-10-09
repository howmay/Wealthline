import { useCalendarNow } from '../useCalendarNow'
import { useHistoricalValuations } from '../useHistoricalValuations'
import { balanceSheet } from '../liabilities'
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
import { AssetChange, ChangeSinceLast } from './AssetChange'
import { Allocation, RankBars } from './charts'

interface Props {
  data: WealthData
  onGoRates: () => void
  onGoLiabilities?: () => void
  onNewAccount: () => void
  onImport: () => void
  onOpenAccount: (name: string) => void
}

export function Overview({ data, onGoRates, onGoLiabilities, onNewAccount, onImport, onOpenAccount }: Props) {
  const now = useCalendarNow()
  const estimated = data.liabilities?.some(d => d.schedule)
  const historical = useHistoricalValuations(data)
  if (data.accounts.length === 0 && !data.liabilities?.length) {
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
          {onGoLiabilities && <button onClick={onGoLiabilities}>新增負債</button>}
          <button onClick={onImport}>從試算表匯入</button>
        </div>
      </section>
    )
  }

  const totals = balanceSheet(data, now)
  const missing = missingRates(data)
  const byCategory = breakdown(data, (a) => a.category)

  return (
    <div className="overview">
      {historical.error && <p role="alert" className="banner error">{historical.error}</p>}
      <section className="panel hero">
        <span className="eyebrow">總資產</span>
        <div className="hero-figure">
          <small>NT$</small>
          {fmt(byCategory.total, 0)}
        </div>
        <ChangeSinceLast data={historical.data} />
        <p className="muted">
          {data.accounts.length} 個帳戶
          {data.fxUpdatedAt && ` · 匯率更新於 ${new Date(data.fxUpdatedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`}
        </p>
        {missing.length > 0 && (
          <p className="notice">
            <span aria-hidden>⚠</span> {missing.join('、')} 沒有匯率；資產總額可能不完整，相關負債與淨資產暫不換算。
            <button className="link" onClick={onGoRates}>
              查看匯率
            </button>
          </p>
        )}
      </section>

      <section className="panel stat" aria-label="總負債">
        <span className="eyebrow">{estimated ? '總負債（含預估）' : '總負債'}</span><strong>{totals.liabilities === null ? '尚無法換算' : `NT$ ${fmt(totals.liabilities, 0)}`}</strong>
        <span className="muted small">{data.liabilities?.length ?? 0} 筆{estimated ? ' · 假設按期還款；不代表銀行餘額，不會扣除現金' : '手動記錄'}</span>
        {onGoLiabilities && <button className="link" onClick={onGoLiabilities}>管理負債</button>}
      </section>
      <section className="panel stat" aria-label="淨資產">
        <span className="eyebrow">{estimated ? '淨資產（預估）' : '淨資產'}</span><strong>{totals.net === null ? '尚無法換算' : `NT$ ${fmt(totals.net, 0)}`}</strong>
        <span className="muted small">總資產 − 總負債{totals.net === null ? ' · 請檢查匯率' : ''}</span>
      </section>
      {!data.accounts.length && <section className="panel span-2"><p className="muted">尚未記錄資產，目前總資產為 0。</p><button onClick={onNewAccount}>新增資產帳戶</button></section>}
      {data.accounts.length > 0 && <>
      <AssetChange data={historical.data} />
      {!!(data.history.quantityDays?.length || data.history.holdingPeriods?.length) && <div className="span-2"><button disabled={historical.loading} onClick={historical.refresh}>{historical.loading ? '查詢歷史行情中…' : '重新查詢歷史行情'}</button></div>}

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

      {data.accounts.some((a) => a.country) && (
        <section className="panel">
          <h3>國家</h3>
          <Allocation
            slices={colorize(
              breakdown(data, (a) => (a.country ? countryLabel(a.country) : '')).slices,
              Object.values(COUNTRIES),
            )}
          />
        </section>
      )}
      </>}
    </div>
  )
}

