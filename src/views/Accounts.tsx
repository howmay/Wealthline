import { useState } from 'react'
import { importSheet } from '../importSheet'
import {
  ACCOUNT_KINDS,
  BASE_CURRENCY,
  CATEGORIES,
  accountBaseValue,
  baseValue,
  newId,
  positionValue,
  type Account,
  type AccountKind,
  type Position,
  type WealthData,
} from '../model'
import { fmt } from '../format'
import { NumberInput } from './NumberInput'

interface Props {
  data: WealthData
  onChange: (d: WealthData) => void
}

export function Accounts({ data, onChange }: Props) {
  const [showImport, setShowImport] = useState(false)

  const updateAccount = (next: Account) =>
    onChange({ ...data, accounts: data.accounts.map((a) => (a.id === next.id ? next : a)) })

  function addAccount(kind: AccountKind) {
    const account: Account = {
      id: newId(),
      name: kind === 'bank' ? '新銀行帳戶' : '新投資帳戶',
      kind,
      country: 'TW',
      category: kind === 'bank' ? '現金與外幣活存' : '國內股票 (台股)',
      purpose: '',
      positions: [],
    }
    onChange({ ...data, accounts: [...data.accounts, account] })
  }

  return (
    <>
      <div className="row">
        <button onClick={() => addAccount('bank')}>＋ 銀行帳戶</button>
        <button onClick={() => addAccount('investment')}>＋ 投資帳戶</button>
        <button onClick={() => setShowImport(!showImport)}>從試算表貼上</button>
      </div>
      {showImport && <ImportPanel data={data} onChange={onChange} onDone={() => setShowImport(false)} />}
      {data.accounts.length === 0 && <p className="muted">尚無帳戶。</p>}
      {data.accounts.map((a) => (
        <AccountCard
          key={a.id}
          data={data}
          account={a}
          onChange={updateAccount}
          onDelete={() => {
            if (confirm(`刪除帳戶「${a.name}」？`)) onChange({ ...data, accounts: data.accounts.filter((x) => x.id !== a.id) })
          }}
        />
      ))}
    </>
  )
}

function ImportPanel({ data, onChange, onDone }: Props & { onDone: () => void }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  return (
    <section className="card">
      <p className="muted">
        從 Google 試算表或 Excel 複製資料列後貼上（不含標題列）。欄位順序：機構、類別、子類別、幣別、數量、單價、原幣市值、匯率、台幣市值、佔比、用途。
        同名帳戶會被覆蓋，匯率會一併更新。
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="在這裡貼上…" />
      <div className="row">
        <button
          onClick={() => {
            const r = importSheet(data, text)
            onChange(r.data)
            setMessage(`已匯入 ${r.rows} 列到 ${r.accounts} 個帳戶${r.skipped ? `，略過 ${r.skipped} 列無法辨識的資料` : ''}。`)
            setText('')
            if (!r.skipped) onDone()
          }}
          disabled={!text.trim()}
        >
          匯入
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </section>
  )
}

function AccountCard({
  data,
  account: a,
  onChange,
  onDelete,
}: {
  data: WealthData
  account: Account
  onChange: (a: Account) => void
  onDelete: () => void
}) {
  const set = <K extends keyof Account>(key: K, value: Account[K]) => onChange({ ...a, [key]: value })
  const setPosition = (p: Position) => set('positions', a.positions.map((x) => (x.id === p.id ? p : x)))
  const removePosition = (id: string) => set('positions', a.positions.filter((x) => x.id !== id))
  const addPosition = (type: Position['type']) =>
    set('positions', [
      ...a.positions,
      { id: newId(), type, currency: a.positions[0]?.currency ?? BASE_CURRENCY, symbol: '', quantity: 0, price: 1 },
    ])

  const cash = a.positions.filter((p) => p.type === 'cash')
  const holdings = a.positions.filter((p) => p.type === 'holding')

  return (
    <section className="card account">
      <div className="account-head">
        <input className="title" value={a.name} onChange={(e) => set('name', e.target.value)} aria-label="帳戶名稱" />
        <strong className="num">
          {BASE_CURRENCY} {fmt(accountBaseValue(data, a), 0)}
        </strong>
      </div>
      <div className="fields">
        <label>
          類型
          <select value={a.kind} onChange={(e) => set('kind', e.target.value as AccountKind)}>
            {Object.entries(ACCOUNT_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          國家
          <input value={a.country} onChange={(e) => set('country', e.target.value.toUpperCase())} size={4} />
        </label>
        <label>
          資產類別
          <input list="categories" value={a.category} onChange={(e) => set('category', e.target.value)} />
        </label>
        <label>
          用途
          <input value={a.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="例如 緊急備用金" />
        </label>
        <datalist id="categories">
          {CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <h4>{a.kind === 'bank' ? '幣別餘額' : '可用金額'}</h4>
      <PositionTable data={data} positions={cash} onChange={setPosition} onRemove={removePosition} />
      <button onClick={() => addPosition('cash')}>＋ 幣別</button>

      {(a.kind === 'investment' || holdings.length > 0) && (
        <>
          <h4>持有標的</h4>
          <PositionTable data={data} positions={holdings} onChange={setPosition} onRemove={removePosition} />
          <button onClick={() => addPosition('holding')}>＋ 標的</button>
        </>
      )}

      <div className="row end">
        <button className="danger" onClick={onDelete}>
          刪除帳戶
        </button>
      </div>
    </section>
  )
}

function PositionTable({
  data,
  positions,
  onChange,
  onRemove,
}: {
  data: WealthData
  positions: Position[]
  onChange: (p: Position) => void
  onRemove: (id: string) => void
}) {
  if (positions.length === 0) return null
  const holding = positions[0].type === 'holding'
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {holding && <th>標的</th>}
            <th>幣別</th>
            <th className="num">{holding ? '數量' : '餘額'}</th>
            {holding && <th className="num">單價</th>}
            {holding && <th className="num">市值</th>}
            <th className="num">{BASE_CURRENCY}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id}>
              {holding && (
                <td>
                  <input value={p.symbol} onChange={(e) => onChange({ ...p, symbol: e.target.value })} placeholder="代號" size={10} />
                </td>
              )}
              <td>
                <input
                  value={p.currency}
                  onChange={(e) => onChange({ ...p, currency: e.target.value.toUpperCase() })}
                  size={4}
                  maxLength={3}
                />
              </td>
              <td className="num">
                <NumberInput value={p.quantity} onCommit={(v) => onChange({ ...p, quantity: v })} size={12} />
              </td>
              {holding && (
                <td className="num">
                  <NumberInput value={p.price} onCommit={(v) => onChange({ ...p, price: v })} size={8} />
                </td>
              )}
              {holding && <td className="num">{fmt(positionValue(p))}</td>}
              <td className="num">{fmt(baseValue(data, p), 0)}</td>
              <td>
                <button className="icon" onClick={() => onRemove(p.id)} aria-label="刪除">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
