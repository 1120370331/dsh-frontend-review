(() => {
  let data = window.__REVIEW__
  const base = String(window.__REVIEW_BASE__ || '/frontend-review').replace(/\/$/u, '')
  const token = window.__REVIEW_TOKEN__ || ''
  const stage = document.getElementById('stage')
  const world = document.getElementById('world')
  const outline = document.getElementById('outline')
  const inspector = document.getElementById('inspector')
  const inspectorBody = document.getElementById('inspector-body')
  const title = document.getElementById('title')
  const subtitle = document.getElementById('subtitle')
  const zoomReadout = document.getElementById('zoom-readout')
  const toast = document.getElementById('toast')
  const annToggle = document.getElementById('toggle-annotations')
  const preview = document.getElementById('preview')
  const previewFrame = document.getElementById('preview-frame')
  const previewWrap = document.getElementById('preview-frame-wrap')
  const previewTitle = document.getElementById('preview-title')
  const previewSub = document.getElementById('preview-sub')
  const previewFoot = document.getElementById('preview-foot')
  const pickButton = document.getElementById('pick-component')
  const previewAnn = document.getElementById('preview-annotations')
  const previewDraw = document.getElementById('preview-draw')
  const contextMenu = document.getElementById('context-menu')
  const annotationPopover = document.getElementById('annotation-popover')
  const annotationPopoverText = document.getElementById('annotation-popover-text')
  const annotationPopoverTitle = document.getElementById('annotation-popover-title')
  const annotationPopoverStatus = document.getElementById('annotation-popover-status')
  const annotationPopoverDelete = document.getElementById('delete-annotation-popover')
  const compareButton = document.getElementById('toggle-compare')
  const comparePicker = document.getElementById('compare-picker')
  const compareOptions = document.getElementById('compare-options')
  const compareCount = document.getElementById('compare-count')
  const compareConfirm = document.getElementById('confirm-compare')
  const compare = document.getElementById('compare')
  const compareGrid = document.getElementById('compare-grid')
  const compareSub = document.getElementById('compare-sub')
  const compareFoot = document.getElementById('compare-foot')
  const bar = document.querySelector('.bar')

  let zoom = 1
  let pan = { x: 50, y: 50 }
  let selected = null
  let selectedAnn = null
  const selectedAnnotations = new Set()
  let showAllRounds = false
  let tool = 'select'
  let color = '#ff4d4f'
  let showAnnotations = true
  let fitted = false
  let panning = null
  let dragging = null
  let suppressClick = false
  const multiSelected = new Set()
  let drawing = null
  let previewNode = null
  let pickerArmed = false
  let summary = ''
  let saveTimer = null
  let submitting = false
  let toastTimer = null
  let frameReady = false
  let contextItems = []
  const compareSelection = new Set()
  let compareIds = []
  let compareDrawing = null

  const escape = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

  const statusLabel = (status) => ({
    draft: '草稿',
    submitted: '已提交',
    processing: '处理中',
    modified: '已修改待确认',
    confirmed: '已确认',
    deferred: '暂缓',
    'needs-info': '需要信息',
    ready: '已固定',
    live: '实时',
    failed: '失败',
  })[status] || status || '未知'

  const kindLabel = (kind) => ({
    rect: '框选',
    ellipse: '圈选',
    arrow: '箭头',
    pen: '画笔',
    pin: '标记',
    note: '批注',
    component: '组件',
  })[kind] || kind

  function assetUrl(versionId) {
    return `${base}/api/asset/${encodeURIComponent(data.reviewId)}/${encodeURIComponent(versionId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`
  }

  function htmlUrl(versionId) {
    return `${base}/api/html/${encodeURIComponent(data.reviewId)}/${encodeURIComponent(versionId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`
  }

  function showToast(message, tone = 'info') {
    toast.textContent = message
    toast.dataset.show = 'true'
    toast.style.background = tone === 'error' ? '#b42318' : '#1f2937'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.dataset.show = 'false' }, 3200)
  }

  async function api(path, options = {}) {
    const headers = { accept: 'application/json', ...(options.headers ?? {}) }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers['x-review-token'] = token
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const text = await response.text()
    let payload
    try { payload = text ? JSON.parse(text) : {} } catch { payload = { error: text } }
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`)
      error.code = payload.code
      error.revision = payload.revision
      throw error
    }
    return payload
  }

  function applyTransform() {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
    zoomReadout.textContent = `${Math.round(zoom * 100)}%`
    stage.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`
    stage.style.backgroundPosition = `${pan.x}px ${pan.y}px`
  }

  function annotationSvg(annotation) {
    const g = annotation.geometry || {}
    const stroke = annotation.color || '#ff4d4f'
    const x = Number(g.x || 0) * 1000
    const y = Number(g.y || 0) * 1000
    const w = Number(g.w || 0) * 1000
    const h = Number(g.h || 0) * 1000
    const left = Math.min(x, x + w)
    const top = Math.min(y, y + h)
    const width = Math.abs(w)
    const height = Math.abs(h)
    const common = `stroke="${escape(stroke)}" stroke-width="3" fill="none" vector-effect="non-scaling-stroke"`
    if (annotation.kind === 'component') {
      const label = annotation.element?.label || annotation.element?.selector || '组件'
      return `<rect x="${left}" y="${top}" width="${Math.max(2, width)}" height="${Math.max(2, height)}" rx="5" ${common} stroke-dasharray="7 4"/>
        <text x="${left + 2}" y="${Math.max(10, top - 3)}" fill="${escape(stroke)}" font-size="10" font-family="system-ui,sans-serif">${escape(label).slice(0, 42)}</text>`
    }
    if (annotation.kind === 'arrow') {
      return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${common} marker-end="url(#fr-arrow)"/>`
    }
    if (annotation.kind === 'ellipse') {
      return `<ellipse cx="${left + width / 2}" cy="${top + height / 2}" rx="${Math.max(2, width / 2)}" ry="${Math.max(2, height / 2)}" ${common}/>`
    }
    if (annotation.kind === 'pen' && Array.isArray(g.points)) {
      const points = g.points.map(([px, py]) => `${Number(px) * 1000},${Number(py) * 1000}`).join(' ')
      return `<polyline points="${points}" ${common} stroke-linecap="round" stroke-linejoin="round"/>`
    }
    if (annotation.kind === 'pin' || annotation.kind === 'note') {
      const cx = annotation.kind === 'note' ? 500 : x
      const cy = annotation.kind === 'note' ? 500 : y
      return `<circle cx="${cx}" cy="${cy}" r="18" fill="${escape(stroke)}" stroke="#fff" stroke-width="4" vector-effect="non-scaling-stroke"/>`
    }
    return `<rect x="${left}" y="${top}" width="${Math.max(2, width)}" height="${Math.max(2, height)}" rx="7" ${common}/>`
  }

  function annotationHitArea(annotation) {
    const g = annotation.geometry || {}
    const x = Number(g.x || 0) * 1000
    const y = Number(g.y || 0) * 1000
    const w = Number(g.w || 0) * 1000
    const h = Number(g.h || 0) * 1000
    const pad = 14
    if (annotation.kind === 'pin' || annotation.kind === 'note') {
      return `<rect x="${x - 24}" y="${y - 24}" width="48" height="48" fill="transparent" pointer-events="all"/>`
    }
    return `<rect x="${Math.min(x, x + w) - pad}" y="${Math.min(y, y + h) - pad}" width="${Math.abs(w) + pad * 2}" height="${Math.abs(h) + pad * 2}" fill="transparent" pointer-events="all"/>`
  }

  function annotationContent(annotations) {
    return `<defs><marker id="fr-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
      ${annotations.map((annotation) => `<g class="ann-shape" data-annotation-id="${escape(annotation.id)}" data-selected="${String(selectedAnnotations.has(annotation.id))}">${annotationHitArea(annotation)}${annotationSvg(annotation)}</g>`).join('')}`
  }

  function overlay(annotations) {
    if (!showAnnotations) return ''
    return `<svg class="ann-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${annotationContent(annotations)}</svg>`
  }

  function cardHtml(node) {
    const annotations = data.annotations.filter((annotation) =>
      annotation.versionId === node.versionId && annotation.status !== 'confirmed' && annotationInRound(annotation))
    const bodyW = Math.max(80, node.w - 2)
    const bodyH = Math.max(80, node.h - 43)
    let shot = ''
    if (node.status === 'ready' && node.snapshot) {
      const aspect = node.snapshot.width / Math.max(1, node.snapshot.height)
      let shotW = bodyW
      let shotH = shotW / aspect
      if (shotH > bodyH) {
        shotH = bodyH
        shotW = shotH * aspect
      }
      const left = (bodyW - shotW) / 2
      const top = (bodyH - shotH) / 2
      shot = `<div class="shot" data-shot-version="${escape(node.versionId)}" style="left:${left}px;top:${top}px;width:${shotW}px;height:${shotH}px">
        <img src="${escape(assetUrl(node.versionId))}" alt="${escape(node.title)} ${escape(node.variant)} v${node.version}" draggable="false">
        ${overlay(annotations)}
        <svg class="draw-layer" data-draw-version="${escape(node.versionId)}" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg>
      </div>`
    } else {
      const link = node.sourceUrl
        ? `<a href="${escape(node.sourceUrl)}" target="_blank" rel="noreferrer">打开原页面</a>`
        : ''
      shot = `<div class="placeholder"><div><strong>${node.status === 'failed' ? '固定截图失败' : '只有实时预览'}</strong><span>${escape(node.error?.message ?? '没有可预览的固定画面')}</span><br>${link}</div></div>`
    }
    const canPreview = node.hasHtml || node.sourceUrl
    return `<article class="card" data-version-id="${escape(node.versionId)}" data-group-id="${escape(node.groupId || '')}" data-selected="${String(selected === node.versionId)}" data-multi="${String(multiSelected.has(node.versionId))}" style="left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px" tabindex="0">
      <header class="card-head">
        <i class="status-dot" data-status="${escape(node.status)}"></i>
        <div class="card-name"><strong>${escape(node.title)}</strong><em>${escape(node.variant)}</em></div>
        <span class="version">v${node.version}</span>
        ${canPreview ? `<button class="card-action" type="button" data-action="preview" data-version-id="${escape(node.versionId)}">互动</button>` : ''}
      </header>
      <div class="card-body">${shot}</div>
    </article>`
  }

  function annotationInRound(annotation) {
    if (showAllRounds) return true
    if (annotation.status === 'draft') return true
    const latestBatch = [...(data.batches ?? [])].sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0]
    if (!latestBatch) return true
    return annotation.batchId === latestBatch.id
  }

  function groupBoxHtml(group) {
    const cards = data.nodes.filter((node) => group.nodeIds.includes(node.versionId))
    if (cards.length === 0) return ''
    const x = Math.min(...cards.map((node) => node.x)) - 16
    const y = Math.min(...cards.map((node) => node.y)) - 34
    const w = Math.max(...cards.map((node) => node.x + node.w)) - Math.min(...cards.map((node) => node.x)) + 32
    const h = Math.max(...cards.map((node) => node.y + node.h)) - Math.min(...cards.map((node) => node.y)) + 50
    return `<div class="group-box" data-group-id="${escape(group.id)}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
      <div class="group-label" data-group-id="${escape(group.id)}" style="border-color:${escape(group.color || '#246bfd')};color:${escape(group.color || '#246bfd')}">${escape(group.name)} <span class="group-count">${cards.length}</span></div>
    </div>`
  }

  function renderWorld() {
    world.innerHTML = (data.groups ?? []).map(groupBoxHtml).join('') + data.sections.map((section) => {
      const cards = data.nodes.filter((node) => node.sectionId === section.id)
      return `<div class="section" style="left:${section.bounds.x}px;top:${section.bounds.y}px;width:${section.bounds.w}px;height:${section.bounds.h}px">
        <div class="section-title">${escape(section.title)} <small>${cards.length} 个版本</small></div>
        ${cards.map(cardHtml).join('')}
      </div>`
    }).join('')
    stage.dataset.tool = tool
    applyTransform()
  }

  function renderOutline() {
    outline.innerHTML = `<div class="outline-title">画布结构</div>` + data.sections.map((section) => `
      <div class="outline-section">${escape(section.title)}</div>
      ${data.nodes.filter((node) => node.sectionId === section.id).map((node) => `
        <button type="button" class="outline-item" data-outline-id="${escape(node.versionId)}" data-selected="${String(selected === node.versionId)}">
          <i class="status-dot" data-status="${escape(node.status)}"></i><span>${escape(node.title)} · ${escape(node.variant)} v${node.version}</span>
        </button>`).join('')}
    `).join('')
  }

  function chip(value, status = '') {
    return `<span class="chip" ${status ? `data-status="${escape(status)}"` : ''}>${escape(value)}</span>`
  }

  function toolButton(value, icon, label) {
    return `<button type="button" class="tool-btn" data-tool="${value}" data-active="${String(tool === value)}"><b>${icon}</b>${label}</button>`
  }

  function batchMarkup(limit) {
    if (data.batches.length === 0) return `<div class="empty">还没有提交过反馈。</div>`
    return [...data.batches].reverse().slice(0, limit).map((batch) => `
      <div class="batch">
        <div class="batch-head"><strong>第 ${batch.number} 轮</strong><span class="badge" data-status="${escape(batch.status)}">${escape(statusLabel(batch.status))}</span></div>
        <p>${batch.annotationIds.length} 条批注 · ${batch.delivery?.status === 'delivered' ? '已送达对话' : batch.delivery?.status === 'failed' ? '未唤醒对话' : '等待送达'}</p>
        ${batch.summary ? `<p>${escape(batch.summary)}</p>` : ''}
      </div>`).join('')
  }

  function renderInspector() {
    const node = data.nodes.find((entry) => entry.versionId === selected) || data.nodes[0]
    if (!node) {
      inspectorBody.innerHTML = `<div class="empty">这个画布还没有页面。</div>`
      return
    }
    if (selected !== node.versionId) selected = node.versionId
    const annotations = data.annotations.filter((annotation) => annotation.versionId === node.versionId && annotationInRound(annotation))
    const ann = annotations.find((annotation) => annotation.id === selectedAnn)
    const drafts = annotations.filter((annotation) => annotation.status === 'draft')
    const allDrafts = data.annotations.filter((annotation) => annotation.status === 'draft')
    const selectedDraft = ann && ann.status === 'draft' ? ann : null
    const nodeGroup = (data.groups ?? []).find((group) => group.nodeIds.includes(node.versionId))
    inspectorBody.innerHTML = `
      ${selectedAnnotations.size > 1 ? `<div class="multi-bar"><span>已选 ${selectedAnnotations.size} 条批注</span><span><button type="button" class="link-btn" data-action="delete-selected-annotations" data-danger="true">删除选中</button> · <button type="button" class="link-btn" data-action="clear-annotation-selection">清空</button></span></div>` : ''}
      ${multiSelected.size > 1 ? `<div class="multi-bar"><span>已选 ${multiSelected.size} 张卡片</span><button type="button" class="link-btn" data-action="group-selection">组合选中</button></div>` : ''}
      ${nodeGroup ? `<div class="group-chip">组合：${escape(nodeGroup.name)} <button type="button" class="link-btn" data-action="ungroup" data-group-id="${escape(nodeGroup.id)}">取消组合</button></div>` : ''}
      <label class="round-toggle"><input type="checkbox" id="show-all-rounds" ${showAllRounds ? 'checked' : ''}> 显示历史轮次 <span>默认只看当前轮</span></label>
      <div class="tool-section">
        <div class="tool-label">标注工具</div>
        <div class="tool-grid">
          ${toolButton('component', '⌖', '选组件')}
          ${toolButton('rect', '▭', '框选')}
          ${toolButton('ellipse', '◯', '圈选')}
          ${toolButton('arrow', '↗', '箭头')}
          ${toolButton('pen', '✎', '画笔')}
          ${toolButton('pin', '●', '标记')}
          ${toolButton('note', '✚', '只加批注')}
          ${toolButton('preview', '↗', '互动预览')}
        </div>
        <div class="swatches">
          ${['#ff4d4f', '#246bfd', '#f59e0b', '#15803d'].map((value) => `<button type="button" class="swatch" data-color="${value}" data-active="${String(color === value)}" style="background:${value}" aria-label="${value}"></button>`).join('')}
        </div>
      </div>
      <div class="selected-page">
        <strong>${escape(node.title)} · ${escape(node.variant)} v${node.version}</strong>
        <span>${node.viewport ? `${node.viewport.width}×${node.viewport.height}` : '未知视口'} · ${statusLabel(node.status)}${node.hasHtml ? ' · 可选取组件' : node.sourceUrl ? ' · 跨域实时页' : ''}</span>
        ${node.hasHtml || node.sourceUrl ? `<button type="button" class="btn" data-action="preview" data-version-id="${escape(node.versionId)}">进入页面互动</button>` : ''}
      </div>
      ${ann ? `
        <div class="field-label">${ann.status === 'draft' ? '当前批注' : '反馈内容'} · ${escape(kindLabel(ann.kind))}</div>
        ${ann.element ? `<div class="note">组件：${escape(ann.element.label || ann.element.selector || ann.element.tag || '')}<br><span style="font-family:monospace">${escape(ann.element.selector || '')}</span></div>` : ''}
        ${ann.status === 'draft'
          ? `<textarea class="field" id="ann-text" placeholder="写下问题或希望怎么改…">${escape(ann.text)}</textarea>
             <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px">
               <span style="color:var(--muted);font-size:10px">自动保存</span>
               <button type="button" class="link-btn" style="color:var(--danger)" data-action="delete-ann" data-ann-id="${escape(ann.id)}">删除批注</button>
             </div>`
          : `<div class="annotation"><div class="annotation-text">${escape(ann.text || '（没有文字）')}</div>${(ann.replies || []).map((reply) => `<div class="reply">${escape(reply.text)}</div>`).join('')}${ann.status === 'needs-info' ? `<div style="text-align:right"><button type="button" class="link-btn" style="color:var(--danger)" data-action="delete-ann" data-ann-id="${escape(ann.id)}">删除批注</button></div>` : ''}</div>`}
      ` : `<div class="field-label">草稿批注</div><div class="empty">选择工具在页面上圈画，或点「只加批注」。</div>`}
      ${allDrafts.length > 0 ? `<div class="subhead-row"><div class="field-label">本轮草稿 · ${allDrafts.length}</div><button type="button" class="link-btn" data-action="refresh">刷新</button></div>
        <div>${allDrafts.map((annotation) => `<div class="draft" data-draft-id="${escape(annotation.id)}" data-selected="${String(annotation.id === selectedAnn)}" data-checked="${String(selectedAnnotations.has(annotation.id))}" style="--ann-color:${escape(annotation.color)}"><input type="checkbox" class="annotation-check" data-check-ann="${escape(annotation.id)}" ${selectedAnnotations.has(annotation.id) ? 'checked' : ''} aria-label="选择批注"><i class="draft-dot"></i><div class="draft-text"><strong>${escape(kindLabel(annotation.kind))}${annotation.element ? ` · ${escape(annotation.element.label || '组件')}` : ''}</strong><span>${escape(annotation.text || '（尚未填写文字）')}</span></div><button type="button" class="draft-delete" data-delete-ann="${escape(annotation.id)}" title="删除这条草稿" aria-label="删除这条草稿">×</button></div>`).join('')}</div>` : ''}
      <div class="field-label">本轮补充说明（可选）</div>
      <textarea class="field" id="summary-text" placeholder="例如：优先处理布局拥挤和按钮层级。">${escape(summary)}</textarea>
      <div class="submit-bar">
        <div class="submit-hint">${allDrafts.length} 条草稿 · 提交后会唤醒绑定对话</div>
        <button type="button" class="btn btn-primary" data-action="submit" ${submitting ? 'disabled' : ''}>${submitting ? '提交中…' : '提交本轮反馈'}</button>
      </div>
      <div class="subhead">反馈批次</div>
      ${batchMarkup(6)}
      <div class="subhead">页面批注</div>
      ${annotations.length === 0 ? `<div class="empty">这个页面还没有批注。</div>` : annotations.map((annotation) => `<div class="draft" data-annotation-id="${escape(annotation.id)}" data-checked="${String(selectedAnnotations.has(annotation.id))}" style="--ann-color:${escape(annotation.color)}"><input type="checkbox" class="annotation-check" data-check-ann="${escape(annotation.id)}" ${selectedAnnotations.has(annotation.id) ? 'checked' : ''} aria-label="选择批注"><i class="draft-dot"></i><div class="draft-text"><strong>${escape(kindLabel(annotation.kind))} · ${escape(statusLabel(annotation.status))}</strong><span>${escape(annotation.text || '（没有文字）')}</span></div>${annotation.status === 'draft' || annotation.status === 'needs-info' ? `<button type="button" class="draft-delete" data-delete-ann="${escape(annotation.id)}" title="删除这条批注" aria-label="删除这条批注">×</button>` : ''}</div>`).join('')}
    `
    if (!drafts.length) {
      // no-op: keeps the composer present for comments-only rounds
    }
  }

  function updatePreviewToolButtons() {
    document.querySelectorAll('[data-ptool]').forEach((button) => {
      const active = button.dataset.ptool === tool || (button.id === 'pick-component' && pickerArmed)
      button.dataset.active = String(active)
      if (button.id === 'pick-component') button.dataset.on = String(pickerArmed)
    })
  }

  function updateCompareToolButtons() {
    document.querySelectorAll('[data-ctool]').forEach((button) => {
      button.dataset.active = String(button.dataset.ctool === tool)
    })
  }

  function setTool(next) {
    tool = next
    stage.dataset.tool = tool
    preview.dataset.mode = tool
    compare.dataset.mode = tool
    if (preview.dataset.open === 'true') {
      if (tool === 'component') enablePicker(true)
      else if (pickerArmed) enablePicker(false)
    }
    updatePreviewToolButtons()
    updateCompareToolButtons()
    if (compare.dataset.open === 'true') {
      compareFoot.textContent = tool === 'select'
        ? '当前工具：浏览。点批注图形可选中；切到批注工具后可在一列上圈画。'
        : `当前工具：${kindLabel(tool)}。在任意一列上拖动，批注会落到该列对应的版本。`
    }
    renderInspector()
  }

  function renderAll({ fit = false } = {}) {
    for (const id of [...selectedAnnotations]) {
      if (!data.annotations.some((annotation) => annotation.id === id)) selectedAnnotations.delete(id)
    }
    if (selectedAnn && !selectedAnnotations.has(selectedAnn)) selectedAnn = [...selectedAnnotations].at(-1) ?? null
    if (!data.nodes.some((node) => node.versionId === selected)) {
      selected = data.nodes[0]?.versionId ?? null
      selectedAnn = null
    }
    if (selectedAnn && !data.annotations.some((annotation) => annotation.id === selectedAnn)) selectedAnn = null
    title.textContent = data.title
    subtitle.textContent = `第 ${data.round} 轮 · rev ${data.revision} · ${data.counts.versions} 个固定版本 · 可批注`
    renderWorld()
    renderOutline()
    renderInspector()
    if (fit) fitCanvas()
  }

  function syncSelectionClasses() {
    document.querySelectorAll('.card').forEach((card) => {
      card.dataset.selected = String(card.dataset.versionId === selected)
      card.dataset.multi = String(multiSelected.has(card.dataset.versionId))
    })
    document.querySelectorAll('.outline-item').forEach((item) => {
      item.dataset.selected = String(item.dataset.outlineId === selected)
    })
  }

  function selectNode(versionId, preserveMulti = false) {
    selected = versionId
    selectedAnn = null
    selectedAnnotations.clear()
    hideAnnotationPopover()
    if (!preserveMulti) multiSelected.clear()
    syncSelectionClasses()
    renderInspector()
    inspector.dataset.open = 'true'
  }

  function toggleMulti(versionId) {
    if (multiSelected.has(versionId)) multiSelected.delete(versionId)
    else multiSelected.add(versionId)
    selected = versionId
    selectedAnn = null
    selectedAnnotations.clear()
    hideAnnotationPopover()
    syncSelectionClasses()
    renderInspector()
    inspector.dataset.open = 'true'
  }

  function selectAnnotation(annotationId, additive = false) {
    const annotation = data.annotations.find((entry) => entry.id === annotationId)
    if (!annotation) return
    if (additive) {
      if (selectedAnnotations.has(annotationId)) selectedAnnotations.delete(annotationId)
      else selectedAnnotations.add(annotationId)
      if (selectedAnnotations.size === 0) {
        selectedAnn = null
        hideAnnotationPopover()
      } else {
        selectedAnn = selectedAnnotations.has(annotationId)
          ? annotationId
          : [...selectedAnnotations].at(-1)
      }
    } else {
      selectedAnnotations.clear()
      selectedAnnotations.add(annotationId)
      selectedAnn = annotationId
    }
    selected = annotation.versionId
    multiSelected.clear()
    inspector.dataset.open = 'true'
    renderWorld()
    renderOutline()
    renderPreviewOverlay()
    if (compare.dataset.open === 'true') renderCompare()
    renderInspector()
    if (selectedAnn) showAnnotationPopover(selectedAnn)
  }

  function hideAnnotationPopover() {
    annotationPopover.dataset.open = 'false'
  }

  function syncTextEditors(annotationId, text) {
    const panel = document.getElementById('ann-text')
    if (panel && selectedAnn === annotationId) panel.value = text
    if (selectedAnn === annotationId) annotationPopoverText.value = text
  }

  function showAnnotationPopover(annotationId) {
    const annotation = data.annotations.find((entry) => entry.id === annotationId)
    if (!annotation) {
      hideAnnotationPopover()
      return
    }
    annotationPopoverTitle.textContent = selectedAnnotations.size > 1
      ? `已选 ${selectedAnnotations.size} 条批注 · ${kindLabel(annotation.kind)}`
      : `${kindLabel(annotation.kind)}批注`
    annotationPopoverText.value = annotation.text || ''
    annotationPopoverText.disabled = annotation.status !== 'draft'
    annotationPopoverText.placeholder = annotation.status === 'draft' ? '写一条批注…' : '已提交的批注不可修改'
    annotationPopoverStatus.textContent = `${statusLabel(annotation.status)} · ${annotation.status === 'draft' ? '自动保存' : '只读'}`
    annotationPopoverDelete.style.display = annotation.status === 'draft' || annotation.status === 'needs-info' ? '' : 'none'
    annotationPopover.dataset.open = 'true'
    const shape = document.querySelector(`.ann-shape[data-annotation-id="${CSS.escape(annotationId)}"]`)
    let rect = shape?.getBoundingClientRect()
    if (!rect || (rect.width < 2 && rect.height < 2)) {
      const card = document.querySelector(`.card[data-version-id="${CSS.escape(annotation.versionId)}"]`)
      rect = card?.getBoundingClientRect()
    }
    if (!rect) return
    const popoverRect = annotationPopover.getBoundingClientRect()
    let left = rect.right + 12
    let top = rect.top
    if (left + popoverRect.width > window.innerWidth - 10) left = Math.max(10, rect.left - popoverRect.width - 12)
    if (top + popoverRect.height > window.innerHeight - 10) top = Math.max(10, window.innerHeight - popoverRect.height - 10)
    annotationPopover.style.left = `${Math.max(10, left)}px`
    annotationPopover.style.top = `${Math.max(10, top)}px`
  }

  function fitCanvas() {
    if (!data.nodes.length) return
    const bounds = {
      x: Math.min(...data.nodes.map((node) => node.x)),
      y: Math.min(...data.nodes.map((node) => node.y)),
      right: Math.max(...data.nodes.map((node) => node.x + node.w)),
      bottom: Math.max(...data.nodes.map((node) => node.y + node.h)),
    }
    const rect = stage.getBoundingClientRect()
    const inspectorWidth = inspector.dataset.open === 'true' ? inspector.getBoundingClientRect().width : 0
    const usableWidth = Math.max(240, rect.width - inspectorWidth)
    const width = Math.max(100, bounds.right - bounds.x)
    const height = Math.max(100, bounds.bottom - bounds.y)
    zoom = Math.max(0.16, Math.min(1, (usableWidth - 70) / width, (rect.height - 80) / height))
    pan = {
      x: (usableWidth - width * zoom) / 2 - bounds.x * zoom,
      y: (rect.height - height * zoom) / 2 - bounds.y * zoom,
    }
    applyTransform()
  }

  function zoomBy(factor, clientX, clientY) {
    const rect = stage.getBoundingClientRect()
    const mx = (clientX ?? rect.left + rect.width / 2) - rect.left
    const my = (clientY ?? rect.top + rect.height / 2) - rect.top
    const next = Math.max(0.16, Math.min(2.5, zoom * factor))
    const wx = (mx - pan.x) / zoom
    const wy = (my - pan.y) / zoom
    pan = { x: mx - wx * next, y: my - wy * next }
    zoom = next
    applyTransform()
  }

  function pointIn(element, event) {
    const rect = element.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    }
  }

  function draftGeometry(start, point, kind, points) {
    if (kind === 'pen') {
      const all = points ?? [start, point]
      const xs = all.map((entry) => entry.x)
      const ys = all.map((entry) => entry.y)
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
        points: all.map((entry) => [entry.x, entry.y]),
      }
    }
    if (kind === 'arrow') {
      return { x: start.x, y: start.y, w: point.x - start.x, h: point.y - start.y }
    }
    return {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    }
  }

  function previewDraft(layer) {
    if (!drawing) return
    layer.innerHTML = `<defs><marker id="fr-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
      ${annotationSvg({ id: 'draft', kind: drawing.kind, geometry: drawing.geometry, color: drawing.color })}`
  }

  async function createAnnotation(kind, geometry, element, versionIdOverride) {
    const targetVersionId = versionIdOverride || selected
    if (!targetVersionId) {
      showToast('先选择一个页面版本', 'error')
      return
    }
    selected = targetVersionId
    try {
      const withElement = element ? { element } : {}
      const result = await api('/api/annotation', {
        method: 'POST',
        body: {
          reviewId: data.reviewId,
          annotation: {
            versionId: targetVersionId,
            kind,
            geometry,
            text: '',
            color,
            ...withElement,
          },
        },
      })
      data = result.review
      const created = result.annotation
      selectedAnn = created?.id ?? null
      selectedAnnotations.clear()
      if (selectedAnn) selectedAnnotations.add(selectedAnn)
      renderAll()
      if (preview.dataset.open === 'true') renderPreviewOverlay()
      if (compare.dataset.open === 'true') renderCompare()
      inspector.dataset.open = 'true'
      if (selectedAnn) showAnnotationPopover(selectedAnn)
      showToast(kind === 'note' ? '已加一条批注，请在右侧写内容' : '已记录批注，请在右侧写内容')
      setTimeout(() => document.getElementById('ann-text')?.focus(), 30)
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function deleteAnnotation(annotationId) {
    try {
      const result = await api('/api/annotation', {
        method: 'DELETE',
        body: { reviewId: data.reviewId, annotationId },
      })
      data = result.review
      selectedAnnotations.delete(annotationId)
      selectedAnn = [...selectedAnnotations].at(-1) ?? null
      hideAnnotationPopover()
      renderAll()
      if (compare.dataset.open === 'true') renderCompare()
      showToast('已删除草稿')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function groupSelection() {
    const ids = multiSelected.size >= 2 ? [...multiSelected] : [selected]
    if (ids.length < 2) {
      showToast('按住 Shift 点击多张卡片，再点「组合选中」', 'error')
      return
    }
    try {
      const result = await api('/api/groups', {
        method: 'POST',
        body: { reviewId: data.reviewId, action: 'create', nodeIds: ids },
      })
      data = result.review
      multiSelected.clear()
      renderAll()
      showToast('已组合选中的卡片，可以一起拖动')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function ungroup(groupId) {
    try {
      const result = await api('/api/groups', {
        method: 'POST',
        body: { reviewId: data.reviewId, action: 'ungroup', groupId },
      })
      data = result.review
      renderAll()
      showToast('已取消组合')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function renameCard(node) {
    const title = window.prompt('页面名称', node.title)
    if (title === null) return
    const variantName = window.prompt('方案名称', node.variant)
    if (variantName === null) return
    try {
      const result = await api('/api/card', {
        method: 'POST',
        body: { reviewId: data.reviewId, versionId: node.versionId, title, variantName },
      })
      data = result.review
      renderAll()
      showToast('已更新页面名称')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function toggleLock(node) {
    try {
      const result = await api('/api/layout', {
        method: 'POST',
        body: { reviewId: data.reviewId, versionId: node.versionId, x: node.x, y: node.y, locked: !node.locked },
      })
      data = result.review
      renderAll()
      showToast(node.locked ? '已解锁位置' : '已锁定位置')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function deleteSelectedAnnotations() {
    const ids = [...selectedAnnotations].filter((id) => {
      const annotation = data.annotations.find((entry) => entry.id === id)
      return annotation?.status === 'draft' || annotation?.status === 'needs-info'
    })
    if (ids.length === 0) {
      showToast('选中的批注都已提交，不能删除', 'error')
      return
    }
    try {
      let latest
      for (const annotationId of ids) {
        latest = await api('/api/annotation', {
          method: 'DELETE',
          body: { reviewId: data.reviewId, annotationId },
        })
      }
      if (latest) data = latest.review
      selectedAnnotations.clear()
      selectedAnn = null
      hideAnnotationPopover()
      renderAll()
      if (compare.dataset.open === 'true') renderCompare()
      showToast(`已删除 ${ids.length} 条草稿`)
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function saveText(annotationId, text) {
    try {
      const result = await api('/api/annotation', {
        method: 'POST',
        body: { reviewId: data.reviewId, annotation: { id: annotationId, text } },
      })
      data = result.review
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  function startDraw(event, layer) {
    if (tool === 'select' || tool === 'component' || tool === 'preview') return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const shot = layer.closest('.shot')
    const versionId = layer.dataset.drawVersion
    if (!shot || !versionId) return
    selected = versionId
    const point = pointIn(shot, event)
    if (tool === 'note') {
      createAnnotation('note', { x: 0.5, y: 0.5, w: 0, h: 0 })
      return
    }
    if (tool === 'pin') {
      createAnnotation('pin', { x: point.x, y: point.y, w: 0, h: 0 })
      return
    }
    layer.setPointerCapture?.(event.pointerId)
    drawing = {
      kind: tool,
      start: point,
      points: [point],
      geometry: { x: point.x, y: point.y, w: 0, h: 0 },
      color,
      layer,
    }
    previewDraft(layer)
  }

  function moveDraw(event, layer) {
    if (!drawing || drawing.layer !== layer) return
    const shot = layer.closest('.shot')
    if (!shot) return
    const point = pointIn(shot, event)
    if (drawing.kind === 'pen') {
      drawing.points.push(point)
      drawing.geometry = draftGeometry(drawing.start, point, 'pen', drawing.points)
    } else {
      drawing.geometry = draftGeometry(drawing.start, point, drawing.kind)
    }
    previewDraft(layer)
  }

  function endDraw(event, layer) {
    if (!drawing || drawing.layer !== layer) return
    const current = drawing
    drawing = null
    layer.innerHTML = ''
    const g = current.geometry
    if (current.kind !== 'pen' && Math.abs(g.w) < 0.008 && Math.abs(g.h) < 0.008) return
    createAnnotation(current.kind, g)
  }

  let previewDrawing = null

  function previewPoint(event) {
    return pointIn(previewWrap, event)
  }

  function previewDraftGeometry(start, point, kind, points) {
    return draftGeometry(start, point, kind, points)
  }

  function previewDrawPreview() {
    if (!previewDrawing) return
    previewDraw.innerHTML = annotationContent([{
      id: 'draft',
      kind: previewDrawing.kind,
      geometry: previewDrawing.geometry,
      color: previewDrawing.color,
    }])
  }

  previewDraw.addEventListener('pointerdown', (event) => {
    if (!previewNode || event.button !== 0) return
    if (!['rect', 'ellipse', 'arrow', 'pen', 'pin', 'note'].includes(tool)) return
    event.preventDefault()
    event.stopPropagation()
    const point = previewPoint(event)
    selected = previewNode.versionId
    if (tool === 'note') {
      createAnnotation('note', { x: point.x, y: point.y, w: 0, h: 0 })
      setTool('select')
      return
    }
    if (tool === 'pin') {
      createAnnotation('pin', { x: point.x, y: point.y, w: 0, h: 0 })
      return
    }
    previewDraw.setPointerCapture?.(event.pointerId)
    previewDrawing = {
      kind: tool,
      start: point,
      points: [point],
      geometry: { x: point.x, y: point.y, w: 0, h: 0 },
      color,
    }
    previewDrawPreview()
  })

  previewDraw.addEventListener('pointermove', (event) => {
    if (!previewDrawing) return
    const point = previewPoint(event)
    if (previewDrawing.kind === 'pen') {
      previewDrawing.points.push(point)
      previewDrawing.geometry = previewDraftGeometry(previewDrawing.start, point, 'pen', previewDrawing.points)
    } else {
      previewDrawing.geometry = previewDraftGeometry(previewDrawing.start, point, previewDrawing.kind)
    }
    previewDrawPreview()
  })

  previewDraw.addEventListener('pointerup', () => {
    if (!previewDrawing) return
    const current = previewDrawing
    previewDrawing = null
    previewDraw.innerHTML = ''
    const g = current.geometry
    if (current.kind !== 'pen' && Math.abs(g.w) < 0.008 && Math.abs(g.h) < 0.008) return
    createAnnotation(current.kind, g)
  })
  previewDraw.addEventListener('pointercancel', () => {
    previewDrawing = null
    previewDraw.innerHTML = ''
  })

  function startCardDrag(event, card, handle) {
    if (event.button !== 0) return
    const node = data.nodes.find((entry) => entry.versionId === card?.dataset.versionId)
    if (!node) return
    if (node.locked) {
      showToast('这个位置已锁定；右键可解锁', 'info')
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const group = (data.groups ?? []).find((entry) => entry.nodeIds.includes(node.versionId))
    let ids
    if (multiSelected.has(node.versionId) && multiSelected.size > 1) ids = [...multiSelected]
    else if (group) ids = [...group.nodeIds]
    else ids = [node.versionId]
    ids = ids.filter((id) => data.nodes.some((entry) => entry.versionId === id && !entry.locked))
    if (ids.length === 0) return
    selected = node.versionId
    selectedAnn = null
    syncSelectionClasses()
    renderInspector()
    handle.setPointerCapture?.(event.pointerId)
    dragging = {
      ids,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      origins: new Map(ids.map((id) => {
        const current = data.nodes.find((entry) => entry.versionId === id)
        return [id, { x: current.x, y: current.y }]
      })),
      moved: false,
    }
  }

  async function finishCardDrag() {
    if (!dragging) return
    const moved = dragging
    dragging = null
    if (!moved.moved) return
    suppressClick = true
    setTimeout(() => { suppressClick = false }, 400)
    try {
      const placements = moved.ids.map((id) => {
        const node = data.nodes.find((entry) => entry.versionId === id)
        return { versionId: id, x: node.x, y: node.y }
      })
      const result = await api('/api/layout', {
        method: 'POST',
        body: { reviewId: data.reviewId, placements },
      })
      data = result.review
      renderAll()
      showToast('位置已保存')
    } catch (error) {
      showToast(error.message, 'error')
      await refresh()
    }
  }

  // Initial render.
  renderAll()
  inspector.dataset.open = 'true'
  updateCompareToolButtons()
  layoutCompareBounds()
  requestAnimationFrame(() => {
    if (!fitted) {
      fitted = true
      fitCanvas()
    }
  })

  // Canvas pointer interactions.
  stage.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    const annotationShape = event.target.closest('[data-annotation-id]')
    if (annotationShape) {
      event.stopPropagation()
      selectAnnotation(annotationShape.dataset.annotationId, event.shiftKey || event.ctrlKey || event.metaKey)
      return
    }
    const previewButton = event.target.closest('[data-action="preview"]')
    if (previewButton) {
      event.stopPropagation()
      const node = data.nodes.find((entry) => entry.versionId === previewButton.dataset.versionId)
      if (node) openPreview(node, false)
      return
    }
    const groupLabel = event.target.closest('.group-label')
    if (groupLabel) {
      const group = (data.groups ?? []).find((entry) => entry.id === groupLabel.dataset.groupId)
      if (group) {
        multiSelected.clear()
        for (const id of group.nodeIds) multiSelected.add(id)
        selected = group.nodeIds[0] ?? selected
        syncSelectionClasses()
        renderInspector()
        inspector.dataset.open = 'true'
      }
      return
    }
    const card = event.target.closest('.card')
    if (card) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        toggleMulti(card.dataset.versionId)
        return
      }
      const insideBody = event.target.closest('.card-body')
      if (insideBody && tool === 'select') {
        const node = data.nodes.find((entry) => entry.versionId === card.dataset.versionId)
        if (node) {
          openPreview(node, false)
          return
        }
      }
      selectNode(card.dataset.versionId)
    }
  })
  stage.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    const groupLabel = event.target.closest('.group-label')
    if (groupLabel) {
      const group = (data.groups ?? []).find((entry) => entry.id === groupLabel.dataset.groupId)
      if (group) groupMenu(group, event)
      return
    }
    const card = event.target.closest('.card')
    if (card) {
      const node = data.nodes.find((entry) => entry.versionId === card.dataset.versionId)
      if (node) cardMenu(node, event)
      return
    }
    showContextMenu(event, [
      { label: '适配视图', action: fitCanvas },
      { label: '刷新画布', action: refresh },
      { label: showAnnotations ? '隐藏批注' : '显示批注', action: () => annToggle.click() },
      { separator: true },
      { label: '进入互动预览（选中页面）', action: () => {
        const node = data.nodes.find((entry) => entry.versionId === selected)
        if (node?.hasHtml || node?.sourceUrl) openPreview(node, false)
      } },
    ])
  })
  globalThis.addEventListener('click', (event) => {
    if (!event.target.closest('#context-menu')) hideContextMenu()
    if (!event.target.closest('#annotation-popover')
      && !event.target.closest('[data-annotation-id]')
      && !event.target.closest('.draft')
      && !event.target.closest('[data-check-ann]')) {
      hideAnnotationPopover()
    }
  })

  stage.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const card = event.target.closest('.card')
    if (!card) return
    event.preventDefault()
    selectNode(card.dataset.versionId)
  })
  stage.addEventListener('pointerdown', (event) => {
    const layer = event.target.closest('.draw-layer')
    if (layer) {
      startDraw(event, layer)
      return
    }
    const head = event.target.closest('.card-head')
    if (head && !event.target.closest('button') && !event.target.closest('.card-action')) {
      startCardDrag(event, head.closest('.card'), head)
      return
    }
    if (event.button !== 0 || event.target.closest('.card') || event.target.closest('button') || event.target.closest('.outline')) return
    stage.setPointerCapture?.(event.pointerId)
    panning = { startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y }
  })
  stage.addEventListener('pointermove', (event) => {
    if (dragging) {
      const dx = (event.clientX - dragging.startX) / zoom
      const dy = (event.clientY - dragging.startY) / zoom
      if (!dragging.moved && Math.abs(event.clientX - dragging.startX) + Math.abs(event.clientY - dragging.startY) > 3) {
        dragging.moved = true
        for (const id of dragging.ids) multiSelected.add(id)
        syncSelectionClasses()
        renderInspector()
      }
      for (const id of dragging.ids) {
        const node = data.nodes.find((entry) => entry.versionId === id)
        const origin = dragging.origins.get(id)
        if (!node || !origin) continue
        node.x = origin.x + dx
        node.y = origin.y + dy
        const card = document.querySelector(`.card[data-version-id="${CSS.escape(id)}"]`)
        if (card) {
          card.style.left = `${node.x}px`
          card.style.top = `${node.y}px`
        }
      }
      return
    }
    const layer = event.target.closest('.draw-layer')
    if (layer) moveDraw(event, layer)
    if (!panning) return
    pan = {
      x: panning.originX + event.clientX - panning.startX,
      y: panning.originY + event.clientY - panning.startY,
    }
    applyTransform()
  })
  stage.addEventListener('pointerup', (event) => {
    const layer = event.target.closest('.draw-layer')
    if (layer) endDraw(event, layer)
    if (dragging) finishCardDrag()
    panning = null
  })
  stage.addEventListener('pointercancel', () => {
    drawing = null
    dragging = null
    panning = null
  })
  stage.addEventListener('wheel', (event) => {
    event.preventDefault()
    zoomBy(event.deltaY > 0 ? 0.9 : 1.1, event.clientX, event.clientY)
  }, { passive: false })

  outline.addEventListener('click', (event) => {
    const item = event.target.closest('.outline-item')
    if (!item) return
    selectNode(item.dataset.outlineId)
    const node = data.nodes.find((entry) => entry.versionId === item.dataset.outlineId)
    if (!node) return
    const rect = stage.getBoundingClientRect()
    pan = {
      x: rect.width / 2 - (node.x + node.w / 2) * zoom,
      y: rect.height / 2 - (node.y + node.h / 2) * zoom,
    }
    applyTransform()
  })

  inspectorBody.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-delete-ann]')
    if (deleteButton) {
      event.stopPropagation()
      await deleteAnnotation(deleteButton.dataset.deleteAnn)
      return
    }
    if (event.target.closest('.annotation-check')) {
      event.stopPropagation()
      return
    }
    const toolButton = event.target.closest('[data-tool]')
    if (toolButton) {
      const next = toolButton.dataset.tool
      if (next === 'preview') {
        const node = data.nodes.find((entry) => entry.versionId === selected)
        if (node && (node.hasHtml || node.sourceUrl)) openPreview(node, false)
        else showToast('这张页面没有可互动的内容', 'error')
        return
      }
      if (next === 'component') {
        const node = data.nodes.find((entry) => entry.versionId === selected)
        if (!node?.hasHtml) {
          showToast(node?.sourceUrl ? '跨域实时页不能直接选组件，请用框选' : '这张页面没有可选取组件的 HTML 快照', 'error')
          return
        }
        if (preview.dataset.open === 'true' && previewNode?.versionId === node.versionId) setTool('component')
        else openPreview(node, true)
        return
      }
      if (next === 'note') {
        if (preview.dataset.open === 'true') {
          setTool('note')
          showToast('点击预览页面任意位置，放置一条文字批注', 'info')
        } else {
          createAnnotation('note', { x: 0.5, y: 0.5, w: 0, h: 0 })
        }
        return
      }
      setTool(next)
      showToast(next === 'select' ? '已回到浏览模式' : `已选择「${toolButton.textContent.trim()}」，在页面上拖拽`, 'info')
      return
    }
    const colorButton = event.target.closest('[data-color]')
    if (colorButton) {
      color = colorButton.dataset.color
      renderInspector()
      return
    }
    const draft = event.target.closest('[data-draft-id]')
    if (draft) {
      selectAnnotation(draft.dataset.draftId, event.shiftKey || event.ctrlKey || event.metaKey)
      return
    }
    const annotation = event.target.closest('[data-annotation-id]')
    if (annotation) {
      selectAnnotation(annotation.dataset.annotationId, event.shiftKey || event.ctrlKey || event.metaKey)
      return
    }
    if (event.target.closest('[data-action="group-selection"]')) {
      await groupSelection()
      return
    }
    if (event.target.closest('[data-action="ungroup"]')) {
      await ungroup(event.target.closest('[data-action="ungroup"]').dataset.groupId)
      return
    }
    const previewButton = event.target.closest('[data-action="preview"]')
    if (previewButton) {
      const node = data.nodes.find((entry) => entry.versionId === previewButton.dataset.versionId)
      if (node) openPreview(node, false)
      return
    }
    if (event.target.closest('[data-action="delete-selected-annotations"]')) {
      await deleteSelectedAnnotations()
      return
    }
    if (event.target.closest('[data-action="clear-annotation-selection"]')) {
      selectedAnnotations.clear()
      selectedAnn = null
      hideAnnotationPopover()
      renderWorld()
      renderPreviewOverlay()
      if (compare.dataset.open === 'true') renderCompare()
      renderInspector()
      return
    }
    if (event.target.closest('[data-action="delete-ann"]')) {
      const id = event.target.closest('[data-action="delete-ann"]').dataset.annId
      await deleteAnnotation(id)
      return
    }
    if (event.target.closest('[data-action="refresh"]')) {
      await refresh()
      return
    }
    if (event.target.closest('[data-action="submit"]')) {
      await submitFeedback()
    }
  })

  inspectorBody.addEventListener('change', (event) => {
    if (event.target.id === 'show-all-rounds') {
      showAllRounds = event.target.checked
      for (const id of [...selectedAnnotations]) {
        const annotation = data.annotations.find((entry) => entry.id === id)
        if (annotation && !annotationInRound(annotation)) selectedAnnotations.delete(id)
      }
      if (selectedAnn && !selectedAnnotations.has(selectedAnn)) {
        selectedAnn = [...selectedAnnotations].at(-1) ?? null
        hideAnnotationPopover()
      }
      renderWorld()
      renderPreviewOverlay()
      if (compare.dataset.open === 'true') renderCompare()
      renderInspector()
      return
    }
    const checkbox = event.target.closest('[data-check-ann]')
    if (!checkbox) return
    event.stopPropagation()
    const id = checkbox.dataset.checkAnn
    const annotation = data.annotations.find((entry) => entry.id === id)
    if (!annotation) return
    if (checkbox.checked) {
      selectedAnnotations.add(id)
      selectedAnn = id
      selected = annotation.versionId
      hideAnnotationPopover()
      renderWorld()
      renderPreviewOverlay()
      renderInspector()
      showAnnotationPopover(id)
    } else {
      selectAnnotation(id, true)
    }
  })

  inspectorBody.addEventListener('input', (event) => {
    if (event.target.id === 'summary-text') {
      summary = event.target.value
      return
    }
    if (event.target.id === 'ann-text' && selectedAnn) {
      const ann = data.annotations.find((entry) => entry.id === selectedAnn)
      if (!ann) return
      ann.text = event.target.value
      if (annotationPopover.dataset.open === 'true') annotationPopoverText.value = event.target.value
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveText(selectedAnn, event.target.value), 500)
    }
  })

  annotationPopoverText.addEventListener('input', () => {
    if (!selectedAnn) return
    const ann = data.annotations.find((entry) => entry.id === selectedAnn)
    if (!ann || ann.status !== 'draft') return
    ann.text = annotationPopoverText.value
    const panel = document.getElementById('ann-text')
    if (panel) panel.value = annotationPopoverText.value
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveText(selectedAnn, annotationPopoverText.value), 500)
  })
  document.getElementById('close-annotation-popover').addEventListener('click', hideAnnotationPopover)
  annotationPopoverDelete.addEventListener('click', () => {
    if (!selectedAnn) return
    const ann = data.annotations.find((entry) => entry.id === selectedAnn)
    if (ann?.status === 'draft' || ann?.status === 'needs-info') deleteAnnotation(selectedAnn)
  })

  // Header controls.
  document.getElementById('fit').addEventListener('click', fitCanvas)
  document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.14))
  document.getElementById('zoom-out').addEventListener('click', () => zoomBy(0.88))
  document.getElementById('close-inspector').addEventListener('click', () => {
    inspector.dataset.open = 'false'
    document.getElementById('toggle-inspector').dataset.on = 'false'
    layoutPreviewBounds()
    layoutCompareBounds()
    if (preview.dataset.open === 'true') layoutPreview()
    if (compare.dataset.open === 'true') renderCompare()
  })
  document.getElementById('toggle-inspector').addEventListener('click', () => {
    const open = inspector.dataset.open !== 'true'
    inspector.dataset.open = String(open)
    document.getElementById('toggle-inspector').dataset.on = String(open)
    layoutPreviewBounds()
    layoutCompareBounds()
    if (preview.dataset.open === 'true') layoutPreview()
    if (compare.dataset.open === 'true') renderCompare()
  })
  annToggle.addEventListener('click', () => {
    showAnnotations = !showAnnotations
    annToggle.dataset.on = String(showAnnotations)
    annToggle.textContent = showAnnotations ? '全部批注 显示' : '全部批注 隐藏'
    if (!showAnnotations) hideAnnotationPopover()
    renderWorld()
    renderPreviewOverlay()
    if (compare.dataset.open === 'true') renderCompare()
    showToast(showAnnotations ? '已显示全部批注' : '已隐藏全部批注')
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (comparePicker.dataset.open === 'true') closeComparePicker()
      else if (compare.dataset.open === 'true') exitCompare()
      else if (preview.dataset.open === 'true') closePreview()
      else inspector.dataset.open = 'false'
    }
  })
  window.addEventListener('resize', () => {
    applyTransform()
    layoutPreviewBounds()
    layoutCompareBounds()
    if (preview.dataset.open === 'true') layoutPreview()
    if (compare.dataset.open === 'true') renderCompare()
  })

  // Preview overlay: browse the real page, or draw directly on top of it.
  function openPreview(node, picker) {
    if (compare.dataset.open === 'true') exitCompare()
    previewNode = node
    selected = node.versionId
    selectedAnn = null
    selectedAnnotations.clear()
    hideAnnotationPopover()
    pickerArmed = !!picker
    tool = picker ? 'component' : 'select'
    preview.dataset.mode = tool
    previewNode = node
    previewTitle.textContent = `${node.title} · ${node.variant} v${node.version}`
    previewSub.textContent = node.hasHtml ? '保存的 HTML 快照 · 浏览模式可操作页面，批注工具可直接圈画' : '实时页面 · 跨域页面可浏览；批注直接画在预览上'
    previewFoot.textContent = node.hasHtml
      ? '浏览模式可直接点击页面；选择批注工具后，在预览上拖动即可。'
      : '跨域实时页面不能选组件；可用框选/圈选直接在预览上批注。'
    preview.dataset.open = 'true'
    preview.setAttribute('aria-hidden', 'false')
    frameReady = false
    previewFrame.src = node.hasHtml ? htmlUrl(node.versionId) : (node.sourceUrl || 'about:blank')
    layoutPreviewBounds()
    layoutPreview()
    renderPreviewOverlay()
    renderInspector()
    updatePreviewToolButtons()
    if (picker) setTimeout(() => setTool('component'), 80)
  }

  function closePreview() {
    preview.dataset.open = 'false'
    preview.setAttribute('aria-hidden', 'true')
    pickerArmed = false
    pickButton.dataset.on = 'false'
    pickButton.textContent = '选择组件'
    previewFrame.src = 'about:blank'
    previewNode = null
    frameReady = false
    tool = 'select'
    stage.dataset.tool = tool
    preview.dataset.mode = tool
    previewDraw.innerHTML = ''
    renderInspector()
    updatePreviewToolButtons()
  }

  function layoutPreviewBounds() {
    if (!preview) return
    const top = Math.round(bar?.getBoundingClientRect().height || 52)
    const right = inspector.dataset.open === 'true' ? Math.round(inspector.getBoundingClientRect().width || 0) : 0
    preview.style.top = `${top}px`
    preview.style.right = `${right}px`
  }

  function layoutPreview() {
    if (!previewNode) return
    const stageRect = document.getElementById('preview-stage').getBoundingClientRect()
    const viewport = previewNode.viewport || { width: 1440, height: 900 }
    const maxW = Math.max(200, stageRect.width - 28)
    const maxH = Math.max(200, stageRect.height - 28)
    const scale = Math.max(0.2, Math.min(maxW / viewport.width, maxH / viewport.height, 1.25))
    previewWrap.style.width = `${viewport.width * scale}px`
    previewWrap.style.height = `${viewport.height * scale}px`
    previewFrame.style.width = `${viewport.width}px`
    previewFrame.style.height = `${viewport.height}px`
    previewFrame.style.transform = `scale(${scale})`
    renderPreviewOverlay()
  }

  function renderPreviewOverlay() {
    if (!previewNode) {
      previewAnn.innerHTML = ''
      return
    }
    const annotations = data.annotations.filter((annotation) => annotation.versionId === previewNode.versionId && annotationInRound(annotation))
    previewAnn.innerHTML = annotationContent(annotations)
    previewAnn.style.display = showAnnotations ? 'block' : 'none'
  }

  previewAnn.addEventListener('click', (event) => {
    const shape = event.target.closest('[data-annotation-id]')
    if (!shape) return
    event.stopPropagation()
    selectAnnotation(shape.dataset.annotationId, event.shiftKey || event.ctrlKey || event.metaKey)
  })

  previewFrame.addEventListener('load', () => {
    frameReady = true
    if (pickerArmed) enablePicker(true)
  })

  function enablePicker(enabled) {
    if (enabled && !previewNode?.hasHtml) {
      showToast('跨域实时页不能直接选组件；请用框选/圈选', 'error')
      if (tool === 'component') setTool('select')
      return
    }
    if (enabled && !frameReady) {
      showToast('页面还在加载，稍后再试', 'info')
      if (tool === 'component') setTool('select')
      return
    }
    pickerArmed = enabled
    try {
      previewFrame.contentWindow?.postMessage({ type: 'fr-picker', enabled }, '*')
    } catch {
      // cross-origin live pages ignore this
    }
    pickButton.dataset.on = String(enabled)
    pickButton.textContent = enabled ? '选择组件中…' : '选择组件'
    updatePreviewToolButtons()
    if (enabled) previewFoot.textContent = '在页面中移动鼠标查看元素；点击一个元素，在预览里生成组件批注。'
    else previewFoot.textContent = previewNode?.hasHtml
      ? '浏览模式可直接点击页面；选择批注工具后，在预览上拖动即可。'
      : '跨域实时页面不能选组件；可用框选/圈选直接在预览上批注。'
  }

  document.querySelector('.preview-actions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ptool]')
    if (!button) return
    const next = button.dataset.ptool
    if (next === 'component') {
      if (!previewNode?.hasHtml) {
        showToast('跨域实时页不能直接选组件，请用框选/圈选', 'error')
        return
      }
      setTool('component')
      return
    }
    setTool(next)
  })
  document.getElementById('close-preview').addEventListener('click', closePreview)

  window.addEventListener('message', (event) => {
    if (!previewFrame.contentWindow || event.source !== previewFrame.contentWindow) return
    if (!event.data || event.data.type !== 'fr-element-picked') return
    const payload = event.data
    const viewport = payload.viewport || previewNode?.viewport || { width: 1440, height: 900 }
    const geometry = {
      x: Math.max(0, Math.min(1, payload.rect.x / Math.max(1, viewport.width))),
      y: Math.max(0, Math.min(1, payload.rect.y / Math.max(1, viewport.height))),
      w: Math.max(0, Math.min(1, payload.rect.w / Math.max(1, viewport.width))),
      h: Math.max(0, Math.min(1, payload.rect.h / Math.max(1, viewport.height))),
    }
    selected = previewNode?.versionId || selected
    setTool('select')
    createAnnotation('component', geometry, {
      selector: payload.selector,
      label: payload.label,
      tag: payload.tag,
      text: payload.elementText,
      rect: geometry,
    })
  })

  function hideContextMenu() {
    contextMenu.dataset.open = 'false'
    contextMenu.setAttribute('aria-hidden', 'true')
    contextMenu.innerHTML = ''
    contextItems = []
  }

  function showContextMenu(event, items) {
    contextItems = items
    contextMenu.innerHTML = items.map((item, index) => item.separator
      ? '<hr>'
      : `<button type="button" role="menuitem" data-menu-index="${index}" ${item.danger ? 'data-danger="true"' : ''}>${escape(item.label)}</button>`).join('')
    contextMenu.dataset.open = 'true'
    contextMenu.setAttribute('aria-hidden', 'false')
    const rect = contextMenu.getBoundingClientRect()
    contextMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX))}px`
    contextMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY))}px`
  }

  contextMenu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-menu-index]')
    if (!button) return
    const item = contextItems[Number(button.dataset.menuIndex)]
    hideContextMenu()
    item?.action?.()
  })

  function cardMenu(node, event) {
    const group = (data.groups ?? []).find((entry) => entry.nodeIds.includes(node.versionId))
    selectNode(node.versionId, event.shiftKey || event.ctrlKey || event.metaKey)
    const items = [
      { label: '进入页面预览', action: () => openPreview(node, false) },
      ...(node.hasHtml ? [{ label: '进入并选择组件', action: () => openPreview(node, true) }] : []),
      { label: '在这个页面加批注', action: () => { selected = node.versionId; createAnnotation('note', { x: 0.5, y: 0.5, w: 0, h: 0 }) } },
      { separator: true },
      ...(multiSelected.size > 1 ? [{ label: `组合选中的 ${multiSelected.size} 张`, action: groupSelection }] : []),
      ...(group ? [{ label: `取消组合「${group.name}」`, action: () => ungroup(group.id) }] : []),
      { label: node.locked ? '解锁位置' : '锁定位置', action: () => toggleLock(node) },
      { label: '重命名页面/方案', action: () => renameCard(node) },
      { separator: true },
      ...(node.hasSnapshot ? [{ label: '下载截图', action: () => window.open(assetUrl(node.versionId), '_blank', 'noopener') }] : []),
      { label: '刷新画布', action: refresh },
    ]
    showContextMenu(event, items)
  }

  async function renameGroup(group) {
    const name = window.prompt('组合名称', group.name)
    if (name === null) return
    try {
      const result = await api('/api/groups', {
        method: 'POST',
        body: { reviewId: data.reviewId, action: 'rename', groupId: group.id, name },
      })
      data = result.review
      renderAll()
      showToast('已重命名组合')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  function groupMenu(group, event) {
    showContextMenu(event, [
      { label: '选择组合内全部卡片', action: () => {
        multiSelected.clear()
        for (const id of group.nodeIds) multiSelected.add(id)
        selected = group.nodeIds[0] ?? selected
        syncSelectionClasses()
        renderInspector()
      } },
      { label: '重命名组合', action: () => renameGroup(group) },
      { label: '取消组合', action: () => ungroup(group.id) },
    ])
  }

  // Comparison mode: pick 2–4 fixed versions and annotate each column.
  function renderComparePicker() {
    const nodes = data.nodes
    compareOptions.innerHTML = nodes.map((node) => `<label class="compare-option">
      <input type="checkbox" data-compare-id="${escape(node.versionId)}" ${compareSelection.has(node.versionId) ? 'checked' : ''}>
      <span class="compare-thumb" style="background-image:url('${escape(assetUrl(node.versionId))}')"></span>
      <span class="compare-option-text">
        <strong>${escape(node.title)} · ${escape(node.variant)} v${node.version}</strong>
        <span>${node.viewport ? `${node.viewport.width}×${node.viewport.height}` : '固定截图'} · ${statusLabel(node.status)}</span>
      </span>
    </label>`).join('')
    compareCount.textContent = `已选 ${compareSelection.size} 个`
    compareConfirm.disabled = compareSelection.size < 2 || compareSelection.size > 4
  }

  function layoutCompareBounds() {
    const top = Math.round(bar?.getBoundingClientRect().height || 52)
    const right = inspector.dataset.open === 'true' ? Math.round(inspector.getBoundingClientRect().width || 0) : 0
    compare.style.top = `${top}px`
    compare.style.right = `${right}px`
  }

  function openComparePicker() {
    if (preview.dataset.open === 'true') closePreview()
    if (compareIds.length > 0) {
      compareSelection.clear()
      for (const id of compareIds) compareSelection.add(id)
    }
    renderComparePicker()
    comparePicker.dataset.open = 'true'
    comparePicker.setAttribute('aria-hidden', 'false')
    compareButton.dataset.on = 'true'
  }

  function closeComparePicker() {
    comparePicker.dataset.open = 'false'
    comparePicker.setAttribute('aria-hidden', 'true')
    compareButton.dataset.on = String(compare.dataset.open === 'true')
  }

  function renderCompare() {
    const nodes = compareIds
      .map((id) => data.nodes.find((node) => node.versionId === id))
      .filter(Boolean)
    if (nodes.length === 0) {
      compareGrid.innerHTML = ''
      return
    }
    compareGrid.style.setProperty('--cols', String(nodes.length))
    compareGrid.innerHTML = nodes.map((node) => {
      const annotations = data.annotations.filter((annotation) => annotation.versionId === node.versionId && annotationInRound(annotation))
      return `<section class="compare-col" data-version-id="${escape(node.versionId)}">
        <div class="compare-col-head"><strong>${escape(node.title)} · ${escape(node.variant)} v${node.version}</strong><span>${annotations.length} 条批注</span></div>
        <div class="compare-frame">
          <img src="${escape(assetUrl(node.versionId))}" alt="${escape(node.title)} ${escape(node.variant)} v${node.version}">
          <svg class="compare-overlay compare-ann" viewBox="0 0 1000 1000" preserveAspectRatio="none" style="display:${showAnnotations ? 'block' : 'none'}" aria-hidden="true">${annotationContent(annotations)}</svg>
          <svg class="compare-overlay compare-draw" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
      </section>`
    }).join('')
    compareSub.textContent = `${nodes.length} 个版本并排对比 · 可直接圈画批注`
    compare.dataset.mode = tool
    updateCompareToolButtons()
  }

  function enterCompare() {
    if (compareSelection.size < 2 || compareSelection.size > 4) {
      showToast('请选择 2–4 个版本', 'error')
      return
    }
    compareIds = [...compareSelection]
    comparePicker.dataset.open = 'false'
    comparePicker.setAttribute('aria-hidden', 'true')
    closePreview()
    compare.dataset.open = 'true'
    compare.setAttribute('aria-hidden', 'false')
    compareButton.dataset.on = 'true'
    setTool('select')
    layoutCompareBounds()
    renderCompare()
    inspector.dataset.open = 'true'
    showToast('已进入对比，可在任意一列上圈画', 'info')
  }

  function exitCompare() {
    compare.dataset.open = 'false'
    compare.setAttribute('aria-hidden', 'true')
    compareButton.dataset.on = 'false'
    compareGrid.innerHTML = ''
    hideAnnotationPopover()
    setTool('select')
  }

  function comparePoint(layer, event) {
    return pointIn(layer, event)
  }

  compareButton.addEventListener('click', () => {
    if (comparePicker.dataset.open === 'true') {
      closeComparePicker()
      return
    }
    openComparePicker()
  })
  document.getElementById('close-compare-picker').addEventListener('click', closeComparePicker)
  document.getElementById('cancel-compare-picker').addEventListener('click', closeComparePicker)
  compareConfirm.addEventListener('click', enterCompare)
  document.getElementById('exit-compare').addEventListener('click', exitCompare)
  document.getElementById('reselect-compare').addEventListener('click', openComparePicker)
  compareOptions.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-compare-id]')
    if (!checkbox) return
    if (checkbox.checked) {
      if (compareSelection.size >= 4) {
        checkbox.checked = false
        showToast('最多同时对比 4 个版本', 'info')
        return
      }
      compareSelection.add(checkbox.dataset.compareId)
    } else {
      compareSelection.delete(checkbox.dataset.compareId)
    }
    compareCount.textContent = `已选 ${compareSelection.size} 个`
    compareConfirm.disabled = compareSelection.size < 2 || compareSelection.size > 4
  })
  compare.querySelector('.compare-actions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ctool]')
    if (button) setTool(button.dataset.ctool)
  })
  compareGrid.addEventListener('click', (event) => {
    const shape = event.target.closest('[data-annotation-id]')
    if (!shape) return
    event.stopPropagation()
    selectAnnotation(shape.dataset.annotationId, event.shiftKey || event.ctrlKey || event.metaKey)
  })
  compareGrid.addEventListener('pointerdown', (event) => {
    if (!compareIds.length || event.button !== 0) return
    if (!['rect', 'ellipse', 'arrow', 'pen', 'pin', 'note'].includes(tool)) return
    const column = event.target.closest('.compare-col')
    const layer = column?.querySelector('.compare-draw')
    if (!column || !layer) return
    event.preventDefault()
    const point = comparePoint(layer, event)
    const versionId = column.dataset.versionId
    if (tool === 'note') {
      createAnnotation('note', { x: point.x, y: point.y, w: 0, h: 0 }, null, versionId)
      setTool('select')
      return
    }
    if (tool === 'pin') {
      createAnnotation('pin', { x: point.x, y: point.y, w: 0, h: 0 }, null, versionId)
      return
    }
    layer.setPointerCapture?.(event.pointerId)
    compareDrawing = {
      layer,
      versionId,
      kind: tool,
      start: point,
      points: [point],
      geometry: { x: point.x, y: point.y, w: 0, h: 0 },
      color,
    }
    layer.innerHTML = annotationContent([{ id: 'compare-draft', kind: tool, geometry: compareDrawing.geometry, color }])
  })
  compareGrid.addEventListener('pointermove', (event) => {
    if (!compareDrawing) return
    const point = comparePoint(compareDrawing.layer, event)
    if (compareDrawing.kind === 'pen') {
      compareDrawing.points.push(point)
      compareDrawing.geometry = draftGeometry(compareDrawing.start, point, 'pen', compareDrawing.points)
    } else {
      compareDrawing.geometry = draftGeometry(compareDrawing.start, point, compareDrawing.kind)
    }
    compareDrawing.layer.innerHTML = annotationContent([{ id: 'compare-draft', kind: compareDrawing.kind, geometry: compareDrawing.geometry, color: compareDrawing.color }])
  })
  compareGrid.addEventListener('pointerup', () => {
    if (!compareDrawing) return
    const current = compareDrawing
    compareDrawing = null
    current.layer.innerHTML = ''
    const g = current.geometry
    if (current.kind !== 'pen' && Math.abs(g.w) < 0.008 && Math.abs(g.h) < 0.008) return
    createAnnotation(current.kind, g, null, current.versionId)
  })
  compareGrid.addEventListener('pointercancel', () => {
    if (compareDrawing?.layer) compareDrawing.layer.innerHTML = ''
    compareDrawing = null
  })

  async function submitFeedback() {
    if (submitting) return
    const drafts = data.annotations.filter((annotation) => annotation.status === 'draft')
    if (drafts.length === 0 && !summary.trim()) {
      showToast('先圈一处或写一段反馈，再提交本轮', 'error')
      return
    }
    submitting = true
    renderInspector()
    try {
      const result = await api('/api/feedback', {
        method: 'POST',
        body: {
          reviewId: data.reviewId,
          annotationIds: drafts.map((annotation) => annotation.id),
          versionIds: [...new Set(drafts.map((annotation) => annotation.versionId))],
          summary,
          idempotencyKey: `standalone-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        },
      })
      data = result.review
      selectedAnn = null
      summary = ''
      renderAll()
      const delivered = result.delivery?.status === 'delivered'
      showToast(delivered ? '反馈已提交，对话已继续处理这一轮' : `反馈已保存，但自动唤醒失败：${result.delivery?.error ?? '原会话不在运行'}`, delivered ? 'info' : 'error')
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      submitting = false
      renderInspector()
    }
  }

  async function refresh() {
    try {
      const next = await api(`/api/review?reviewId=${encodeURIComponent(data.reviewId)}`)
      data = next
      renderAll()
      if (compare.dataset.open === 'true') renderCompare()
      showToast('画布已刷新')
    } catch (error) {
      showToast(error.message, 'error')
    }
  }
})()
