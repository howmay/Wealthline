import type { ReactNode } from 'react'
import type { LiabilityChange } from '../history'
import { LIABILITY_KINDS, type Liability } from '../liabilities'
import { REPAYMENT_METHODS } from '../loanEstimate'
import { fmt } from '../format'

const labels: Record<Exclude<keyof Liability, 'id'>, string> = {
  schedule: '按期預估日程', basisHistory: '基準變更紀錄',
  name: '名稱', kind: '類型', currency: '幣別', balance: '本金／未償餘額', annualRate: '年利率（%）',
  repaymentMethod: '還款方式', remainingInstallments: '基準期數', paymentAmount: '既有手填每期應付', nextDueDate: '下次到期日', totalInstallments: '總期數', paidInstallments: '已繳期數', notes: '備註',
}
function value(d: Liability | null, key: keyof typeof labels): string {
  const v = d?.[key]
  if (v === undefined) return '未設定'
  if (key === 'schedule') { const s = d!.schedule!; return `${s.source === 'original' ? '原始貸款' : `校正日 ${s.baseDate}`} · 首期 ${s.firstDueDate} · 每月 ${s.monthlyDay} 日 · ${s.timeZone}` }
  if (key === 'basisHistory') return d!.basisHistory!.map(b => `${b.at} ${b.reason} (${b.currency} ${fmt(b.balance)})`).join('；')
  if (key === 'repaymentMethod') return REPAYMENT_METHODS[d!.repaymentMethod!]
  if (key === 'kind') return LIABILITY_KINDS[d!.kind]
  if (key === 'balance' || key === 'paymentAmount') return `${d!.currency} ${fmt(v as number)}`
  return typeof v === 'number' ? fmt(v, 4) : String(v)
}

export function LiabilityChangeRow({ change, extra, showTime = true }: { change: LiabilityChange; extra?: ReactNode; showTime?: boolean }) {
  const { before, after } = change
  return <li className="liability-change">
    <div className="row"><strong>{(after ?? before)!.name}</strong><span className="tag">{!before ? '新增負債' : !after ? '移除負債' : '修改負債'}</span>{extra}</div>
    {showTime && <p className="muted small">{new Date(change.at).toLocaleString('zh-TW')}</p>}
    <dl className="liability-details">{(Object.keys(labels) as (keyof typeof labels)[]).filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])).map((key) => <div className="liability-diff-field" key={key}>
      <dt>{labels[key]}</dt><dd>{before ? value(before, key) : '—'} → {after ? value(after, key) : '—'}</dd>
    </div>)}</dl>
  </li>
}
