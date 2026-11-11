import { readFile, writeFile } from 'node:fs/promises'
import { extname, basename, dirname, join } from 'node:path'
import { captureScreenshot } from './capture.js'
import { CARD_HEIGHT, CARD_WIDTH, computeLayout } from './layout.js'
import { ReviewStore } from './store.js'
import {
  asArray,
  atomicWrite,
  clamp,
  createId,
  ensureDir,
  escapeHtml,
  imageDimensions,
  isHttpUrl,
  nowIso,
  optionalString,
  parseDataUrl,
  safeJoin,
  shortHash,
  stableStringify,
} from './util.js'

const MAX_HTML_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }
const ANNOTATION_KINDS = new Set(['rect', 'ellipse', 'arrow', 'pen', 'pin', 'note', 'component'])
const FEEDBACK_STATUSES = new Set([
  'draft',
  'submitted',
  'processing',
  'modified',
  'confirmed',
  'deferred',
  'needs-info',
])

export class ReviewService {
  constructor({ dataDir, logger, feedbackDelivery }) {
    this.dataDir = dataDir
    this.logger = logger
    this.feedbackDelivery = feedbackDelivery
    this.store = new ReviewStore({ dataDir })
  }

  async init() {
    await this.store.init()
  }

  projectKey(root) {
    return this.store.projectKey(root)
  }

  async resolve({ reviewId, sessionId, projectRoot, create = false, title }) {
    if (reviewId) {
      const review = await this.store.get(reviewId)
      if (!review) throw Object.assign(new Error(`review not found: ${reviewId}`), { code: 'REVIEW_NOT_FOUND' })
      if (sessionId && review.sessionId !== sessionId) {
        throw Object.assign(new Error('this review belongs to a different conversation'), { code: 'REVIEW_SESSION_MISMATCH' })
      }
      return review
    }
    const projectKey = this.projectKey(projectRoot)
    const found = await this.store.findDefault({ sessionId, projectKey })
    if (found && found.projectKey === projectKey) return found
    if (!create) return undefined
    return this.store.create({ sessionId, projectKey, projectRoot, title })
  }

  async open({ sessionId, projectRoot, title }) {
    const existing = await this.resolve({ sessionId, projectRoot })
    if (existing) {
      const { review } = await this.store.mutate(existing.id, (draft) => {
        if (typeof title === 'string' && title.trim()) draft.title = title.trim().slice(0, 160)
        draft.pendingOpen = { at: nowIso(), source: 'tool' }
      })
      return { review, created: false }
    }
    const review = await this.store.create({ sessionId, projectKey: this.projectKey(projectRoot), projectRoot, title })
    const opened = await this.store.mutate(review.id, (draft) => {
      draft.pendingOpen = { at: nowIso(), source: 'tool' }
    })
    return { review: opened.review, created: true }
  }

  async importPages({ review, pages, idempotencyKey, force = false, arrange = true }) {
    return this.materializeBatch({
      review,
      items: pages,
      operation: 'import',
      idempotencyKey,
      force,
      arrange,
      respondTo: [],
    })
  }

  async publish({ review, pages, idempotencyKey, force = false, arrange = true, respondTo = [], note }) {
    return this.materializeBatch({
      review,
      items: pages,
      operation: 'publish',
      idempotencyKey,
      force,
      arrange,
      respondTo: asArray(respondTo),
      note,
    })
  }

  async materializeBatch({ review, items, operation, idempotencyKey, force, arrange, respondTo, note }) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('at least one page is required')
    if (items.length > 24) throw new Error('a batch can import or publish at most 24 pages')
    const key = idempotencyKey?.trim() || shortHash(stableStringify({ operation, items, respondTo }), 24)
    const receiptKey = `${operation}:${key}`
    if (!force && review.receipts?.[receiptKey]) {
      return { ...review.receipts[receiptKey], deduplicated: true }
    }

    const prepared = []
    const failures = []
    for (const [index, item] of items.entries()) {
      try {
        const normalized = normalizeItem(item, index)
        const versionId = ReviewStore.newVersionId()
        const materialized = await this.prepareVersionSource({
          review,
          versionId,
          source: normalized.source,
          viewport: normalized.viewport,
          pageKey: normalized.pageKey,
          variantKey: normalized.variantKey,
        })
        prepared.push({ ...normalized, versionId, ...materialized })
      } catch (error) {
        failures.push({
          index,
          pageKey: typeof item?.pageKey === 'string' ? item.pageKey : undefined,
          title: typeof item?.title === 'string' ? item.title : undefined,
          code: error?.code ?? 'IMPORT_FAILED',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (prepared.length === 0) {
      return {
        reviewId: review.id,
        revision: review.revision,
        imported: [],
        failed: failures,
        arranged: false,
        message: 'No page could be materialized.',
      }
    }

    const { review: updated, result } = await this.store.mutate(review.id, (draft) => {
      const results = []
      const touchedSections = new Set()
      let round = draft.round
      for (const item of prepared) {
        const section = ensureSection(draft, item.sectionId, item.sectionTitle)
        const page = ensurePage(draft, item, section.id)
        const variant = ensureVariant(draft, page, item)
        const previous = draft.versions
          .filter((version) => version.variantId === variant.id)
          .sort((left, right) => right.number - left.number)[0]
        const number = (previous?.number ?? 0) + 1
        const version = {
          id: item.versionId,
          pageId: page.id,
          variantId: variant.id,
          number,
          status: item.status,
          createdAt: nowIso(),
          title: item.titleOverride || page.title,
          note: item.note ?? note,
          captureMode: item.captureMode,
          sourceUrl: item.sourceUrl,
          htmlFile: item.htmlFile,
          snapshot: item.snapshot,
          viewport: item.viewport,
          error: item.error,
          feedbackBatchIds: [],
        }
        draft.versions.push(version)
        results.push({
          pageKey: page.key,
          variantKey: variant.key,
          pageId: page.id,
          variantId: variant.id,
          versionId: version.id,
          version: version.number,
          status: version.status,
          snapshot: version.snapshot
            ? { width: version.snapshot.width, height: version.snapshot.height, mediaType: version.snapshot.mediaType }
            : undefined,
          error: version.error,
        })
        touchedSections.add(section.id)
        round = Math.max(round, number)
      }

      const allReady = results.length > 0 && results.every((entry) => entry.status === 'ready')
      for (const batchId of respondTo) {
        const batch = draft.batches.find((entry) => entry.id === batchId)
        if (!batch) continue
        // Link only fixed versions. A failed capture must never present the
        // feedback as modified or make the old snapshot look replaced.
        for (const versionId of results.filter((entry) => entry.status === 'ready').map((entry) => entry.versionId)) {
          if (!batch.responseVersionIds.includes(versionId)) batch.responseVersionIds.push(versionId)
        }
        batch.status = allReady ? 'modified' : 'processing'
        if (allReady) {
          for (const annotationId of batch.annotationIds) {
            const annotation = draft.annotations.find((entry) => entry.id === annotationId)
            if (annotation && annotation.status !== 'confirmed' && annotation.status !== 'deferred') {
              annotation.status = 'modified'
              annotation.updatedAt = nowIso()
            }
          }
        }
        for (const versionId of batch.responseVersionIds) {
          const version = draft.versions.find((entry) => entry.id === versionId)
          if (version && !version.feedbackBatchIds.includes(batchId)) version.feedbackBatchIds.push(batchId)
        }
      }

      draft.round = round
      // The seeded "页面" section exists only so a first empty canvas has a
      // usable group. Once imports name real sections, drop the empty seed.
      if (draft.sections.length > 1) {
        draft.sections = draft.sections.filter((section) =>
          section.id !== 'sec_main' || draft.pages.some((page) => page.sectionId === 'sec_main'))
      }
      if (arrange) computeLayout(draft)
      const payload = {
        reviewId: draft.id,
        revision: draft.revision + 1,
        imported: results,
        failed: failures,
        arranged: arrange,
        round: draft.round,
      }
      draft.receipts[receiptKey] = { at: nowIso(), ...payload }
      return payload
    })

    return { ...result, revision: updated.revision }
  }

  async prepareVersionSource({ review, versionId, source, viewport, pageKey, variantKey }) {
    if (!source || typeof source !== 'object') throw new Error('source is required')
    const kind = source.kind
    if (kind !== 'url' && kind !== 'html' && kind !== 'image' && kind !== 'existing') {
      throw new Error('source.kind must be url, html, image, or existing')
    }
    const targetViewport = normalizeViewport(viewport ?? source.viewport)
    const assetDir = join(this.dataDir, 'assets', review.id)
    await ensureDir(assetDir)

    if (kind === 'existing') {
      const page = review.pages.find((entry) => entry.key === pageKey)
      const variant = page
        ? review.variants.find((entry) => entry.pageId === page.id && entry.key === variantKey)
        : undefined
      const previous = review.versions
        .filter((version) =>
          version.status === 'ready'
          && version.snapshot
          && (variant ? version.variantId === variant.id : true))
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0]
      if (!previous) {
        throw new Error(
          variant
            ? `no previous fixed snapshot exists for ${pageKey}/${variantKey} to copy`
            : 'no previous fixed snapshot exists to copy',
        )
      }
      const data = await readFile(safeJoin(this.dataDir, previous.snapshot.file))
      const file = this.store.reviewAssetRelative(review.id, `${versionId}.png`)
      await atomicWrite(safeJoin(this.dataDir, file), data)
      return {
        status: 'ready',
        captureMode: 'copy',
        snapshot: { ...previous.snapshot, file },
        viewport: previous.viewport,
      }
    }

    if (kind === 'url') {
      if (!isHttpUrl(source.url)) throw new Error('source.url must be an http(s) URL')
      if (source.capture === false) {
        return {
          status: 'live',
          captureMode: 'live',
          sourceUrl: source.url,
          snapshot: undefined,
          viewport: targetViewport,
        }
      }
      try {
        const shot = await captureScreenshot({
          url: source.url,
          width: targetViewport.width,
          height: targetViewport.height,
          fullPage: source.fullPage === true,
        })
        const file = this.store.reviewAssetRelative(review.id, `${versionId}.png`)
        await atomicWrite(safeJoin(this.dataDir, file), shot.data)
        return {
          status: 'ready',
          captureMode: 'url',
          sourceUrl: source.url,
          snapshot: {
            file,
            width: shot.width,
            height: shot.height,
            bytes: shot.data.length,
            mediaType: 'image/png',
          },
          viewport: targetViewport,
        }
      } catch (error) {
        return {
          status: 'failed',
          captureMode: 'url',
          sourceUrl: source.url,
          viewport: targetViewport,
          error: captureError(error),
        }
      }
    }

    if (kind === 'html') {
      let html
      if (typeof source.html === 'string') html = source.html
      else if (typeof source.path === 'string') html = await readFile(source.path, 'utf8')
      else if (typeof source.htmlPath === 'string') html = await readFile(source.htmlPath, 'utf8')
      else throw new Error('html source needs html, path, or htmlPath')
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('HTML is larger than 12 MiB')
      if (source.baseUrl && isHttpUrl(source.baseUrl)) html = injectBaseUrl(html, source.baseUrl)
      const file = this.store.reviewAssetRelative(review.id, `${versionId}.html`)
      await atomicWrite(safeJoin(this.dataDir, file), html, 'utf8')
      try {
        const shot = await captureScreenshot({
          html,
          width: targetViewport.width,
          height: targetViewport.height,
          fullPage: source.fullPage === true,
        })
        const snapshotFile = this.store.reviewAssetRelative(review.id, `${versionId}.png`)
        await atomicWrite(safeJoin(this.dataDir, snapshotFile), shot.data)
        return {
          status: 'ready',
          captureMode: 'html',
          htmlFile: file,
          sourceUrl: typeof source.baseUrl === 'string' ? source.baseUrl : undefined,
          snapshot: {
            file: snapshotFile,
            width: shot.width,
            height: shot.height,
            bytes: shot.data.length,
            mediaType: 'image/png',
          },
          viewport: targetViewport,
        }
      } catch (error) {
        return {
          status: 'failed',
          captureMode: 'html',
          htmlFile: file,
          sourceUrl: typeof source.baseUrl === 'string' ? source.baseUrl : undefined,
          viewport: targetViewport,
          error: captureError(error),
        }
      }
    }

    // image
    let data
    if (typeof source.dataUrl === 'string') {
      const parsed = parseDataUrl(source.dataUrl)
      if (!parsed) throw new Error('source.dataUrl is not a valid data URL')
      data = parsed.data
    } else if (typeof source.path === 'string') {
      data = await readFile(source.path)
    } else if (typeof source.imagePath === 'string') {
      data = await readFile(source.imagePath)
    } else {
      throw new Error('image source needs path or dataUrl')
    }
    if (data.length > MAX_IMAGE_BYTES) throw new Error('image is larger than 25 MiB')
    const dims = imageDimensions(data)
    if (!dims) throw new Error('unsupported image bytes: expected PNG, JPEG, GIF, or WebP')
    const extension = extensionForMediaType(dims.mediaType)
    const file = this.store.reviewAssetRelative(review.id, `${versionId}${extension}`)
    await atomicWrite(safeJoin(this.dataDir, file), data)
    return {
      status: 'ready',
      captureMode: 'image',
      sourceUrl: undefined,
      snapshot: {
        file,
        width: dims.width,
        height: dims.height,
        bytes: data.length,
        mediaType: dims.mediaType,
      },
      viewport: { width: dims.width, height: dims.height },
    }
  }

  async rearrange({ review, sections, placements, mode = 'auto', expectedRevision }) {
    const { review: updated, result } = await this.store.mutate(
      review.id,
      (draft) => {
        if (Array.isArray(sections)) {
          for (const [index, entry] of sections.entries()) {
            if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string') continue
            const existing = entry.id ? draft.sections.find((section) => section.id === entry.id) : undefined
            if (existing && entry.remove === true) {
              if (draft.pages.some((page) => page.sectionId === existing.id)) {
                throw new Error(`section "${existing.title}" still contains pages; move them before removing it`)
              }
              draft.sections = draft.sections.filter((section) => section.id !== existing.id)
              continue
            }
            if (existing) {
              existing.title = entry.title.slice(0, 120)
              if (Number.isFinite(entry.order)) existing.order = entry.order
            } else {
              draft.sections.push({
                id: entry.id || ReviewStore.newSectionId(entry.title),
                title: entry.title.slice(0, 120),
                order: Number.isFinite(entry.order) ? entry.order : draft.sections.length + index,
              })
            }
          }
        }
        if (Array.isArray(placements)) {
          for (const placement of placements) {
            if (!placement || typeof placement.versionId !== 'string') continue
            const version = draft.versions.find((entry) => entry.id === placement.versionId)
            if (!version) continue
            if (typeof placement.sectionId === 'string') {
              const page = draft.pages.find((entry) => entry.id === version.pageId)
              const section = draft.sections.find((entry) => entry.id === placement.sectionId)
              if (page && section) page.sectionId = section.id
            }
            const card = draft.layout[version.id] ?? { w: CARD_WIDTH, h: CARD_HEIGHT }
            if (Number.isFinite(placement.x)) card.x = placement.x
            if (Number.isFinite(placement.y)) card.y = placement.y
            if (Number.isFinite(placement.w)) card.w = Math.max(180, placement.w)
            if (Number.isFinite(placement.h)) card.h = Math.max(120, placement.h)
            if (typeof placement.locked === 'boolean') card.locked = placement.locked
            draft.layout[version.id] = card
          }
        }
        if (mode === 'auto') computeLayout(draft)
        return {
          reviewId: draft.id,
          revision: draft.revision + 1,
          layout: draft.layout,
          sections: draft.sections,
        }
      },
      { expectedRevision },
    )
    return { ...result, revision: updated.revision }
  }

  async updateCard({ review, versionId, x, y, locked, sectionId, expectedRevision }) {
    return this.rearrange({
      review,
      placements: [{ versionId, x, y, locked, sectionId }],
      mode: 'manual',
      expectedRevision,
    })
  }

  async moveCards({ review, placements, expectedRevision }) {
    if (!Array.isArray(placements) || placements.length === 0) throw new Error('placements must be a non-empty array')
    const { review: updated, result } = await this.store.mutate(
      review.id,
      (draft) => {
        for (const placement of placements) {
          if (!placement || typeof placement.versionId !== 'string') continue
          const version = draft.versions.find((entry) => entry.id === placement.versionId)
          if (!version) continue
          const card = draft.layout[version.id] ?? { w: CARD_WIDTH, h: CARD_HEIGHT }
          if (Number.isFinite(placement.x)) card.x = placement.x
          if (Number.isFinite(placement.y)) card.y = placement.y
          if (typeof placement.locked === 'boolean') card.locked = placement.locked
          if (typeof placement.sectionId === 'string') {
            const page = draft.pages.find((entry) => entry.id === version.pageId)
            if (page && draft.sections.some((entry) => entry.id === placement.sectionId)) {
              page.sectionId = placement.sectionId
            }
          }
          draft.layout[version.id] = card
        }
        return {
          reviewId: draft.id,
          revision: draft.revision + 1,
          layout: draft.layout,
          groups: draft.groups ?? [],
        }
      },
      { expectedRevision },
    )
    return { ...result, revision: updated.revision }
  }

  async groupAction({ review, action, nodeIds, groupId, name, color, expectedRevision }) {
    const { review: updated, result } = await this.store.mutate(
      review.id,
      (draft) => {
        draft.groups ??= []
        if (action === 'create') {
          const ids = [...new Set(asArray(nodeIds).filter((id) =>
            draft.versions.some((version) => version.id === id)))]
          if (ids.length < 2) throw new Error('select at least two cards to create a group')
          // A card belongs to at most one group; move it out of its old group first.
          for (const group of draft.groups) {
            group.nodeIds = group.nodeIds.filter((id) => !ids.includes(id))
          }
          draft.groups = draft.groups.filter((group) => group.nodeIds.length >= 2)
          const group = {
            id: createId('grp'),
            name: (name?.trim() || `组合 ${ids.length}`).slice(0, 80),
            color: safeColor(color),
            nodeIds: ids,
            createdAt: nowIso(),
          }
          draft.groups.push(group)
          return { group, groups: draft.groups }
        }
        const group = draft.groups.find((entry) => entry.id === groupId)
        if (!group) throw new Error(`group not found: ${groupId}`)
        if (action === 'ungroup') {
          draft.groups = draft.groups.filter((entry) => entry.id !== groupId)
          return { groups: draft.groups, removed: groupId }
        }
        if (action === 'rename') {
          if (typeof name === 'string' && name.trim()) group.name = name.trim().slice(0, 80)
          if (typeof color === 'string') group.color = safeColor(color)
          return { group, groups: draft.groups }
        }
        throw new Error(`unsupported group action: ${action}`)
      },
      { expectedRevision },
    )
    return { ...result, revision: updated.revision }
  }

  async editCard({ review, versionId, title, variantName, note, expectedRevision }) {
    const { review: updated, result } = await this.store.mutate(
      review.id,
      (draft) => {
        const version = draft.versions.find((entry) => entry.id === versionId)
        if (!version) throw new Error(`version not found: ${versionId}`)
        const page = draft.pages.find((entry) => entry.id === version.pageId)
        const variant = draft.variants.find((entry) => entry.id === version.variantId)
        if (page && typeof title === 'string' && title.trim()) page.title = title.trim().slice(0, 160)
        if (variant && typeof variantName === 'string' && variantName.trim()) variant.name = variantName.trim().slice(0, 120)
        if (typeof note === 'string') version.note = note.slice(0, 2000)
        return { versionId, page: page ? { id: page.id, title: page.title } : undefined, variant: variant ? { id: variant.id, name: variant.name } : undefined }
      },
      { expectedRevision },
    )
    return { ...result, revision: updated.revision }
  }

  async upsertAnnotation({ review, annotation, expectedRevision }) {
    const input = annotation ?? {}
    const { review: updated, result } = await this.store.mutate(
      review.id,
      (draft) => {
        const existing = input.id ? draft.annotations.find((entry) => entry.id === input.id) : undefined
        if (existing) {
          if (existing.status !== 'draft' && existing.status !== 'needs-info') {
            throw new Error('submitted feedback is immutable; add a reply instead')
          }
          if (typeof input.text === 'string') existing.text = input.text.slice(0, 4000)
          if (input.geometry && typeof input.geometry === 'object') existing.geometry = normalizeGeometry(input.geometry)
          if (typeof input.color === 'string') existing.color = safeColor(input.color)
          if (input.element && typeof input.element === 'object') existing.element = normalizeElement(input.element)
          existing.updatedAt = nowIso()
          return { annotation: sanitizeAnnotation(existing) }
        }
        const version = draft.versions.find((entry) => entry.id === input.versionId)
        if (!version) throw new Error(`version not found: ${input.versionId}`)
        if (!ANNOTATION_KINDS.has(input.kind)) throw new Error(`unsupported annotation kind: ${input.kind}`)
        const created = {
          id: createId('an'),
          versionId: version.id,
          pageId: version.pageId,
          variantId: version.variantId,
          kind: input.kind,
          geometry: input.kind === 'note' ? { x: 0.5, y: 0.5, w: 0, h: 0 } : normalizeGeometry(input.geometry),
          text: typeof input.text === 'string' ? input.text.slice(0, 4000) : '',
          color: safeColor(input.color),
          ...(input.element && typeof input.element === 'object' ? { element: normalizeElement(input.element) } : {}),
          status: 'draft',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          batchId: null,
          author: 'user',
          replies: [],
        }
        draft.annotations.push(created)
        return { annotation: sanitizeAnnotation(created) }
      },
      { expectedRevision },
    )
    return { ...result, revision: updated.revision }
  }

  async deleteAnnotation({ review, annotationId, expectedRevision }) {
    const { review: updated, result } = await this.store.mutate(
      review.id,
      (draft) => {
        const index = draft.annotations.findIndex((entry) => entry.id === annotationId)
        if (index < 0) throw new Error(`annotation not found: ${annotationId}`)
        if (draft.annotations[index].status !== 'draft' && draft.annotations[index].status !== 'needs-info') {
          throw new Error('submitted feedback cannot be deleted')
        }
        const [removed] = draft.annotations.splice(index, 1)
        return { annotation: sanitizeAnnotation(removed) }
      },
      { expectedRevision },
    )
    return { ...result, revision: updated.revision }
  }

  async submitFeedback({ review, annotationIds, summary, versionIds, idempotencyKey, source = 'ui' }) {
    const key = idempotencyKey?.trim() || shortHash(stableStringify({ annotationIds, summary, versionIds }), 24)
    if (review.receipts?.[`feedback:${key}`]) {
      return { ...review.receipts[`feedback:${key}`], deduplicated: true }
    }
    const { review: updated, result } = await this.store.mutate(review.id, (draft) => {
      const ids = Array.isArray(annotationIds) ? annotationIds : []
      const annotations = ids.length > 0
        ? draft.annotations.filter((entry) => ids.includes(entry.id))
        : draft.annotations.filter((entry) => entry.status === 'draft')
      if (annotations.length === 0 && !summary?.trim()) {
        throw new Error('nothing to submit: draw an annotation or write a summary')
      }
      const batchNumber = Math.max(0, ...draft.batches.map((entry) => entry.number)) + 1
      const batch = {
        id: createId('fb'),
        number: batchNumber,
        createdAt: nowIso(),
        status: 'submitted',
        annotationIds: annotations.map((entry) => entry.id),
        versionIds: [...new Set([...annotations.map((entry) => entry.versionId), ...asArray(versionIds)])],
        summary: summary?.trim().slice(0, 8000) || '',
        delivery: { status: 'pending', attempts: 0 },
        responseVersionIds: [],
        source,
      }
      draft.batches.push(batch)
      for (const annotation of annotations) {
        if (annotation.status === 'draft') {
          annotation.status = 'submitted'
          annotation.batchId = batch.id
          annotation.updatedAt = nowIso()
        }
      }
      const payload = {
        reviewId: draft.id,
        revision: draft.revision + 1,
        batch: sanitizeBatch(batch),
        annotations: annotations.map(sanitizeAnnotation),
      }
      draft.receipts[`feedback:${key}`] = { at: nowIso(), ...payload }
      return payload
    })

    let delivery
    try {
      delivery = await this.feedbackDelivery({ review: updated, batch: updated.batches.find((entry) => entry.id === result.batch.id) })
    } catch (error) {
      delivery = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
    const final = await this.store.mutate(updated.id, (draft) => {
      const batch = draft.batches.find((entry) => entry.id === result.batch.id)
      if (!batch) return { delivery }
      batch.delivery = {
        status: delivery.status,
        attempts: (batch.delivery?.attempts ?? 0) + 1,
        at: nowIso(),
        ...(delivery.error ? { error: delivery.error } : {}),
      }
      return { delivery: batch.delivery }
    })
    return { ...result, revision: final.review.revision, delivery: final.result.delivery }
  }

  async retryDelivery({ review, batchId }) {
    const batch = review.batches.find((entry) => entry.id === batchId)
    if (!batch) throw new Error(`feedback batch not found: ${batchId}`)
    const delivery = await this.feedbackDelivery({ review, batch })
    const { review: updated } = await this.store.mutate(review.id, (draft) => {
      const target = draft.batches.find((entry) => entry.id === batchId)
      if (target) {
        target.delivery = {
          status: delivery.status,
          attempts: (target.delivery?.attempts ?? 0) + 1,
          at: nowIso(),
          ...(delivery.error ? { error: delivery.error } : {}),
        }
      }
    })
    return {
      reviewId: updated.id,
      revision: updated.revision,
      batchId,
      delivery,
      batch: sanitizeBatch(updated.batches.find((entry) => entry.id === batchId)),
    }
  }

  async getFeedback({ review, batchId, sinceBatch, status }) {
    let batches = review.batches
    if (batchId) batches = batches.filter((entry) => entry.id === batchId)
    if (sinceBatch) {
      const since = review.batches.find((entry) => entry.id === sinceBatch)
      batches = batches.filter((entry) => entry.number > (since?.number ?? 0))
    }
    if (status) batches = batches.filter((entry) => entry.status === status)
    if (!batchId && !sinceBatch && !status) {
      batches = batches.filter((entry) => entry.number > (review.lastReadBatchNumber ?? 0))
    }
    return {
      reviewId: review.id,
      revision: review.revision,
      batches: batches.map((batch) => ({
        ...sanitizeBatch(batch),
        annotations: batch.annotationIds
          .map((id) => review.annotations.find((entry) => entry.id === id))
          .filter(Boolean)
          .map((annotation) => ({
            ...sanitizeAnnotation(annotation),
            page: pageLabel(review, annotation.versionId),
            geometry: annotation.geometry,
          })),
      })),
      annotations: review.annotations.filter((entry) => entry.status === 'draft').map(sanitizeAnnotation),
    }
  }

  async updateFeedback({ review, batchId, annotationId, status, reply, versionIds, expectedRevision }) {
    if (status === 'confirmed') {
      throw new Error('confirmed is a user-only decision; ask the user to confirm in the canvas')
    }
    if (status && !FEEDBACK_STATUSES.has(status)) throw new Error(`unsupported feedback status: ${status}`)
    const { review: updated, result } = await this.store.mutate(
      review.id,
      (draft) => {
        const batch = batchId ? draft.batches.find((entry) => entry.id === batchId) : undefined
        if (batchId && !batch) throw new Error(`feedback batch not found: ${batchId}`)
        const targets = annotationId
          ? draft.annotations.filter((entry) => entry.id === annotationId)
          : batch
            ? draft.annotations.filter((entry) => batch.annotationIds.includes(entry.id))
            : []
        if (targets.length === 0) throw new Error('no feedback target found')
        if (status) {
          if (status === 'modified' && !batch?.responseVersionIds?.length) {
            throw new Error('publish a new version and link it before marking feedback modified')
          }
          for (const annotation of targets) {
            annotation.status = status
            annotation.updatedAt = nowIso()
          }
          if (batch) batch.status = status
        }
        if (typeof reply === 'string' && reply.trim()) {
          for (const annotation of targets) {
            annotation.replies ??= []
            annotation.replies.push({ at: nowIso(), role: 'agent', text: reply.trim().slice(0, 4000) })
            annotation.updatedAt = nowIso()
          }
        }
        if (Array.isArray(versionIds)) {
          for (const versionId of versionIds) {
            if (!draft.versions.some((entry) => entry.id === versionId)) continue
            if (batch && !batch.responseVersionIds.includes(versionId)) batch.responseVersionIds.push(versionId)
          }
        }
        return {
          reviewId: draft.id,
          revision: draft.revision + 1,
          annotations: targets.map(sanitizeAnnotation),
          batch: batch ? sanitizeBatch(batch) : undefined,
        }
      },
      { expectedRevision },
    )
    return { ...result, revision: updated.revision }
  }

  async confirmFeedback({ review, annotationId, batchId }) {
    const { review: updated, result } = await this.store.mutate(review.id, (draft) => {
      const batch = batchId ? draft.batches.find((entry) => entry.id === batchId) : undefined
      const targets = annotationId
        ? draft.annotations.filter((entry) => entry.id === annotationId)
        : batch
          ? draft.annotations.filter((entry) => batch.annotationIds.includes(entry.id))
          : []
      if (targets.length === 0) throw new Error('no feedback target found')
      for (const annotation of targets) {
        annotation.status = 'confirmed'
        annotation.updatedAt = nowIso()
      }
      if (batch) batch.status = 'confirmed'
      return { annotations: targets.map(sanitizeAnnotation), batch: batch ? sanitizeBatch(batch) : undefined }
    })
    return { ...result, revision: updated.revision }
  }

  async read({ review }) {
    return canvasState(review)
  }

  async getEvidence({ review, annotationIds, batchId, crop = true }) {
    let ids = asArray(annotationIds)
    if (batchId) {
      const batch = review.batches.find((entry) => entry.id === batchId)
      if (!batch) throw new Error(`feedback batch not found: ${batchId}`)
      ids = [...new Set([...ids, ...batch.annotationIds])]
    }
    const latestBatch = [...review.batches]
      .filter((batch) => batch.status !== 'confirmed')
      .sort((left, right) => right.number - left.number)[0]
    const annotations = ids.length > 0
      ? review.annotations.filter((entry) => ids.includes(entry.id))
      : latestBatch
        ? review.annotations.filter((entry) => latestBatch.annotationIds.includes(entry.id))
        : review.annotations.filter((entry) => entry.status !== 'draft' && entry.status !== 'confirmed')
    return annotations.map((annotation) => {
      const version = review.versions.find((entry) => entry.id === annotation.versionId)
      const page = review.pages.find((entry) => entry.id === version?.pageId)
      const variant = review.variants.find((entry) => entry.id === version?.variantId)
      return {
        annotationId: annotation.id,
        batchId: annotation.batchId,
        status: annotation.status,
        text: annotation.text,
        kind: annotation.kind,
        geometry: annotation.geometry,
        color: annotation.color,
        target: {
          versionId: annotation.versionId,
          page: page?.title,
          variant: variant?.name,
          version: version?.number,
          viewport: version?.viewport,
          snapshot: version?.snapshot
            ? { width: version.snapshot.width, height: version.snapshot.height, mediaType: version.snapshot.mediaType }
            : undefined,
        },
        snapshotFile: version?.snapshot?.file,
        htmlFile: version?.htmlFile,
        crop,
        createdAt: annotation.createdAt,
        replies: annotation.replies,
      }
    })
  }

  async claimOpen({ review }) {
    const pending = review.pendingOpen
    if (!pending) return { open: false, reviewId: review.id }
    const age = Date.now() - new Date(pending.at).getTime()
    if (!Number.isFinite(age) || age > 30_000) return { open: false, reviewId: review.id, expired: true }
    const { review: updated } = await this.store.mutate(review.id, (draft) => {
      draft.pendingOpen = null
    })
    return { open: true, reviewId: updated.id, revision: updated.revision }
  }
}

export function canvasState(review) {
  const pages = new Map(review.pages.map((page) => [page.id, page]))
  const variants = new Map(review.variants.map((variant) => [variant.id, variant]))
  const sections = [...review.sections].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const groups = review.groups ?? []
  const nodes = review.versions.map((version) => {
    const page = pages.get(version.pageId)
    const variant = variants.get(version.variantId)
    const card = review.layout[version.id] ?? { x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT }
    const group = groups.find((entry) => entry.nodeIds.includes(version.id))
    return {
      id: version.id,
      versionId: version.id,
      pageId: version.pageId,
      variantId: version.variantId,
      pageKey: page?.key,
      variantKey: variant?.key,
      title: page?.title ?? '未命名页面',
      variant: variant?.name ?? '默认方案',
      version: version.number,
      status: version.status,
      sectionId: page?.sectionId,
      groupId: group?.id,
      x: card.x,
      y: card.y,
      w: card.w,
      h: card.h,
      locked: card.locked === true,
      createdAt: version.createdAt,
      note: version.note,
      sourceUrl: version.sourceUrl,
      hasHtml: typeof version.htmlFile === 'string',
      hasSnapshot: Boolean(version.snapshot && version.status === 'ready'),
      snapshot: version.snapshot
        ? {
            width: version.snapshot.width,
            height: version.snapshot.height,
            mediaType: version.snapshot.mediaType,
            bytes: version.snapshot.bytes,
          }
        : undefined,
      viewport: version.viewport,
      error: version.error,
      feedbackCount: review.annotations.filter(
        (annotation) => annotation.versionId === version.id && annotation.status !== 'confirmed',
      ).length,
      draftCount: review.annotations.filter(
        (annotation) => annotation.versionId === version.id && annotation.status === 'draft',
      ).length,
    }
  })
  const sectionList = sections.map((section) => {
    const cards = nodes.filter((node) => node.sectionId === section.id)
    const bounds = cards.length > 0
      ? {
          x: Math.min(...cards.map((node) => node.x)) - 28,
          y: Math.min(...cards.map((node) => node.y)) - 22,
          w: Math.max(...cards.map((node) => node.x + node.w)) - Math.min(...cards.map((node) => node.x)) + 56,
          h: Math.max(...cards.map((node) => node.y + node.h)) - Math.min(...cards.map((node) => node.y)) + 50,
        }
      : section.bounds ?? { x: 0, y: 0, w: 1000, h: 700 }
    return { ...section, bounds }
  })
  const groupList = groups.map((group) => {
    const cards = nodes.filter((node) => group.nodeIds.includes(node.versionId))
    const bounds = cards.length > 0
      ? {
          x: Math.min(...cards.map((node) => node.x)) - 16,
          y: Math.min(...cards.map((node) => node.y)) - 34,
          w: Math.max(...cards.map((node) => node.x + node.w)) - Math.min(...cards.map((node) => node.x)) + 32,
          h: Math.max(...cards.map((node) => node.y + node.h)) - Math.min(...cards.map((node) => node.y)) + 50,
        }
      : undefined
    return {
      id: group.id,
      name: group.name,
      color: group.color,
      nodeIds: [...group.nodeIds],
      createdAt: group.createdAt,
      bounds,
    }
  }).filter((group) => group.bounds !== undefined)

  return {
    reviewId: review.id,
    title: review.title,
    sessionId: review.sessionId,
    projectKey: review.projectKey,
    projectName: basename(review.projectRoot ?? '') || undefined,
    revision: review.revision,
    round: review.round,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    sections: sectionList,
    groups: groupList,
    nodes,
    annotations: review.annotations.map(sanitizeAnnotation),
    batches: review.batches.map(sanitizeBatch),
    unreadBatches: review.batches.filter((batch) => batch.number > (review.lastReadBatchNumber ?? 0)).length,
    counts: {
      pages: review.pages.length,
      variants: review.variants.length,
      versions: review.versions.length,
      drafts: review.annotations.filter((annotation) => annotation.status === 'draft').length,
      openBatches: review.batches.filter((batch) => batch.status === 'submitted' || batch.status === 'processing').length,
    },
  }
}

export function feedbackPrompt(review, batch) {
  const lines = [
    `[前端评审画布] 新一轮视觉反馈已提交（画布 ${review.id}，批次 #${batch.number}，batchId=${batch.id}）。`,
    `请先调用 review_get_feedback 读取文字和定位；需要现场证据时调用 review_get_evidence 获取截图，再修改代码。`,
    `涉及 ${batch.versionIds.length} 个页面版本、${batch.annotationIds.length} 条批注。`,
  ]
  if (batch.summary) lines.push(`本轮补充说明：${batch.summary}`)
  lines.push('修改完成后，用 review_publish 以相同的 pageKey/variantKey 发布固定新版本，并传入 respondsTo 关联本批次。不要把未截图的开发地址当作固定版本。')
  return lines.join('\n')
}

function normalizeItem(item, index) {
  if (!item || typeof item !== 'object') throw new Error(`pages[${index}] must be an object`)
  const pageKey = optionalString(item.pageKey, `pages[${index}].pageKey`, 120) ?? `page-${index + 1}`
  const variantKey = optionalString(item.variantKey, `pages[${index}].variantKey`, 120) ?? 'default'
  const title = optionalString(item.title, `pages[${index}].title`, 160) ?? pageKey
  const variantName = optionalString(item.variantName, `pages[${index}].variantName`, 120) ?? (variantKey === 'default' ? '默认方案' : variantKey)
  return {
    pageKey,
    variantKey,
    title,
    variantName,
    titleOverride: optionalString(item.pageTitle, `pages[${index}].pageTitle`, 160),
    sectionId: optionalString(item.sectionId, `pages[${index}].sectionId`, 120),
    sectionTitle: optionalString(item.sectionTitle, `pages[${index}].sectionTitle`, 120),
    note: optionalString(item.note, `pages[${index}].note`, 2000),
    viewport: item.viewport,
    source: item.source,
  }
}

function ensureSection(review, sectionId, sectionTitle) {
  if (sectionId) {
    const existing = review.sections.find((section) => section.id === sectionId)
    if (existing) return existing
  }
  if (sectionTitle) {
    const existing = review.sections.find((section) => section.title === sectionTitle)
    if (existing) return existing
    const created = {
      id: sectionId || ReviewStore.newSectionId(sectionTitle),
      title: sectionTitle.slice(0, 120),
      order: review.sections.length,
    }
    review.sections.push(created)
    return created
  }
  return review.sections[0]
}

function ensurePage(review, item, sectionId) {
  let page = review.pages.find((entry) => entry.key === item.pageKey)
  if (!page) {
    page = {
      id: ReviewStore.newPageId(item.pageKey),
      key: item.pageKey,
      title: item.title,
      sectionId,
      order: review.pages.filter((entry) => entry.sectionId === sectionId).length,
      createdAt: nowIso(),
    }
    review.pages.push(page)
  }
  if (page.sectionId !== sectionId) page.sectionId = sectionId
  if (item.title && page.title !== item.title) page.title = item.title
  return page
}

function ensureVariant(review, page, item) {
  let variant = review.variants.find((entry) => entry.pageId === page.id && entry.key === item.variantKey)
  if (!variant) {
    variant = {
      id: ReviewStore.newVariantId(page.id, item.variantKey),
      pageId: page.id,
      key: item.variantKey,
      name: item.variantName,
      order: review.variants.filter((entry) => entry.pageId === page.id).length,
      createdAt: nowIso(),
    }
    review.variants.push(variant)
  }
  if (item.variantName && variant.name !== item.variantName) variant.name = item.variantName
  return variant
}

function normalizeViewport(viewport) {
  return {
    width: clamp(Math.round(Number(viewport?.width) || DEFAULT_VIEWPORT.width), 320, 3840),
    height: clamp(Math.round(Number(viewport?.height) || DEFAULT_VIEWPORT.height), 240, 4000),
  }
}

function normalizeGeometry(geometry) {
  const x = clamp(Number(geometry?.x) || 0, 0, 1)
  const y = clamp(Number(geometry?.y) || 0, 0, 1)
  const w = clamp(Number(geometry?.w) || 0, 0, 1)
  const h = clamp(Number(geometry?.h) || 0, 0, 1)
  const points = Array.isArray(geometry?.points)
    ? geometry.points
        .filter((point) => Array.isArray(point) && point.length >= 2)
        .slice(0, 400)
        .map(([px, py]) => [clamp(Number(px) || 0, 0, 1), clamp(Number(py) || 0, 0, 1)])
    : undefined
  return { x, y, w, h, ...(points ? { points } : {}) }
}

function normalizeElement(element) {
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : undefined
  const rect = element.rect && typeof element.rect === 'object'
    ? {
        x: clamp(Number(element.rect.x) || 0, 0, 1),
        y: clamp(Number(element.rect.y) || 0, 0, 1),
        w: clamp(Number(element.rect.w) || 0, 0, 1),
        h: clamp(Number(element.rect.h) || 0, 0, 1),
      }
    : undefined
  return {
    selector: text(element.selector, 600),
    label: text(element.label, 300),
    tag: text(element.tag, 80),
    text: text(element.text, 600),
    ...(rect ? { rect } : {}),
  }
}

function safeColor(color) {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/u.test(color) ? color : '#ff4d4f'
}

function captureError(error) {
  const code = error?.code ?? 'CAPTURE_FAILED'
  const message = error instanceof Error ? error.message : String(error)
  return {
    code,
    message,
    hint:
      code === 'BROWSER_NOT_FOUND'
        ? 'Install Chrome or Edge, or set DSH_REVIEW_CHROME, then publish again.'
        : 'The live page URL may be reachable but no fixed screenshot was produced. Check the dev server and authentication, or import an HTML/image source.',
  }
}

function injectBaseUrl(html, baseUrl) {
  if (/<base\s/iu.test(html)) return html
  const tag = `<base href="${escapeHtml(baseUrl.replace(/\/?$/u, '/'))}">`
  if (/<head[^>]*>/iu.test(html)) return html.replace(/<head[^>]*>/iu, (match) => `${match}\n${tag}`)
  return `<head>${tag}</head>\n${html}`
}

function extensionForMediaType(mediaType) {
  switch (mediaType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    default:
      return '.png'
  }
}

function pageLabel(review, versionId) {
  const version = review.versions.find((entry) => entry.id === versionId)
  if (!version) return undefined
  const page = review.pages.find((entry) => entry.id === version.pageId)
  const variant = review.variants.find((entry) => entry.id === version.variantId)
  return {
    pageId: version.pageId,
    variantId: version.variantId,
    page: page?.title,
    variant: variant?.name,
    version: version.number,
  }
}

export function sanitizeAnnotation(annotation) {
  return {
    id: annotation.id,
    versionId: annotation.versionId,
    pageId: annotation.pageId,
    variantId: annotation.variantId,
    kind: annotation.kind,
    geometry: annotation.geometry,
    text: annotation.text,
    color: annotation.color,
    ...(annotation.element ? { element: annotation.element } : {}),
    status: annotation.status,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
    batchId: annotation.batchId,
    author: annotation.author,
    replies: annotation.replies ?? [],
  }
}

export function sanitizeBatch(batch) {
  return {
    id: batch.id,
    number: batch.number,
    createdAt: batch.createdAt,
    status: batch.status,
    annotationIds: [...batch.annotationIds],
    versionIds: [...batch.versionIds],
    summary: batch.summary,
    delivery: batch.delivery,
    responseVersionIds: [...batch.responseVersionIds],
    source: batch.source,
  }
}

export function dataPathForFile(dataDir, relativeFile) {
  return safeJoin(dataDir, relativeFile)
}

export function htmlDocumentForEvidence({ imageDataUrl, width, height, annotations }) {
  const shapes = annotations
    .map((annotation, index) => {
      const color = safeColor(annotation.color)
      const g = annotation.geometry ?? {}
      const x = Math.round(g.x * width)
      const y = Math.round(g.y * height)
      const w = Math.round(g.w * width)
      const h = Math.round(g.h * height)
      if (annotation.kind === 'arrow') {
        return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${color}" stroke-width="6" marker-end="url(#arrow)"/>`
      }
      if (annotation.kind === 'ellipse') {
        return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${Math.abs(w) / 2}" ry="${Math.abs(h) / 2}" fill="none" stroke="${color}" stroke-width="6"/>`
      }
      if (annotation.kind === 'pen' && Array.isArray(g.points)) {
        const points = g.points.map(([px, py]) => `${Math.round(px * width)},${Math.round(py * height)}`).join(' ')
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
      }
      if (annotation.kind === 'pin' || annotation.kind === 'note') {
        return `<circle cx="${x}" cy="${y}" r="20" fill="${color}" stroke="#fff" stroke-width="5"/><text x="${x}" y="${y + 7}" fill="#fff" font-family="Arial" font-size="20" font-weight="700" text-anchor="middle">${index + 1}</text>`
      }
      return `<rect x="${x}" y="${y}" width="${Math.abs(w)}" height="${Math.abs(h)}" fill="none" stroke="${color}" stroke-width="6" rx="8"/>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#fff}
    img{display:block;width:${width}px;height:${height}px;object-fit:contain}
    svg{position:absolute;inset:0;width:${width}px;height:${height}px;pointer-events:none}
  </style></head><body>
    <img src="${escapeHtml(imageDataUrl)}" alt="">
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ff4d4f"/></marker></defs>
      ${shapes}
    </svg>
  </body></html>`
}
