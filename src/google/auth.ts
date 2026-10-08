// Google sign-in via Google Identity Services (GIS) token model.
// The access token lives only in memory; nothing is stored on any server.

const GIS_SRC = 'https://accounts.google.com/gsi/client'

export const SCOPES = [
  'openid',
  'email',
  'profile',
  // Only files this app creates or the user opens with it; the files stay visible in the user's Drive.
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

export interface AccessToken {
  value: string
  expiresAt: number
}

export interface UserProfile {
  email: string
  name: string
  picture?: string
}

let gisLoaded: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisLoaded ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      gisLoaded = null
      reject(new Error('無法載入 Google 登入元件'))
    }
    document.head.appendChild(script)
  })
  return gisLoaded
}

function clientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!id) throw new Error('尚未設定 VITE_GOOGLE_CLIENT_ID，請參考 docs/google-cloud-setup.md')
  return id
}

// prompt '' reuses an existing grant without showing the consent screen again;
// 'consent' forces the account chooser and consent screen.
export async function requestAccessToken(prompt: '' | 'consent' | 'select_account' = ''): Promise<AccessToken> {
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPES,
      prompt,
      callback: (res) => {
        if (res.error || !res.access_token) {
          reject(new Error(res.error_description || res.error || '登入失敗'))
          return
        }
        if (!window.google!.accounts.oauth2.hasGrantedAllScopes(res, 'https://www.googleapis.com/auth/drive.file')) {
          reject(new Error('需要授權 Google Drive 存取權限才能儲存資料'))
          return
        }
        resolve({ value: res.access_token, expiresAt: Date.now() + Number(res.expires_in) * 1000 })
      },
      error_callback: (err) => reject(new Error(err.message || err.type)),
    })
    client.requestAccessToken()
  })
}

export async function revokeAccessToken(token: AccessToken): Promise<void> {
  await loadGis()
  await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(token.value, () => resolve()))
}

export async function fetchProfile(token: AccessToken): Promise<UserProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.value}` },
  })
  if (!res.ok) throw new Error(`讀取使用者資料失敗 (${res.status})`)
  return res.json()
}
