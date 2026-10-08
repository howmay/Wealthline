// Minimal typings for the parts of Google Identity Services this app uses.
// https://developers.google.com/identity/oauth2/web/reference/js-reference

interface GisTokenResponse {
  access_token: string
  expires_in: string | number
  scope: string
  error?: string
  error_description?: string
}

interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    prompt?: string
    login_hint?: string
    callback: (res: GisTokenResponse) => void
    error_callback?: (err: { type: string; message?: string }) => void
  }): GisTokenClient
  hasGrantedAllScopes(res: GisTokenResponse, ...scopes: string[]): boolean
  revoke(token: string, done: () => void): void
}

interface Window {
  google?: { accounts: { oauth2: GisOAuth2 } }
}

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
}
