import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson, createId, ensureDir, nowIso, readJson, safeJoin, shortHash } from './util.js'

const REVIEW_DIR = 'reviews'

export class ReviewStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir
    this.reviewDir = join(dataDir, REVIEW_DIR)
    this.assetsDir = join(dataDir, 'assets')
    this.queues = new Map()
    this.cache = new Map()
  }

  async init() {
    await ensureDir(this.reviewDir)
    await ensureDir(this.assetsDir)
  }

  reviewPath(id) {
    if (!/^rv_[a-zA-Z0-9]+$/u.test(id)) throw new Error(`invalid review id: ${id}`)
    return join(this.reviewDir, `${id}.json`)
  }

  assetPath(reviewId, relativePath) {
    return safeJoin(join(this.assetsDir, reviewId), relativePath)
  }

  reviewAssetRelative(reviewId, fileName) {
    return `assets/${reviewId}/${fileName}`
  }

  async list(sessionId) {
    await this.init()
    const names = await readdir(this.reviewDir).catch(() => [])
    const reviews = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const review = await this.get(name.slice(0, -5))
      if (!review) continue
      if (sessionId !== undefined && review.sessionId !== sessionId) continue
      reviews.push(review)
    }
    return reviews.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  }

  async get(id) {
    const path = this.reviewPath(id)
    let mtimeMs
    try {
      mtimeMs = (await stat(path)).mtimeMs
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.cache.delete(id)
        return undefined
      }
      throw error
    }
    const cached = this.cache.get(id)
    if (cached && cached.mtimeMs === mtimeMs) return cached.review
    const review = await readJson(path, undefined)
    if (review === undefined) return undefined
    this.cache.set(id, { review, mtimeMs })
    return review
  }

  async findDefault({ sessionId, projectKey }) {
    const reviews = await this.list(sessionId)
    return reviews.find((review) => review.projectKey === projectKey) ?? reviews[0]
  }

  async create({ sessionId, projectKey, projectRoot, title }) {
    await this.init()
    const review = {
      schema: 1,
      id: createId('rv'),
      sessionId,
      projectKey,
      projectRoot,
      title: title?.trim() || '前端评审画布',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      revision: 1,
      round: 1,
      sections: [{ id: 'sec_main', title: '页面', order: 0 }],
      pages: [],
      variants: [],
      versions: [],
      layout: {},
      groups: [],
      annotations: [],
      batches: [],
      pendingOpen: null,
      lastReadAt: null,
      lastReadBatchNumber: 0,
      receipts: {},
    }
    await atomicWriteJson(this.reviewPath(review.id), review)
    const mtimeMs = (await stat(this.reviewPath(review.id))).mtimeMs
    this.cache.set(review.id, { review, mtimeMs })
    return review
  }

  /** Serialize one read-modify-write per review and bump its optimistic revision. */
  async mutate(id, mutator, { expectedRevision } = {}) {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.then(async () => {
      const current = await this.get(id)
      if (!current) throw Object.assign(new Error(`review not found: ${id}`), { code: 'REVIEW_NOT_FOUND' })
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw Object.assign(
          new Error(`canvas changed since revision ${expectedRevision}; current revision is ${current.revision}`),
          { code: 'REVISION_CONFLICT', revision: current.revision },
        )
      }
      const draft = structuredClone(current)
      const result = await mutator(draft)
      draft.revision = current.revision + 1
      draft.updatedAt = nowIso()
      await atomicWriteJson(this.reviewPath(id), draft)
      const mtimeMs = (await stat(this.reviewPath(id))).mtimeMs
      this.cache.set(id, { review: draft, mtimeMs })
      return { review: draft, result, revision: draft.revision }
    })
    this.queues.set(id, next.catch(() => {}))
    return next
  }

  projectKey(projectRoot) {
    return shortHash(String(projectRoot ?? 'unknown-project'), 12)
  }

  static newSectionId(title) {
    return `sec_${shortHash(`${title}:${Date.now()}:${Math.random()}`, 10)}`
  }

  static newPageId(key) {
    return `pg_${shortHash(String(key), 12)}`
  }

  static newVariantId(pageId, key) {
    return `vr_${shortHash(`${pageId}:${key}`, 12)}`
  }

  static newVersionId() {
    return createId('v')
  }
}
