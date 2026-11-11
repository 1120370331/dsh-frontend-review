import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { renderCanvasPage } from './canvas-page.js'
import { dataPathForFile, canvasState } from './service.js'
import { safeJoin } from './util.js'

const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * Mount the canvas API on the host webServer. The route is intentionally
 * separate from /api so it works in a plain browser profile without the
 * harness's browser cookie while still requiring the per-process review token.
 */
export function mountReviewRoutes({ webServer, service, token, basePath = '/frontend-review', getSessionCwd, logger }) {
  // The web-server's prefix matcher appends its own slash, so registering
  // "/frontend-review/" would turn the probe into "/frontend-review//" and
  // never match "/frontend-review/api/...".
  const prefix = '/frontend-review'
  const route = {
    kind: 'prefix',
    path: prefix,
    handler: (req, res) => handle(req, res, { service, token, basePath, getSessionCwd, logger }).catch((error) => {
      logger?.warn?.(`frontend-review route failed: ${error?.message ?? error}`)
      if (res.headersSent) {
        res.destroy()
        return
      }
      const status = error?.code === 'REVISION_CONFLICT'
        ? 409
        : error?.code === 'REVIEW_NOT_FOUND'
          ? 404
          : error?.code === 'BODY_TOO_LARGE'
            ? 413
            : error?.code === 'INVALID_JSON'
              ? 400
              : error?.code === 'REVIEW_SESSION_MISMATCH'
                ? 403
                : 400
      sendJson(res, status, {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.revision !== undefined ? { revision: error.revision } : {}),
      })
    }),
  }
  return webServer.register(route)
}

async function handle(req, res, context) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname.startsWith('/frontend-review/')
    ? url.pathname.slice('/frontend-review'.length)
    : url.pathname
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  const requestOrigin = req.headers.origin
  if (typeof requestOrigin === 'string' && requestOrigin.length > 0) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin)
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      allow: 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-review-token',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-max-age': '600',
    })
    res.end()
    return
  }

  if (!authorize(req, url, context.token)) {
    sendJson(res, 401, { error: 'invalid review token' })
    return
  }

  if (path === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, version: 1 })
    return
  }

  if (path === '/canvas' && req.method === 'GET') {
    const reviewId = url.searchParams.get('reviewId') ?? undefined
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    const review = await resolveForRequest(context, { reviewId, sessionId })
    if (!review) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>Canvas not found</title><body style="font-family:sans-serif;padding:40px"><h1>Canvas not found</h1><p>Open the frontend review canvas from its bound Harness conversation.</p>')
      return
    }
    const html = await renderCanvasPage({
      state: canvasState(review),
      base: context.basePath,
      token: context.token,
    })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': [
        "default-src 'none'",
        "img-src 'self' data:",
        "style-src 'unsafe-inline'",
        "script-src 'unsafe-inline'",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-src 'self' http: https:",
      ].join('; '),
      'cache-control': 'no-store',
    })
    res.end(html)
    return
  }

  if (path.startsWith('/api/asset/') && req.method === 'GET') {
    await serveAsset(req, res, path, context)
    return
  }

  if (path.startsWith('/api/html/') && req.method === 'GET') {
    await serveHtml(req, res, path, context)
    return
  }

  if (path === '/api/review' && req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    const reviewId = url.searchParams.get('reviewId') ?? undefined
    const review = await resolveForRequest(context, { reviewId, sessionId })
    if (!review) {
      sendJson(res, 404, { code: 'NO_REVIEW', error: 'this conversation has no review canvas yet' })
      return
    }
    sendJson(res, 200, canvasState(review))
    return
  }

  if (path === '/api/reviews' && req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    const list = await context.service.store.list(sessionId)
    sendJson(res, 200, {
      reviews: list.map((review) => ({
        id: review.id,
        title: review.title,
        revision: review.revision,
        updatedAt: review.updatedAt,
        pages: review.pages.length,
        versions: review.versions.length,
        batches: review.batches.length,
      })),
    })
    return
  }

  if (path === '/api/open' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (body.reviewId) {
      const review = await resolveForRequest(context, {
        reviewId: body.reviewId,
        sessionId: body.sessionId,
      })
      if (!review) throw new Error('review not found')
      const mutated = await context.service.store.mutate(review.id, (draft) => {
        draft.pendingOpen = { at: new Date().toISOString(), source: 'ui' }
      })
      sendJson(res, 200, { review: canvasState(mutated.review), opened: true })
      return
    }
    if (!body.sessionId) throw new Error('sessionId is required')
    const projectRoot = typeof body.projectRoot === 'string' && body.projectRoot
      ? body.projectRoot
      : context.getSessionCwd(body.sessionId) ?? process.cwd()
    const opened = await context.service.open({
      sessionId: body.sessionId,
      projectRoot,
      title: typeof body.title === 'string' ? body.title : undefined,
    })
    sendJson(res, 200, { review: canvasState(opened.review), created: opened.created })
    return
  }

  if (path === '/api/claim-open' && req.method === 'POST') {
    const body = await readJsonBody(req)
    if (!body.reviewId) throw new Error('reviewId is required')
    const review = await resolveForRequest(context, { reviewId: body.reviewId, sessionId: body.sessionId })
    if (!review) throw new Error('review not found')
    const claimed = await context.service.claimOpen({ review })
    sendJson(res, 200, claimed)
    return
  }

  if (path === '/api/annotation' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = await context.service.upsertAnnotation({
      review,
      annotation: body.annotation ?? body,
      expectedRevision: body.expectedRevision,
    })
    sendJson(res, 200, { ...result, review: canvasState((await context.service.store.get(review.id))) })
    return
  }

  if (path === '/api/annotation' && req.method === 'DELETE') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = await context.service.deleteAnnotation({
      review,
      annotationId: body.annotationId,
      expectedRevision: body.expectedRevision,
    })
    sendJson(res, 200, { ...result, review: canvasState((await context.service.store.get(review.id))) })
    return
  }

  if (path === '/api/layout' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = Array.isArray(body.placements)
      ? await context.service.moveCards({ review, placements: body.placements, expectedRevision: body.expectedRevision })
      : await context.service.updateCard({
          review,
          versionId: body.versionId,
          x: body.x,
          y: body.y,
          locked: body.locked,
          sectionId: body.sectionId,
          expectedRevision: body.expectedRevision,
        })
    sendJson(res, 200, { ...result, review: canvasState((await context.service.store.get(review.id))) })
    return
  }

  if (path === '/api/groups' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = await context.service.groupAction({
      review,
      action: body.action,
      nodeIds: body.nodeIds,
      groupId: body.groupId,
      name: body.name,
      color: body.color,
      expectedRevision: body.expectedRevision,
    })
    sendJson(res, 200, { ...result, review: canvasState((await context.service.store.get(review.id))) })
    return
  }

  if (path === '/api/card' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = await context.service.editCard({
      review,
      versionId: body.versionId,
      title: body.title,
      variantName: body.variantName,
      note: body.note,
      expectedRevision: body.expectedRevision,
    })
    sendJson(res, 200, { ...result, review: canvasState((await context.service.store.get(review.id))) })
    return
  }

  if (path === '/api/feedback' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = await context.service.submitFeedback({
      review,
      annotationIds: body.annotationIds,
      summary: body.summary,
      versionIds: body.versionIds,
      idempotencyKey: body.idempotencyKey,
      source: 'ui',
    })
    const fresh = await context.service.store.get(review.id)
    sendJson(res, 200, { ...result, review: canvasState(fresh) })
    return
  }

  if (path === '/api/feedback/retry' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = await context.service.retryDelivery({ review, batchId: body.batchId })
    sendJson(res, 200, { ...result, review: canvasState((await context.service.store.get(review.id))) })
    return
  }

  if (path === '/api/feedback/confirm' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const { review } = await requireReview(context, body)
    const result = await context.service.confirmFeedback({
      review,
      annotationId: body.annotationId,
      batchId: body.batchId,
    })
    sendJson(res, 200, { ...result, review: canvasState((await context.service.store.get(review.id))) })
    return
  }

  sendJson(res, 404, { error: `unknown review route: ${req.method} ${path}` })
}

async function resolveForRequest(context, { reviewId, sessionId }) {
  if (reviewId) {
    const review = await context.service.store.get(reviewId)
    if (!review) return undefined
    if (sessionId && review.sessionId !== sessionId) throw new Error('review belongs to another conversation')
    return review
  }
  if (!sessionId) return undefined
  return context.service.store.findDefault({ sessionId })
}

async function requireReview(context, body) {
  const review = await resolveForRequest(context, { reviewId: body.reviewId, sessionId: body.sessionId })
  if (!review) throw Object.assign(new Error('review not found'), { code: 'REVIEW_NOT_FOUND' })
  return { review }
}

function authorize(req, url, token) {
  const header = req.headers['x-review-token']
  const supplied = (Array.isArray(header) ? header[0] : header) || url.searchParams.get('token')
  if (typeof supplied === 'string' && supplied === token) return true
  // The canvas is same-origin with the Harness page. This keeps the UI usable
  // after a plugin HMR reload that happened before the index injection was
  // picked up, while a non-browser local process still needs the token.
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'same-origin') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && typeof host === 'string') {
    try {
      if (new URL(origin).host === host) return true
    } catch {
      // malformed Origin stays unauthorized
    }
  }
  return false
}

async function serveAsset(req, res, path, context) {
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 4) {
    sendJson(res, 404, { error: 'missing asset identity' })
    return
  }
  const [, , reviewId, versionId] = parts
  const review = await context.service.store.get(reviewId)
  if (!review) {
    sendJson(res, 404, { error: 'review not found' })
    return
  }
  const version = review.versions.find((entry) => entry.id === versionId)
  if (!version?.snapshot?.file) {
    sendJson(res, 404, { error: 'snapshot not found' })
    return
  }
  const data = await readFile(dataPathForFile(context.service.dataDir, version.snapshot.file))
  res.writeHead(200, {
    'content-type': version.snapshot.mediaType || 'image/png',
    'content-length': data.length,
    'cache-control': 'private, max-age=3600',
  })
  res.end(data)
}

async function serveHtml(req, res, path, context) {
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 4) {
    sendJson(res, 404, { error: 'missing html identity' })
    return
  }
  const [, , reviewId, versionId] = parts
  const review = await context.service.store.get(reviewId)
  if (!review) {
    sendJson(res, 404, { error: 'review not found' })
    return
  }
  const version = review.versions.find((entry) => entry.id === versionId)
  if (!version?.htmlFile) {
    sendJson(res, 404, { error: 'html snapshot not found' })
    return
  }
  const data = injectPicker(await readFile(dataPathForFile(context.service.dataDir, version.htmlFile), 'utf8'))
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': [
      "default-src 'none'",
      "img-src * data: blob:",
      "style-src * 'unsafe-inline'",
      "script-src * 'unsafe-inline'",
      "font-src * data:",
      "connect-src *",
      "media-src * data: blob:",
      "frame-src *",
    ].join('; '),
    'cache-control': 'private, max-age=60',
  })
  res.end(data)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body exceeds 2 MiB'), { code: 'BODY_TOO_LARGE' })
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('request body must be valid JSON'), { code: 'INVALID_JSON' })
  }
}

const PICKER_SCRIPT = `<script>
(function () {
  var enabled = false;
  var box = null;
  var badge = null;
  var target = null;
  var listeners = false;

  function make() {
    if (box) return;
    box = document.createElement('div');
    box.setAttribute('data-dsh-review-picker', '');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #246bfd;background:rgba(36,107,253,.12);border-radius:3px;display:none;box-sizing:border-box;';
    badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;left:0;top:-24px;max-width:320px;padding:2px 7px;border-radius:5px;background:#246bfd;color:#fff;font:11px/18px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    box.appendChild(badge);
    document.documentElement.appendChild(box);
  }

  function labelOf(element) {
    var text = (element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    return text.slice(0, 80) || element.tagName.toLowerCase();
  }

  function selectorOf(element) {
    if (element.id) return '#' + element.id;
    var parts = [];
    var current = element;
    while (current && current.nodeType === 1 && parts.length < 4) {
      var part = current.tagName.toLowerCase();
      if (current.classList && current.classList.length) part += '.' + Array.prototype.slice.call(current.classList, 0, 2).join('.');
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function paint(element) {
    if (!element || element === box || element === badge) return;
    target = element;
    make();
    var rect = element.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = Math.max(1, rect.width) + 'px';
    box.style.height = Math.max(1, rect.height) + 'px';
    badge.textContent = selectorOf(element) + ' · ' + labelOf(element);
  }

  function clear() {
    if (box) box.style.display = 'none';
    target = null;
  }

  function move(event) {
    if (!enabled) return;
    var element = document.elementFromPoint(event.clientX, event.clientY);
    if (element && element !== box && element !== badge) paint(element);
  }

  function stop(event) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function click(event) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    var element = target || document.elementFromPoint(event.clientX, event.clientY);
    if (!element) return;
    var rect = element.getBoundingClientRect();
    window.parent.postMessage({
      type: 'fr-element-picked',
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      selector: selectorOf(element),
      label: labelOf(element),
      tag: element.tagName.toLowerCase(),
      elementText: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 600)
    }, '*');
    toggle(false);
  }

  function install(on) {
    if (on === listeners) return;
    listeners = on;
    if (on) {
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mousedown', stop, true);
      document.addEventListener('click', click, true);
    } else {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mousedown', stop, true);
      document.removeEventListener('click', click, true);
      clear();
    }
  }

  function toggle(on) {
    enabled = !!on;
    make();
    install(enabled);
    if (!enabled) clear();
  }

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'fr-picker') toggle(event.data.enabled);
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && enabled) toggle(false);
  });
})();
</script>`

function injectPicker(html) {
  if (/dsh-review-picker/u.test(html)) return html
  if (/<\/body\s*>/iu.test(html)) return html.replace(/<\/body\s*>/iu, `${PICKER_SCRIPT}</body>`)
  return `${html}\n${PICKER_SCRIPT}`
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}
