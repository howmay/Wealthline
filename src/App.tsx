import { useEffect, useRef, useState } from 'react'
import { fetchProfile, requestAccessToken, revokeAccessToken, type AccessToken, type UserProfile } from './google/auth'
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

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Access tokens last about an hour; refresh silently a minute before expiry.
  async function validToken(): Promise<AccessToken> {
    if (!token.current || token.current.expiresAt - Date.now() < 60_000) {
      token.current = await requestAccessToken('')
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

  const signIn = () =>
    run('登入中…', async () => {
      token.current = await requestAccessToken('select_account')
      setUser(await fetchProfile(token.current))
      const file = await loadData(token.current, parseWealthData)
      fileId.current = file?.fileId
      setData(file?.data ?? emptyData())
      setDirty(false)
    })

  const signOut = () =>
    run('登出中…', async () => {
      if (token.current) await revokeAccessToken(token.current)
      token.current = null
      fileId.current = undefined
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
          <button onClick={signIn} disabled={busy}>
            使用 Google 登入
          </button>
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
