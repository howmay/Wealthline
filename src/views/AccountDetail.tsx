import { useState, type FormEvent } from 'react'
import { fmt } from '../format'
import {
  ACCOUNT_KINDS,
  BASE_CURRENCY,
  accountBaseValue,
  baseValue,
  cashCurrencies,
  countryLabel,
  newId,
  positionValue,
  type Account,
  type Position,
  type WealthData,
} from '../model'
import { NumberInput } from './NumberInput'

interface Props {
  data: WealthData
  account: Account
  onChange: (a: Account) => void
  onEdit: () => void
  onBack: () => void
}

// Where the numbers go: balances per currency, and holdings for investment accounts.
export function AccountDetail({ data, account: a, onChange, onEdit, onBack }: Props) {
  const setPositions = (positions: Position[]) => onChange({ ...a, positions })
  const setPosition = (p: Position) => setPositions(a.positions.map((x) => (x.id === p.id ? p : x)))
  const cash = a.positions.filter((p) => p.type === 'cash')
  const holdings = a.positions.filter((p) => p.type === 'holding')

  return (
    <>
      <button className="link back" onClick={onBack}>
        ← 所有帳戶
      </button>
      <div className="account-head">
        <div>
          <h2>{a.name}</h2>
          <p className="muted">
            {[ACCOUNT_KINDS[a.kind], countryLabel(a.country), a.category, a.purpose].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="total">
          <span className="muted">合計 {BASE_CURRENCY}</span>
          <strong>{fmt(accountBaseValue(data, a), 0)}</strong>
        </div>
      </div>
      <div className="row">
        <button onClick={onEdit}>編輯帳戶設定</button>
      </div>

      <section className="card">
        <h3>{a.kind === 'bank' ? '餘額' : '可用金額'}</h3>
        {cash.length === 0 && <p className="muted">尚未設定幣別，請按「編輯帳戶設定」選擇持有幣別。</p>}
        {cash.map((p) => (
          <div className="balance" key={p.id}>
            <span className="ccy">{p.currency}</span>
            <NumberInput value={p.quantity} onCommit={(v) => setPosition({ ...p, quantity: v })} aria-label={`${p.currency} 餘額`} />
            <span className="muted num">
              {p.currency === BASE_CURRENCY
                ? ''
                : Number.isFinite(baseValue(data, p))
                  ? `≈ ${BASE_CURRENCY} ${fmt(baseValue(data, p), 0)}`
                  : '尚未設定匯率'}
            </span>
          </div>
        ))}
      </section>

      {(a.kind === 'investment' || holdings.length > 0) && (
        <section className="card">
          <h3>持有標的</h3>
          {holdings.length > 0 && (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>標的</th>
                    <th className="num">數量</th>
                    <th className="num">單價</th>
                    <th>幣別</th>
                    <th className="num">市值</th>
                    <th className="num">{BASE_CURRENCY}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input value={p.symbol} onChange={(e) => setPosition({ ...p, symbol: e.target.value })} size={10} />
                      </td>
                      <td className="num">
                        <NumberInput value={p.quantity} onCommit={(v) => setPosition({ ...p, quantity: v })} size={10} />
                      </td>
                      <td className="num">
                        <NumberInput value={p.price} onCommit={(v) => setPosition({ ...p, price: v })} size={8} />
                      </td>
                      <td>{p.currency}</td>
                      <td className="num">{fmt(positionValue(p))}</td>
                      <td className="num">{fmt(baseValue(data, p), 0)}</td>
                      <td>
                        <button
                          className="icon"
                          aria-label="刪除"
                          onClick={() => setPositions(a.positions.filter((x) => x.id !== p.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AddHolding
            currencies={cashCurrencies(a)}
            onAdd={(p) => setPositions([...a.positions, p])}
          />
        </section>
      )}
    </>
  )
}

function AddHolding({ currencies, onAdd }: { currencies: string[]; onAdd: (p: Position) => void }) {
  const [currency, setCurrency] = useState(currencies[0] ?? BASE_CURRENCY)
  const options = [...new Set([...currencies, currency])]

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const quantity = Number(String(f.get('quantity')).replace(/,/g, ''))
    const price = Number(String(f.get('price')).replace(/,/g, ''))
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return
    onAdd({ id: newId(), type: 'holding', currency, symbol: String(f.get('symbol')).trim(), quantity, price })
    e.currentTarget.reset()
  }

  return (
    <form className="row add-holding" onSubmit={submit}>
      <input name="symbol" placeholder="代號，如 2330、AAPL、BTC" required size={16} />
      <input name="quantity" placeholder="數量" inputMode="decimal" required size={8} />
      <input name="price" placeholder="單價" inputMode="decimal" required size={8} />
      <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {options.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <button type="submit">＋ 新增標的</button>
    </form>
  )
}
