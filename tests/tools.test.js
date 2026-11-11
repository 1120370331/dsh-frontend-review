import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ReviewService } from '../lib/service.js'
import { registerReviewTools } from '../lib/tools.js'

test('review_open registers, accepts a title, and exposes presentation metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-tools-'))
  const service = new ReviewService({
    dataDir: join(root, 'data'),
    feedbackDelivery: async () => ({ status: 'delivered' }),
  })
  const registered = []
  const ctx = {
    get: () => undefined,
    tools: { register: (tool) => registered.push(tool) },
  }
  try {
    registerReviewTools(ctx, { service, basePath: '/frontend-review' })
    assert.deepEqual(
      registered.map((tool) => tool.name),
      [
        'review_open',
        'review_import',
        'review_publish',
        'review_arrange',
        'review_read',
        'review_get_feedback',
        'review_get_evidence',
        'review_update_feedback',
      ],
    )
    const open = registered[0]
    const value = await open.execute(
      { title: '工具测试画布' },
      { agent: { session: { id: 'session-tools', header: { cwd: 'C:/demo' } } } },
    )
    assert.equal(value.title, '工具测试画布')
    assert.equal(value.created, true)
    const meta = open.output.presentationMeta({}, value)
    assert.equal(meta.reviewId, value.reviewId)
    assert.equal(meta.autoOpen, true)
    assert.equal(meta.sessionId, 'session-tools')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
