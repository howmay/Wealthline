import { useState } from 'react'
import { fmt, pct } from '../format'
import { importSheet, type ImportResult } from '../importSheet'
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
        accounts={data.accounts}
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
  const [preview, setPreview] = useState<{ source: WealthData; result: ImportResult } | null>(null)
  return (
    <section className="panel">
      <h3>從試算表匯入</h3>
      <p className="muted small">
        從 Google 試算表或 Excel 複製資料列後貼上（不含標題列）。欄位順序：機構、類別、子類別、幣別、數量、單價、原幣市值、匯率、台幣市值、佔比。
        同名帳戶的全部原持倉會被取代，匯率會一併更新。請先預覽並確認刪除差異；有錯誤時整批不匯入。
      </p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null) }} rows={8} placeholder="在這裡貼上…" />
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            setPreview({ source: data, result: importSheet(data, text) })
          }}
          disabled={!text.trim()}
        >
          預覽匯入
        </button>
        <button onClick={onDone}>取消</button>
      </div>
      {preview && <div aria-live="polite">
        <h4>匯入預覽：{preview.result.rows} 列、{preview.result.accounts} 個帳戶</h4>
        {preview.source !== data && <p role="alert">資料已變更，請重新預覽後再確認。</p>}
        {preview.result.errors.length > 0 && <div role="alert">
          <p>以下錯誤必須全部修正，尚未套用任何資料：</p>
          <ul>{preview.result.errors.map((e) => <li key={e.line}>第 {e.line} 列：{e.message}</li>)}</ul>
        </div>}
        {preview.result.replaced.map((a) => <div key={a.id}>
          <strong>將取代「{a.name}」，刪除以下 {a.positions.length} 筆原持倉：</strong>
          <ul>{a.positions.map((p) => <li key={p.id}>{p.symbol || '現金'} · {p.currency} · 數量 {p.quantity} · 單價 {p.price}</li>)}</ul>
        </div>)}
        {!preview.result.errors.length && preview.result.data.accounts.filter((a) => !preview.source.accounts.includes(a)).map((a) => <div key={a.id}>
          <strong>匯入後：{a.name} · {a.kind === 'bank' ? '銀行帳戶' : '投資帳戶'} · {a.category} · {a.country || '未設定國家'}</strong>
          <ul>{a.positions.map((p) => <li key={p.id}>{p.symbol || '現金'} · {p.currency} · 數量 {p.quantity} · 單價 {p.price}</li>)}</ul>
        </div>)}
        <ul>{preview.result.rateChanges.map((r) => <li key={r.currency}>匯率 {r.currency}：{r.before ?? '未設定'} → {r.after}</li>)}</ul>
        <p className="muted small">確認後只更新本機資料，仍需按「儲存變更」才會寫入 Drive。</p>
        <button className="primary" disabled={preview.source !== data || !!preview.result.errors.length || !preview.result.rows} onClick={() => {
          if (preview.source !== data || preview.result.errors.length || !preview.result.rows) return
          onChange(preview.result.data)
          onDone()
        }}>確認匯入並取代上述資料</button>
      </div>}
    </section>
  )
}
