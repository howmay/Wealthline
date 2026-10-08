// Site-wide links and a tiny path router for the public notice pages.

import { useSyncExternalStore } from 'react'

export const REPO_URL = 'https://github.com/howmay/we-wealth'
export const ISSUES_URL = `${REPO_URL}/issues`
export const SECURITY_URL = `${REPO_URL}/security/advisories/new`
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`
export const LICENSE_ZH_URL = `${REPO_URL}/blob/main/LICENSE.zh-TW.md`
export const AUTHOR = 'Harvey Chen'
export const AUTHOR_URL = 'https://github.com/zhChenOuO'

export const PAGES = {
  privacy: { path: '/privacy', title: '隱私權政策' },
  terms: { path: '/terms', title: '使用條款' },
  disclaimer: { path: '/disclaimer', title: '免責聲明' },
} as const
export type PageKey = keyof typeof PAGES

// Cloudflare Pages serves index.html for unknown paths, so these routes work on reload too.
const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

export function usePage(): PageKey | null {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname.replace(/\/+$/, ''))
  return (Object.keys(PAGES) as PageKey[]).find((k) => PAGES[k].path === path) ?? null
}

export function navigate(to: string) {
  if (to === window.location.pathname) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo({ top: 0 })
}
