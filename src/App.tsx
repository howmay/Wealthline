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
import { DATA_FILE_NAME, FOLDER_NAME, loadData, saveData, type DriveFile } from './google/drive'
import { applyFetchedRates, emptyData, missingRates, parseWealthData, ratesStale, usedCurrencies, type WealthData } from './model'
import { localDate, pendingChanges, recordSave, revertChange } from './history'
import { applyQuotes, fetchHoldingQuotes } from './quotes'
import { fetchRates } from './rates'
import { Accounts, type AccountsView } from './views/Accounts'
import { HistoryView } from './views/History'
import { Overview } from './views/Overview'
import { Rates } from './views/Rates'
import { SaveReview } from './views/SaveReview'
import { Landing } from './views/Landing'
import { Opening, type OpeningStep } from './views/Opening'
import { LegalPage } from './views/Legal'
import { PAGES, goBack, navigate, usePage, usePath } from './site'
import { TABS, parseRoute, routePath, tabPath, type Route, type Tab } from './routes'
import { Link, Logo, PrivacyNotice, SiteFooter } from './views/Site'

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }

export default function App() {
  const token = useRef<AccessToken | null>(null)
  const fileId = useRef<string | undefined>(undefined)
  const sessionVersion = useRef(0)
  // The version last read from or written to Drive; each save records what changed since it.
  const saved = useRef<WealthData | null>(null)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [data, setData] = useState<WealthData | null>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // Edits to balances or holdings are shown for review before they become history.
  const [reviewing, setReviewing] = useState(false)
  const [ratesError, setRatesError] = useState('')
  const [priceError, setPriceError] = useState('')
  // A previous session whose token has expired: offer one-click resume as this account.
  const [returning, setReturning] = useState<UserProfile | null>(() => loadSession()?.profile ?? null)
  // Between getting a token and showing the app. A reload with a live token starts here,
  // so the signed-out page never flashes before the app.
  const [opening, setOpening] = useState<{ step: OpeningStep; profile?: UserProfile } | null>(() =>
    loadSession()?.token ? { step: 'auth' } : null,
  )
  // Prices and rates being fetched after the data file has loaded.
  const [refreshing, setRefreshing] = useState(false)
  // The notice pages are open to everyone; the app's own state stays mounted behind them.
  const page = usePage()
  // Every page of the signed-in app has its own URL, so back and forward move between them.
  const route = parseRoute(usePath())
  const tab = route.tab

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
      storeSession({ profile: user, token: token.current })
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
    setOpening({ step: 'auth' })
    let p: UserProfile
    let file: DriveFile<WealthData> | null
    try {
      p = await fetchProfile(t)
      setOpening({ step: 'drive', profile: p })
      file = await loadData(t, parseWealthData)
    } finally {
      setOpening(null)
    }
    const version = ++sessionVersion.current
    token.current = t
    storeSession({ profile: p, token: t })
    setUser(p)
    fileId.current = file?.fileId
    saved.current = file?.data ?? null
    const loaded = file?.data ?? emptyData()
    setData(loaded)
    setDirty(false)
    setRefreshing(true)
    void refreshMarket(loaded)
      .then((market) => {
        if (version === sessionVersion.current) setRefreshing(false)
        return market && recordToday(market)
      })
      .catch(() => version === sessionVersion.current && setRefreshing(false))
  }

  // Updates holding prices, then exchange rates (new quotes can bring new currencies).
  // Like rates, prices stay in memory until the next save. Returns `from` with the
  // new prices and rates, or null when the user signed out meanwhile.
  async function refreshMarket(from: WealthData): Promise<WealthData | null> {
    const version = sessionVersion.current
    const { quotes, failed } = await fetchHoldingQuotes(from)
    if (version !== sessionVersion.current) return null
    const at = new Date().toISOString()
    setData((d) => (d ? applyQuotes(d, quotes, at) : d))
    setPriceError(failed.length ? `找不到 ${failed.join('、')} 的報價，可以點價格手動輸入。` : '')
    const withQuotes = applyQuotes(from, quotes, at)
    return ratesStale(withQuotes) ? refreshRates(withQuotes) : withQuotes
  }

  // Updates exchange rates in the background. The new rates are kept in memory and
  // written to Drive with the next save (or today's first record), so opening the app never leaves unsaved changes.
  async function refreshRates(from: WealthData): Promise<WealthData | null> {
    const version = sessionVersion.current
    setRatesError('')
    try {
      const r = await fetchRates(usedCurrencies(from))
      if (version !== sessionVersion.current) return null
      setData((d) => (d ? applyFetchedRates(d, r.rates, r.updatedAt) : d))
      if (r.unsupported.length) setRatesError(`找不到 ${r.unsupported.join('、')} 的匯率，請手動輸入。`)
      return applyFetchedRates(from, r.rates, r.updatedAt)
    } catch (e) {
      if (version !== sessionVersion.current) return null
      setRatesError(e instanceof Error ? e.message : String(e))
      return from
    }
  }

  // The first sign-in of the day records that day's values with fresh prices, so the
  // daily history fills in without the user having to save. Only market data changes:
  // `market` is the saved file with new prices and rates, so no edits are logged.
  async function recordToday(market: WealthData) {
    const version = sessionVersion.current
    const at = new Date().toISOString()
    const last = saved.current
    if (!last || !market.accounts.length || dirtyRef.current) return
    if (last.history.snapshots.some((s) => s.date === localDate(at))) return
    // A value without its exchange rate would record a wrong day.
    if (missingRates(market).length) return
    const next = recordSave(last, { ...market, updatedAt: at })
    try {
      fileId.current = await saveData(await validToken(), next, fileId.current)
    } catch {
      return // Not worth an error: the next save records today anyway.
    }
    if (version !== sessionVersion.current) return
    saved.current = next
    // Keep any edits made while it was saving; only the history and the new stamps are added.
    const stamps = new Map(next.accounts.flatMap((a) => a.positions.map((p) => [p.id, p.addedAt])))
    setData((d) =>
      d
        ? {
            ...d,
            // An edit meanwhile (say, a deleted history entry) wins; that save records today again.
            history: dirtyRef.current ? d.history : next.history,
            accounts: d.accounts.map((a) => ({ ...a, positions: a.positions.map((p) => (p.addedAt ? p : { ...p, addedAt: stamps.get(p.id) })) })),
          }
        : d,
    )
  }

  // Restore the session after a reload while this tab's token is still valid.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const stored = loadSession()?.token
    if (!stored) return
    void run('載入中…', async () => {
      try {
        await openSession(stored)
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
      const previous = token.current
      sessionVersion.current++
      clearSession()
      token.current = null
      fileId.current = undefined
      saved.current = null
      setReturning(null)
      setRefreshing(false)
      setUser(null)
      setData(null)
      setDirty(false)
      setReviewing(false)
      navigate('/', { replace: true })
      // Local logout must finish even if Google's revoke request fails or hangs.
      if (previous) void revokeAccessToken(previous).catch(() => {})
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

  // An account that no longer exists (deleted, or an old link) shows the account list instead.
  const missingAccount = !!data && 'id' in route && !data.accounts.some((a) => a.id === route.id)
  useEffect(() => {
    if (missingAccount) navigate('/accounts', { replace: true })
  }, [missingAccount])

  const busy = status.kind === 'busy'

  const go = (r: Route, replace = false) => navigate(routePath(r), { replace })
  const goAccounts = (view: AccountsView, replace = false) => go({ tab: 'accounts', ...view }, replace)

  if (page) return <LegalPage page={page} signedIn={!!user} />

  if (!user) {
    if (opening) return <Opening step={opening.step} profile={opening.profile} />
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
    <div className="app-enter">
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
                onClick={() => navigate(tabPath(t))}
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
            ) : refreshing ? (
              <span className="refreshing" role="status">
                <span className="spinner" aria-hidden /> 更新報價
              </span>
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

      <main className="content view-enter" key={tab}>
        <PrivacyNotice />
        {status.kind === 'busy' && !data && <p className="muted">{status.text}</p>}
        {status.kind === 'error' && <p className="banner error">{status.text}</p>}

        {data && tab === 'overview' && (
          <Overview
            data={data}
            onGoRates={() => go({ tab: 'rates' })}
            onNewAccount={() => goAccounts({ page: 'new' })}
            onImport={() => goAccounts({ page: 'list', importing: true })}
            onOpenAccount={(name) => {
              const a = data.accounts.find((x) => x.name === name)
              if (a) goAccounts({ page: 'detail', id: a.id })
            }}
          />
        )}
        {data && route.tab === 'accounts' && (
          <Accounts
            data={data}
            onChange={update}
            view={route}
            setView={goAccounts}
            onBack={(fallback) => goBack(routePath({ tab: 'accounts', ...fallback }))}
            onRefreshPrices={async () => void (await refreshMarket(data))}
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
            onOpenAccount={(id) => goAccounts({ page: 'detail', id })}
          />
        )}
        {data && tab === 'rates' && <Rates data={data} onChange={update} onRefresh={async () => void (await refreshRates(data))} error={ratesError} />}
      </main>
      <SiteFooter />
    </div>
  )
}
