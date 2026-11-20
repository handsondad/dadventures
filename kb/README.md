# 知识库（kb）

围绕微信读书个人笔记建立的 Markdown 知识库。目标不是把划线堆在一起，而是把值得长期复用的内容整理成有来源、有边界、能检索的知识单元。

## 目录

```text
kb/
  sources/books/<主题域>/     书目卡 source_book：一本书的来源、主题和整理进度
  sources/notes/<主题域>/     来源笔记 source_note：章节或问题簇的摘要、定位线索和个人想法
  concepts/<主题域>/          概念卡 concept_card：这是什么意思、为什么重要
  actions/<主题域>/           行动卡 action_card：判断规则、步骤和检查清单
  collections/<主题域>/       主题包 collection：围绕一个问题聚合几张卡，可以跨书
  ideas/<主题域>/             想法种子 idea_seed：还待验证或继续发展的个人想法
  taxonomy/taxonomy.md        受控词表（主题域、各类卡片的类型、状态等）
  _templates/                 六类卡片的模板
  _reports/                   历史记录，不是知识内容
  AGENTS.md                   规则：先查哪里、怎么回答、怎么写回
  IDEA_CAPTURE_WORKFLOW.md    整理流程和每类卡片的最小可用标准
```

原始笔记不在这里：Markdown 阅读档案在仓库根目录的 `notes/<类别>/<书>.md`，同步下来的原始数据在 `.weread-sync/raw_notes/<书>/raw.json`。卡片只引用它们，不复制整本内容。

## 卡片

一个文件一张卡：YAML frontmatter 加正文。每张卡都有 `doc_type`、`id`、`status`，其余字段照 `_templates/` 里对应的模板写。

| 约定 | 说明 |
| --- | --- |
| ID | 新卡 `类型-主题域-四位序号`（如 `concept-investing-0072`），并写 `schema_version: 2`。旧卡是 `concept-0068` 这样的短 ID，只在自己的主题域里唯一，保持不变 |
| 文件名 | `<ID>-<english-slug>.md`，只用 ASCII |
| 引用 | 同一主题域写 ID，别的主题域写 `主题域/ID`（如 `parenting/concept-0068`） |
| 来源链路 | 概念卡、行动卡用 `source_refs` 指向来源笔记；来源笔记用 `source_book` 指向书目卡（人工综合写 `manual_synthesis`）；主题包用 `included_cards`；想法种子用 `theme_refs` |
| 状态 | `draft`（默认）→ `reviewed`（内容和来源核对过）→ `published`（确认可稳定复用） |
| 受控字段 | `subject_domains`、`note_kind`、`concept_type`、`action_type`、`claim_basis`、`audiences`、`use_cases`、`effort`、`time_horizon`、`collection_kind`、`idea_kind`、`status` 只用词表里的值 |
| 路径 | 写相对仓库根目录的路径，不写本机绝对路径 |

书目卡另外记录这本书的原始来源：

| 字段 | 含义 |
| --- | --- |
| `raw_source_path` | 这本书的原始笔记，例如 `notes/投资/周期.md` |
| `weread_book_id` | 微信读书的 bookId（同步数据里有时填写） |
| `author` | 作者，按微信读书给出的写法 |
| `note_count` | 仓库里这本书的笔记条数：一条划线或一条想法（连同它的原文）算一条 |

## 整理原则

- 先保留原始来源，再做摘要与抽象；知识卡必须能回到来源笔记或书目卡。
- 区分书中主张、个人转述与个人判断；没有页码时用章节名、微信读书条目 ID 或可搜索短句定位，不编造页码。
- 优先保留短引用、定位信息和转述，不复制大段原文。
- 一个文件只表达一个知识单元；相近主题通过引用和主题包关联。

## 校验

在仓库根目录运行：

```powershell
npm run kb:check                                   # 错误 + 提醒（文件名、目录、来源链路、失效链接等）
python .weread-sync\scripts\validate_knowledge.py  # 只报错误，规则与上面相同
```

`schema_version: 2` 的卡会按词表严格检查。旧卡的受控字段里还有一些词表之外的历史取值，加 `--strict`（Python 校验器是 `--strict-taxonomy`）可以列出来。

## 使用入口

- 在 DeepSeek Harness 里问答和整理：仓库根目录 [dsh/README.md](../dsh/README.md)
- 同步微信读书、转 Markdown：[.weread-sync/README.md](../.weread-sync/README.md)
