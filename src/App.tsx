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
import { emptyData, parseWealthData, type WealthData } from './model'
import { Accounts } from './views/Accounts'
import { Overview } from './views/Overview'
import { Rates } from './views/Rates'

const TABS = { overview: '總覽', accounts: '帳戶', rates: '匯率' }
type Tab = keyof typeof TABS

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }

export default function App() {
  const token = useRef<AccessToken | null>(null)
  const fileId = useRef<string | undefined>(undefined)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [data, setData] = useState<WealthData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [tab, setTab] = useState<Tab>('overview')
  // A previous session whose token has expired: offer one-click resume as this account.
  const [returning, setReturning] = useState<UserProfile | null>(() => loadSession()?.profile ?? null)

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
    setData(file?.data ?? emptyData())
    setDirty(false)
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
      setReturning(null)
      setUser(null)
      setData(null)
    })

  const save = () =>
    run('儲存到 Google Drive…', async () => {
      if (!data) return
      const next = { ...data, updatedAt: new Date().toISOString() }
      fileId.current = await saveData(await validToken(), next, fileId.current)
      setData(next)
      setDirty(false)
    })

  function update(next: WealthData) {
    setData(next)
    setDirty(true)
  }

  const busy = status.kind === 'busy'

  return (
    <main>
      <header>
        <h1>We Wealth</h1>
        {user && (
          <div className="user">
            {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
            <span>{user.email}</span>
            <button onClick={signOut} disabled={busy}>
              登出
            </button>
          </div>
        )}
      </header>

      {status.kind === 'busy' && <p className="status">{status.text}</p>}
      {status.kind === 'error' && <p className="status error">{status.text}</p>}

      {!user ? (
        <section className="signin">
          <p>使用 Google 帳號登入。所有資料只存放在你自己的 Google Drive 中。</p>
          {returning ? (
            <div className="row">
              <button onClick={resume} disabled={busy}>
                以 {returning.email} 繼續
              </button>
              <button className="secondary" onClick={signIn} disabled={busy}>
                使用其他帳號
              </button>
            </div>
          ) : (
            <button onClick={signIn} disabled={busy}>
              使用 Google 登入
            </button>
          )}
        </section>
      ) : (
        data && (
          <>
            <nav className="tabs">
              {(Object.keys(TABS) as Tab[]).map((t) => (
                <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
                  {TABS[t]}
                </button>
              ))}
            </nav>

            {tab === 'overview' && <Overview data={data} onGoRates={() => setTab('rates')} />}
            {tab === 'accounts' && <Accounts data={data} onChange={update} />}
            {tab === 'rates' && <Rates data={data} onChange={update} />}

            <footer>
              <button onClick={save} disabled={busy || !dirty}>
                {dirty ? '儲存到 Google Drive' : '已儲存'}
              </button>
              <small>
                檔案位置：我的雲端硬碟 / {FOLDER_NAME} / {DATA_FILE_NAME}
                {data.updatedAt && `（最後更新 ${new Date(data.updatedAt).toLocaleString('zh-TW')}）`}
              </small>
            </footer>
          </>
        )
      )}
    </main>
  )
}
