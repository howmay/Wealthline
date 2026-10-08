// Writes static HTML for the public pages into dist/ after `vite build`:
// dist/index.html, dist/privacy.html, dist/terms.html, dist/disclaimer.html.
// Cloudflare serves /privacy from privacy.html; other paths still fall back to index.html.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const { routes } = await import(pathToFileURL('dist-ssr/prerender.js').href)
const shell = readFileSync('dist/index.html', 'utf8')
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

for (const r of routes) {
  const html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(r.title)}</title>`)
    .replace('<div id="root"></div>', `<div id="root">${r.html()}</div>`)
  if (html === shell) throw new Error(`prerender: could not fill ${r.file}`)
  writeFileSync(`dist/${r.file}`, html)
  console.log(`prerendered dist/${r.file}`)
}
