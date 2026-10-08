import { useState } from 'react'
import { fmt } from '../format'
import { importSheet } from '../importSheet'
import { ACCOUNT_KINDS, BASE_CURRENCY, accountBaseValue, cashCurrencies, countryLabel, type Account, type AccountKind, type WealthData } from '../model'
import { AccountDetail } from './AccountDetail'
import { AccountForm } from './AccountForm'

interface Props {
  data: WealthData
  onChange: (d: WealthData) => void
}

type View = { page: 'list' } | { page: 'new' } | { page: 'edit'; id: string } | { page: 'detail'; id: string }

export function Accounts({ data, onChange }: Props) {
  const [view, setView] = useState<View>({ page: 'list' })
  const [showImport, setShowImport] = useState(false)

  const purposes = [...new Set(data.accounts.map((a) => a.purpose).filter(Boolean))]
  const saveAccount = (next: Account) => {
    const exists = data.accounts.some((a) => a.id === next.id)
    onChange({ ...data, accounts: exists ? data.accounts.map((a) => (a.id === next.id ? next : a)) : [...data.accounts, next] })
  }
  const current = 'id' in view ? data.accounts.find((a) => a.id === view.id) : undefined

  if (view.page === 'new' || (view.page === 'edit' && current)) {
    return (
      <AccountForm
        account={current}
        purposes={purposes}
        onSave={(a) => {
          saveAccount(a)
          setView({ page: 'detail', id: a.id })
        }}
        onCancel={() => setView(current ? { page: 'detail', id: current.id } : { page: 'list' })}
        onDelete={
          current &&
          (() => {
            if (!confirm(`刪除帳戶「${current.name}」以及其中所有餘額與持倉？`)) return
            onChange({ ...data, accounts: data.accounts.filter((a) => a.id !== current.id) })
            setView({ page: 'list' })
          })
        }
      />
    )
  }

  if (view.page === 'detail' && current) {
    return (
      <AccountDetail
        data={data}
        account={current}
        onChange={saveAccount}
        onEdit={() => setView({ page: 'edit', id: current.id })}
        onBack={() => setView({ page: 'list' })}
      />
    )
  }

  return (
    <>
      <div className="row">
        <button className="primary" onClick={() => setView({ page: 'new' })}>
          ＋ 新增帳戶
        </button>
        <button onClick={() => setShowImport(!showImport)}>從試算表貼上</button>
      </div>
      {showImport && <ImportPanel data={data} onChange={onChange} onDone={() => setShowImport(false)} />}
      {data.accounts.length === 0 && <p className="muted">還沒有帳戶。先按「新增帳戶」定義你的銀行或投資帳戶。</p>}
      {(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((kind) => {
        const list = data.accounts.filter((a) => a.kind === kind)
        if (list.length === 0) return null
        return (
          <section key={kind}>
            <h3>{ACCOUNT_KINDS[kind]}</h3>
            <ul className="account-list">
              {list.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setView({ page: 'detail', id: a.id })}>
                    <span className="name">{a.name}</span>
                    <span className="meta muted">
                      {[countryLabel(a.country), cashCurrencies(a).join(' · ')].filter(Boolean).join('　')}
                    </span>
                    <span className="num">
                      {BASE_CURRENCY} {fmt(accountBaseValue(data, a), 0)}
                    </span>
                    <span className="muted">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
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
