# 工具参数与返回

所有工具都在当前 Harness 对话中调用。`reviewId` 可以省略；省略时使用当前会话 + 当前项目绑定的默认画布。

## review_open

```json
{ "title": "首页与设置页评审" }
```

返回：`reviewId`、`title`、`created`、`revision`、`counts`、`panel`、`autoOpen`、`openedAt`、`sessionId`。
同一对话重复调用不会新建第二个默认画布。画布右侧面板由客户端自动打开；如果用户关掉了，工具卡上的「打开画布」仍可恢复。

## review_import

```json
{
  "reviewId": "rv_...",
  "idempotencyKey": "import-home-2026-01-01",
  "pages": [
    {
      "pageKey": "home",
      "title": "首页",
      "variantKey": "a",
      "variantName": "A 方案",
      "sectionTitle": "首页",
      "source": { "kind": "url", "url": "http://127.0.0.1:5173/" },
      "viewport": { "width": 1440, "height": 900 },
      "note": "当前开发版"
    },
    {
      "pageKey": "home",
      "title": "首页",
      "variantKey": "b",
      "variantName": "B 方案",
      "sectionTitle": "首页",
      "source": { "kind": "html", "path": "C:/project/prototype/home-b.html" }
    }
  ]
}
```

`source` 的四种形式：

| kind | 必填 | 行为 |
|---|---|---|
| `url` | `url` | http(s) 页面；用 Chromium 在指定视口截取固定 PNG |
| `html` | `html` 或 `path`/`htmlPath` | 保存 HTML，截图；可带 `baseUrl` 让相对资源可加载 |
| `image` | `path`/`imagePath` 或 `dataUrl` | 复制 PNG/JPEG/GIF/WebP 作为固定画面 |
| `existing` | 无 | 复制最近一个固定版本（用于只改说明、不换画面的发布） |

`source.capture: false` 只对 `url` 有效：创建 `live` 版本，不产生固定截图。这种版本可互动但不能作为「已修复」的证据。

## review_publish

```json
{
  "reviewId": "rv_...",
  "respondsTo": ["fb_..."],
  "idempotencyKey": "publish-home-a-r2",
  "note": "收紧了卡片间距，重做了筛选栏层级",
  "pages": [
    {
      "pageKey": "home",
      "title": "首页",
      "variantKey": "a",
      "variantName": "A 方案",
      "sectionTitle": "首页",
      "source": { "kind": "url", "url": "http://127.0.0.1:5173/" }
    }
  ]
}
```

返回 `imported[]` 里有 `versionId`、`version`、`status`、`snapshot`、`error`。`status` 不是 `ready` 时不能把反馈标记为已修改。

## review_arrange

```json
{
  "reviewId": "rv_...",
  "expectedRevision": 12,
  "mode": "auto",
  "sections": [
    { "id": "sec_home", "title": "首页", "order": 0 },
    { "title": "设置", "order": 1 }
  ],
  "placements": [
    { "versionId": "v_...", "sectionId": "sec_home", "locked": true }
  ]
}
```

- `mode: "auto"` 重新计算未锁定卡片的位置；`locked: true` 的位置保留。
- `mode: "manual"` 只应用 placements，不重排。
- `expectedRevision` 用来防止覆盖用户刚做的移动；冲突会返回当前 revision。

## review_read

无参数即可。返回 `canvas`：`title`、`revision`、`round`、`sections`（含 `bounds`）、`nodes`（每个版本的页面、方案、版本号、状态、坐标、锁定、草稿数）、`annotations`、`batches`。

## review_get_feedback

```json
{ "reviewId": "rv_...", "batchId": "fb_...", "includeDrafts": false }
```

- 不传 `batchId` 时读取所有批次（含已读历史）；用 `sinceBatchId` 只看某批次之后的新反馈。
- 每条批注包含 `id`、`text`、`kind`、`geometry`、`status`、`page/variant/version`。
- 读取后画布会记录 `lastReadBatchNumber`，便于下次判断哪些是新批次。

## review_get_evidence

```json
{
  "reviewId": "rv_...",
  "annotationIds": ["an_..."],
  "includeImages": true
}
```

返回 `items[]`（文字、坐标、目标版本、错误）和 `images[]`（已附加到上下文的标注截图）。图片是原截图上叠加了该版本所有已提交批注的合成图；不带 `annotationIds` 时读取最近一个未确认批次。

坐标是**页面图像归一化坐标**：`x/y/w/h` 为 0–1，原点左上。arrow 的 `w/h` 可以为负，表示方向。

## review_update_feedback

```json
{
  "reviewId": "rv_...",
  "batchId": "fb_...",
  "status": "modified",
  "reply": "已调整卡片间距，并修复了空状态。",
  "versionIds": ["v_..."],
  "expectedRevision": 18
}
```

允许的 agent 状态：`processing`、`modified`、`needs-info`、`deferred`。
`modified` 要求批次已经通过 `review_publish` 关联了新版本。
`confirmed` 是用户专属动作；工具调用会被拒绝。
