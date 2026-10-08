// Renders the public pages to static HTML at build time (see scripts/prerender.mjs), so the
// home page and notice pages can be read without JavaScript or signing in, as Google's
// OAuth brand verification requires. In the browser, main.tsx replaces this markup.

import { renderToStaticMarkup } from 'react-dom/server'
import { PAGES, type PageKey } from './site'
import { Landing } from './views/Landing'
import { LegalPage } from './views/Legal'

const noop = () => {}

export const routes: { file: string; title: string; html: () => string }[] = [
  {
    file: 'index.html',
    title: 'Wealthline｜個人資產統計',
    html: () => renderToStaticMarkup(<Landing returning={null} busy={false} message={null} onSignIn={noop} onResume={noop} />),
  },
  ...(Object.keys(PAGES) as PageKey[]).map((k) => ({
    file: `${k}.html`,
    title: `${PAGES[k].title}｜Wealthline`,
    html: () => renderToStaticMarkup(<LegalPage page={k} signedIn={false} />),
  })),
]
