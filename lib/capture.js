import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const WINDOWS_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const POSIX_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

let cachedBrowser

/** Locate a Chromium browser without downloading one. */
export async function findBrowser() {
  if (cachedBrowser !== undefined) return cachedBrowser
  const configured = process.env.DSH_REVIEW_CHROME?.trim()
  const candidates = [
    ...(configured ? [configured] : []),
    ...(process.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES),
  ]
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      cachedBrowser = candidate
      return candidate
    } catch {
      // try the next candidate
    }
  }
  throw Object.assign(
    new Error(
      'No Chromium browser found for fixed screenshots. Install Chrome/Edge or set DSH_REVIEW_CHROME to its executable path.',
    ),
    { code: 'BROWSER_NOT_FOUND' },
  )
}

class CdpConnection {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.waiters = new Map()
    this.closed = false
  }

  async open() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timed out')), 15000)
      this.socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      this.socket.addEventListener('error', (event) => {
        clearTimeout(timer)
        reject(new Error(`CDP WebSocket failed: ${event?.message ?? 'socket error'}`))
      })
    })
    this.socket.addEventListener('message', (event) => this.onMessage(event.data))
    this.socket.addEventListener('close', () => {
      this.closed = true
      for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'))
      this.pending.clear()
    })
  }

  onMessage(raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
    } catch {
      return
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
      else pending.resolve(message.result)
      return
    }
    const waiters = this.waiters.get(message.method)
    if (!waiters || waiters.length === 0) return
    const waiter = waiters.shift()
    clearTimeout(waiter.timer)
    waiter.resolve(message.params)
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('CDP connection is closed'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          const waiters = this.waiters.get(method) ?? []
          this.waiters.set(method, waiters.filter((entry) => entry !== waiter))
          reject(new Error(`CDP event ${method} timed out`))
        }, timeoutMs),
      }
      const waiters = this.waiters.get(method) ?? []
      waiters.push(waiter)
      this.waiters.set(method, waiters)
    })
  }

  close() {
    try {
      this.socket?.close()
    } catch {
      // best effort
    }
  }
}

async function waitForDebugPort(profileDir) {
  const portFile = join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(portFile, 'utf8')
      const [port, path] = raw.trim().split(/\r?\n/u)
      if (port && path) return { port: Number(port), path }
    } catch {
      // browser is still starting
    }
    await delay(100)
  }
  throw new Error('Chromium did not expose a DevTools port in time')
}

async function withPage(run) {
  const browser = await findBrowser()
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-review-chrome-'))
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--allow-file-access-from-files',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ]
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    args.push('--no-sandbox')
  }
  const child = spawn(browser, args, { stdio: 'ignore', windowsHide: true })
  let connection
  try {
    const { port } = await waitForDebugPort(profileDir)
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (!response.ok) throw new Error(`Chromium DevTools list failed with HTTP ${response.status}`)
    const targets = await response.json()
    const target = targets.find((entry) => entry.type === 'page')
    if (!target?.webSocketDebuggerUrl) throw new Error('Chromium exposed no page target')
    connection = new CdpConnection(target.webSocketDebuggerUrl)
    await connection.open()
    return await run(connection)
  } finally {
    connection?.close()
    try {
      child.kill()
    } catch {
      // already exited
    }
    await delay(100)
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function settlePage(connection) {
  await connection.send('Runtime.evaluate', {
    expression: `(async () => {
      await document.fonts.ready;
      const images = Array.from(document.images);
      await Promise.all(images.map((image) => image.complete ? undefined : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
}

/**
 * Capture one URL or local HTML file at an exact CSS viewport.
 * @returns {{ data: Buffer, width: number, height: number }}
 */
export async function captureScreenshot({
  url,
  html,
  htmlPath,
  width = 1440,
  height = 900,
  fullPage = false,
  waitMs = 500,
}) {
  const safeWidth = Math.max(320, Math.min(3840, Math.round(Number(width) || 1440)))
  const safeHeight = Math.max(240, Math.min(4000, Math.round(Number(height) || 900)))
  let tempHtml
  let targetUrl = url
  if (html !== undefined) {
    tempHtml = join(tmpdir(), `dsh-review-${Date.now()}-${Math.random().toString(16).slice(2)}.html`)
    await writeFile(tempHtml, html, 'utf8')
    targetUrl = pathToFileURL(tempHtml).href
  } else if (htmlPath) {
    targetUrl = pathToFileURL(htmlPath).href
  }
  if (!targetUrl) throw new Error('captureScreenshot requires url, html, or htmlPath')
  try {
    return await withPage(async (connection) => {
      await connection.send('Page.enable')
      await connection.send('Runtime.enable')
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width: safeWidth,
        height: safeHeight,
        deviceScaleFactor: 1,
        mobile: false,
      })
      const loaded = connection.once('Page.loadEventFired', 30000).catch(() => undefined)
      await connection.send('Page.navigate', { url: targetUrl })
      await loaded
      if (waitMs > 0) await delay(waitMs)
      await settlePage(connection)
      let clip
      if (fullPage) {
        const metrics = await connection.send('Page.getLayoutMetrics')
        const content = metrics.cssContentSize ?? metrics.contentSize
        const contentHeight = Math.min(10000, Math.max(safeHeight, Math.ceil(content?.height ?? safeHeight)))
        const contentWidth = Math.min(3840, Math.max(safeWidth, Math.ceil(content?.width ?? safeWidth)))
        clip = { x: 0, y: 0, width: contentWidth, height: contentHeight, scale: 1 }
      }
      const result = await connection.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: fullPage,
        ...(clip ? { clip } : {}),
      })
      const data = Buffer.from(result.data, 'base64')
      const dimensions = readPngDimensions(data) ?? {
        width: clip?.width ?? safeWidth,
        height: clip?.height ?? safeHeight,
      }
      return { data, width: dimensions.width, height: dimensions.height }
    })
  } finally {
    if (tempHtml) await rm(tempHtml, { force: true }).catch(() => {})
  }
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return undefined
  if (!(buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG')) return undefined
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
