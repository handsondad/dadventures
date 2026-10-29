# 微信读书知识库

这是一个围绕微信读书个人笔记建立的 Markdown 知识库。它的目标不是把划线堆在一起，而是把值得长期复用的内容整理成有来源、有边界、能检索的知识单元。

## 知识层次

| 层次 | 目录 | 用途 |
|---|---|---|
| 书目 | `openclaw/workspace/sources/books/` | 记录书籍、阅读来源和整理进度 |
| 来源笔记 | `openclaw/workspace/sources/notes/` | 保留章节摘要、个人想法和定位线索 |
| 概念卡 | `openclaw/workspace/concepts/` | 回答“这是什么意思、为什么重要” |
| 行动卡 | `openclaw/workspace/actions/` | 沉淀判断规则、步骤和检查清单 |
| 主题包 | `openclaw/workspace/collections/` | 聚合多个来源和知识卡，回答跨书主题问题 |
| 想法种子 | `openclaw/workspace/ideas/` | 保存尚待验证或继续发展的个人想法 |

## 微信读书导入

同步脚本位于仓库根目录的 `.weread-sync/scripts/`：

1. `sync_final.py` 获取有笔记的书籍、个人划线和想法/点评，并保留来源 ID 与章节定位。
2. `json2md.py` 将原始 JSON 生成为按书阅读的 Markdown 副本。
3. 人工审核后，按工作流将内容沉淀到本目录下的来源笔记和知识卡。

完整命令和 API 数据范围见仓库根目录的 [.weread-sync/README.md](../.weread-sync/README.md)。

## 整理原则

- 先保留原始来源，再做摘要与抽象；知识卡必须能回到来源笔记或书目。
- 区分书中主张、个人转述与个人判断；没有页码时使用章节名、微信读书条目 ID 或可搜索短句定位，不编造页码。
- 优先保留短引用、定位信息和转述，不复制大段原文。
- 一个文件只表达一个知识单元；相近主题通过引用和主题包关联，不把所有内容塞入同一张卡。
- 状态仅使用 `draft`、`reviewed`、`published`；通过模板逐步采用受控 taxonomy 与 schema 校验。

## 常用入口

- 工作区规则：`openclaw/workspace/AGENTS.md`
- 整理流程：`openclaw/workspace/IDEA_CAPTURE_WORKFLOW.md`
- 受控词表：`openclaw/workspace/taxonomy/taxonomy.md`
- 模板：`openclaw/workspace/_templates/`
- OpenClaw 接入说明：`openclaw/README.md`
