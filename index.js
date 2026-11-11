import { randomBytes, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mountReviewRoutes } from './lib/http.js'
import { ReviewService } from './lib/service.js'
import { registerReviewTools } from './lib/tools.js'

export const name = 'dsh-frontend-review'
export const inject = ['tools', 'webServer']

const SKILLS_ROOT = fileURLToPath(new URL('./skills/', import.meta.url))
const SKILL_PROVIDER = 'dsh-frontend-review'
const TOKEN = randomBytes(24).toString('hex')
const BASE_PATH = '/frontend-review'
let publicBase = BASE_PATH

/**
 * Frontend review canvas host plugin.
 *
 * One review thread is bound to one Harness conversation and project. The
 * canvas UI is a client plugin; this half owns durable state, screenshots,
 * the tools, and the feedback-to-conversation delivery.
 */
export function apply(ctx, config = {}) {
  const dataDir = config.dataDir || process.env.DSH_REVIEW_DATA_DIR
    || join(process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || process.cwd(), '.dsh'), 'storages', 'frontend-review')
  const logger = ctx.logger
  const service = new ReviewService({
    dataDir,
    logger,
    feedbackDelivery: async ({ review, batch }) => deliverFeedback(ctx, review, batch),
  })
  const ready = service.init().catch((error) => {
    logger?.warn?.(`frontend-review: failed to initialize ${dataDir}: ${error?.message ?? error}`)
    throw error
  })

  ctx.inject(['webServer'], (webCtx) => {
    try {
      publicBase = new URL(BASE_PATH, webCtx.webServer.getOrigin()).href.replace(/\/$/u, '')
    } catch {
      publicBase = BASE_PATH
    }
    const dispose = mountReviewRoutes({
      webServer: webCtx.webServer,
      service,
      token: TOKEN,
      basePath: publicBase,
      logger,
      getSessionCwd: (sessionId) => ctx.get('agents')?.get(sessionId)?.session?.header?.cwd,
    })
    webCtx.effect(() => dispose, 'frontend-review: canvas routes')
  })

  // Make the per-process route token and base path available to the browser
  // module before the client plugin loads. Existing pages pick it up on reload;
  // same-origin requests also pass without the token.
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: '__DSH_FRONTEND_REVIEW__',
      value: { base: publicBase, token: TOKEN, version: 1 },
    })
  })

  const toolContext = {
    get: (serviceName) => ctx.get(serviceName),
    tools: {
      register(tool) {
        ctx.tools.register({
          ...tool,
          async execute(args, exec) {
            await ready
            const value = await tool.execute(args, exec)
            // Tool values must be losslessly JSON: drop optional undefined keys
            // instead of letting the registry reject an otherwise useful result.
            return JSON.parse(JSON.stringify(value))
          },
        })
      },
    },
  }
  registerReviewTools(toolContext, {
    service,
    token: TOKEN,
    basePath: () => publicBase,
    shareToken: TOKEN,
  })

  ctx.inject(['skills'], (skillCtx) => {
    const disposeProvider = skillCtx.skills.registerProvider(createSkillProvider())
    skillCtx.effect(() => disposeProvider, 'frontend-review: skill provider')
  })

  ctx.effect(() => () => {
    logger?.info?.(`frontend-review: closed canvas service at ${dataDir}`)
  }, 'frontend-review: lifecycle')
}

async function deliverFeedback(ctx, review, batch) {
  const agents = ctx.get('agents')
  const agent = agents?.get?.(review.sessionId)
  if (!agent) {
    return {
      status: 'failed',
      error: 'the bound conversation is not live; open it in Harness and submit again, or call the review tools from that conversation',
    }
  }
  const lines = [
    `[前端评审画布] 新一轮视觉反馈（画布 ${review.id}，批次 #${batch.number}，batchId=${batch.id}）。`,
    `请先调用 review_get_feedback 读取文字、定位和证据，再修改代码；修改后用 review_publish 以相同 pageKey/variantKey 发布固定新版本，并用 respondsTo 关联本批次。`,
  ]
  if (batch.summary) lines.push(`用户补充：${batch.summary}`)
  lines.push(`涉及 ${batch.annotationIds.length} 条批注、${batch.versionIds.length} 个页面版本。旧版本必须保留，不要只说“改好了”而不发布截图。`)
  agent.followup({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: lines.join('\n') }],
    source: { kind: 'user' },
  })
  return { status: 'delivered', message: 'queued as a follow-up in the bound conversation' }
}

function createSkillProvider() {
  return () => ({
    name: SKILL_PROVIDER,
    async list(options) {
      options?.signal?.throwIfAborted()
      const skills = await loadSkills(options?.signal)
      options?.signal?.throwIfAborted()
      return skills.map(toCandidate)
    },
    async get(candidate, options) {
      options?.signal?.throwIfAborted()
      const skills = await loadSkills(options?.signal)
      const skill = skills.find((entry) => entry.name === candidate.name)
      return skill ? toDefinition(skill) : undefined
    },
  })
}

async function loadSkills(signal) {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true })
  const skills = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    signal?.throwIfAborted()
    const directory = join(SKILLS_ROOT, entry.name)
    const skillFile = join(directory, 'SKILL.md')
    let raw
    try {
      raw = await readFile(skillFile, 'utf8')
    } catch {
      continue
    }
    const parsed = parseSkill(raw, directory, skillFile)
    if (parsed) skills.push(parsed)
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

function parseSkill(raw, directory, skillFile) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw)
  if (!match) return undefined
  const frontmatter = {}
  for (const line of match[1].split(/\r?\n/u)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
    if (!entry) continue
    let value = entry[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    frontmatter[entry[1]] = value
  }
  if (!frontmatter.name || !frontmatter.description) return undefined
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: SKILL_PROVIDER,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: directory },
    rank: 620,
    locator: skillFile,
    path: skillFile,
    content: match[2].trim(),
  }
}

function toCandidate(skill) {
  return {
    name: skill.name,
    description: skill.description,
    invocation: skill.invocation,
    provider: skill.provider,
    source: skill.source,
    resourceBase: skill.resourceBase,
    rank: skill.rank,
    locator: skill.locator,
    path: skill.path,
  }
}

function toDefinition(skill) {
  return {
    name: skill.name,
    description: skill.description,
    invocation: skill.invocation,
    provider: skill.provider,
    source: skill.source,
    resourceBase: skill.resourceBase,
    path: skill.path,
    content: skill.content,
  }
}
