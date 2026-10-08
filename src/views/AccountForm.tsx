import { useState, type FormEvent } from 'react'
import {
  ACCOUNT_KINDS,
  CATEGORIES,
  COMMON_CURRENCIES,
  COUNTRIES,
  cashCurrencies,
  defaultCategory,
  homeCurrency,
  newId,
  type Account,
  type AccountKind,
} from '../model'

interface Props {
  // Undefined when creating a new account.
  account?: Account
  onSave: (a: Account) => void
  onCancel: () => void
  onDelete?: () => void
}

// Defines what an account is: type, where it is, which currencies it holds.
// Balances and holdings are filled in afterwards on the account page.
export function AccountForm({ account, onSave, onCancel, onDelete }: Props) {
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'bank')
  const [name, setName] = useState(account?.name ?? '')
  const [country, setCountry] = useState(account?.country || 'TW')
  const [currencies, setCurrencies] = useState<string[]>(account ? cashCurrencies(account) : ['TWD'])
  const [category, setCategory] = useState(account?.category ?? defaultCategory('bank', 'TW'))
  const [extraCurrency, setExtraCurrency] = useState('')
  // Follow the defaults for type and country until the user picks a category themselves.
  const [categoryTouched, setCategoryTouched] = useState(!!account)

  function changeKindOrCountry(nextKind: AccountKind, nextCountry: string) {
    setKind(nextKind)
    if (nextCountry !== country && !account && currencies.length <= 1) setCurrencies([homeCurrency(nextCountry)])
    setCountry(nextCountry)
    if (!categoryTouched) setCategory(defaultCategory(nextKind, nextCountry))
  }

  const toggleCurrency = (c: string) =>
    setCurrencies(currencies.includes(c) ? currencies.filter((x) => x !== c) : [...currencies, c])

  const shownCurrencies = [...new Set([...COMMON_CURRENCIES, ...currencies])]

  function submit(e: FormEvent) {
    e.preventDefault()
    const positions = account?.positions ?? []
    // Keep existing balances and all holdings; add a zero balance for newly picked currencies.
    const kept = positions.filter((p) => p.type === 'holding' || currencies.includes(p.currency))
    const added = currencies
      .filter((c) => !kept.some((p) => p.type === 'cash' && p.currency === c))
      .map((c) => ({ id: newId(), type: 'cash' as const, currency: c, symbol: '', quantity: 0, price: 1 }))
    onSave({
      id: account?.id ?? newId(),
      name: name.trim(),
      kind,
      country,
      category: category.trim() || '其他',
      positions: [...kept, ...added],
    })
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <h3>{account ? '編輯帳戶' : '新增帳戶'}</h3>

      <div className="field">
        <span>帳戶類型</span>
        <div className="choices">
          {(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((k) => (
            <button type="button" key={k} className={k === kind ? 'chip on' : 'chip'} onClick={() => changeKindOrCountry(k, country)}>
              {ACCOUNT_KINDS[k]}
              <small>{k === 'bank' ? '活存、定存、外幣' : '證券、加密貨幣、退休金'}</small>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>帳戶名稱</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 HSBC SG、台新證券" required autoFocus />
      </label>

      <label className="field">
        <span>國家</span>
        <select value={country} onChange={(e) => changeKindOrCountry(kind, e.target.value)}>
          {Object.entries(COUNTRIES).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
          {!(country in COUNTRIES) && <option value={country}>{country}</option>}
        </select>
      </label>

      <div className="field">
        <span>{kind === 'bank' ? '持有幣別' : '可用金額幣別'}</span>
        <div className="choices">
          {shownCurrencies.map((c) => (
            <button type="button" key={c} className={currencies.includes(c) ? 'chip on' : 'chip'} onClick={() => toggleCurrency(c)}>
              {c}
            </button>
          ))}
          <input
            value={extraCurrency}
            onChange={(e) => setExtraCurrency(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const c = extraCurrency.trim()
              if (/^[A-Z]{3,5}$/.test(c) && !currencies.includes(c)) setCurrencies([...currencies, c])
              setExtraCurrency('')
            }}
            placeholder="其他幣別 + Enter"
            size={14}
          />
        </div>
      </div>

      <label className="field">
        <span>資產類別</span>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setCategoryTouched(true)
          }}
        >
          {[...new Set([...CATEGORIES, category])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>

      <div className="row">
        <button type="submit" className="primary" disabled={!name.trim()}>
          {account ? '儲存' : '建立帳戶'}
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
        {onDelete && (
          <button type="button" className="danger push-right" onClick={onDelete}>
            刪除帳戶
          </button>
        )}
      </div>
    </form>
  )
}
