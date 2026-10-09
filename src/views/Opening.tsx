// The screen between signing in and the app: the logo draws itself while the account
// is checked and the data file is read from Google Drive.

import type { UserProfile } from '../google/auth'

export type OpeningStep = 'auth' | 'drive'

const STEPS: { key: OpeningStep; text: string }[] = [
  { key: 'auth', text: '確認 Google 帳號' },
  { key: 'drive', text: '從 Google Drive 讀取資料' },
]

interface Props {
  step: OpeningStep
  profile?: UserProfile
}

export function Opening({ step, profile }: Props) {
  const current = STEPS.findIndex((s) => s.key === step)
  return (
    <div className="opening" role="status" aria-live="polite">
      <div className="opening-card">
        <svg className="opening-logo" width="72" height="72" viewBox="0 0 64 64" aria-hidden>
          <defs>
            <linearGradient id="opening-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#3a8ef0" />
              <stop offset="1" stopColor="#4a3aa7" />
            </linearGradient>
            <linearGradient id="opening-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".28" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="15" fill="url(#opening-bg)" />
          <path className="opening-area" d="M13 22 22.5 43 32 29 41.5 43 49.5 19.5V50H13Z" fill="url(#opening-area)" />
          <path
            className="opening-line"
            d="M13 22 22.5 43 32 29 41.5 43 49.5 19.5"
            pathLength="100"
            fill="none"
            stroke="#fff"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle className="opening-dot" cx="49.5" cy="19.5" r="4.5" fill="#ffd166" stroke="#fff" strokeWidth="2" />
        </svg>
        <p className="opening-title">{profile ? `歡迎回來，${profile.name || profile.email}` : 'Wealthline'}</p>
        <ol className="opening-steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i < current ? 'done' : i === current ? 'active' : ''}>
              <span className="opening-mark" aria-hidden />
              {s.text}
            </li>
          ))}
        </ol>
        <div className="opening-bar" aria-hidden>
          <span />
        </div>
      </div>
    </div>
  )
}
