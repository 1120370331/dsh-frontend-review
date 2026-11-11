window.__ModuleLoader__.load({
  id: 'dsh-frontend-review',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState, useCallback } = React
    const PANEL_ID = 'dsh-frontend-review'
    const TAB_KIND = 'frontend-review'
    const MAX_ZOOM = 2.5
    const MIN_ZOOM = 0.16
    const SHAPE_STROKE = 3

    const CSS = `
      .fr-root {
        --fr-bg: #f5f6f8;
        --fr-surface: #ffffff;
        --fr-surface-2: #f0f2f5;
        --fr-border: #dfe3e8;
        --fr-border-strong: #c7ced8;
        --fr-text: #1b2430;
        --fr-muted: #687385;
        --fr-accent: #246bfd;
        --fr-accent-soft: #e8f0ff;
        --fr-danger: #e5484d;
        --fr-green: #15803d;
        --fr-amber: #b45309;
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        color: var(--fr-text);
        background: var(--fr-bg);
        font-family: var(--dsh-font-family-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif);
        font-size: 13px;
        line-height: 1.45;
      }
      body[data-ds-dark-theme] .fr-root {
        --fr-bg: #0f141b;
        --fr-surface: #171d25;
        --fr-surface-2: #202832;
        --fr-border: #2a3340;
        --fr-border-strong: #3b4655;
        --fr-text: #e8edf4;
        --fr-muted: #98a4b5;
        --fr-accent: #5b8cff;
        --fr-accent-soft: #1b2a46;
        --fr-danger: #ff6b6b;
        --fr-green: #4ade80;
        --fr-amber: #fbbf24;
      }
      .fr-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--fr-border);
        background: var(--fr-surface);
        flex-wrap: wrap;
        z-index: 30;
      }
      .fr-title {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-right: 4px;
      }
      .fr-title strong {
        display: block;
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 240px;
      }
      .fr-title span {
        display: block;
        color: var(--fr-muted);
        font-size: 11px;
        white-space: nowrap;
      }
      .fr-logo {
        width: 24px;
        height: 24px;
        border-radius: 7px;
        background: var(--fr-accent);
        color: #fff;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
      }
      .fr-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        height: 28px;
        padding: 0 9px;
        border: 1px solid var(--fr-border);
        border-radius: 7px;
        background: var(--fr-surface);
        color: var(--fr-text);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      .fr-btn:hover { background: var(--fr-surface-2); }
      .fr-btn[data-active="true"] {
        color: var(--fr-accent);
        border-color: color-mix(in srgb, var(--fr-accent) 55%, var(--fr-border));
        background: var(--fr-accent-soft);
      }
      .fr-btn:disabled { opacity: .45; cursor: default; }
      .fr-btn--primary {
        background: var(--fr-accent);
        border-color: var(--fr-accent);
        color: #fff;
        font-weight: 600;
      }
      .fr-btn--primary:hover { filter: brightness(1.06); background: var(--fr-accent); }
      .fr-btn--danger { color: var(--fr-danger); }
      .fr-btn--icon { width: 28px; padding: 0; }
      .fr-spacer { flex: 1 1 auto; }
      .fr-sep { width: 1px; height: 22px; background: var(--fr-border); margin: 0 3px; }
      .fr-mode-group {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border-radius: 8px;
        background: var(--fr-surface-2);
      }
      .fr-mode-group .fr-btn { height: 26px; border-color: transparent; background: transparent; }
      .fr-mode-group .fr-btn[data-active="true"] { background: var(--fr-surface); border-color: var(--fr-border); }
      .fr-main {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        overflow: hidden;
      }
      .fr-stage {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        cursor: grab;
        background-color: var(--fr-bg);
      }
      .fr-stage[data-mode="annotate"] { cursor: crosshair; }
      .fr-stage[data-mode="interact"] { cursor: default; }
      .fr-stage:active { cursor: grabbing; }
      .fr-world {
        position: absolute;
        left: 0;
        top: 0;
        width: 1px;
        height: 1px;
        transform-origin: 0 0;
      }
      .fr-section {
        position: absolute;
        border: 1px dashed color-mix(in srgb, var(--fr-border-strong) 80%, transparent);
        border-radius: 18px;
        background: color-mix(in srgb, var(--fr-surface) 32%, transparent);
      }
      .fr-section-head {
        position: absolute;
        left: 16px;
        top: -13px;
        display: flex;
        align-items: center;
        gap: 7px;
        height: 26px;
        padding: 0 10px;
        border: 1px solid var(--fr-border);
        border-radius: 999px;
        background: var(--fr-surface);
        color: var(--fr-text);
        font-weight: 600;
        font-size: 12px;
        white-space: nowrap;
      }
      .fr-section-head small { color: var(--fr-muted); font-weight: 500; }
      .fr-card {
        position: absolute;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--fr-border);
        border-radius: 12px;
        background: var(--fr-surface);
        box-shadow: 0 6px 20px rgba(17, 24, 39, .08);
        transition: border-color .12s ease, box-shadow .12s ease;
      }
      .fr-card[data-selected="true"] {
        border-color: var(--fr-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--fr-accent) 24%, transparent), 0 12px 26px rgba(17, 24, 39, .14);
      }
      .fr-card[data-locked="true"] .fr-card-head { background: var(--fr-surface-2); }
      .fr-card-head {
        display: flex;
        align-items: center;
        gap: 7px;
        min-height: 42px;
        height: 42px;
        padding: 0 9px;
        border-bottom: 1px solid var(--fr-border);
        cursor: grab;
        user-select: none;
      }
      .fr-card-head:active { cursor: grabbing; }
      .fr-card-name {
        min-width: 0;
        flex: 1;
        display: flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
        overflow: hidden;
      }
      .fr-card-name strong {
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 12px;
      }
      .fr-card-name em {
        font-style: normal;
        color: var(--fr-muted);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .fr-version {
        flex: 0 0 auto;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--fr-surface-2);
        color: var(--fr-muted);
        font-size: 10px;
      }
      .fr-lock {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--fr-muted);
        cursor: pointer;
        font-size: 12px;
        padding: 4px;
        border-radius: 5px;
      }
      .fr-lock:hover { background: var(--fr-surface-2); color: var(--fr-text); }
      .fr-card-body {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        background: repeating-conic-gradient(var(--fr-surface-2) 0 25%, transparent 0 50%) 50% / 16px 16px;
      }
      .fr-shot {
        position: absolute;
        overflow: hidden;
        background: #fff;
      }
      .fr-shot img { display: block; width: 100%; height: 100%; object-fit: fill; user-select: none; -webkit-user-drag: none; }
      .fr-shot-placeholder {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 18px;
        text-align: center;
        color: var(--fr-muted);
        background: var(--fr-surface);
      }
      .fr-shot-placeholder strong { display: block; color: var(--fr-text); margin-bottom: 4px; }
      .fr-annotations {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        touch-action: none;
      }
      .fr-annotations[data-annotate="true"] { cursor: crosshair; }
      .fr-ann-shape { pointer-events: visiblePainted; cursor: pointer; }
      .fr-ann-shape:hover { filter: drop-shadow(0 0 2px rgba(0,0,0,.28)); }
      .fr-ann-hit { pointer-events: all; cursor: pointer; }
      .fr-live-frame {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #fff;
      }
      .fr-live-frame iframe {
        position: absolute;
        left: 50%;
        top: 50%;
        border: 0;
        transform-origin: 0 0;
        background: #fff;
      }
      .fr-frame-exit {
        position: absolute;
        right: 8px;
        top: 8px;
        z-index: 6;
        box-shadow: 0 2px 8px rgba(0,0,0,.18);
      }
      .fr-interact-tip {
        position: absolute;
        left: 10px;
        bottom: 10px;
        z-index: 5;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(17,24,39,.78);
        color: #fff;
        font-size: 11px;
        pointer-events: none;
      }
      .fr-draw-hint {
        position: absolute;
        left: 50%;
        top: 54px;
        transform: translateX(-50%);
        z-index: 20;
        pointer-events: none;
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--fr-surface);
        border: 1px solid var(--fr-border);
        box-shadow: 0 4px 16px rgba(0,0,0,.12);
        color: var(--fr-muted);
        font-size: 11px;
        white-space: nowrap;
      }
      .fr-zoom {
        position: absolute;
        left: 12px;
        bottom: 12px;
        z-index: 12;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 3px;
        border: 1px solid var(--fr-border);
        border-radius: 9px;
        background: var(--fr-surface);
        box-shadow: 0 4px 14px rgba(0,0,0,.1);
      }
      .fr-zoom .fr-btn { border: 0; background: transparent; }
      .fr-zoom span { min-width: 44px; text-align: center; color: var(--fr-muted); font-variant-numeric: tabular-nums; font-size: 11px; }
      .fr-panel {
        position: absolute;
        top: 0;
        bottom: 0;
        z-index: 25;
        display: flex;
        flex-direction: column;
        min-width: 0;
        background: var(--fr-surface);
        border-color: var(--fr-border);
        box-shadow: 0 0 32px rgba(15, 23, 42, .14);
      }
      .fr-panel--left { left: 0; width: 218px; border-right: 1px solid var(--fr-border); }
      .fr-panel--right { right: 0; width: 318px; border-left: 1px solid var(--fr-border); }
      .fr-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 42px;
        padding: 7px 10px;
        border-bottom: 1px solid var(--fr-border);
        font-weight: 600;
      }
      .fr-panel-head small { color: var(--fr-muted); font-weight: 500; }
      .fr-panel-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; }
      .fr-panel-foot { border-top: 1px solid var(--fr-border); padding: 10px; background: var(--fr-surface); }
      .fr-structure-section { margin-bottom: 14px; }
      .fr-structure-title {
        display: flex;
        justify-content: space-between;
        color: var(--fr-muted);
        font-size: 11px;
        font-weight: 600;
        margin: 0 2px 5px;
      }
      .fr-structure-item {
        appearance: none;
        width: 100%;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--fr-text);
        text-align: left;
        padding: 6px 7px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 7px;
        font: inherit;
      }
      .fr-structure-item:hover { background: var(--fr-surface-2); }
      .fr-structure-item[data-active="true"] { background: var(--fr-accent-soft); color: var(--fr-accent); }
      .fr-structure-item span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fr-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--fr-border-strong); flex: 0 0 auto; }
      .fr-dot[data-status="ready"] { background: var(--fr-green); }
      .fr-dot[data-status="failed"] { background: var(--fr-danger); }
      .fr-dot[data-status="live"] { background: var(--fr-amber); }
      .fr-field-label { display: block; color: var(--fr-muted); font-size: 11px; font-weight: 600; margin: 10px 0 5px; }
      .fr-textarea {
        display: block;
        width: 100%;
        min-height: 72px;
        resize: vertical;
        box-sizing: border-box;
        padding: 8px 9px;
        border: 1px solid var(--fr-border);
        border-radius: 8px;
        background: var(--fr-surface);
        color: var(--fr-text);
        font: inherit;
        line-height: 1.5;
      }
      .fr-textarea:focus { outline: 2px solid color-mix(in srgb, var(--fr-accent) 35%, transparent); border-color: var(--fr-accent); }
      .fr-item {
        border: 1px solid var(--fr-border);
        border-radius: 9px;
        background: var(--fr-surface);
        padding: 8px;
        margin-bottom: 8px;
      }
      .fr-item[data-selected="true"] { border-color: var(--fr-accent); background: var(--fr-accent-soft); }
      .fr-item-button {
        appearance: none;
        width: 100%;
        border: 1px solid var(--fr-border);
        border-radius: 9px;
        background: var(--fr-surface);
        color: var(--fr-text);
        padding: 8px;
        margin-bottom: 7px;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }
      .fr-item-button:hover { background: var(--fr-surface-2); }
      .fr-item-button[data-selected="true"] { border-color: var(--fr-accent); background: var(--fr-accent-soft); }
      .fr-item-meta { display: flex; align-items: center; gap: 6px; color: var(--fr-muted); font-size: 10px; margin-bottom: 3px; }
      .fr-item-text { font-size: 12px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .fr-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--fr-surface-2);
        color: var(--fr-muted);
        font-size: 10px;
        white-space: nowrap;
      }
      .fr-status[data-status="submitted"], .fr-status[data-status="processing"] { color: var(--fr-amber); background: color-mix(in srgb, var(--fr-amber) 12%, var(--fr-surface)); }
      .fr-status[data-status="modified"] { color: var(--fr-accent); background: var(--fr-accent-soft); }
      .fr-status[data-status="confirmed"] { color: var(--fr-green); background: color-mix(in srgb, var(--fr-green) 12%, var(--fr-surface)); }
      .fr-status[data-status="failed"], .fr-status[data-status="needs-info"] { color: var(--fr-danger); background: color-mix(in srgb, var(--fr-danger) 12%, var(--fr-surface)); }
      .fr-batch {
        border: 1px solid var(--fr-border);
        border-radius: 9px;
        padding: 8px;
        margin-bottom: 8px;
      }
      .fr-batch-head { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
      .fr-batch p { margin: 6px 0 0; color: var(--fr-muted); font-size: 11px; }
      .fr-reply { border-left: 2px solid var(--fr-accent); padding: 2px 0 2px 7px; margin-top: 7px; color: var(--fr-muted); font-size: 11px; white-space: pre-wrap; }
      .fr-empty {
        height: 100%;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
        background: var(--fr-bg);
      }
      .fr-empty-card {
        width: min(420px, 100%);
        border: 1px solid var(--fr-border);
        border-radius: 14px;
        background: var(--fr-surface);
        padding: 22px;
        text-align: center;
        box-shadow: 0 10px 32px rgba(15,23,42,.08);
      }
      .fr-empty-card h2 { margin: 10px 0 6px; font-size: 16px; }
      .fr-empty-card p { margin: 0 0 16px; color: var(--fr-muted); }
      .fr-error { color: var(--fr-danger); font-size: 12px; }
      .fr-toast {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        z-index: 50;
        max-width: min(520px, calc(100% - 32px));
        padding: 9px 14px;
        border-radius: 9px;
        background: #1f2937;
        color: #fff;
        box-shadow: 0 8px 28px rgba(0,0,0,.24);
        font-size: 12px;
      }
      .fr-toast[data-tone="error"] { background: #b42318; }
      .fr-open-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 11px;
        border: 1px solid var(--fr-border, #dfe3e8);
        border-radius: 10px;
        background: var(--fr-surface, #fff);
        color: var(--fr-text, #1b2430);
        margin: 4px 0;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .fr-open-card:hover { background: var(--fr-surface-2, #f0f2f5); }
      .fr-open-card__mark {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        background: #246bfd;
        color: #fff;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        font-size: 12px;
      }
      .fr-open-card__body { min-width: 0; flex: 1; }
      .fr-open-card__body strong { display: block; font-size: 12px; }
      .fr-open-card__body span { display: block; color: var(--fr-muted, #687385); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fr-open-card__action { color: var(--fr-accent, #246bfd); font-size: 12px; font-weight: 600; }
      .fr-dock-button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 9px;
        border: 1px solid var(--dsw-alias-border, rgba(128,138,152,.28));
        border-radius: 7px;
        background: transparent;
        color: var(--dsw-alias-text-secondary, #687385);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .fr-dock-button:hover { background: var(--dsw-alias-fill-secondary, rgba(128,138,152,.1)); }
      @media (max-width: 960px) {
        .fr-title { display: flex; min-width: 0; gap: 6px; margin-right: 0; }
        .fr-title .fr-logo { width: 22px; height: 22px; border-radius: 6px; }
        .fr-title strong { max-width: 96px; font-size: 12px; }
        .fr-title span { display: none; }
        .fr-sep { display: none; }
        .fr-toolbar { gap: 4px; padding: 5px 7px; min-height: 38px; }
        .fr-toolbar .fr-btn { height: 26px; padding: 0 7px; }
        .fr-panel--right { width: min(300px, 52%); }
        .fr-panel--left { width: 196px; }
      }
      @media (max-width: 720px) {
        .fr-panel--right { width: min(300px, 88%); }
        .fr-title span { display: none; }
      }
    `

    function runtimeConfig() {
      const injected = window.__DSH_FRONTEND_REVIEW__
      if (injected?.base) return injected
      const transport = window.__DSH_TRANSPORT__
      if (typeof transport?.streamBaseUrl === 'string') {
        try {
          return {
            base: new URL('/frontend-review', transport.streamBaseUrl).href.replace(/\/$/u, ''),
            token: injected?.token,
          }
        } catch {
          // fall through to the same-origin path
        }
      }
      return { base: '/frontend-review', token: injected?.token }
    }

    async function api(path, options = {}) {
      const config = runtimeConfig()
      const headers = { accept: 'application/json', ...(options.headers ?? {}) }
      if (options.body !== undefined) headers['content-type'] = 'application/json'
      if (config.token) headers['x-review-token'] = config.token
      const response = await fetch(`${config.base}${path}`, {
        method: options.method ?? 'GET',
        headers,
        credentials: 'same-origin',
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      })
      const text = await response.text()
      let payload
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        payload = { error: text }
      }
      if (!response.ok) {
        const error = new Error(payload.error || `request failed with HTTP ${response.status}`)
        error.code = payload.code
        error.revision = payload.revision
        error.status = response.status
        throw error
      }
      return payload
    }

    function assetUrl(reviewId, versionId) {
      const config = runtimeConfig()
      return `${config.base}/api/asset/${encodeURIComponent(reviewId)}/${encodeURIComponent(versionId)}${config.token ? `?token=${encodeURIComponent(config.token)}` : ''}`
    }

    function htmlUrl(reviewId, versionId) {
      const config = runtimeConfig()
      return `${config.base}/api/html/${encodeURIComponent(reviewId)}/${encodeURIComponent(versionId)}${config.token ? `?token=${encodeURIComponent(config.token)}` : ''}`
    }

    function openPanel(ctx, reviewId) {
      const controller = sidebarController ?? ctx?.get?.('sidebarRight')
      if (!controller) throw new Error('右侧栏服务尚未就绪，请刷新页面后重试')
      controller.openTab(TAB_KIND, {
        params: reviewId ? { reviewId } : undefined,
        revealIfOpened: true,
      })
    }

    function timeAgo(value) {
      const time = new Date(value).getTime()
      if (!Number.isFinite(time)) return ''
      const seconds = Math.round((Date.now() - time) / 1000)
      if (seconds < 60) return '刚刚'
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
      return `${Math.floor(seconds / 86400)} 天前`
    }

    function statusLabel(status) {
      switch (status) {
        case 'draft': return '草稿'
        case 'submitted': return '已提交'
        case 'processing': return '处理中'
        case 'modified': return '已修改待确认'
        case 'confirmed': return '已确认'
        case 'deferred': return '暂缓'
        case 'needs-info': return '需要信息'
        case 'ready': return '已固定'
        case 'live': return '实时'
        case 'failed': return '失败'
        default: return status || '未知'
      }
    }

    function targetLabel(data, annotation) {
      if (!data) return ''
      const node = data.nodes.find((entry) => entry.versionId === annotation.versionId)
      if (!node) return annotation.versionId
      return `${node.title} / ${node.variant} v${node.version}`
    }

    function Mark() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 11, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('rect', { x: 10, y: 12, width: 11, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M6 16c3-3 6-3 9 0', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function ReviewOpenRow({ block, phase }) {
      const meta = block?.meta ?? {}
      const reviewId = typeof meta.reviewId === 'string' ? meta.reviewId : undefined
      const claimed = useRef(false)
      const [message, setMessage] = useState('')
      const open = useCallback(() => {
        try {
          openPanel(ctx, reviewId)
          setMessage('已打开右侧画布')
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error))
        }
      }, [reviewId])

      useEffect(() => {
        if (phase !== 'result' || !reviewId || claimed.current) return
        const openedAt = new Date(meta.openedAt ?? 0).getTime()
        if (!Number.isFinite(openedAt) || Date.now() - openedAt > 25000) return
        claimed.current = true
        api('/api/claim-open', { method: 'POST', body: { reviewId, sessionId: meta.sessionId } })
          .then((result) => {
            if (result.open) open()
          })
          .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
      }, [phase, reviewId, meta.openedAt, meta.sessionId, open])

      if (phase !== 'result') {
        return h('div', { className: 'fr-open-card' },
          h('span', { className: 'fr-open-card__mark' }, h(Mark)),
          h('span', { className: 'fr-open-card__body' },
            h('strong', {}, '前端评审画布'),
            h('span', {}, '正在准备画布…')))
      }
      return h('button', { type: 'button', className: 'fr-open-card', onClick: open },
        h('span', { className: 'fr-open-card__mark' }, h(Mark)),
        h('span', { className: 'fr-open-card__body' },
          h('strong', {}, meta.title || '前端评审画布'),
          h('span', {}, message || '在右侧画布中圈画、批注，然后提交反馈')),
        h('span', { className: 'fr-open-card__action' }, '打开画布'))
    }

    function DockButton() {
      const [error, setError] = useState('')
      return h('button', {
        type: 'button',
        className: 'fr-dock-button',
        title: error || '打开前端评审画布',
        onClick: () => {
          try {
            openPanel(ctx)
            setError('')
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        },
      }, h(Mark), '评审')
    }

    function Canvas({ sessionId }) {
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [mode, setMode] = useState('overview')
      const [shape, setShape] = useState('rect')
      const [color, setColor] = useState('#ff4d4f')
      const [zoom, setZoom] = useState(1)
      const [pan, setPan] = useState({ x: 40, y: 40 })
      const [selectedNode, setSelectedNode] = useState(null)
      const [selectedAnnotation, setSelectedAnnotation] = useState(null)
      const [interactiveNode, setInteractiveNode] = useState(null)
      const [structureOpen, setStructureOpen] = useState(false)
      const [inspectorOpen, setInspectorOpen] = useState(false)
      const [summary, setSummary] = useState('')
      const [toast, setToast] = useState(null)
      const [dragging, setDragging] = useState(null)
      const [panning, setPanning] = useState(null)
      const [drawing, setDrawing] = useState(null)
      const [submitting, setSubmitting] = useState(false)
      const stageRef = useRef(null)
      const dataRef = useRef(null)
      const initialized = useRef(false)
      const saveTimer = useRef(null)
      const toastTimer = useRef(null)

      useEffect(() => {
        dataRef.current = data
      }, [data])

      const notify = useCallback((message, tone = 'info') => {
        setToast({ message, tone })
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 3600)
      }, [])

      const load = useCallback(async (signal) => {
        if (!sessionId) {
          setLoading(false)
          return
        }
        setLoading(true)
        setError('')
        try {
          const review = await api(`/api/review?sessionId=${encodeURIComponent(sessionId)}`, { signal })
          setData(review)
        } catch (reason) {
          if (reason?.code === 'NO_REVIEW' || reason?.status === 404) {
            setData(null)
          } else if (reason?.name !== 'AbortError') {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        } finally {
          setLoading(false)
        }
      }, [sessionId])

      useEffect(() => {
        const controller = new AbortController()
        load(controller.signal)
        return () => controller.abort()
      }, [load])

      useEffect(() => () => {
        clearTimeout(saveTimer.current)
        clearTimeout(toastTimer.current)
      }, [])

      const refresh = useCallback(async () => {
        if (!data?.reviewId) return
        try {
          const review = await api(`/api/review?reviewId=${encodeURIComponent(data.reviewId)}&sessionId=${encodeURIComponent(sessionId ?? '')}`)
          setData(review)
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
        }
      }, [data?.reviewId, sessionId, notify])

      const fit = useCallback(() => {
        const stage = stageRef.current
        if (!stage || !data) return
        const rect = stage.getBoundingClientRect()
        const cards = data.nodes
        const bounds = cards.length > 0
          ? {
              x: Math.min(...cards.map((node) => node.x)),
              y: Math.min(...cards.map((node) => node.y)),
              right: Math.max(...cards.map((node) => node.x + node.w)),
              bottom: Math.max(...cards.map((node) => node.y + node.h)),
            }
          : { x: 0, y: 0, right: 900, bottom: 640 }
        const width = Math.max(120, bounds.right - bounds.x)
        const height = Math.max(120, bounds.bottom - bounds.y)
        const nextZoom = Math.max(MIN_ZOOM, Math.min(1, (rect.width - 100) / width, (rect.height - 100) / height))
        const nextX = (rect.width - width * nextZoom) / 2 - bounds.x * nextZoom
        const nextY = (rect.height - height * nextZoom) / 2 - bounds.y * nextZoom
        setZoom(nextZoom)
        setPan({ x: nextX, y: nextY })
      }, [data])

      useEffect(() => {
        if (!data || initialized.current) return
        initialized.current = true
        const timer = setTimeout(fit, 60)
        return () => clearTimeout(timer)
      }, [data, fit])

      useEffect(() => {
        const handler = (event) => {
          if (event.key === 'Escape') {
            if (interactiveNode) {
              setInteractiveNode(null)
              setMode('overview')
            } else if (drawing) {
              setDrawing(null)
            } else if (inspectorOpen) {
              setInspectorOpen(false)
            }
          }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
      }, [interactiveNode, drawing, inspectorOpen])

      const createCanvas = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const result = await api('/api/open', { method: 'POST', body: { sessionId } })
          setData(result.review)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setLoading(false)
        }
      }, [sessionId])

      const nodeById = useMemo(() => {
        const map = new Map()
        for (const node of data?.nodes ?? []) map.set(node.versionId, node)
        return map
      }, [data])

      const selected = selectedNode ? nodeById.get(selectedNode) : undefined
      const selectedAnn = selectedAnnotation && data
        ? data.annotations.find((entry) => entry.id === selectedAnnotation)
        : undefined
      const drafts = data?.annotations.filter((entry) => entry.status === 'draft') ?? []

      const selectNode = useCallback((node, openInspector = false) => {
        setSelectedNode(node.versionId)
        if (openInspector) setInspectorOpen(true)
      }, [])

      const selectAnnotation = useCallback((annotation) => {
        setSelectedAnnotation(annotation.id)
        setSelectedNode(annotation.versionId)
        setInspectorOpen(true)
      }, [])

      const zoomAt = useCallback((delta, clientX, clientY) => {
        const stage = stageRef.current
        if (!stage) return
        const rect = stage.getBoundingClientRect()
        const mx = clientX - rect.left
        const my = clientY - rect.top
        setZoom((current) => {
          const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current * delta))
          setPan((currentPan) => {
            const wx = (mx - currentPan.x) / current
            const wy = (my - currentPan.y) / current
            return { x: mx - wx * next, y: my - wy * next }
          })
          return next
        })
      }, [])

      const onWheel = useCallback((event) => {
        if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) > 0) {
          event.preventDefault()
          const delta = event.deltaY > 0 ? 0.9 : 1.1
          zoomAt(delta, event.clientX, event.clientY)
        }
      }, [zoomAt])

      const normalizedPoint = useCallback((event, element) => {
        const rect = element.getBoundingClientRect()
        return {
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
        }
      }, [])

      const persistAnnotation = useCallback(async (annotation, { silent = false } = {}) => {
        if (!data?.reviewId) return
        try {
          const result = await api('/api/annotation', {
            method: 'POST',
            body: { reviewId: data.reviewId, annotation },
          })
          setData(result.review)
          if (!silent) notify('批注已保存')
          return result
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
          return undefined
        }
      }, [data?.reviewId, notify])

      const createAnnotation = useCallback(async (node, kind, geometry) => {
        const result = await persistAnnotation({
          versionId: node.versionId,
          kind,
          geometry,
          text: '',
          color,
        }, { silent: true })
        if (result?.annotation?.id) {
          setSelectedAnnotation(result.annotation.id)
          setSelectedNode(node.versionId)
          setInspectorOpen(true)
          notify(kind === 'pin' ? '已放一个标记，请在右侧写反馈' : '已记录批注，请在右侧补充说明')
        }
      }, [color, notify, persistAnnotation])

      const beginDraw = useCallback((event, node) => {
        if (mode !== 'annotate' || event.button !== 0) return
        event.stopPropagation()
        event.preventDefault()
        const element = event.currentTarget
        const point = normalizedPoint(event, element)
        if (shape === 'pin' || shape === 'note') {
          createAnnotation(node, 'pin', { x: point.x, y: point.y, w: 0, h: 0 })
          return
        }
        element.setPointerCapture?.(event.pointerId)
        setDrawing({
          node,
          kind: shape,
          color,
          start: point,
          points: [point],
          geometry: { x: point.x, y: point.y, w: 0, h: 0 },
        })
      }, [mode, shape, color, normalizedPoint, createAnnotation])

      const moveDraw = useCallback((event) => {
        if (!drawing) return
        const element = event.currentTarget
        const point = normalizedPoint(event, element)
        const start = drawing.start
        const geometry = drawing.kind === 'pen'
          ? (() => {
              const points = [...drawing.points, point]
              const xs = points.map((entry) => entry[0])
              const ys = points.map((entry) => entry[1])
              return {
                x: Math.min(...xs),
                y: Math.min(...ys),
                w: Math.max(...xs) - Math.min(...xs),
                h: Math.max(...ys) - Math.min(...ys),
                points,
              }
            })()
          : {
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              w: Math.abs(point.x - start.x),
              h: Math.abs(point.y - start.y),
            }
        setDrawing((current) => current ? {
          ...current,
          points: current.kind === 'pen' ? [...current.points, point] : current.points,
          geometry: current.kind === 'arrow' ? { x: start.x, y: start.y, w: point.x - start.x, h: point.y - start.y } : geometry,
        } : current)
      }, [drawing, normalizedPoint])

      const endDraw = useCallback(() => {
        if (!drawing) return
        const current = drawing
        setDrawing(null)
        const g = current.geometry
        if (current.kind !== 'pen' && Math.abs(g.w) < 0.006 && Math.abs(g.h) < 0.006) return
        createAnnotation(current.node, current.kind, g)
      }, [drawing, createAnnotation])

      const onStagePointerDown = useCallback((event) => {
        if (event.button !== 0) return
        if (event.target.closest('.fr-card') || event.target.closest('.fr-panel') || event.target.closest('.fr-zoom')) return
        if (mode === 'interact') return
        stageRef.current?.setPointerCapture?.(event.pointerId)
        setPanning({ startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y })
      }, [mode, pan])

      const onStagePointerMove = useCallback((event) => {
        if (panning) {
          setPan({
            x: panning.originX + (event.clientX - panning.startX),
            y: panning.originY + (event.clientY - panning.startY),
          })
        }
        if (dragging) {
          const dx = (event.clientX - dragging.startX) / zoom
          const dy = (event.clientY - dragging.startY) / zoom
          setData((current) => current ? {
            ...current,
            nodes: current.nodes.map((node) => node.versionId === dragging.versionId
              ? { ...node, x: dragging.originX + dx, y: dragging.originY + dy }
              : node),
          } : current)
        }
      }, [panning, dragging, zoom])

      const onStagePointerUp = useCallback(async () => {
        if (panning) setPanning(null)
        if (!dragging) return
        const moved = dragging
        setDragging(null)
        try {
          const current = dataRef.current
          const node = current?.nodes.find((entry) => entry.versionId === moved.versionId)
          if (!current || !node) return
          const result = await api('/api/layout', {
            method: 'POST',
            body: {
              reviewId: current.reviewId,
              versionId: moved.versionId,
              x: node.x,
              y: node.y,
            },
          })
          setData(result.review)
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
          refresh()
        }
      }, [panning, dragging, zoom, notify, refresh])

      const onCardPointerDown = useCallback((event, node) => {
        if (event.button !== 0) return
        if (mode === 'interact') return
        event.stopPropagation()
        selectNode(node)
        if (mode !== 'overview') return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        setDragging({
          versionId: node.versionId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          originX: node.x,
          originY: node.y,
        })
      }, [mode, selectNode])

      const onCardPointerMove = useCallback((event) => {
        if (!dragging) return
        event.stopPropagation()
        setDragging((current) => current ? { ...current, lastX: event.clientX, lastY: event.clientY } : current)
        const dx = (event.clientX - dragging.startX) / zoom
        const dy = (event.clientY - dragging.startY) / zoom
        setData((current) => current ? {
          ...current,
          nodes: current.nodes.map((node) => node.versionId === dragging.versionId
            ? { ...node, x: dragging.originX + dx, y: dragging.originY + dy }
            : node),
        } : current)
      }, [dragging, zoom])

      const saveText = useCallback((annotation, text) => {
        if (!annotation || !data?.reviewId) return
        setData((current) => current ? {
          ...current,
          annotations: current.annotations.map((entry) => entry.id === annotation.id ? { ...entry, text } : entry),
        } : current)
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(async () => {
          try {
            const result = await api('/api/annotation', {
              method: 'POST',
              body: { reviewId: data.reviewId, annotation: { id: annotation.id, text } },
            })
            setData(result.review)
          } catch (reason) {
            notify(reason instanceof Error ? reason.message : String(reason), 'error')
          }
        }, 500)
      }, [data?.reviewId, notify])

      const deleteAnnotation = useCallback(async (annotation) => {
        if (!data?.reviewId) return
        try {
          const result = await api('/api/annotation', {
            method: 'DELETE',
            body: { reviewId: data.reviewId, annotationId: annotation.id },
          })
          setData(result.review)
          setSelectedAnnotation(null)
          notify('草稿已删除')
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
        }
      }, [data?.reviewId, notify])

      const toggleLock = useCallback(async (node) => {
        try {
          const result = await api('/api/layout', {
            method: 'POST',
            body: { reviewId: data.reviewId, versionId: node.versionId, x: node.x, y: node.y, locked: !node.locked },
          })
          setData(result.review)
          notify(node.locked ? '已解锁位置' : '已锁定位置')
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
        }
      }, [data?.reviewId, notify])

      const submit = useCallback(async () => {
        if (!data?.reviewId || submitting) return
        const ids = drafts.map((entry) => entry.id)
        if (ids.length === 0 && summary.trim().length === 0) {
          notify('先圈一处或写一段反馈，再提交本轮', 'error')
          return
        }
        setSubmitting(true)
        try {
          const result = await api('/api/feedback', {
            method: 'POST',
            body: {
              reviewId: data.reviewId,
              sessionId,
              annotationIds: ids,
              versionIds: [...new Set(drafts.map((entry) => entry.versionId))],
              summary,
              idempotencyKey: `ui-${cryptoRandom()}`,
            },
          })
          setData(result.review)
          setSummary('')
          setSelectedAnnotation(null)
          const delivery = result.delivery
          notify(
            delivery?.status === 'delivered'
              ? '反馈已提交，对话已继续处理这一轮'
              : `反馈已保存，但自动唤醒失败：${delivery?.error ?? '原会话不在运行'}`,
            delivery?.status === 'delivered' ? 'info' : 'error',
          )
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
        } finally {
          setSubmitting(false)
        }
      }, [data?.reviewId, drafts, summary, submitting, sessionId, notify])

      const confirmBatch = useCallback(async (batch) => {
        try {
          const result = await api('/api/feedback/confirm', {
            method: 'POST',
            body: { reviewId: data.reviewId, batchId: batch.id },
          })
          setData(result.review)
          notify('已确认这一轮反馈')
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
        }
      }, [data?.reviewId, notify])

      const retryDelivery = useCallback(async (batch) => {
        try {
          const result = await api('/api/feedback/retry', {
            method: 'POST',
            body: { reviewId: data.reviewId, batchId: batch.id },
          })
          setData(result.review)
          notify(
            result.delivery?.status === 'delivered' ? '已把反馈重新送达对话' : `仍未送达：${result.delivery?.error ?? '原会话未运行'}`,
            result.delivery?.status === 'delivered' ? 'info' : 'error',
          )
        } catch (reason) {
          notify(reason instanceof Error ? reason.message : String(reason), 'error')
        }
      }, [data?.reviewId, notify])

      if (loading) {
        return h('div', { className: 'fr-root' },
          h('div', { className: 'fr-empty' },
            h('div', { className: 'fr-empty-card' }, h(Mark), h('h2', {}, '正在加载评审画布'), h('p', {}, '读取这个对话绑定的页面版本和批注…'))))
      }

      if (!data) {
        return h('div', { className: 'fr-root' },
          h('div', { className: 'fr-empty' },
            h('div', { className: 'fr-empty-card' },
              h(Mark),
              h('h2', {}, '这个对话还没有评审画布'),
              h('p', {}, '创建后，AI 可以导入页面、固定版本；你可以直接在截图上圈画并提交反馈。'),
              h('button', { type: 'button', className: 'fr-btn fr-btn--primary', onClick: createCanvas }, '创建评审画布'),
              error ? h('p', { className: 'fr-error' }, error) : null)))
      }

      const bounds = data.sections.length > 0
        ? {
            x: Math.min(...data.sections.map((section) => section.bounds.x)),
            y: Math.min(...data.sections.map((section) => section.bounds.y)),
            right: Math.max(...data.sections.map((section) => section.bounds.x + section.bounds.w)),
            bottom: Math.max(...data.sections.map((section) => section.bounds.y + section.bounds.h)),
          }
        : { x: 0, y: 0, right: 1000, bottom: 700 }

      return h('div', { className: 'fr-root' },
        h('div', { className: 'fr-toolbar' },
          h('div', { className: 'fr-title' },
            h('span', { className: 'fr-logo' }, h(Mark)),
            h('div', {},
              h('strong', { title: data.title }, data.title),
              h('span', {}, `第 ${data.round} 轮 · rev ${data.revision} · ${data.counts.versions} 个固定版本`))),
          h('span', { className: 'fr-sep' }),
          h('div', { className: 'fr-mode-group' },
            h('button', { type: 'button', className: 'fr-btn', 'data-active': mode === 'overview', onClick: () => { setMode('overview'); setInteractiveNode(null) } }, '总览'),
            h('button', { type: 'button', className: 'fr-btn', 'data-active': mode === 'annotate', onClick: () => setMode('annotate') }, '批注'),
            h('button', { type: 'button', className: 'fr-btn', 'data-active': mode === 'interact', onClick: () => setMode('interact') }, '互动')),
          mode === 'annotate' ? h('div', { className: 'fr-mode-group' },
            ...[['rect', '矩形'], ['ellipse', '圈选'], ['arrow', '箭头'], ['pen', '画笔'], ['pin', '标记']].map(([value, label]) =>
              h('button', {
                key: value,
                type: 'button',
                className: 'fr-btn',
                'data-active': shape === value,
                onClick: () => setShape(value),
              }, label)),
            ...[['#ff4d4f'], ['#246bfd'], ['#f59e0b'], ['#15803d']].map(([value]) =>
              h('button', {
                key: value,
                type: 'button',
                className: 'fr-btn fr-btn--icon',
                title: value,
                style: { background: value, borderColor: value, width: 18, minWidth: 18, height: 18, padding: 0, borderRadius: 999, marginLeft: 3 },
                onClick: () => setColor(value),
              }))) : null,
          h('span', { className: 'fr-spacer' }),
          h('button', { type: 'button', className: 'fr-btn', 'data-active': structureOpen, onClick: () => setStructureOpen((value) => !value) }, '结构'),
          h('button', { type: 'button', className: 'fr-btn', 'data-active': inspectorOpen, onClick: () => setInspectorOpen((value) => !value) }, `反馈 ${drafts.length || ''}`.trim()),
          h('button', { type: 'button', className: 'fr-btn fr-btn--primary', disabled: submitting, onClick: submit }, submitting ? '提交中…' : '提交本轮')),
        h('div', { className: 'fr-main' },
        h('div', {
          className: 'fr-stage',
          'data-mode': mode,
          ref: stageRef,
          onWheel,
          onPointerDown: onStagePointerDown,
          onPointerMove: onStagePointerMove,
          onPointerUp: onStagePointerUp,
          onPointerCancel: onStagePointerUp,
          style: {
            backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--fr-border-strong) 52%, transparent) 1px, transparent 1px)`,
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          },
        },
          mode === 'annotate'
            ? h('div', { className: 'fr-draw-hint' }, `批注模式 · ${shape === 'pin' ? '点击页面放置标记' : '拖拽圈出要反馈的区域'} · Esc 退出`)
            : mode === 'interact'
              ? h('div', { className: 'fr-draw-hint' }, '互动模式 · 点击卡片进入页面；按 Esc 返回总览')
              : null,
          h('div', {
            className: 'fr-world',
            style: { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` },
          },
            data.sections.map((section) => h('div', {
              key: section.id,
              className: 'fr-section',
              style: {
                left: section.bounds.x,
                top: section.bounds.y,
                width: section.bounds.w,
                height: section.bounds.h,
              },
            },
              h('div', { className: 'fr-section-head' },
                section.title,
                h('small', {}, `${data.nodes.filter((node) => node.sectionId === section.id).length} 个版本`)))),
            data.nodes.map((node) => h(NodeCard, {
              key: node.versionId,
              data,
              node,
              zoom,
              mode,
              drawing: drawing?.node.versionId === node.versionId ? drawing : null,
              selected: selectedNode === node.versionId,
              interactive: interactiveNode === node.versionId,
              annotations: data.annotations.filter((annotation) => annotation.versionId === node.versionId && annotation.status !== 'confirmed'),
              selectedAnnotation,
              onSelect: selectNode,
              onAnnotation: selectAnnotation,
              onPointerDown: onCardPointerDown,
              onPointerMove: onCardPointerMove,
              onPointerUp: onStagePointerUp,
              onBeginDraw: beginDraw,
              onMoveDraw: moveDraw,
              onEndDraw: endDraw,
              onEnterInteractive: (target) => {
                selectNode(target)
                setInteractiveNode(target.versionId)
                setMode('interact')
              },
              onExitInteractive: () => {
                setInteractiveNode(null)
                setMode('overview')
              },
              onOpenExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
              onToggleLock: toggleLock,
            })))),
        h('div', { className: 'fr-zoom' },
          h('button', { type: 'button', className: 'fr-btn', onClick: () => zoomAt(0.88, (stageRef.current?.getBoundingClientRect().left ?? 0) + 200, (stageRef.current?.getBoundingClientRect().top ?? 0) + 200) }, '−'),
          h('span', {}, `${Math.round(zoom * 100)}%`),
          h('button', { type: 'button', className: 'fr-btn', onClick: () => zoomAt(1.14, (stageRef.current?.getBoundingClientRect().left ?? 0) + 200, (stageRef.current?.getBoundingClientRect().top ?? 0) + 200) }, '+'),
          h('button', { type: 'button', className: 'fr-btn', onClick: fit, title: '适配内容' }, '适配')),
        structureOpen ? h('aside', { className: 'fr-panel fr-panel--left', onPointerDown: (event) => event.stopPropagation() },
          h('div', { className: 'fr-panel-head' }, h('span', {}, '画布结构'), h('button', { type: 'button', className: 'fr-btn fr-btn--icon', onClick: () => setStructureOpen(false) }, '×')),
          h('div', { className: 'fr-panel-scroll' },
            data.sections.map((section) => h('div', { key: section.id, className: 'fr-structure-section' },
              h('div', { className: 'fr-structure-title' }, h('span', {}, section.title), h('span', {}, data.nodes.filter((node) => node.sectionId === section.id).length)),
              data.nodes.filter((node) => node.sectionId === section.id).map((node) =>
                h('button', {
                  key: node.versionId,
                  type: 'button',
                  className: 'fr-structure-item',
                  'data-active': selectedNode === node.versionId,
                  onClick: () => { selectNode(node); setSelectedAnnotation(null) },
                },
                  h('i', { className: 'fr-dot', 'data-status': node.status }),
                  h('span', {}, `${node.title} · ${node.variant} v${node.version}`)))))),
          h('div', { className: 'fr-panel-foot' },
            h('div', { style: { color: 'var(--fr-muted)', fontSize: 11 } }, '拖动卡片可以移动；锁定的位置会自动排布时保留。'))) : null,
        inspectorOpen ? h(FeedbackPanel, {
          data,
          selected,
          selectedAnn,
          drafts,
          summary,
          setSummary,
          onClose: () => setInspectorOpen(false),
          onSelect: selectAnnotation,
          onSelectNode: (node) => { selectNode(node); setSelectedAnnotation(null) },
          onChangeText: saveText,
          onDelete: deleteAnnotation,
          onSubmit: submit,
          submitting,
          onConfirm: confirmBatch,
          onRetryDelivery: retryDelivery,
          onRefresh: refresh,
          notify,
        }) : null),
        toast ? h('div', { className: 'fr-toast', 'data-tone': toast.tone }, toast.message) : null)
    }

    function NodeCard({
      data,
      node,
      mode,
      drawing,
      selected,
      interactive,
      annotations,
      selectedAnnotation,
      onSelect,
      onAnnotation,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onBeginDraw,
      onMoveDraw,
      onEndDraw,
      onEnterInteractive,
      onExitInteractive,
      onOpenExternal,
      onToggleLock,
    }) {
      const bodyW = Math.max(80, node.w - 2)
      const bodyH = Math.max(80, node.h - 43)
      const snapshot = node.snapshot
      const aspect = snapshot ? snapshot.width / Math.max(1, snapshot.height) : 1.6
      let shotW = bodyW
      let shotH = shotW / aspect
      if (shotH > bodyH) {
        shotH = bodyH
        shotW = shotH * aspect
      }
      const shotStyle = {
        width: shotW,
        height: shotH,
        left: (bodyW - shotW) / 2,
        top: (bodyH - shotH) / 2,
      }
      const liveSource = node.hasHtml
        ? htmlUrl(data.reviewId, node.versionId)
        : node.sourceUrl || undefined
      const scale = node.viewport
        ? Math.min(bodyW / node.viewport.width, bodyH / node.viewport.height)
        : 1

      return h('article', {
        className: 'fr-card',
        'data-selected': selected ? 'true' : 'false',
        'data-locked': node.locked ? 'true' : 'false',
        style: { left: node.x, top: node.y, width: node.w, height: node.h },
        onPointerDown: (event) => onPointerDown(event, node),
        onPointerMove,
        onPointerUp: (event) => { event.stopPropagation(); onPointerUp(event) },
        onDoubleClick: () => (liveSource || node.hasHtml) ? onEnterInteractive(node) : onSelect(node),
      },
        h('header', { className: 'fr-card-head' },
          h('i', { className: 'fr-dot', 'data-status': node.status }),
          h('div', { className: 'fr-card-name' },
            h('strong', {}, node.title),
            h('em', {}, node.variant)),
          h('span', { className: 'fr-version' }, `v${node.version}`),
          node.draftCount > 0 ? h('span', { className: 'fr-status', 'data-status': 'draft' }, `${node.draftCount} 草稿`) : null,
          h('button', {
            type: 'button',
            className: 'fr-lock',
            title: node.locked ? '解锁位置' : '锁定位置',
            onPointerDown: (event) => event.stopPropagation(),
            onClick: (event) => { event.stopPropagation(); onToggleLock(node) },
          }, node.locked ? '🔒' : '🔓')),
        h('div', { className: 'fr-card-body' },
          interactive && liveSource
            ? h('div', { className: 'fr-live-frame', onPointerDown: (event) => event.stopPropagation() },
                h('iframe', {
                  src: liveSource,
                  title: `${node.title} ${node.variant} v${node.version}`,
                  sandbox: 'allow-scripts allow-forms allow-popups allow-modals',
                  referrerPolicy: 'no-referrer',
                  style: node.viewport ? {
                    width: node.viewport.width,
                    height: node.viewport.height,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    marginLeft: `${-(node.viewport.width * scale) / 2}px`,
                    marginTop: `${-(node.viewport.height * scale) / 2}px`,
                  } : { inset: 0, width: '100%', height: '100%' },
                }),
                h('button', {
                  type: 'button',
                  className: 'fr-btn fr-frame-exit',
                  onClick: (event) => { event.stopPropagation(); onExitInteractive() },
                }, '退出互动 Esc'),
                h('span', { className: 'fr-interact-tip' }, '直接操作这个页面；批注需先退出互动'))
            : node.status === 'ready' && snapshot
              ? h('div', { className: 'fr-shot', style: shotStyle },
                  h('img', { src: assetUrl(data.reviewId, node.versionId), alt: node.title, draggable: false }),
                  h(AnnotationLayer, {
                    node,
                    annotations,
                    selectedAnnotation,
                    mode,
                    onAnnotation,
                    onBeginDraw,
                    onMoveDraw,
                    onEndDraw,
                    drawing,
                  }))
              : h('div', { className: 'fr-shot-placeholder' },
                  h('div', {},
                    h('strong', {}, node.status === 'failed' ? '固定截图失败' : '这个版本只有实时预览'),
                    h('span', {}, node.error?.message ?? '没有可批注的固定截图；可切换到互动模式查看页面。'),
                    liveSource ? h('button', {
                      type: 'button',
                      className: 'fr-btn',
                      style: { marginTop: 8 },
                      onClick: (event) => { event.stopPropagation(); onEnterInteractive(node) },
                    }, '进入互动预览') : null,
                    node.sourceUrl ? h('button', {
                      type: 'button',
                      className: 'fr-btn',
                      style: { marginTop: 6, marginLeft: 6 },
                      onClick: (event) => { event.stopPropagation(); onOpenExternal(node.sourceUrl) },
                    }, '新窗口打开') : null)),
          mode === 'interact' && !interactive && liveSource
            ? h('button', {
                type: 'button',
                className: 'fr-btn',
                style: { position: 'absolute', right: 10, top: 10, zIndex: 4 },
                onClick: (event) => { event.stopPropagation(); onEnterInteractive(node) },
              }, '进入互动')
            : null))
    }

    function AnnotationLayer({ node, annotations, selectedAnnotation, mode, drawing, onAnnotation, onBeginDraw, onMoveDraw, onEndDraw }) {
      return h('svg', {
        className: 'fr-annotations',
        'data-annotate': mode === 'annotate' ? 'true' : 'false',
        viewBox: '0 0 1000 1000',
        preserveAspectRatio: 'none',
        onPointerDown: (event) => onBeginDraw(event, node),
        onPointerMove: onMoveDraw,
        onPointerUp: onEndDraw,
        onPointerCancel: onEndDraw,
      },
        h('defs', {},
          h('marker', {
            id: 'fr-arrow',
            viewBox: '0 0 10 10',
            refX: 8,
            refY: 5,
            markerWidth: 5,
            markerHeight: 5,
            orient: 'auto-start-reverse',
          }, h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }))),
        annotations.map((annotation) => h(AnnotationShape, {
          key: annotation.id,
          annotation,
          selected: selectedAnnotation === annotation.id,
          onSelect: onAnnotation,
        })),
        drawing ? h(AnnotationShape, {
          key: 'draft',
          annotation: {
            id: 'draft',
            kind: drawing.kind,
            geometry: drawing.geometry,
            color: drawing.color || '#ff4d4f',
          },
          preview: true,
          selected: true,
        }) : null)
    }

    function AnnotationShape({ annotation, selected, onSelect, preview = false }) {
      const g = annotation.geometry ?? { x: 0, y: 0, w: 0, h: 0 }
      const x = g.x * 1000
      const y = g.y * 1000
      const w = g.w * 1000
      const hgt = g.h * 1000
      const left = Math.min(x, x + w)
      const top = Math.min(y, y + hgt)
      const width = Math.abs(w)
      const height = Math.abs(hgt)
      const common = {
        className: 'fr-ann-shape',
        stroke: annotation.color || '#ff4d4f',
        strokeWidth: selected ? SHAPE_STROKE + 2 : SHAPE_STROKE,
        fill: 'none',
        vectorEffect: 'non-scaling-stroke',
        ...(preview ? { pointerEvents: 'none' } : {
          onPointerDown: (event) => {
            event.stopPropagation()
            onSelect(annotation)
          },
        }),
      }
      let shapeElement
      if (annotation.kind === 'arrow') {
        shapeElement = h('line', {
          ...common,
          x1: x,
          y1: y,
          x2: x + w,
          y2: y + hgt,
          markerEnd: 'url(#fr-arrow)',
        })
      } else if (annotation.kind === 'ellipse') {
        shapeElement = h('ellipse', {
          ...common,
          cx: left + width / 2,
          cy: top + height / 2,
          rx: Math.max(2, width / 2),
          ry: Math.max(2, height / 2),
        })
      } else if (annotation.kind === 'pen') {
        const points = (g.points ?? []).map(([px, py]) => `${px * 1000},${py * 1000}`).join(' ')
        shapeElement = h('polyline', { ...common, points, strokeLinecap: 'round', strokeLinejoin: 'round' })
      } else if (annotation.kind === 'pin' || annotation.kind === 'note') {
        shapeElement = h('g', {
          className: 'fr-ann-shape',
          ...(preview ? { pointerEvents: 'none' } : { onPointerDown: (event) => { event.stopPropagation(); onSelect(annotation) } }),
        },
          h('circle', {
            cx: x,
            cy: y,
            r: selected ? 24 : 20,
            fill: annotation.color || '#ff4d4f',
            stroke: '#fff',
            strokeWidth: 4,
            vectorEffect: 'non-scaling-stroke',
          }))
      } else {
        shapeElement = h('rect', {
          ...common,
          x: left,
          y: top,
          width: Math.max(2, width),
          height: Math.max(2, height),
          rx: 7,
        })
      }
      return h('g', {}, shapeElement)
    }

    function FeedbackPanel({
      data,
      selected,
      selectedAnn,
      drafts,
      summary,
      setSummary,
      onClose,
      onSelect,
      onSelectNode,
      onChangeText,
      onDelete,
      onSubmit,
      submitting,
      onConfirm,
      onRetryDelivery,
      onRefresh,
      notify,
    }) {
      const [tab, setTab] = useState('drafts')
      const modifiedBatches = data.batches.filter((batch) => batch.status === 'modified')
      return h('aside', { className: 'fr-panel fr-panel--right', onPointerDown: (event) => event.stopPropagation() },
        h('div', { className: 'fr-panel-head' },
          h('span', {}, '本轮反馈 ', h('small', {}, `${drafts.length} 草稿`)),
          h('div', { style: { display: 'flex', gap: 4 } },
            h('button', { type: 'button', className: 'fr-btn fr-btn--icon', title: '刷新', onClick: onRefresh }, '↻'),
            h('button', { type: 'button', className: 'fr-btn fr-btn--icon', onClick: onClose }, '×'))),
        h('div', { style: { display: 'flex', gap: 2, padding: '6px 10px 0' } },
          h('button', { type: 'button', className: 'fr-btn', 'data-active': tab === 'drafts', onClick: () => setTab('drafts') }, '草稿'),
          h('button', { type: 'button', className: 'fr-btn', 'data-active': tab === 'history', onClick: () => setTab('history') }, '历史与确认')),
        h('div', { className: 'fr-panel-scroll' },
          tab === 'drafts'
            ? h('div', {},
                selectedAnn
                  ? h('div', {},
                      h('div', { className: 'fr-field-label' }, '正在编辑'),
                      h('div', { className: 'fr-item', 'data-selected': 'true' },
                        h('div', { className: 'fr-item-meta' },
                          h('span', {}, targetLabel(data, selectedAnn)),
                          h('span', { className: 'fr-status', 'data-status': selectedAnn.status }, statusLabel(selectedAnn.status))),
                        h('textarea', {
                          className: 'fr-textarea',
                          value: selectedAnn.text,
                          placeholder: '写下这里的问题或希望怎么改…',
                          autoFocus: true,
                          onChange: (event) => onChangeText(selectedAnn, event.target.value),
                        }),
                        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 } },
                          h('span', { style: { color: 'var(--fr-muted)', fontSize: 10 } }, `自动保存 · ${timeAgo(selectedAnn.updatedAt)}`),
                          selectedAnn.status === 'draft'
                            ? h('button', { type: 'button', className: 'fr-btn fr-btn--danger', onClick: () => onDelete(selectedAnn) }, '删除草稿')
                            : null),
                        (selectedAnn.replies ?? []).map((reply, index) =>
                          h('div', { key: index, className: 'fr-reply' }, reply.text)),
                        selected ? h('button', {
                          type: 'button',
                          className: 'fr-btn',
                          style: { marginTop: 8 },
                          onClick: () => onSelectNode(selected),
                        }, `定位到 ${selected.title} · ${selected.variant}`) : null))
                  : h('div', {},
                      h('p', { style: { color: 'var(--fr-muted)', margin: '2px 0 10px' } }, '点选一条草稿继续编辑，或在画布上圈出新反馈。'),
                      drafts.length === 0 ? h('div', { style: { color: 'var(--fr-muted)', padding: '18px 0', textAlign: 'center' } }, '还没有草稿批注') : null,
                      drafts.map((annotation) =>
                        h('button', {
                          key: annotation.id,
                          type: 'button',
                          className: 'fr-item-button',
                          'data-selected': selectedAnn?.id === annotation.id,
                          onClick: () => onSelect(annotation),
                        },
                          h('div', { className: 'fr-item-meta' },
                            h('span', {}, targetLabel(data, annotation)),
                            h('span', {}, timeAgo(annotation.createdAt))),
                          h('div', { className: 'fr-item-text' }, annotation.text || '（尚未填写文字）'))),
                      h('label', { className: 'fr-field-label', htmlFor: 'fr-summary' }, '本轮补充说明（可选）'),
                      h('textarea', {
                        id: 'fr-summary',
                        className: 'fr-textarea',
                        value: summary,
                        placeholder: '例如：优先处理布局拥挤和按钮层级，颜色下一轮再看。',
                        onChange: (event) => setSummary(event.target.value),
                      })))
            : h('div', {},
                modifiedBatches.length > 0
                  ? h('div', { style: { marginBottom: 10 } },
                      h('div', { className: 'fr-field-label' }, '待你确认'),
                      modifiedBatches.map((batch) =>
                        h('div', { key: batch.id, className: 'fr-batch' },
                          h('div', { className: 'fr-batch-head' },
                            h('strong', {}, `第 ${batch.number} 轮`),
                            h('span', { className: 'fr-status', 'data-status': batch.status }, statusLabel(batch.status))),
                          h('p', {}, `AI 已发布 ${batch.responseVersionIds.length} 个新版本，确认问题解决后可以标记已确认。`),
                          h('button', { type: 'button', className: 'fr-btn', style: { marginTop: 7 }, onClick: () => onConfirm(batch) }, '确认已解决'))))
                  : null,
                h('div', { className: 'fr-field-label' }, '反馈批次'),
                data.batches.length === 0
                  ? h('p', { style: { color: 'var(--fr-muted)' } }, '提交第一轮后，处理记录会出现在这里。')
                  : null,
                [...data.batches].reverse().map((batch) =>
                  h('div', { key: batch.id, className: 'fr-batch' },
                    h('div', { className: 'fr-batch-head' },
                      h('strong', {}, `第 ${batch.number} 轮 · ${timeAgo(batch.createdAt)}`),
                      h('span', { className: 'fr-status', 'data-status': batch.status }, statusLabel(batch.status))),
                    h('p', {}, `${batch.annotationIds.length} 条批注 · ${batch.delivery?.status === 'delivered' ? '已送达对话' : batch.delivery?.status === 'failed' ? '未唤醒对话' : '等待送达'}`),
                    batch.summary ? h('p', {}, batch.summary) : null,
                    batch.delivery?.error ? h('p', { className: 'fr-error' }, batch.delivery.error) : null,
                    batch.delivery?.status === 'failed'
                      ? h('button', { type: 'button', className: 'fr-btn', style: { marginTop: 7 }, onClick: () => onRetryDelivery(batch) }, '重试唤醒对话')
                      : null))))
        ,
        h('div', { className: 'fr-panel-foot' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 } },
            h('span', { style: { color: 'var(--fr-muted)', fontSize: 11 } }, `${drafts.length} 条草稿`),
            h('button', { type: 'button', className: 'fr-btn', onClick: () => notify('直接点画布上的页面，可以开始圈画', 'info') }, '怎么批注？')),
          h('button', { type: 'button', className: 'fr-btn fr-btn--primary', style: { width: '100%' }, disabled: submitting, onClick: onSubmit }, submitting ? '提交中…' : '提交本轮反馈')))
    }

    function cryptoRandom() {
      try {
        return crypto.randomUUID()
      } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`
      }
    }

    let ctx
    let sidebarController

    const apply = (clientContext) => {
      ctx = clientContext
      clientContext.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-frontend-review'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'frontend-review: styles')

      clientContext.inject(['slots'], (slotCtx) => {
        slotCtx.effect(() => slotCtx.slots.inject('tool.call.toolview', () => slotCtx.slots.register({
          name: 'tool.call.toolview',
          key: 'review_open',
        }, ReviewOpenRow)), 'frontend-review: open tool row')

        slotCtx.effect(() => slotCtx.slots.inject('conversation.composer.dock', () => slotCtx.slots.register({
          name: 'conversation.composer.dock',
          id: 'frontend-review-dock',
          order: 40,
        }, DockButton)), 'frontend-review: composer entry')
      })

      clientContext.inject(['slots', 'sidebarRightTabs', 'sidebarRight'], (sideCtx) => {
        sidebarController = sideCtx.get('sidebarRight')
        sideCtx.effect(() => () => {
          sidebarController = undefined
        }, 'frontend-review: sidebar controller')
        sideCtx.effect(() => sideCtx.sidebarRightTabs.register({
          id: PANEL_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => '前端评审画布',
        }), 'frontend-review: tab type')

        sideCtx.effect(() => sideCtx.slots.inject('sidebar.right.pane.tab', () => sideCtx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: PANEL_ID,
          inject: (sessionId) => ({ sessionId }),
        }, Canvas)), 'frontend-review: canvas body')
      })
    }

    return { apply }
  },
})
