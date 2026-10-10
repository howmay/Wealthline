import { useEffect, useRef, useState } from 'react'
import type { WealthData } from '../model'
import { localDate } from '../history'
import { applyQuantityDay, entriesForDate, instrumentKey, parseQuantityDays, validatePastDate, valueEntries, type QuantityDay, type QuantityEntry } from '../quantityHistory'

export interface QuantityEditRequest { date: string; expected?: QuantityDay }
const nameOf = (e: QuantityEntry) => `${e.account} · ${e.symbol || e.currency} · ${e.currency}`
const stamp = () => new Date().toISOString()

export function QuantityEditor({
  data,
  date: initialDate,
  expected,
  onCancel,
  onApply,
}: {
  data: WealthData
  date: string
  expected?: QuantityDay
  onCancel: () => void
  onApply: (data: WealthData) => void
}) {
  const [date, setDate] = useState(initialDate)
  const [today] = useState(() => localDate(new Date().toISOString()))
  const [entries, setEntries] = useState<QuantityEntry[]>(() => entriesForDate(data, initialDate))
  const [drafts, setDrafts] = useState<string[]>(() => entries.map((e) => e.quantity?.toString() ?? ''))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [symbol, setSymbol] = useState('')
  const [currency, setCurrency] = useState('TWD')
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? '')
  const [type, setType] = useState<'cash' | 'holding'>('holding')
  const editorRef = useRef<HTMLDialogElement>(null)
  // A quote request belongs to the inputs it was made for; any edit since makes it stale.
  const revision = useRef(0)
  const live = useRef(true)
  const latest = useRef(data)
  useEffect(() => {
    editorRef.current?.showModal()
  }, [])
  useEffect(() => {
    latest.current = data
  }, [data])
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const invalidateRequest = () => {
    revision.current++
    setLoading(false)
    setError('')
  }
  const changeDate = (next: string) => {
    invalidateRequest()
    setDate(next)
    const values = entriesForDate(latest.current, next)
    setEntries(values)
    setDrafts(values.map((e) => e.quantity?.toString() ?? ''))
  }
  const editAt = (setter: typeof setDrafts, i: number, value: string) => {
    invalidateRequest()
    setter((d) => d.map((v, j) => (j === i ? value : v)))
  }

  const save = async () => {
    invalidateRequest()
    const request = revision.current
    try {
      validatePastDate(date)
      if (!expected && latest.current.history.quantityDays?.some((d) => d.date === date)) {
        throw new Error('這一天已有補登，請取消後使用該日的編輯按鈕')
      }
      const rows = entries.map((e, i): QuantityEntry => {
        const { price: _price, fx: _fx, error: _error, ...rest } = e
        const quantity = drafts[i].trim() === '' ? null : Number(drafts[i])
        return { ...rest, quantity }
      })
      const candidate = { date, updatedAt: stamp(), entries: rows }
      parseQuantityDays([candidate])
      if (!rows.length) throw new Error('請先加入至少一項歷史持倉')
      setLoading(true)
      const valued = await valueEntries(rows, date)
      if (live.current && revision.current === request) onApply(applyQuantityDay(latest.current, { ...candidate, entries: valued }, expected))
    } catch (e) {
      if (live.current && revision.current === request) setError(e instanceof Error ? e.message : '無法取得歷史行情')
    } finally {
      if (live.current && revision.current === request) setLoading(false)
    }
  }

  const addRow = () => {
    try {
      const a = data.accounts.find((a) => a.id === accountId)
      if (!a) throw new Error('請先選擇帳戶')
      const entry: QuantityEntry = {
        accountId: a.id,
        account: a.name,
        category: a.category,
        country: a.country,
        type,
        symbol: type === 'cash' ? '' : symbol.trim(),
        currency: currency.trim(),
        quantity: null,
      }
      parseQuantityDays([{ date, updatedAt: stamp(), entries: [...entries, entry] }])
      invalidateRequest()
      setEntries([...entries, entry])
      setDrafts([...drafts, ''])
      setAccountFilter('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '資料不正確')
    }
  }

  return (
    <dialog ref={editorRef} className="review quantity-editor form" aria-label="編輯歷史數量" onCancel={() => { revision.current++; onCancel() }}>
      <h4>{expected ? '編輯歷史數量' : '補登歷史數量'}</h4>
      <label className="field">
        <span>歷史日期</span>
        <input type="date" max={today} disabled={!!expected} value={date} onChange={(e) => changeDate(e.target.value)} />
      </label>
      <p className="muted small">
        填寫當日所有持倉的數量，儲存時自動查詢歷史行情。空白代表未知，0 代表未持有；新日期不複製目前數量。切換日期會清除尚未儲存的輸入。
      </p>
      <label className="field">
        <span>篩選歷史帳戶</span>
        <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
          <option value="">全部帳戶</option>
          {[...new Map(entries.map((e) => [e.accountId, e.account]))].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {entries.map((entry, i) => (
        <div className="quantity-row" key={instrumentKey(entry)} hidden={!!accountFilter && entry.accountId !== accountFilter}>
          <label className="field">
            <span>{nameOf(entry)} 當日數量</span>
            <input inputMode="decimal" value={drafts[i]} onChange={(e) => editAt(setDrafts, i, e.target.value)} />
          </label>
          <small className="muted">
            {entry.type === 'cash' ? '現金：幣別單位值為 1' : '合計同帳戶、同標的、同幣別的所有批次'}
          </small>
          <button type="button" onClick={() => editAt(setDrafts, i, '')}>
            清除數量（未知）
          </button>
        </div>
      ))}
      <details>
        <summary>加入未列出的歷史持倉</summary>
        <p className="muted small">在既有帳戶補登已售出或未曾留下紀錄的標的，不新增目前持倉。</p>
        <label className="field">
          <span>歷史持倉帳戶</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>歷史持倉類型</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="holding">持倉</option>
            <option value="cash">現金</option>
          </select>
        </label>
        {type === 'holding' && (
          <label className="field">
            <span>歷史標的代號</span>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </label>
        )}
        <label className="field">
          <span>歷史持倉幣別</span>
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </label>
        <button onClick={addRow}>加入歷史持倉欄位</button>
      </details>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      <div className="row editor-actions">
        <button className="primary" disabled={loading} onClick={() => void save()}>
          {loading ? '取得歷史行情中…' : '儲存這天'}
        </button>
        <button
          onClick={() => {
            revision.current++
            onCancel()
          }}
        >
          取消歷史編輯
        </button>
      </div>
      <p className="muted small">只修改選定日期，不改變目前持倉。查不到行情時仍保留數量，當日估值顯示資料不完整。</p>
    </dialog>
  )
}
