---
name: frontend-review
description: 当用户要预览前端页面、比较设计方案、做视觉评审，或评审画布提交了一批圈画/文字反馈需要继续修改时使用。Use when the user asks to visually review or compare frontend pages/designs, annotate screenshots, or when a frontend review canvas batch has been submitted and the bound conversation must inspect it and publish the next fixed version.
---

# 前端评审画布

这个 Skill 把「看页面、圈问题、改代码、看下一版」串成一条可回看的链路。画布和反馈由 `review_*` 工具管理；写代码仍然使用本会话已有的文件、终端和浏览器工具。

## 何时进入

- 用户说「把首页/列表页/设置页拿进来看看」「比较 A/B 方案」「做一个视觉评审」「我在页面上圈一下」。
- 对话收到 `[前端评审画布]` 反馈批次消息，或用户明确要求读取画布反馈。
- 需要把修改前后的前端结果固定成可对比版本。

不要因为普通的「实现一个页面」就打开画布；用户要的是可圈画、可对比的评审现场时才使用。

## 标准流程

1. **先开会话画布**：调用 `review_open`。同一个项目 + 对话只会有一个默认画布；不要重复新建。工具返回 `reviewId`、`revision` 和画布入口。
2. **导入页面**：调用 `review_import`。默认优先：
   - 项目正在运行的页面：`source: { kind: "url", url: "http://127.0.0.1:..." }`，会截取固定 PNG。
   - 已有静态 HTML：`source: { kind: "html", path: "..." }`。
   - 设计图/参考图：`source: { kind: "image", path: "..." }`。
   同一页面不同方案用相同 `pageKey`、不同 `variantKey`；不同业务模块用 `sectionTitle` 分区。
3. **整理但不要乱动**：`review_arrange` 默认按「模块分区、页面/方案横排、版本按轮次下移」排布。用户锁定过的位置必须保留；局部整理时只传要变的 placements。
4. **等待用户提交**：批注是用户的操作，不要替用户编造圈画，也不要把一个没有文字的圈自动解释成「删除/放大」。用户提交后，宿主会把批次作为 follow-up 送回绑定对话。
5. **读取反馈**：先调用 `review_get_feedback` 拿到批次、原文、目标页面/方案/版本和归一化坐标；只对需要看图的批注调用 `review_get_evidence`。默认先读文字和缩略证据，再按需读取原始截图，避免一次塞入全部历史。
6. **修改代码**：使用本会话的编辑/终端工具。保持原页面可运行；不要为了截图而破坏开发服务器。
7. **发布固定新版本**：修改完成后调用 `review_publish`：
   - 用**相同的** `pageKey` 和 `variantKey`，新版本会自动排到该方案下面。
   - 传 `respondsTo: ["<batchId>"]`，把这一版和反馈批次关联。
   - 传 `note` 简述改了什么。
   - 未修改的页面不要重复发布；画布会保留它们的旧版本。
8. **回报状态**：`review_update_feedback` 可把批次标为 `processing`、`needs-info`、`modified` 或 `deferred`。`confirmed` 只能由用户在画布点击确认，不能代替用户确认。
9. **继续下一轮**：用户在新版本上继续圈画并提交，重复第 5 步。

## 硬规则

- **固定版本不可覆盖**：已发布版本的 PNG、HTML、页面尺寸和状态保持不变。不要用同一个 `versionId` 替换截图。
- **截图失败不算已修改**：`review_publish` 返回 `status: "failed"` 时，反馈不能被说成已修复。检查开发服务器、页面登录态或换用 HTML/图片源后重试。
- **同一发布要可重试**：网络或客户端重试时复用同一个 `idempotencyKey`，避免重复版本行。
- **保留用户原文**：回复用 `review_update_feedback` 追加，不要覆盖 `annotation.text`。
- **位置锁定**：自动整理必须尊重 `locked: true`；新增页面不能打乱已锁定布局。
- **状态诚实**：只有发布成功的新版本才能把反馈标为 `modified`；只有用户能标 `confirmed`。
- **不要伪造图片**：没有真实截图就明确说明，不能把示意图当作页面证据。

## 工具速查

| 工具 | 用途 |
|---|---|
| `review_open` | 创建/恢复当前对话绑定的画布，并打开右侧面板 |
| `review_import` | 批量导入页面、方案、参考图；生成第一版固定截图 |
| `review_publish` | 发布修改后的固定新版本，关联反馈批次，旧版保留 |
| `review_arrange` | 分区、归组、移动、锁定、自动对齐 |
| `review_read` | 读取画布结构、版本、位置、锁定和反馈计数 |
| `review_get_feedback` | 读取反馈批次、原文、目标版本和坐标 |
| `review_get_evidence` | 读取指定反馈的标注截图与定位信息 |
| `review_update_feedback` | 回复批注、更新处理状态、关联新版本 |

详细参数和返回字段见 `references/tools.md`；页面导入与截图的边界见 `references/importing.md`；排布规则见 `references/layout.md`；异常处理见 `references/troubleshooting.md`。

## 和用户沟通

- 导入完成：一句话说明导入了几个页面/方案，截图成功还是失败。
- 收到反馈：先用一句话复述要处理的核心问题，再开始改；不要逐条复述所有批注。
- 发布完成：说明新版本在第几轮、哪些页面变了、哪些沿用了上一版。
- 无法截图/无法唤醒对话：直接说明原因和下一步，不要假装成功。
