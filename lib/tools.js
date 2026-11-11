import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  canvasState,
  dataPathForFile,
  htmlDocumentForEvidence,
  sanitizeBatch,
} from './service.js'
import { captureScreenshot } from './capture.js'
import { atomicWrite, imageDimensions } from './util.js'

const SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', description: 'url, html, image, or existing' },
    url: { type: 'string', description: 'http(s) URL for kind=url; the page is captured as a fixed PNG' },
    html: { type: 'string', description: 'Complete HTML for kind=html (max 12 MiB)' },
    path: { type: 'string', description: 'Local HTML or image path for kind=html/image' },
    htmlPath: { type: 'string', description: 'Local HTML path alias for kind=html' },
    imagePath: { type: 'string', description: 'Local image path alias for kind=image' },
    dataUrl: { type: 'string', description: 'PNG/JPEG/GIF/WebP data URL for kind=image' },
    baseUrl: { type: 'string', description: 'Optional http(s) base URL for relative assets in imported HTML' },
    fullPage: { type: 'boolean', description: 'Capture the full document height instead of the viewport' },
    capture: { type: 'boolean', description: 'Set false only for a live URL preview without a fixed screenshot' },
  },
  required: ['kind'],
}

const PAGE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pageKey: { type: 'string', description: 'Stable page identity, e.g. home or settings' },
    title: { type: 'string', description: 'User-facing page title' },
    variantKey: { type: 'string', description: 'Stable design variant identity, e.g. a or b; default for the only variant' },
    variantName: { type: 'string', description: 'User-facing variant name, e.g. A方案' },
    sectionId: { type: 'string', description: 'Existing section id; omit to use sectionTitle or the first section' },
    sectionTitle: { type: 'string', description: 'Create or join a section by title, e.g. 首页' },
    note: { type: 'string', description: 'Short note recorded on this version' },
    viewport: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'number', description: 'CSS viewport width, default 1440' },
        height: { type: 'number', description: 'CSS viewport height, default 900' },
      },
    },
    source: SOURCE_SCHEMA,
  },
  required: ['pageKey', 'source'],
}

const REVIEW_ID_SCHEMA = {
  type: 'string',
  description: 'Canvas id from review_open. Omit to use the default canvas bound to this conversation.',
}

const ARRANGE_PLACEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    versionId: { type: 'string' },
    sectionId: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
    locked: { type: 'boolean' },
  },
  required: ['versionId'],
}

const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    name: { type: 'string' },
    file: { type: 'string' },
  },
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
}

/**
 * Register the eight review tools on the host context.
 * @param {object} ctx
 * @param {object} options
 */
export function registerReviewTools(ctx, { service, basePath, shareToken }) {
  const tools = [
    openTool(service, basePath, shareToken),
    importTool(service),
    publishTool(service),
    arrangeTool(service),
    readTool(service),
    feedbackTool(service),
    evidenceTool(ctx, service),
    updateFeedbackTool(service),
  ]
  for (const tool of tools) ctx.tools.register(tool)
}

function baseOutput(render) {
  return { schema: OUTPUT_SCHEMA, render }
}

function openTool(service, basePath, shareToken) {
  return {
    name: 'review_open',
    description:
      'Open or restore the frontend review canvas bound to this conversation. Repeated calls return the same canvas. The canvas opens in the Harness right sidebar. Call this before importing pages or reading visual feedback.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Optional canvas title; sets it when creating or renaming the bound canvas' },
      },
    },
    output: {
      ...baseOutput((_args, value) => [
        {
          type: 'text',
          text: value.created
            ? `已创建并打开「${value.title}」评审画布（${value.reviewId}）。接下来可调用 review_import 导入页面。\n独立交互画布：${value.canvasUrl}`
            : `已恢复并打开「${value.title}」评审画布（${value.reviewId}，${value.counts.pages} 个页面 / ${value.counts.versions} 个版本）。\n独立交互画布：${value.canvasUrl}`,
        },
      ]),
      presentationMeta: (args, value) => ({
        reviewId: value.reviewId,
        title: value.title,
        autoOpen: value.autoOpen === true,
        openedAt: value.openedAt,
        sessionId: value.sessionId,
      }),
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.session?.id ?? process.env.DSH_SESSION_ID
      if (!sessionId) throw new Error('review_open requires a bound Harness conversation')
      const projectRoot = exec.agent?.session?.header?.cwd ?? process.cwd()
      const opened = await service.open({ sessionId, projectRoot, title: args.title })
      const state = canvasState(opened.review)
      const resolvedBase = typeof basePath === 'function' ? basePath() : basePath
      const canvasUrl = `${String(resolvedBase).replace(/\/$/u, '')}/canvas?reviewId=${encodeURIComponent(state.reviewId)}${shareToken ? `&token=${encodeURIComponent(shareToken)}` : ''}`
      return {
        reviewId: state.reviewId,
        title: state.title,
        created: opened.created,
        revision: state.revision,
        counts: state.counts,
        panel: 'frontend-review',
        autoOpen: true,
        openedAt: new Date().toISOString(),
        sessionId,
        basePath,
        canvasUrl,
        next: 'Call review_import with page sources. Use review_read after importing to inspect layout.',
      }
    },
  }
}

function importTool(service) {
  return {
    name: 'review_import',
    description:
      'Import one or more frontend pages into the bound review canvas as fixed visual versions. Prefer source.url (http/https, captured to PNG) for running project pages, or source.html / source.image for static copies. Each item becomes the first version of its page+variant. Partial failures are reported per item and do not abort the batch.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: REVIEW_ID_SCHEMA,
        idempotencyKey: { type: 'string', description: 'Retry-safe key; the same key returns the original result' },
        force: { type: 'boolean', description: 'Ignore a previous result for the same idempotencyKey' },
        arrange: { type: 'boolean', description: 'Auto-arrange the canvas after import (default true)' },
        pages: { type: 'array', items: PAGE_ITEM_SCHEMA, description: 'Pages and design variants to import' },
      },
      required: ['pages'],
    },
    output: baseOutput((_args, value) => {
      const lines = [
        `画布 ${value.reviewId}：导入 ${value.imported.length} 个页面版本${value.failed.length ? `，${value.failed.length} 个失败` : ''}。`,
      ]
      for (const item of value.imported.slice(0, 20)) {
        lines.push(`- ${item.pageKey}/${item.variantKey} v${item.version}：${item.status === 'ready' ? '已固定截图' : item.status === 'live' ? '仅实时预览' : '截图失败'}${item.error ? `（${item.error.message}）` : ''}`)
      }
      for (const failure of value.failed.slice(0, 10)) {
        lines.push(`- 失败 ${failure.pageKey ?? failure.title ?? failure.index}: ${failure.message}`)
      }
      lines.push('下一步：可调用 review_read 查看结构；用户将在画布中圈画并提交反馈。')
      return [{ type: 'text', text: lines.join('\n') }]
    }),
    async execute(args, exec) {
      const review = await requireReview(service, args, exec, { create: true })
      const result = await service.importPages({
        review,
        pages: args.pages,
        idempotencyKey: args.idempotencyKey,
        force: args.force === true,
        arrange: args.arrange !== false,
      })
      return result
    },
  }
}

function publishTool(service) {
  return {
    name: 'review_publish',
    description:
      'Publish fixed new versions after changing code. Reuse the same pageKey/variantKey to place the new result directly below that variant, keep earlier versions untouched, and link the feedback batch with respondsTo. Source.url is captured now; source.existing copies the latest fixed snapshot. A failed capture creates a failed version and never marks feedback as modified.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: REVIEW_ID_SCHEMA,
        idempotencyKey: { type: 'string', description: 'Retry-safe key; prevents duplicate version rows' },
        force: { type: 'boolean' },
        arrange: { type: 'boolean', description: 'Auto-arrange after publishing (default true)' },
        respondsTo: {
          type: 'array',
          items: { type: 'string' },
          description: 'Feedback batch ids answered by this publish',
        },
        note: { type: 'string', description: 'Short account of what changed in this round' },
        pages: { type: 'array', items: PAGE_ITEM_SCHEMA, description: 'Changed pages. Unchanged pages need no item.' },
      },
      required: ['pages'],
    },
    output: baseOutput((_args, value) => {
      const lines = [
        `画布 ${value.reviewId}：发布 ${value.imported.length} 个新版本${value.failed.length ? `，${value.failed.length} 个失败` : ''}。旧版本保持不变。`,
      ]
      for (const item of value.imported.slice(0, 20)) {
        lines.push(`- ${item.pageKey}/${item.variantKey} v${item.version}：${item.status === 'ready' ? '已固定截图' : item.status === 'live' ? '仅实时预览' : '截图失败'}${item.error ? `（${item.error.message}）` : ''}`)
      }
      for (const failure of value.failed.slice(0, 10)) {
        lines.push(`- 失败 ${failure.pageKey ?? failure.title ?? failure.index}: ${failure.message}`)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }),
    async execute(args, exec) {
      const review = await requireReview(service, args, exec, { create: false })
      return service.publish({
        review,
        pages: args.pages,
        idempotencyKey: args.idempotencyKey,
        force: args.force === true,
        arrange: args.arrange !== false,
        respondTo: args.respondsTo,
        note: args.note,
      })
    },
  }
}

function arrangeTool(service) {
  return {
    name: 'review_arrange',
    description:
      'Organize the canvas: create/rename sections, move version cards between sections, lock or unlock positions, and run automatic alignment. Automatic layout groups pages into sections, places variants side by side, and stacks new versions downward. Locked cards are preserved. Use expectedRevision to avoid overwriting a user move.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: REVIEW_ID_SCHEMA,
        expectedRevision: { type: 'number', description: 'Canvas revision the model based this edit on' },
        mode: { type: 'string', description: 'auto (default) or manual' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              order: { type: 'number' },
              remove: { type: 'boolean', description: 'Remove an empty section' },
            },
            required: ['title'],
          },
        },
        placements: { type: 'array', items: ARRANGE_PLACEMENT_SCHEMA },
      },
    },
    output: baseOutput((_args, value) => [
      {
        type: 'text',
        text: `画布 ${value.reviewId} 已整理，revision=${value.revision}。锁定位置已保留；可调用 review_read 查看新布局。`,
      },
    ]),
    async execute(args, exec) {
      const review = await requireReview(service, args, exec)
      return service.rearrange({
        review,
        sections: args.sections,
        placements: args.placements,
        mode: args.mode === 'manual' ? 'manual' : 'auto',
        expectedRevision: args.expectedRevision,
      })
    },
  }
}

function readTool(service) {
  return {
    name: 'review_read',
    description:
      'Read the review canvas structure: sections, pages, variants, fixed versions, layout positions, locks, annotation counts, feedback batches, and the current revision. Use this before reorganizing or when you need version ids.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: REVIEW_ID_SCHEMA,
      },
    },
    output: baseOutput((_args, value) => {
      const state = value.canvas
      const lines = [
        `画布「${state.title}」revision=${state.revision}，${state.counts.pages} 页 / ${state.counts.versions} 版 / ${state.counts.drafts} 条草稿反馈。`,
      ]
      for (const section of state.sections) {
        lines.push(`\n[${section.title}] ${section.id}`)
        for (const node of state.nodes.filter((entry) => entry.sectionId === section.id)) {
          lines.push(
            `- ${node.title} / ${node.variant} v${node.version} (${node.versionId}) ${node.status}${node.locked ? ' 🔒' : ''}${node.draftCount ? ` · ${node.draftCount} 草稿` : ''}`,
          )
        }
      }
      if (state.batches.length > 0) {
        lines.push('\n最近反馈批次：')
        for (const batch of state.batches.slice(-6)) {
          lines.push(`- #${batch.number} ${batch.status}（${batch.id}）${batch.summary ? `：${batch.summary}` : ''}`)
        }
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }),
    async execute(args, exec) {
      const review = await requireReview(service, args, exec)
      return { canvas: canvasState(review) }
    },
  }
}

function feedbackTool(service) {
  return {
    name: 'review_get_feedback',
    description:
      'Read submitted visual feedback. Returns the written comments, target page/variant/version, annotation type and normalized geometry, status, and evidence ids. Defaults to feedback batches the agent has not read yet. Read the text first; call review_get_evidence only for the comments whose screenshots you need.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: REVIEW_ID_SCHEMA,
        batchId: { type: 'string', description: 'Read one batch by id' },
        sinceBatchId: { type: 'string', description: 'Read batches after this batch number' },
        status: { type: 'string', description: 'Optional batch status filter' },
        includeDrafts: { type: 'boolean', description: 'Also include private draft annotations not yet submitted' },
      },
    },
    output: baseOutput((_args, value) => {
      const lines = [`画布 ${value.reviewId} 共有 ${value.batches.length} 个相关反馈批次。`]
      for (const batch of value.batches) {
        lines.push(`\n## 批次 #${batch.number} · ${batch.status} · ${batch.id}`)
        if (batch.summary) lines.push(`补充说明：${batch.summary}`)
        for (const annotation of batch.annotations) {
          const where = annotation.page
            ? `${annotation.page.page ?? annotation.pageId} / ${annotation.page.variant ?? annotation.variantId} v${annotation.page.version ?? '?'}`
            : annotation.versionId
          lines.push(`- [${annotation.id}] ${where} · ${annotation.kind} · 状态 ${annotation.status}`)
          if (annotation.text) lines.push(`  原文：${annotation.text}`)
          lines.push(`  证据：review_get_evidence({ annotationIds: ["${annotation.id}"] })`)
        }
      }
      if (value.drafts?.length) {
        lines.push(`\n未提交草稿 ${value.drafts.length} 条；这些不是本轮任务，除非用户明确要求处理。`)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }),
    async execute(args, exec) {
      const review = await requireReview(service, args, exec)
      const result = await service.getFeedback({
        review,
        batchId: args.batchId,
        sinceBatch: args.sinceBatchId,
        status: args.status,
      })
      const drafts = args.includeDrafts
        ? review.annotations.filter((entry) => entry.status === 'draft').map((entry) => ({
            id: entry.id,
            versionId: entry.versionId,
            text: entry.text,
            kind: entry.kind,
          }))
        : []
      const maxNumber = Math.max(0, ...result.batches.map((batch) => batch.number))
      if (maxNumber > (review.lastReadBatchNumber ?? 0)) {
        await service.store.mutate(review.id, (draft) => {
          draft.lastReadBatchNumber = maxNumber
          draft.lastReadAt = new Date().toISOString()
        })
      }
      return { ...result, drafts }
    },
  }
}

function evidenceTool(ctx, service) {
  return {
    name: 'review_get_evidence',
    description:
      'Read screenshot evidence for feedback. Returns the fixed page screenshot with annotations painted on top, the target version/viewport, annotation geometry and text. Images are attached when the model route accepts images; otherwise the result names the files. Fetch only the comments you need.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: REVIEW_ID_SCHEMA,
        annotationIds: { type: 'array', items: { type: 'string' } },
        batchId: { type: 'string', description: 'Fetch evidence for every annotation in this batch' },
        includeImages: { type: 'boolean', description: 'Attach annotated PNGs (default true)' },
      },
    },
    output: baseOutput((_args, value) => {
      const blocks = []
      const lines = [`证据 ${value.items.length} 条。`]
      for (const item of value.items) {
        lines.push(
          `\n[${item.annotationId}] ${item.target.page ?? item.target.versionId} / ${item.target.variant ?? ''} v${item.target.version ?? '?'} · ${item.status}`,
        )
        if (item.text) lines.push(`原文：${item.text}`)
        lines.push(`坐标：${JSON.stringify(item.geometry)}（页面归一化坐标，原点左上）`)
        if (item.error) lines.push(`截图不可用：${item.error}`)
      }
      blocks.push({ type: 'text', text: lines.join('\n') })
      for (const image of value.images ?? []) {
        blocks.push({
          type: 'image',
          attachment: {
            attachmentId: image.attachmentId,
            mediaType: image.mediaType,
            bytes: image.bytes,
            width: image.width,
            height: image.height,
            ...(image.name ? { name: image.name } : {}),
          },
        })
      }
      return blocks
    }),
    async execute(args, exec) {
      const review = await requireReview(service, args, exec)
      const evidence = await service.getEvidence({
        review,
        annotationIds: args.annotationIds,
        batchId: args.batchId,
      })
      const images = []
      if (args.includeImages !== false) {
        const annotated = await buildAnnotatedImages(ctx, service, review, evidence, exec)
        images.push(...annotated)
      }
      return {
        reviewId: review.id,
        revision: review.revision,
        items: evidence.map((item) => ({
          annotationId: item.annotationId,
          batchId: item.batchId,
          status: item.status,
          text: item.text,
          kind: item.kind,
          geometry: item.geometry,
          target: item.target,
          error: item.snapshotFile ? undefined : 'no fixed screenshot for this version',
        })),
        images,
      }
    },
  }
}

function updateFeedbackTool(service) {
  return {
    name: 'review_update_feedback',
    description:
      'Reply to feedback and record processing state. Agent-allowed states: processing, modified (only after a new version is linked), needs-info, deferred. Never mark confirmed: only the user confirms in the canvas. A reply is preserved as an immutable new entry; original user text is never overwritten.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewId: REVIEW_ID_SCHEMA,
        expectedRevision: { type: 'number' },
        batchId: { type: 'string' },
        annotationId: { type: 'string' },
        status: { type: 'string', description: 'processing, modified, needs-info, or deferred' },
        reply: { type: 'string', description: 'What was done or what information is needed' },
        versionIds: { type: 'array', items: { type: 'string' } },
      },
    },
    output: baseOutput((_args, value) => [
      {
        type: 'text',
        text: `已更新 ${value.annotations.length} 条反馈${value.batch ? `（批次 #${value.batch.number}：${value.batch.status}）` : ''}。用户确认仍需在画布中完成。`,
      },
    ]),
    async execute(args, exec) {
      const review = await requireReview(service, args, exec)
      return service.updateFeedback({
        review,
        batchId: args.batchId,
        annotationId: args.annotationId,
        status: args.status,
        reply: args.reply,
        versionIds: args.versionIds,
        expectedRevision: args.expectedRevision,
      })
    },
  }
}

async function requireReview(service, args, exec, { create = false } = {}) {
  const sessionId = exec.agent?.session?.id ?? process.env.DSH_SESSION_ID
  const projectRoot = exec.agent?.session?.header?.cwd ?? process.cwd()
  const review = await service.resolve({
    reviewId: args.reviewId,
    sessionId,
    projectRoot,
    create: create && Boolean(sessionId),
  })
  if (!review) throw new Error('review canvas not found; call review_open first')
  return review
}

async function buildAnnotatedImages(ctx, service, review, evidence, exec) {
  const attachments = ctx.get('attachments')
  if (!attachments) return []
  const images = []
  for (const item of evidence.slice(0, 4)) {
    if (!item.snapshotFile) continue
    try {
      const snapshotPath = dataPathForFile(service.dataDir, item.snapshotFile)
      const source = await readFile(snapshotPath)
      const dims = imageDimensions(source) ?? { width: 1440, height: 900 }
      const version = review.versions.find((entry) => entry.id === item.target.versionId)
      const related = review.annotations.filter(
        (annotation) => annotation.versionId === item.target.versionId && annotation.status !== 'draft',
      )
      const html = htmlDocumentForEvidence({
        imageDataUrl: `data:${dims.mediaType ?? 'image/png'};base64,${source.toString('base64')}`,
        width: dims.width,
        height: dims.height,
        annotations: related.length > 0 ? related : [review.annotations.find((entry) => entry.id === item.annotationId)].filter(Boolean),
      })
      const shot = await captureScreenshot({
        html,
        width: dims.width,
        height: dims.height,
        fullPage: false,
        waitMs: 50,
      })
      const file = join(service.dataDir, 'assets', review.id, `evidence-${item.annotationId}.png`)
      await atomicWrite(file, shot.data)
      const ref = await attachments.saveImage({
        data: shot.data,
        mediaType: 'image/png',
        name: `${slug(item.target.page ?? 'page')}-v${item.target.version ?? '?'}-${item.annotationId}.png`,
      })
      images.push({
        annotationId: item.annotationId,
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        name: ref.name,
      })
    } catch (error) {
      exec.agent?.logger?.warn?.(`review evidence image failed: ${error?.message ?? error}`)
    }
  }
  return images
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40) || 'page'
}



