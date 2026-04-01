# TOOLS.md - 本地知识库说明

这里记录的是这套微信读书知识库的本地结构和使用约定。

## 关键路径

- 知识库根目录：当前目录
- 配置入口：`../openclaw.json`
- 配置包说明：`../README.md`
- 总览入口：`../../README.md`
- OpenClaw 接入说明：`../OPENCLAW_INTEGRATION.md`
- 想法捕捉工作流：`IDEA_CAPTURE_WORKFLOW.md`
- 受控词表：`taxonomy/taxonomy.md`

## 内容目录

- `sources/raw/`：当前加工中的原始导入素材
- `sources/books/`：书目信息、原始来源路径和整理进度
- `sources/notes/`：章节或主题摘要、问题簇摘要、引用线索和个人想法
- `concepts/`：概念、原理、框架、规律
- `actions/`：方法、规则、清单、习惯、提醒
- `collections/`：主题包、专题答案、比较包、阅读路径
- `ideas/`：主题种子、闪光点、碎片想法和待继续补充的方向
- `_templates/`：新建文件时参考，不作为答案来源

## 写回约定

- 新的原始内容先落到 `sources/books/` 和 `sources/notes/`
- 需要 OpenClaw 直读原始文本时，把工作副本放入 `sources/raw/`
- 再创建对应的 `concept_card` 或 `action_card`
- 再围绕场景或问题整理 `collection` 主题包
- 最后在 `ideas/` 下沉淀 `idea_seed`
- 文件命名遵循 `book-0001-short-slug.md`、`note-0001-short-slug.md`、`concept-0001-short-slug.md`、`action-0001-short-slug.md`、`collection-0001-short-slug.md`、`idea-0001-short-slug.md`
- 文件状态只用 `draft`、`reviewed`、`published`

## 配置约定

- 不修改原有主配置
- 这套知识库的专用配置位于当前目录上一级