import { readFile } from 'node:fs/promises'

const ROOT = new URL('../standalone/', import.meta.url)

async function assets() {
  const [html, css, js] = await Promise.all([
    readFile(new URL('canvas.html', ROOT), 'utf8'),
    readFile(new URL('canvas.css', ROOT), 'utf8'),
    readFile(new URL('canvas.js', ROOT), 'utf8'),
  ])
  return { html, css, js }
}

/**
 * Render the standalone, read-only canvas page. The page receives one detached
 * state snapshot and the process token; it never reads another review itself.
 */
export async function renderCanvasPage({ state, base, token }) {
  const { html, css, js } = await assets()
  const safeData = JSON.stringify(state).replaceAll('<', '\\u003c')
  return html
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js)
    .replace('__REVIEW_DATA__', () => safeData)
    .replace('__REVIEW_BASE_JSON__', () => JSON.stringify(base))
    .replace('__REVIEW_TOKEN_JSON__', () => JSON.stringify(token))
    .replaceAll('__REVIEW_TITLE__', () => escapeText(state.title ?? '前端评审画布'))
}

function escapeText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
