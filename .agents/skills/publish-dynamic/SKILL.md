---
name: publish-dynamic
description: "在本博客创建或修改动态（src/content/dynamic），处理用户正文及可选图片附件。"
---

# 发布动态

完成可验证的动态内容，遵循仓库 AGENTS.md 的 Git 与 Sites 授权边界。

## 修改既有动态

修改前先判断是否为 Memos 托管内容：核对 [同步器导出实现](../../../scripts/memos-sync/index.mjs) 与文件名 `YYYY-MM-DD-HHmmss-memos-<16位实例与记录摘要>.md`；当前导出文件没有额外的托管 frontmatter 标记。匹配该规则的内容应回到 Memos 源端编辑并经既有同步链更新，不直接改生成文件或私有映射；普通手写动态仍按本技能直接维护。若身份有疑问，先核实来源。涉及同步输出目录的人工维护，沿用 [同步锁与串行维护约定](../../../deploy/memos/SYNC.md#状态冲突与恢复)及[发布停写窗口](../../../deploy/memos/PUBLISH.md#一轮任务与重试)，不要抢占活锁。

## 内容约定

- 正文、标点、表情保持用户原样；图片按用户指定顺序，否则按附件顺序。不擅自润色或添加标签。
- 发布前检查正文是否有语法错误、语句不通顺或标点使用错误。发现疑似问题时，说明对应原句、问题和建议改法；注意区分错误与用户有意保留的口语、语气和风格。除非用户已明确授权修正，否则不直接改动正文；没有发现问题时也在交付结果中简要说明。
- 在 `src/content/dynamic/` 创建不冲突的 `YYYY-MM-DD-HHmmss.md`；时间取 `siteConfig.timezone`，配置不可用才回退 `Asia/Shanghai`。
- 手写动态的 `published` 保持下例无时区的墙钟格式，不擅加 `+08:00` 或 `Z`。[动态 API](../../../src/pages/api/dynamic.json.ts) 将 schema 的日期转为时间戳，[formatDynamicDate](../../../src/utils/date-utils.ts) 再按 UTC 输出年月日时分秒，添加偏移会改变显示值。Memos 导出的真实 ISO 时间仍遵循[同步契约](../../../deploy/memos/SYNC.md#导出规则)，不套用手写规则。
- 默认公开、不置顶、不填写位置。仅按用户要求添加 `draft`、`pinned` 或 `location`。最小 frontmatter：

```yaml
---
published: YYYY-MM-DD HH:mm:ss
---
```

- 图片使用 `![简短描述](./images/semantic-name.avif)`。有附件时阅读 [图片处理与验证](references/images.md)；纯文字任务不加载图片流程。

## 完成标准

确认文件符合当前内容 schema、正文与要求一致、时间及可选元数据正确、没有覆盖现有文件。选择能验证本次内容的检查；纯文字动态无需仅因本 Skill 而运行图片生成流程。涉及图片时完成参考中的构建与资产验证。

交付文件与验证结果。若用户尚未授权提交或推送，保留本地结果并说明未提交或未推送；只有完成用户要求的发布目标需要该授权时才询问。已有本任务明确授权则按授权继续，不重复索要相同确认。只暂存任务文件，使用 Conventional Commits，并验证推送及配置的自动部署实际结果。Sites 授权与确认方式以根目录规定为准。
