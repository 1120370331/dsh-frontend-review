import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ReviewService, canvasState } from '../lib/service.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lDq3WQAAAABJRU5ErkJggg==',
  'base64',
)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-test-'))
  const image = join(root, 'shot.png')
  await writeFile(image, PNG)
  const deliveries = []
  const service = new ReviewService({
    dataDir: join(root, 'data'),
    feedbackDelivery: async ({ batch }) => {
      deliveries.push(batch.id)
      return { status: 'delivered', message: 'queued' }
    },
  })
  const { review } = await service.open({ sessionId: 'session-test', projectRoot: 'C:/demo', title: 'Test canvas' })
  return { root, image, service, review, deliveries }
}

test('import, annotate, submit, publish and preserve history', async () => {
  const { root, image, service, review, deliveries } = await fixture()
  try {
    const imported = await service.importPages({
      review,
      pages: [{ pageKey: 'home', title: '首页', variantKey: 'a', variantName: 'A 方案', source: { kind: 'image', path: image } }],
    })
    assert.equal(imported.imported[0].status, 'ready')
    const versionId = imported.imported[0].versionId
    const before = await service.store.get(review.id)
    const oldSnapshot = await readFile(join(service.dataDir, before.versions[0].snapshot.file))
    const annotation = await service.upsertAnnotation({
      review: before,
      annotation: { versionId, kind: 'rect', geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, text: '间距太挤' },
    })
    const submitted = await service.submitFeedback({
      review: await service.store.get(review.id),
      annotationIds: [annotation.annotation.id],
      summary: '第一轮',
    })
    assert.equal(submitted.batch.status, 'submitted')
    assert.deepEqual(deliveries, [submitted.batch.id])

    const published = await service.publish({
      review: await service.store.get(review.id),
      pages: [{ pageKey: 'home', title: '首页', variantKey: 'a', variantName: 'A 方案', source: { kind: 'existing' } }],
      respondTo: [submitted.batch.id],
    })
    assert.equal(published.imported[0].version, 2)
    const after = await service.store.get(review.id)
    assert.equal(after.versions.length, 2)
    assert.equal(after.versions[0].snapshot.file, before.versions[0].snapshot.file)
    assert.deepEqual(await readFile(join(service.dataDir, after.versions[0].snapshot.file)), oldSnapshot)
    assert.equal(after.versions[1].snapshot.file === after.versions[0].snapshot.file, false)
    assert.equal(after.batches[0].status, 'modified')
    assert.equal(after.annotations[0].status, 'modified')
    assert.equal(after.annotations[0].text, '间距太挤')
    const state = canvasState(after)
    assert.equal(state.nodes.length, 2)
    assert.ok(state.nodes[1].y > state.nodes[0].y)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('idempotent publish does not duplicate versions', async () => {
  const { root, image, service, review } = await fixture()
  try {
    const imported = await service.importPages({
      review,
      pages: [{ pageKey: 'home', variantKey: 'a', source: { kind: 'image', path: image } }],
    })
    assert.equal(imported.imported[0].status, 'ready')
    const body = {
      review: await service.store.get(review.id),
      pages: [{ pageKey: 'home', variantKey: 'a', source: { kind: 'existing' } }],
      idempotencyKey: 'same-publish',
    }
    const first = await service.publish(body)
    const second = await service.publish({ ...body, review: await service.store.get(review.id) })
    assert.equal(second.deduplicated, true)
    assert.equal(second.revision, first.revision)
    const state = canvasState(await service.store.get(review.id))
    assert.equal(state.nodes.length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a live-only publish never marks reviewed feedback as modified', async () => {
  const { root, image, service, review } = await fixture()
  try {
    const imported = await service.importPages({
      review,
      pages: [{ pageKey: 'home', variantKey: 'a', source: { kind: 'image', path: image } }],
    })
    const annotation = await service.upsertAnnotation({
      review: await service.store.get(review.id),
      annotation: {
        versionId: imported.imported[0].versionId,
        kind: 'pin',
        geometry: { x: 0.2, y: 0.2, w: 0, h: 0 },
        text: '这里再看一下',
      },
    })
    const submitted = await service.submitFeedback({
      review: await service.store.get(review.id),
      annotationIds: [annotation.annotation.id],
    })
    const published = await service.publish({
      review: await service.store.get(review.id),
      pages: [{
        pageKey: 'home',
        variantKey: 'a',
        source: { kind: 'url', url: 'http://127.0.0.1:9/', capture: false },
      }],
      respondTo: [submitted.batch.id],
    })
    assert.equal(published.imported[0].status, 'live')
    const after = await service.store.get(review.id)
    assert.equal(after.batches[0].status, 'processing')
    assert.equal(after.annotations[0].status, 'submitted')
    assert.equal(after.batches[0].responseVersionIds.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed delivery can be retried without creating a second batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-retry-'))
  const image = join(root, 'shot.png')
  await writeFile(image, PNG)
  let attempts = 0
  const service = new ReviewService({
    dataDir: join(root, 'data'),
    feedbackDelivery: async () => {
      attempts += 1
      return attempts === 1
        ? { status: 'failed', error: 'conversation offline' }
        : { status: 'delivered' }
    },
  })
  try {
    const { review } = await service.open({ sessionId: 'session-test', projectRoot: 'C:/demo' })
    const imported = await service.importPages({
      review,
      pages: [{ pageKey: 'home', variantKey: 'a', source: { kind: 'image', path: image } }],
    })
    await service.upsertAnnotation({
      review: await service.store.get(review.id),
      annotation: {
        versionId: imported.imported[0].versionId,
        kind: 'note',
        geometry: { x: 0.5, y: 0.5, w: 0, h: 0 },
        text: '需要再看一下',
      },
    })
    const submitted = await service.submitFeedback({ review: await service.store.get(review.id) })
    assert.equal(submitted.delivery.status, 'failed')
    assert.equal((await service.store.get(review.id)).batches.length, 1)
    const retried = await service.retryDelivery({
      review: await service.store.get(review.id),
      batchId: submitted.batch.id,
    })
    assert.equal(retried.delivery.status, 'delivered')
    const after = await service.store.get(review.id)
    assert.equal(after.batches.length, 1)
    assert.equal(after.batches[0].delivery.status, 'delivered')
    assert.equal(after.batches[0].delivery.attempts, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('auto layout preserves locked cards and reports revision conflicts', async () => {
  const { root, image, service, review } = await fixture()
  try {
    const imported = await service.importPages({
      review,
      pages: [
        { pageKey: 'home', variantKey: 'a', source: { kind: 'image', path: image } },
        { pageKey: 'settings', variantKey: 'a', source: { kind: 'image', path: image } },
      ],
    })
    assert.equal(imported.imported.length, 2)
    const current = await service.store.get(review.id)
    const node = canvasState(current).nodes[0]
    await service.updateCard({
      review: current,
      versionId: node.versionId,
      x: 900,
      y: 700,
      locked: true,
    })
    const moved = await service.rearrange({
      review: await service.store.get(review.id),
      mode: 'auto',
    })
    assert.equal(moved.layout[node.versionId].x, 900)
    assert.equal(moved.layout[node.versionId].y, 700)
    assert.equal(moved.layout[node.versionId].locked, true)
    await assert.rejects(
      service.rearrange({
        review: await service.store.get(review.id),
        mode: 'auto',
        expectedRevision: 1,
      }),
      /canvas changed since revision/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
