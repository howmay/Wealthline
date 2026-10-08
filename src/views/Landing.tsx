// The signed-out home page: what the app does, where the data lives, and sign-in.

import type { ReactNode } from 'react'
import type { UserProfile } from '../google/auth'
import { DATA_FILE_NAME, FOLDER_NAME } from '../google/drive'
import { LICENSE_ZH_URL, PAGES, REPO_URL } from '../site'
import { GitHubMark, Link, Logo, SiteFooter } from './Site'

interface Props {
  returning: UserProfile | null
  busy: boolean
  message: { kind: 'busy' | 'error'; text: string } | null
  onSignIn: () => void
  onResume: () => void
}

export function Landing({ returning, busy, message, onSignIn, onResume }: Props) {
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="brand">
          <Logo />
          <span>Wealthline</span>
        </div>
        <a className="gh-link" href={REPO_URL}>
          <GitHubMark /> 原始碼
        </a>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="pill">開放原始碼 · 免費 · 資料自主</p>
            <h1>
              你的資產，
              <br />
              存在你自己的
              <br />
              <span className="accent-text">Google Drive</span>
            </h1>
            <p className="lead">
              用帳戶整理銀行存款、股票、基金與加密貨幣，自動換算匯率與報價，一眼看清資產配置。沒有後端資料庫，作者也看不到你的資料。
            </p>
            <div className="signin-box">
              {returning ? (
                <>
                  <button className="google" onClick={onResume} disabled={busy}>
                    <GoogleMark />以 {returning.email} 繼續
                  </button>
                  <button className="ghost" onClick={onSignIn} disabled={busy}>
                    使用其他帳號
                  </button>
                </>
              ) : (
                <button className="google" onClick={onSignIn} disabled={busy}>
                  <GoogleMark />
                  使用 Google 登入
                </button>
              )}
              {message && <p className={message.kind === 'error' ? 'error small' : 'muted small'}>{message.text}</p>}
              <p className="muted small">
                登入即表示你同意<Link to={PAGES.terms.path}>使用條款</Link>與<Link to={PAGES.privacy.path}>隱私權政策</Link>。
              </p>
            </div>
          </div>
          <Preview />
        </section>

        <section className="landing-section">
          <h2>需要的功能都在這裡</h2>
          <div className="feature-grid">
            <Feature icon={<IconWallet />} title="以帳戶為中心">
              先建立銀行或投資帳戶，再填入各幣別餘額與持有標的，和你實際的資產結構一致。
            </Feature>
            <Feature icon={<IconBolt />} title="自動報價與匯率">
              持倉只要輸入代號和數量，價格、幣別自動查詢；外幣自動換算成新臺幣。
            </Feature>
            <Feature icon={<IconChart />} title="資產配置一目了然">
              依類別、帳戶、幣別、國家拆解總資產，看清集中度與幣別曝險。
            </Feature>
            <Feature icon={<IconClock />} title="歷史與變動紀錄">
              每天保存一次資產快照，每次修改都留下前後數值，儲存前會提醒異常變動。
            </Feature>
          </div>
        </section>

        <section className="landing-section split">
          <div>
            <h2>資料只放在你看得到的地方</h2>
            <ul className="checks">
              <li>只要求 Google Drive 的 drive.file 權限，看不到你雲端硬碟中的其他檔案。</li>
              <li>資料是一個普通的 JSON 檔，可以隨時下載、備份或刪除。</li>
              <li>不使用分析工具、廣告或追蹤 Cookie。</li>
              <li>隨時可以在 Google 帳戶設定中撤銷授權。</li>
            </ul>
            <Link to={PAGES.privacy.path} className="more">
              閱讀隱私權政策 →
            </Link>
          </div>
          <div className="drive-path" aria-label="資料檔位置">
            <div className="drive-row">
              <span className="drive-icon" aria-hidden>
                <IconDrive />
              </span>
              我的雲端硬碟
            </div>
            <div className="drive-row indent">
              <span className="folder" aria-hidden>
                ▸
              </span>
              {FOLDER_NAME}
            </div>
            <div className="drive-row indent-2 file">
              <span className="file-icon" aria-hidden>
                {'{ }'}
              </span>
              {DATA_FILE_NAME}
            </div>
          </div>
        </section>

        <section className="landing-section open-source">
          <div>
            <h2>程式碼完全公開，歡迎審查</h2>
            <p className="muted">
              處理你財務資料的程式，應該讓任何人都能檢查。完整原始碼放在 GitHub，個人學習、研究與教育用途可以自由使用與修改；商業用途需取得作者書面授權。
            </p>
          </div>
          <div className="row">
            <a className="button" href={REPO_URL}>
              <GitHubMark /> 在 GitHub 查看
            </a>
            <a className="button ghost" href={LICENSE_ZH_URL}>
              授權說明
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="feature">
      <span className="feature-icon" aria-hidden>
        {icon}
      </span>
      <h3>{title}</h3>
      <p className="muted">{children}</p>
    </div>
  )
}

// A static sketch of the overview page; the numbers are made up.
function Preview() {
  const parts = [
    { label: '台股', pct: 34, color: 'var(--s1)' },
    { label: '海外股票', pct: 26, color: 'var(--s2)' },
    { label: '現金與外幣', pct: 22, color: 'var(--s3)' },
    { label: '基金與退休金', pct: 11, color: 'var(--s4)' },
    { label: '加密貨幣', pct: 7, color: 'var(--s7)' },
  ]
  return (
    <figure className="preview" aria-label="總覽畫面示意">
      <div className="preview-card">
        <div className="preview-head">
          <span className="eyebrow">總資產（新臺幣）</span>
          <span className="tag good">▲ 2.4% 本月</span>
        </div>
        <div className="preview-total">NT$ 3,284,500</div>
        <svg className="preview-spark" viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--s1)" stopOpacity=".25" />
              <stop offset="1" stopColor="var(--s1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 55 40 50 80 52 120 40 160 43 200 30 240 33 300 12V70H0Z" fill="url(#spark-fill)" />
          <path d="M0 55 40 50 80 52 120 40 160 43 200 30 240 33 300 12" fill="none" stroke="var(--s1)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="preview-bar">
          {parts.map((p) => (
            <span key={p.label} style={{ width: `${p.pct}%`, background: p.color }} />
          ))}
        </div>
        <ul className="preview-legend">
          {parts.map((p) => (
            <li key={p.label}>
              <span className="dot" style={{ background: p.color }} />
              {p.label}
              <span className="muted">{p.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="muted small">畫面示意，數字為虛構</figcaption>
    </figure>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const IconWallet = () => (
  <svg {...iconProps}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18M16 14.5h2" />
  </svg>
)
const IconBolt = () => (
  <svg {...iconProps}>
    <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
  </svg>
)
const IconChart = () => (
  <svg {...iconProps}>
    <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
    <path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z" />
  </svg>
)
const IconClock = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)
const IconDrive = () => (
  <svg {...iconProps} width={18} height={18}>
    <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5Z" />
  </svg>
)
