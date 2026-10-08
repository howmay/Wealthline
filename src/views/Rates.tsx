import { useState } from 'react'
import { BASE_CURRENCY, usedCurrencies, type WealthData } from '../model'
import { NumberInput } from './NumberInput'

interface Props {
  data: WealthData
  onChange: (d: WealthData) => void
  onRefresh: () => Promise<void>
  error: string
}

export function Rates({ data, onChange, onRefresh, error }: Props) {
  const [refreshing, setRefreshing] = useState(false)
  const currencies = usedCurrencies(data)

  // Typing a rate pins it; automatic updates then leave that currency alone.
  const setManual = (c: string, r: number) =>
    onChange({
      ...data,
      fxRates: { ...data.fxRates, [c]: r },
      fxManual: data.fxManual.includes(c) ? data.fxManual : [...data.fxManual, c],
    })
  const unpin = (c: string) => onChange({ ...data, fxManual: data.fxManual.filter((x) => x !== c) })

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>匯率</h3>
          <p className="muted small">
            每 1 單位兌 {BASE_CURRENCY}。開啟時自動更新（法幣來自 ExchangeRate-API，穩定幣與加密貨幣來自 CoinGecko）
            {data.fxUpdatedAt && `，上次更新 ${new Date(data.fxUpdatedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`}。
          </p>
        </div>
        <button
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            await onRefresh()
            setRefreshing(false)
          }}
        >
          {refreshing ? '更新中…' : '立即更新'}
        </button>
      </div>
      {error && <p className="banner error">{error}</p>}
      {currencies.length === 0 ? (
        <p className="muted">目前只有 {BASE_CURRENCY}，不需要匯率。</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>幣別</th>
              <th className="num">兌 {BASE_CURRENCY}</th>
              <th>來源</th>
            </tr>
          </thead>
          <tbody>
            {currencies.map((c) => {
              const manual = data.fxManual.includes(c)
              const rate = data.fxRates[c]
              return (
                <tr key={c}>
                  <td>
                    <span className="ccy-badge">{c}</span>
                  </td>
                  <td className="num">
                    <NumberInput className="cell-input" digits={4} value={rate ?? 0} onCommit={(v) => setManual(c, v)} aria-label={`${c} 匯率`} />
                  </td>
                  <td>
                    {!(rate > 0) ? (
                      <span className="tag warn">缺少匯率</span>
                    ) : manual ? (
                      <>
                        <span className="tag">手動</span>
                        <button className="link small" onClick={() => unpin(c)}>
                          改回自動
                        </button>
                      </>
                    ) : (
                      <span className="tag good">自動</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
