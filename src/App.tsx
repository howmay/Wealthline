import { useRef, useState, type FormEvent } from 'react'
import { fetchProfile, requestAccessToken, revokeAccessToken, type AccessToken, type UserProfile } from './google/auth'
import { DATA_FILE_NAME, FOLDER_NAME, loadData, saveData } from './google/drive'
import { ASSET_CATEGORIES, emptyData, totalsByCurrency, type AssetCategory, type WealthData } from './model'

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }

const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 2 })

export default function App() {
  const token = useRef<AccessToken | null>(null)
  const fileId = useRef<string | undefined>(undefined)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [data, setData] = useState<WealthData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

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
      const file = await loadData<WealthData>(token.current)
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

  function addAsset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!data) return
    const form = new FormData(e.currentTarget)
    const amount = Number(form.get('amount'))
    if (!Number.isFinite(amount)) return
    update({
      ...data,
      assets: [
        ...data.assets,
        {
          id: crypto.randomUUID(),
          name: String(form.get('name')).trim(),
          category: form.get('category') as AssetCategory,
          currency: String(form.get('currency')).trim().toUpperCase() || 'TWD',
          amount,
        },
      ],
    })
    e.currentTarget.reset()
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
            <section>
              <h2>資產統計</h2>
              {data.assets.length === 0 ? (
                <p>尚無資產，請在下方新增。</p>
              ) : (
                [...totalsByCurrency(data.assets)].map(([currency, { total, byCategory }]) => (
                  <div key={currency} className="totals">
                    <strong>
                      {currency} {fmt(total)}
                    </strong>
                    <ul>
                      {[...byCategory].map(([cat, sum]) => (
                        <li key={cat}>
                          {cat}：{fmt(sum)}（{total ? ((sum / total) * 100).toFixed(1) : 0}%）
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <section>
              <h2>資產明細</h2>
              <table>
                <thead>
                  <tr>
                    <th>名稱</th>
                    <th>類別</th>
                    <th>幣別</th>
                    <th className="num">金額</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.assets.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.category}</td>
                      <td>{a.currency}</td>
                      <td className="num">{fmt(a.amount)}</td>
                      <td>
                        <button onClick={() => update({ ...data, assets: data.assets.filter((x) => x.id !== a.id) })}>
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <form onSubmit={addAsset} className="add">
                <input name="name" placeholder="名稱" required />
                <select name="category" defaultValue={ASSET_CATEGORIES[0]}>
                  {ASSET_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <input name="currency" placeholder="幣別" defaultValue="TWD" size={5} />
                <input name="amount" type="number" step="any" placeholder="金額" required />
                <button type="submit">新增</button>
              </form>
            </section>

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
