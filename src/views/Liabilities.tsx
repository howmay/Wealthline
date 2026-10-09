import { useState, type FormEvent } from 'react'
import { COMMON_CURRENCIES, newId, type WealthData } from '../model'
import { LIABILITY_KINDS, balanceSheet, liabilityBaseValue, parseLiability, type Liability } from '../liabilities'
import { fmt } from '../format'
import { REPAYMENT_METHODS, estimateLoan, type RepaymentMethod } from '../loanEstimate'
import { LoanProjection } from './LoanEstimate'

export function Liabilities({ data, onChange }: { data: WealthData; onChange: (data: WealthData) => void }) {
  const [editing, setEditing] = useState<Liability | 'new' | null>(null)
  const debts = data.liabilities ?? []
  const totals = balanceSheet(data)
  if (editing) return <LiabilityForm key={editing === 'new' ? 'new' : editing.id} liability={editing === 'new' ? undefined : editing}
    onCancel={() => setEditing(null)} onSave={(d) => {
      onChange({ ...data, liabilities: debts.some((x) => x.id === d.id) ? debts.map((x) => x.id === d.id ? d : x) : [...debts, d] })
      setEditing(null)
    }} />
  return <>
    <div className="page-head">
      <div><h2>負債</h2><p className="muted">記錄實際欠款；貸款可按本金、利率與剩餘期數試算，實際餘額仍由你更新。</p></div>
      <button className="primary" onClick={() => setEditing('new')}>＋ 新增負債</button>
    </div>
    <section className="panel stat">
      <span className="eyebrow">總負債</span><strong>{totals.liabilities === null ? '尚無法換算' : `NT$ ${fmt(totals.liabilities, 0)}`}</strong>
      <span className="muted small">{debts.length} 筆 · 餘額以正值記錄，淨資產會扣除此金額</span>
    </section>
    {!debts.length && <section className="panel empty"><p>尚未記錄負債。新增貸款或信用卡目前未償餘額。</p></section>}
    <div className="liability-list">{debts.map((d) => {
      const value = liabilityBaseValue(data, d)
      return <section className="panel" key={d.id}>
        <div className="panel-head"><h3>{d.name}</h3><span className="tag">{LIABILITY_KINDS[d.kind]}</span></div>
        <p className="liability-balance">{d.currency} {fmt(d.balance)}</p>
        <p className="muted small">目前未償餘額 · {Number.isFinite(value) ? `NT$ ${fmt(value, 0)}` : '缺少有效匯率，請至「匯率」設定'}</p>
        <dl className="liability-details">
          {d.annualRate !== undefined && <><dt>年利率</dt><dd>{fmt(d.annualRate, 4)}%</dd></>}
          {d.paymentAmount !== undefined && <><dt>既有手填每期應付</dt><dd>{d.currency} {fmt(d.paymentAmount)}</dd></>}
          {d.nextDueDate && <><dt>下次到期日</dt><dd>{d.nextDueDate}</dd></>}
          {d.totalInstallments !== undefined && <><dt>總期數</dt><dd>{d.totalInstallments}</dd></>}
          {d.paidInstallments !== undefined && <><dt>已繳期數</dt><dd>{d.paidInstallments}</dd></>}
        </dl>
        {d.repaymentMethod && d.repaymentMethod !== 'none' && <LoanProjection principal={d.balance} annualRate={d.annualRate} periods={d.remainingInstallments} method={d.repaymentMethod} currency={d.currency} />}
        {d.notes && <p className="liability-notes muted">{d.notes}</p>}
        <div className="row">
          <button onClick={() => setEditing(d)} aria-label={`編輯負債 ${d.name}`}>編輯</button>
          <button className="danger" aria-label={`刪除負債 ${d.name}`} onClick={() => {
            if (confirm(`刪除負債「${d.name}」？這只移除紀錄，不表示貸款已清償。`)) onChange({ ...data, liabilities: debts.filter((x) => x.id !== d.id) })
          }}>刪除</button>
        </div>
      </section>
    })}</div>
  </>
}

function LiabilityForm({ liability, onSave, onCancel }: { liability?: Liability; onSave: (liability: Liability) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(() => ({
    name: liability?.name ?? '', kind: liability?.kind ?? 'personal', currency: liability?.currency ?? 'TWD',
    balance: liability?.balance.toString() ?? '', annualRate: liability?.annualRate?.toString() ?? '',
    repaymentMethod: liability ? liability.repaymentMethod ?? 'none' : 'annuity',
    remainingInstallments: liability?.remainingInstallments?.toString() ?? '',
    nextDueDate: liability?.nextDueDate ?? '', notes: liability?.notes ?? '',
  }))
  const [error, setError] = useState('')
  const set = (key: keyof typeof draft, value: string) => setDraft((d) => ({ ...d, [key]: value }))
  const number = (value: string) => value.trim() ? Number(value.replace(/,/g, '')) : undefined
  const method = draft.repaymentMethod as RepaymentMethod
  function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const next = parseLiability({ ...liability, ...draft, id: liability?.id ?? newId(), balance: number(draft.balance), annualRate: method === 'none' ? liability?.annualRate : number(draft.annualRate), remainingInstallments: method === 'none' ? liability?.remainingInstallments : number(draft.remainingInstallments), nextDueDate: draft.nextDueDate || undefined })
      if (method !== 'none') estimateLoan({ principal: next.balance, annualRate: next.annualRate!, periods: next.remainingInstallments!, method })
      onSave(next)
    } catch (e) { setError(e instanceof Error ? e.message : '請檢查輸入資料') }
  }
  return <form className="panel form liability-form" onSubmit={submit}>
    <h3>{liability ? '編輯負債' : '新增負債'}</h3>
    <p className="muted small">填寫目前剩餘本金。貸款再填年利率與剩餘月數，即可試算；信用卡、寬限期或不規則還款請選只記錄餘額。</p>
    {error && <p role="alert" className="banner error">{error}</p>}
    <label className="field"><span>負債名稱</span><input required autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} /></label>
    <label className="field"><span>負債類型</span><select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as typeof d.kind, repaymentMethod: e.target.value === 'credit' ? 'none' : d.repaymentMethod }))}>{Object.entries(LIABILITY_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="field"><span>幣別</span><input required list="liability-currencies" value={draft.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></label>
    <datalist id="liability-currencies">{[...new Set([...COMMON_CURRENCIES, 'USDC'])].map((c) => <option key={c} value={c} />)}</datalist>
    <label className="field"><span>目前未償餘額</span><input required inputMode="decimal" value={draft.balance} onChange={(e) => set('balance', e.target.value)} /><small className="muted">使用正值；已清償可填 0。</small></label>
    <label className="field"><span>還款方式</span><select value={method} onChange={(e) => set('repaymentMethod', e.target.value)}>{Object.entries(REPAYMENT_METHODS).map(([key, label]) => <option key={key} value={key} disabled={draft.kind === 'credit' && key !== 'none'}>{label}</option>)}</select></label>
    {method !== 'none' && <>
      <div className="liability-form-grid">
        <label className="field"><span>年利率（%）</span><input required inputMode="decimal" value={draft.annualRate} onChange={(e) => set('annualRate', e.target.value)} /></label>
        <label className="field"><span>剩餘期數（月）</span><input required inputMode="numeric" value={draft.remainingInstallments} onChange={(e) => set('remainingInstallments', e.target.value)} /><small className="muted">1–1200 期；每月一期。</small></label>
      </div>
      <LoanProjection principal={number(draft.balance)} annualRate={number(draft.annualRate)} periods={number(draft.remainingInstallments)} method={method} currency={draft.currency} />
    </>}
    {liability && (liability.paymentAmount !== undefined || liability.totalInstallments !== undefined || liability.paidInstallments !== undefined || (!liability.repaymentMethod && liability.annualRate !== undefined)) && <details>
      <summary>既有手填資料（保留，未作為試算條件）</summary>
      <p className="muted small">每期應付：{liability.paymentAmount ?? '未填'}；總期數：{liability.totalInstallments ?? '未填'}；已繳期數：{liability.paidInstallments ?? '未填'}；原年利率：{liability.annualRate ?? '未填'}%。不會自動推算剩餘期數。</p>
    </details>}
    <details><summary>日期與備註（選填）</summary>
      <label className="field"><span>下次到期日（選填）</span><input type="date" value={draft.nextDueDate} onChange={(e) => set('nextDueDate', e.target.value)} /></label>
      <label className="field"><span>備註（選填）</span><textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} /></label>
    </details>
    <div className="row"><button type="submit" className="primary">套用負債</button><button type="button" onClick={onCancel}>取消</button></div>
    <p className="muted small">套用後仍須按「儲存變更」才會寫入 Drive。</p>
  </form>
}
