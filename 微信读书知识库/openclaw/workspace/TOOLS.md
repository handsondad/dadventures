# TOOLS.md - 本地知识库说明

这里记录的是这套微信读书笔记知识库的本地结构和使用约定。

## 关键路径

- 知识库根目录：当前目录
- 配置包说明：`../README.md`
- 总览入口：`../../README.md`
- 想法捕捉工作流：`IDEA_CAPTURE_WORKFLOW.md`
- 受控词表：`taxonomy/taxonomy.md`

## 内容目录

- `sources/books/`：书目信息、原始来源路径和整理进度
- `sources/notes/`：章节或主题摘要、问题簇摘要、引用线索和个人想法
- `concepts/`：概念、原理、框架、规律
- `actions/`：方法、规则、清单、习惯、提醒
- `collections/`：主题包、专题答案、比较包、阅读路径
- `ideas/`：主题种子、闪光点、碎片想法和待继续补充的方向
- `_templates/`：新建文件时参考，不作为答案来源

## 写回约定

- 新的原始内容先落到 `sources/books/` 和 `sources/notes/`
- 原始数据保存在仓库根目录的 `.weread-sync/raw_notes/`；阅读用 Markdown 副本位于 `微信读书笔记/`。只在确有需要时复制当前工作副本，不重复长期归档整本内容
- 对人工综合且没有单一本书来源的来源笔记，`source_book` 可标为 `manual_synthesis`，并在 `source_refs` 中列明实际来源
- 再创建对应的 `concept_card` 或 `action_card`
- 再围绕场景或问题整理 `collection` 主题包
- 最后在 `ideas/` 下沉淀 `idea_seed`
- 新文件 ID 与文件名使用 `类型-主题域-序号`，例如 `note-investing-0001-short-slug.md`，确保跨主题目录也可唯一引用
- 文件状态只用 `draft`、`reviewed`、`published`
- 新知识条目使用 `schema_version: 2`，写回后运行 `.weread-sync/scripts/validate_knowledge.py`

## 配置约定

- OpenClaw 工作区指向当前 `workspace/` 目录
- 本仓库不假定机器级 OpenClaw 配置文件路径；不要把本机绝对路径写进知识内容