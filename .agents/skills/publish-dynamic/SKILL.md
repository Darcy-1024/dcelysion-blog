---
name: publish-dynamic
description: "在本博客创建或修改动态（src/content/dynamic），处理用户正文及可选图片附件。"
---

# 发布动态

完成可验证的动态内容，遵循仓库 AGENTS.md 的 Git 与 Sites 授权边界。

## 内容约定

- 正文、标点、表情保持用户原样；图片按用户指定顺序，否则按附件顺序。不擅自润色或添加标签。
- 在 `src/content/dynamic/` 创建不冲突的 `YYYY-MM-DD-HHmmss.md`；时间取 `siteConfig.timezone`，配置不可用才回退 `Asia/Shanghai`。
- 默认公开、不置顶、不填写位置。仅按用户要求添加 `draft`、`pinned` 或 `location`。最小 frontmatter：

```yaml
---
published: YYYY-MM-DD HH:mm:ss
---
```

- 图片使用 `![简短描述](./images/semantic-name.avif)`。有附件时阅读 [图片处理与验证](references/images.md)；纯文字任务不加载图片流程。

## 完成标准

确认文件符合当前内容 schema、正文与要求一致、时间及可选元数据正确、没有覆盖现有文件。选择能验证本次内容的检查；纯文字动态无需仅因本 Skill 而运行图片生成流程。涉及图片时完成参考中的构建与资产验证。

交付文件与验证结果。若用户尚未授权提交或推送，先交付本地结果再询问；已有本任务明确授权则按授权继续，不重复索要相同确认。只暂存任务文件，使用 Conventional Commits，并验证推送及配置的自动部署实际结果。Sites 各操作仍需根目录规定的单独确认。
