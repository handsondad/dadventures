# 微信读书知识库规则

`kb/` 是围绕微信读书笔记建立的 Markdown 知识库：读书笔记的整理、概念提炼、主题聚合、想法捕捉和写回都按这份规则做。目录和字段说明见 `README.md`，整理流程和最小可用标准见 `IDEA_CAPTURE_WORKFLOW.md`，受控词表见 `taxonomy/taxonomy.md`。

## 主要任务

- 解释某个概念、观点、作者主张或跨书主题
- 比较不同书籍对同一主题的异同
- 在需要行动建议时，返回可执行的方法、判断规则或检查清单
- 基于场景和问题，定位相关主题、引用线索和个人想法
- 把原始笔记整理成 `source_note`、`concept_card`、`action_card`、`collection` 或 `idea_seed`
- 把新的结论写回知识库，而不是只停留在聊天里

## 先查哪里

| 用户在问 | 依次查 |
| --- | --- |
| 这是什么意思、怎么理解这个观点 | `concepts/` → `sources/notes/` → `collections/` → `sources/books/` |
| 具体怎么做、怎么判断 | `actions/` → `collections/` → `concepts/` → `sources/notes/` |
| 这个场景和问题有哪些相关主题 | `collections/` → `actions/` → `concepts/` → `sources/notes/` |
| 围绕这个主题有哪些闪光点、碎片想法，或为后续表达做准备 | `collections/` → `ideas/` → `concepts/` → `actions/` → `sources/notes/` |
| 这本书是怎么说的 | `sources/notes/` → 原始笔记（仓库根目录 `notes/` 和 `.weread-sync/raw_notes/`）→ `sources/books/` → `concepts/` |
| 不同的书怎么比较 | `concepts/` → `collections/` → `sources/notes/` → `sources/books/` |

`_templates/`、`taxonomy/`、`_reports/` 不是知识内容，不要把它们当作答案来源。

## 回答原则

- 默认使用中文回答
- 优先使用 `reviewed` 或 `published` 的内容；只有 `draft` 时照用，但说明是草稿
- 问“怎么做”优先返回行动卡，而不是长篇理论；问“怎么理解”优先返回概念卡
- 问“延展主题”先给主题包，再给想法种子或碎片线索
- 问“找相关素材”至少返回主题、来源、可引用片段线索和个人想法摘要
- 不伪造书籍、作者、页码或研究依据；微信读书导出没有页码时，保留章节名和可搜索短句
- 引用要克制：优先短定位片段和转述，不堆砌长原文
- 知识库里没有完全匹配的内容时，可以基于已有内容做整理草案，但要明确标注是“基于现有知识库整理的草案”
- 不默认把整理结果写成成品稿或口播稿，优先停在可复用的想法层

## 回答结构

解释概念：核心定义 → 为什么重要 → 关键判断 → 常见误解或边界 → 跨书对照 → 来源说明。

推荐方法或动作：适用场景 → 目标 → 执行步骤 → 关键判断规则或话术 → 不适用场景 → 观察信号 → 来源说明。

主题梳理：核心问题 → 相关主题 → 可用引用线索 → 你的想法或切入角度 → 可继续展开的结构。

整理想法种子：想法摘要 → 触发问题 → 闪光点 → 可用引用线索 → 个人观点与延展 → 可继续补充的方向。

## 澄清策略

用户没有说清楚时，只补问最关键的一个问题，优先顺序：

1. 主题或问题
2. 要找素材、做主题包，还是沉淀想法种子
3. 要单本书视角还是跨书整理
4. 要简答、结构化笔记，还是后续表达准备用的材料

## 写回知识库的规则

- 一文件一单元；不把多本书、多个不相关主题塞进同一张卡
- 受控字段只用 `taxonomy/taxonomy.md` 里的值；新增高频标签前先更新词表
- 状态只用 `draft`、`reviewed`、`published`。新卡是 `draft`；内容和来源都核对过才改 `reviewed`；确认可以稳定复用才改 `published`，同时更新 `last_reviewed`
- 新卡写 `schema_version: 2`，ID 用 `类型-主题域-四位序号`（例如 `concept-investing-0072`），文件名 `<ID>-<english-slug>.md`，只用 ASCII
- 旧卡（没有 `schema_version`，ID 形如 `concept-0068`）保持旧格式：不改 ID 和文件名，也不加 `schema_version: 2`
- 引用同一主题域的卡片写 ID；引用别的主题域的卡片写 `主题域/ID`（例如 `parenting/concept-0068`），因为旧的短 ID 在不同主题域里会重复
- 原始导出不是知识单元，不把整本书复制进 `concepts/`、`actions/` 或 `ideas/`
- 文件路径一律写相对仓库根目录的路径（例如 `notes/投资/周期.md`），不写本机绝对路径
- 写完运行校验（见下），错误必须改完

根据新书摘写内容时，按这个顺序写回，不跳过来源层：

1. 书目卡不存在时，先在 `sources/books/` 下创建 `source_book`
2. 原始内容直接引用仓库里的 `notes/` 档案或 `.weread-sync/raw_notes/` 原始 JSON，不重复归档整本内容
3. 在 `sources/notes/` 下创建来源笔记，保留章节、短定位线索，以及可用的微信读书 `bookId`、`reviewId`、划线 ID 或 range
4. 创建对应的 `concept_card` 或 `action_card`，用 `source_refs` 指向来源笔记
5. 同一主题已经有多张卡时，整理成 `collection` 主题包
6. 主题包稳定后，在 `ideas/` 中沉淀 `idea_seed`

人工归纳、没有单本书来源的内容，先建一张 `source_book: manual_synthesis` 的来源笔记，在 `source_refs` 和正文里写明实际依据，不要写成书摘。

## 巡检清单

整理完一批内容，或定期维护时，看一遍：

- 有没有只有书目卡、没有来源笔记的书
- 有没有只有来源笔记、还没拆出概念卡或行动卡的高价值主题
- 有没有已有多张概念卡和行动卡、但还没有主题包的高频问题
- 有没有可以合并的重复概念卡
- 行动卡有没有写清适用场景和不适用边界
- 主题包有没有可用引用线索和个人角度
- 想法种子有没有来源说明和继续补充的方向
- 有没有频繁使用但还没进词表的标签

## 校验与工具

- 校验：仓库根目录运行 `npm run kb:check`，或 `python .weread-sync/scripts/validate_knowledge.py`（两者的错误规则相同）
- 在 DeepSeek Harness 的读书问答模式、读书整理模式里（见仓库 `dsh/README.md`），“先查哪里”对应 `kb_search` 的 `intent`（concept / howto / topic / ideas / book / compare）；读卡片用 `kb_read`，沿引用走用 `kb_links`；原始笔记用 `notes_books`、`notes_read`、`notes_search`；写卡片前用 `kb_schema` 取模板、编号和路径，写完用 `kb_check` 校验

## 风格

- 直接、清楚、可执行
- 少做空泛总结，多给可复用的定义、判断、问题和结构
- 对来源链路严格，对推断与原书结论的边界严格
