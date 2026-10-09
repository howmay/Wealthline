// Renders the public pages to static HTML at build time (see scripts/prerender.mjs), so the
// home page and notice pages can be read without JavaScript or signing in, as Google's
// OAuth brand verification requires. In the browser, main.tsx replaces this markup.

import { renderToStaticMarkup } from 'react-dom/server'
import { PAGES, SITE_URL, type PageKey } from './site'
import { Landing } from './views/Landing'
import { LegalPage } from './views/Legal'

const noop = () => {}

export type Route = { file: string; path: string; url: string; title: string; description: string; html: () => string }

export const routes: Route[] = [
  {
    file: 'index.html',
    path: '/',
    url: `${SITE_URL}/`,
    title: 'Wealthline｜個人資產統計 Personal Asset Tracker',
    description: '開源的個人資產統計工具：以 Google 帳號登入，所有資料只存在你自己的 Google Drive，自動換算匯率與報價，清楚呈現資產配置。Wealthline is a free, open-source personal asset tracker that stores your data only in your own Google Drive.',
    html: () => renderToStaticMarkup(<Landing returning={null} busy={false} message={null} onSignIn={noop} onResume={noop} />),
  },
  ...(Object.keys(PAGES) as PageKey[]).map((k) => ({
    file: `${k}.html`,
    path: PAGES[k].path,
    url: `${SITE_URL}${PAGES[k].path}`,
    title: `${PAGES[k].title}｜Wealthline ${PAGES[k].en}`,
    description: PAGES[k].description,
    html: () => renderToStaticMarkup(<LegalPage page={k} signedIn={false} />),
  })),
]
