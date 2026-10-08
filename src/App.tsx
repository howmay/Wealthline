import { useEffect, useRef, useState } from 'react'
import {
  clearSession,
  fetchProfile,
  isFresh,
  loadSession,
  requestAccessToken,
  renewAccessToken,
  revokeAccessToken,
  storeSession,
  type AccessToken,
  type UserProfile,
} from './google/auth'
import { DATA_FILE_NAME, FOLDER_NAME, loadData, saveData } from './google/drive'
import { applyFetchedRates, emptyData, missingRates, parseWealthData, ratesStale, usedCurrencies, type WealthData } from './model'
import { pendingChanges, recordSave, revertChange } from './history'
import { applyQuotes, fetchHoldingQuotes } from './quotes'
import { fetchRates } from './rates'
import { Accounts, type AccountsView } from './views/Accounts'
import { HistoryView } from './views/History'
import { Overview } from './views/Overview'
import { Rates } from './views/Rates'
import { SaveReview } from './views/SaveReview'
import { Landing } from './views/Landing'
import { LegalPage } from './views/Legal'
import { usePage } from './site'
import { Logo, SiteFooter } from './views/Site'
import { createEncryption, decryptData, isEncryptedData, type EncryptionContext } from './encryption'
import { EncryptionDialog } from './views/EncryptionDialog'

const TABS = { overview: '總覽', accounts: '帳戶', history: '歷史', rates: '匯率' }
type Tab = keyof typeof TABS

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }

export default function App() {
  const token = useRef<AccessToken | null>(null)
  const fileId = useRef<string | undefined>(undefined)
  const encryption = useRef<EncryptionContext | undefined>(undefined)
  const [encryptionPending, setEncryptionPending] = useState(false)
  const sessionVersion = useRef(0)
  const [passwordRequest, setPasswordRequest] = useState<{
    creating: boolean; resolve: (password: string) => void; reject: (error: Error) => void
  } | null>(null)
  // The version last read from or written to Drive; each save records what changed since it.
  const saved = useRef<WealthData | null>(null)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [data, setData] = useState<WealthData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [tab, setTab] = useState<Tab>('overview')
  const [accountsView, setAccountsView] = useState<AccountsView>({ page: 'list' })
  // Edits to balances or holdings are shown for review before they become history.
  const [reviewing, setReviewing] = useState(false)
  const [ratesError, setRatesError] = useState('')
  const [priceError, setPriceError] = useState('')
  // A previous session whose token has expired: offer one-click resume as this account.
  const [returning, setReturning] = useState<UserProfile | null>(() => loadSession()?.profile ?? null)
  // The notice pages are open to everyone; the app's own state stays mounted behind them.
  const page = usePage()

  const askPassword = (creating: boolean) => new Promise<string>((resolve, reject) => {
    setPasswordRequest({ creating, resolve, reject })
  })
  const passwordDialog = passwordRequest && <EncryptionDialog creating={passwordRequest.creating}
    onSubmit={(password) => { setPasswordRequest(null); passwordRequest.resolve(password) }}
    onCancel={() => { setPasswordRequest(null); passwordRequest.reject(new Error('已取消，Drive 檔案未被修改。')) }} />

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Renew on save, verifying the account before any Drive write.
  async function validToken(): Promise<AccessToken> {
    if (!token.current || !isFresh(token.current)) {
      if (!user) throw new Error('請先登入')
      token.current = await renewAccessToken(user)
    }
    return token.current
  }

  async function run(text: string, task: () => Promise<void>) {
    setStatus({ kind: 'busy', text })
    try {
      await task()
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  async function openSession(t: AccessToken) {
    const p = await fetchProfile(t)
    let context: EncryptionContext | undefined
    const file = await loadData(t, async (raw) => {
      if (!isEncryptedData(raw)) return parseWealthData(raw)
      const unlocked = await decryptData(raw, await askPassword(false))
      context = unlocked.context
      return parseWealthData(unlocked.data)
    })
    sessionVersion.current++
    encryption.current = context
    setEncryptionPending(false)
    token.current = t
    storeSession({ profile: p })
    setUser(p)
    fileId.current = file?.fileId
    saved.current = file?.data ?? null
    const loaded = file?.data ?? emptyData()
    setData(loaded)
    setDirty(false)
    void refreshMarket(loaded)
  }

  // Updates holding prices, then exchange rates (new quotes can bring new currencies).
  // Like rates, prices stay in memory until the next save.
  async function refreshMarket(from: WealthData) {
    const version = sessionVersion.current
    const { quotes, failed } = await fetchHoldingQuotes(from)
    if (version !== sessionVersion.current) return
    const at = new Date().toISOString()
    setData((d) => (d ? applyQuotes(d, quotes, at) : d))
    setPriceError(failed.length ? `找不到 ${failed.join('、')} 的報價，可以點價格手動輸入。` : '')
    const withQuotes = applyQuotes(from, quotes, at)
    if (ratesStale(withQuotes)) await refreshRates(withQuotes)
  }

  // Updates exchange rates in the background. The new rates are kept in memory and
  // written to Drive with the next save, so opening the app never leaves unsaved changes.
  async function refreshRates(from: WealthData) {
    const version = sessionVersion.current
    setRatesError('')
    try {
      const r = await fetchRates(usedCurrencies(from))
      if (version !== sessionVersion.current) return
      setData((d) => (d ? applyFetchedRates(d, r.rates, r.updatedAt) : d))
      if (r.unsupported.length) setRatesError(`找不到 ${r.unsupported.join('、')} 的匯率，請手動輸入。`)
    } catch (e) {
      if (version !== sessionVersion.current) return
      setRatesError(e instanceof Error ? e.message : String(e))
    }
  }

  const signIn = () =>
    run('登入中…', async () => {
      await openSession(await requestAccessToken('select_account'))
    })

  const resume = () =>
    run('登入中…', async () => {
      if (!returning) return
      const t = await requestAccessToken('', returning.email)
      // The user may have picked a different account in Google's dialog.
      await openSession(t)
    })

  const signOut = () =>
    run('登出中…', async () => {
      const previous = token.current
      sessionVersion.current++
      encryption.current = undefined
      setEncryptionPending(false)
      clearSession()
      token.current = null
      fileId.current = undefined
      saved.current = null
      setReturning(null)
      setUser(null)
      setData(null)
      setDirty(false)
      setReviewing(false)
      // Local logout must finish even if Google's revoke request fails or hangs.
      if (previous) void revokeAccessToken(previous).catch(() => {})
    })

  const save = () =>
    run('儲存到 Google Drive…', async () => {
      if (!data) return
      const next = recordSave(saved.current, { ...data, updatedAt: new Date().toISOString() })
      fileId.current = await saveData(await validToken(), next, fileId.current, encryption.current)
      saved.current = next
      setData(next)
      setDirty(false)
      setReviewing(false)
      setEncryptionPending(false)
    })

  const enableEncryption = () => run('加密並儲存到 Google Drive…', async () => {
    if (!data || dirty || encryption.current) return
    const context = await createEncryption(await askPassword(true))
    // A network failure can occur after Drive accepted ciphertext. Keep the key so
    // retrying can never silently downgrade the file back to plaintext.
    encryption.current = context
    setEncryptionPending(true)
    setDirty(true)
    const id = await saveData(await validToken(), data, fileId.current, context)
    fileId.current = id
    saved.current = data
    setEncryptionPending(false)
    setDirty(false)
  })

  const requestSave = () => {
    if (data && pendingChanges(saved.current, data).length) setReviewing(true)
    else void save()
  }
  const pending = reviewing && data ? pendingChanges(saved.current, data) : []
  useEffect(() => {
    if (reviewing && pending.length === 0) setReviewing(false)
  }, [reviewing, pending.length])

  function update(next: WealthData) {
    setData(next)
    setDirty(true)
  }

  // A newly added holding or balance can bring a currency without a rate: fetch it right away.
  const missingAuto = data ? missingRates(data).filter((c) => !data.fxManual.includes(c)).join(',') : ''
  useEffect(() => {
    if (missingAuto && data) void refreshRates(data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingAuto])

  const busy = status.kind === 'busy'

  function go(t: Tab, view?: AccountsView) {
    setTab(t)
    if (view) setAccountsView(view)
    window.scrollTo({ top: 0 })
  }

  if (page) return <><LegalPage page={page} signedIn={!!user} />{passwordDialog}</>

  if (!user) {
    return (
      <><Landing
        returning={returning}
        busy={busy}
        message={status.kind === 'idle' ? null : status}
        onSignIn={signIn}
        onResume={resume}
      />{passwordDialog}</>
    )
  }

  return (
    <>
      {passwordDialog}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <Logo />
            <span className="brand-name">Wealthline</span>
          </div>
          <nav className="tabs" aria-label="分頁">
            {(Object.keys(TABS) as Tab[]).map((t) => (
              <button
                key={t}
                className={t === tab ? 'active' : ''}
                aria-current={t === tab ? 'page' : undefined}
                onClick={() => go(t, t === 'accounts' ? { page: 'list' } : undefined)}
              >
                {TABS[t]}
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            {dirty ? (
              <button className="primary save" onClick={requestSave} disabled={busy}>
                {busy ? '儲存中…' : '儲存變更'}
              </button>
            ) : (
              <span className="synced" title={`我的雲端硬碟 / ${FOLDER_NAME} / ${DATA_FILE_NAME}`}>
                <span aria-hidden>✓</span> 已同步
              </span>
            )}
            <details className="account-menu">
              <summary aria-label="帳號選單">
                {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{user.email[0]}</span>}
              </summary>
              <div className="menu">
                <strong>{user.name}</strong>
                <span className="muted">{user.email}</span>
                <span className="muted small">
                  資料檔：我的雲端硬碟 / {FOLDER_NAME} / {DATA_FILE_NAME}
                </span>
                {encryption.current ? <span className="muted small">{encryptionPending ? '加密尚未同步，請重試儲存' : '已啟用密碼加密'}</span> : <>
                  <button onClick={enableEncryption} disabled={busy || dirty || !data}>啟用資料加密</button>
                  {dirty && <span className="muted small">請先確認並儲存變更，再啟用加密。</span>}
                </>}
                <button onClick={signOut} disabled={busy}>
                  登出
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>

      {reviewing && data && pending.length > 0 && (
        <SaveReview
          changes={pending}
          busy={busy}
          canRevert={(c) => data.accounts.some((a) => a.id === c.accountId)}
          onRevert={(c) => {
            const next = revertChange(saved.current, data, c)
            if (next) update(next)
          }}
          onConfirm={save}
          onCancel={() => setReviewing(false)}
        />
      )}

      <main className="content">
        {status.kind === 'busy' && !data && <p className="muted">{status.text}</p>}
        {status.kind === 'error' && <p className="banner error">{status.text}</p>}

        {data && tab === 'overview' && (
          <Overview
            data={data}
            onGoRates={() => go('rates')}
            onNewAccount={() => go('accounts', { page: 'new' })}
            onImport={() => go('accounts', { page: 'list', importing: true })}
            onOpenAccount={(name) => {
              const a = data.accounts.find((x) => x.name === name)
              if (a) go('accounts', { page: 'detail', id: a.id })
            }}
          />
        )}
        {data && tab === 'accounts' && (
          <Accounts
            data={data}
            onChange={update}
            view={accountsView}
            setView={setAccountsView}
            onRefreshPrices={() => refreshMarket(data)}
            priceError={priceError}
          />
        )}
        {data && tab === 'history' && (
          <HistoryView
            data={data}
            dirty={dirty}
            busy={busy}
            onSave={requestSave}
            onChange={update}
            onOpenAccount={(id) => go('accounts', { page: 'detail', id })}
          />
        )}
        {data && tab === 'rates' && <Rates data={data} onChange={update} onRefresh={() => refreshRates(data)} error={ratesError} />}
      </main>
      <SiteFooter />
    </>
  )
}
