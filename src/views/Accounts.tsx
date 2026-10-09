import { useState } from 'react'
import { fmt, pct } from '../format'
import { importSheet } from '../importSheet'
import { ACCOUNT_KINDS, CATEGORIES, accountBaseValue, cashCurrencies, countryLabel, type Account, type AccountKind, type WealthData } from '../model'
import { AccountDetail } from './AccountDetail'
import { AccountForm } from './AccountForm'

interface Props {
  data: WealthData
  onChange: (d: WealthData) => void
}

export type AccountsView =
  | { page: 'list'; importing?: boolean }
  | { page: 'new' }
  | { page: 'edit'; id: string }
  | { page: 'detail'; id: string }

interface AccountsProps extends Props {
  view: AccountsView
  // `replace` swaps the current history entry instead of adding one, for pages the back button should skip.
  setView: (v: AccountsView, replace?: boolean) => void
  onBack: (fallback: AccountsView) => void
  onRefreshPrices: () => Promise<void>
  priceError: string
}

export function Accounts({ data, onChange, view, setView, onBack, onRefreshPrices, priceError }: AccountsProps) {
  const showImport = view.page === 'list' && !!view.importing
  const setShowImport = (importing: boolean) => setView({ page: 'list', importing }, true)

  const saveAccount = (next: Account) => {
    const exists = data.accounts.some((a) => a.id === next.id)
    onChange({ ...data, accounts: exists ? data.accounts.map((a) => (a.id === next.id ? next : a)) : [...data.accounts, next] })
  }
  const current = 'id' in view ? data.accounts.find((a) => a.id === view.id) : undefined

  if (view.page === 'new' || (view.page === 'edit' && current)) {
    return (
      <AccountForm
        account={current}
        onSave={(a) => {
          saveAccount(a)
          // Editing returns to the account it came from; a new account's page takes the form's place.
          if (current) onBack({ page: 'detail', id: a.id })
          else setView({ page: 'detail', id: a.id }, true)
        }}
        onCancel={() => onBack(current ? { page: 'detail', id: current.id } : { page: 'list' })}
        onDelete={
          current &&
          (() => {
            if (!confirm(`刪除帳戶「${current.name}」以及其中所有餘額與持倉？`)) return
            onChange({ ...data, accounts: data.accounts.filter((a) => a.id !== current.id) })
            setView({ page: 'list' }, true)
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
        onBack={() => onBack({ page: 'list' })}
        onRefreshPrices={onRefreshPrices}
        priceError={priceError}
      />
    )
  }

  const total = data.accounts.reduce((sum, a) => sum + accountBaseValue(data, a), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h2>帳戶</h2>
          <p className="muted">先定義帳戶，再點進去填餘額或持倉。</p>
        </div>
        <div className="row">
          <button onClick={() => setShowImport(!showImport)}>從試算表匯入</button>
          <button className="primary" onClick={() => setView({ page: 'new' })}>
            ＋ 新增帳戶
          </button>
        </div>
      </div>
      {showImport && <ImportPanel data={data} onChange={onChange} onDone={() => setShowImport(false)} />}
      {data.accounts.length === 0 && !showImport && (
        <section className="panel empty">
          <p className="muted">還沒有帳戶。按「新增帳戶」定義你的第一個銀行或投資帳戶。</p>
        </section>
      )}
      {(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((kind) => {
        const list = data.accounts
          .filter((a) => a.kind === kind)
          .map((a) => ({ a, value: accountBaseValue(data, a) }))
          .sort((x, y) => y.value - x.value)
        if (list.length === 0) return null
        const subtotal = list.reduce((s2, x) => s2 + x.value, 0)
        return (
          <section key={kind} className="group">
            <div className="group-head">
              <h3>{ACCOUNT_KINDS[kind]}</h3>
              <span className="muted">NT$ {fmt(subtotal, 0)}</span>
            </div>
            <ul className="account-list">
              {list.map(({ a, value }) => (
                <li key={a.id}>
                  <button onClick={() => setView({ page: 'detail', id: a.id })}>
                    <i className="dot" style={{ background: categoryColor(a.category) }} />
                    <span className="name">{a.name}</span>
                    <span className="meta">
                      {a.country && <span className="tag">{countryLabel(a.country)}</span>}
                      <span className="muted">{a.category}</span>
                      {cashCurrencies(a).map((c) => (
                        <span key={c} className="ccy-badge">
                          {c}
                        </span>
                      ))}
                    </span>
                    <span className="value">
                      <strong>{fmt(value, 0)}</strong>
                      <small className="muted">{total ? pct(value / total) : ''}</small>
                    </span>
                    <span className="chevron" aria-hidden>
                      ›
                    </span>
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

function categoryColor(category: string) {
  const i = CATEGORIES.indexOf(category)
  return i >= 0 ? `var(--s${i + 1})` : 'var(--other)'
}

function ImportPanel({ data, onChange, onDone }: Props & { onDone: () => void }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  return (
    <section className="panel">
      <h3>從試算表匯入</h3>
      <p className="muted small">
        從 Google 試算表或 Excel 複製資料列後貼上（不含標題列）。欄位順序：機構、類別、子類別、幣別、數量、單價、原幣市值、匯率、台幣市值、佔比。
        同名帳戶會被覆蓋，匯率會一併更新。
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="在這裡貼上…" />
      <div className="row">
        <button
          className="primary"
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
