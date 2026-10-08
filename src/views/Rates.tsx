import { useState } from 'react'
import { BASE_CURRENCY, usedCurrencies, type WealthData } from '../model'
import { NumberInput } from './NumberInput'

export function Rates({ data, onChange }: { data: WealthData; onChange: (d: WealthData) => void }) {
  const [extra, setExtra] = useState('')
  const setRate = (c: string, r: number) => onChange({ ...data, fxRates: { ...data.fxRates, [c]: r } })

  return (
    <section>
      <p className="muted">每 1 單位外幣可換多少 {BASE_CURRENCY}。匯率需手動更新，或貼上試算表時一併匯入。</p>
      <table>
        <thead>
          <tr>
            <th>幣別</th>
            <th className="num">兌 {BASE_CURRENCY}</th>
          </tr>
        </thead>
        <tbody>
          {usedCurrencies(data).map((c) => (
            <tr key={c} className={data.fxRates[c] > 0 ? '' : 'missing'}>
              <td>{c}</td>
              <td className="num">
                <NumberInput value={data.fxRates[c] ?? 0} onCommit={(v) => setRate(c, v)} size={10} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          const c = extra.trim().toUpperCase()
          if (/^[A-Z]{3}$/.test(c) && c !== BASE_CURRENCY && !(c in data.fxRates)) setRate(c, 0)
          setExtra('')
        }}
      >
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="新增幣別，如 HKD" size={14} />
        <button type="submit">新增</button>
      </form>
    </section>
  )
}
