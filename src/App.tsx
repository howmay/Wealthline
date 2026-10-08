import { useEffect, useRef, useState } from 'react'
import {
  clearSession,
  fetchProfile,
  isFresh,
  loadSession,
  requestAccessToken,
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
import { PAGES, usePage } from './site'
import { Link, Logo, PrivacyNotice, SiteFooter } from './views/Site'

const TABS = { overview: '總覽', accounts: '帳戶', history: '歷史', rates: '匯率' }
type Tab = keyof typeof TABS

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }

export default function App() {
  const token = useRef<AccessToken | null>(null)
  const fileId = useRef<string | undefined>(undefined)
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

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Access tokens last about an hour; get a new one silently a minute before expiry.
  async function validToken(): Promise<AccessToken> {
    if (!token.current || !isFresh(token.current)) {
      token.current = await requestAccessToken('', user?.email)
      if (user) storeSession({ token: token.current, profile: user })
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

  async function openSession(t: AccessToken, profile?: UserProfile) {
    token.current = t
    const p = profile ?? (await fetchProfile(t))
    storeSession({ token: t, profile: p })
    setUser(p)
    const file = await loadData(t, parseWealthData)
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
    const { quotes, failed } = await fetchHoldingQuotes(from)
    const at = new Date().toISOString()
    setData((d) => (d ? applyQuotes(d, quotes, at) : d))
    setPriceError(failed.length ? `找不到 ${failed.join('、')} 的報價，可以點價格手動輸入。` : '')
    const withQuotes = applyQuotes(from, quotes, at)
    if (ratesStale(withQuotes)) await refreshRates(withQuotes)
  }

  // Updates exchange rates in the background. The new rates are kept in memory and
  // written to Drive with the next save, so opening the app never leaves unsaved changes.
  async function refreshRates(from: WealthData) {
    setRatesError('')
    try {
      const r = await fetchRates(usedCurrencies(from))
      setData((d) => (d ? applyFetchedRates(d, r.rates, r.updatedAt) : d))
      if (r.unsupported.length) setRatesError(`找不到 ${r.unsupported.join('、')} 的匯率，請手動輸入。`)
    } catch (e) {
      setRatesError(e instanceof Error ? e.message : String(e))
    }
  }

  // Restore the last session on load while its token is still valid.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const s = loadSession()
    if (!s || !isFresh(s.token)) return
    void run('載入中…', async () => {
      try {
        await openSession(s.token, s.profile)
      } catch {
        // Token revoked or rejected: fall back to the one-click resume button.
        token.current = null
        setUser(null)
        setData(null)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      if (token.current) await revokeAccessToken(token.current)
      clearSession()
      token.current = null
      fileId.current = undefined
      saved.current = null
      setReturning(null)
      setUser(null)
      setData(null)
    })

  const save = () =>
    run('儲存到 Google Drive…', async () => {
      if (!data) return
      const next = recordSave(saved.current, { ...data, updatedAt: new Date().toISOString() })
      fileId.current = await saveData(await validToken(), next, fileId.current)
      saved.current = next
      setData(next)
      setDirty(false)
      setReviewing(false)
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

  if (page) return <LegalPage page={page} signedIn={!!user} />

  if (!user) {
    return (
      <Landing
        returning={returning}
        busy={busy}
        message={status.kind === 'idle' ? null : status}
        onSignIn={signIn}
        onResume={resume}
      />
    )
  }

  return (
    <>
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
                <Link to={PAGES.privacy.path} className="small">
                  隱私權政策 Privacy Policy
                </Link>
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
        <PrivacyNotice />
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
