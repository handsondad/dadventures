# IDEA_CAPTURE_WORKFLOW.md

## 目标

把微信读书笔记原始内容逐步整理成：

1. 可检索的来源笔记
2. 可复用的概念卡和动作卡
3. 可持续积累的主题包
4. 可继续延展的想法卡和碎片线索

## 标准流程

### 第一步：整理来源笔记

- 从仓库根目录 `微信读书笔记/` 选择一本阅读档案；必要时回查 `.weread-sync/raw_notes/` 中的原始 JSON
- 创建 `source_book`
- 按章节、主题或问题簇创建 `source_note`，保存 `bookId`、`reviewId`/划线 ID、章节名、chapterUid、range 等可用定位字段
- 每张 `source_note` 至少补齐：核心摘要、原始定位、可引用片段、我的想法、可延展的想法火花

### 第二步：拆概念卡和动作卡

- 适合解释“这是什么意思”的内容，拆成 `concept_card`
- 适合回答“怎么做”的内容，拆成 `action_card`
- 每张卡都尽量补 `scenes`、`problems`、`idea_sparks`

### 第三步：做主题包

- 围绕一个明确问题整理 `collection`
- 主题包必须能回答：为什么值得积累、适合放在哪类场景下调用、可用哪些引用、你的角度是什么
- 一个主题包最好控制在 3-8 张关联卡片内，避免过散

### 第四步：沉淀想法卡

- 当主题包稳定后，在 `ideas/` 中创建 `idea_seed`
- 先写触发问题和闪光点，再写碎片想法与可继续补充的方向
- 区分“书中观点”“你的转述”“你的判断”
- 不要直接把它写成播客稿、文章稿或口播稿

## 检索入口建议

### 入口 A：从主题出发

- 适合已经知道自己想继续追哪条线
- 检索顺序：`collections/` -> `ideas/` -> `concepts/` -> `actions/` -> `sources/notes/`

### 入口 B：从场景和问题出发

- 适合还没收敛成主题
- 检索顺序：按 `scenes`、`problems` 过滤，再看 `collections/`、`ideas/` 和 `sources/notes/`

### 入口 C：从某本书出发

- 适合想把一本书拆成多个主题和想法种子
- 检索顺序：`sources/books/` -> `sources/notes/` -> `concepts/` / `actions/` -> `collections/` -> `ideas/`

## 最小可用标准

一张可用的 `source_note` 至少要有：

- 1 段核心摘要
- 1 个可搜索定位线索
- 1 个可引用短片段
- 1 条你的想法

一张可用的主题包至少要有：

- 1 个核心问题
- 3 个关联条目
- 2 个可用引用线索
- 1 个你的角度

一张可用的想法卡至少要有：

- 1 个触发问题
- 3 条闪光点
- 1 组可用引用线索
- 明确的来源说明

## 来源回链与复核

- 每条观点至少关联一个 `source_note`；来源笔记尽量关联 `source_book`。
- 优先保留微信读书条目 ID 与章节/range，并在有定位数据时使用 `weread://` 深链接；章节短句仅作为补充定位，不替代来源 ID。
- 写入知识卡前核对书名、作者和章节；清楚标记直接书摘、个人笔记、跨书综合或个人推断。
- 复核后将状态从 `draft` 改为 `reviewed`；经确认可稳定复用后再改为 `published`，并更新 `last_reviewed`。
- 新建内容使用模板的 `schema_version: 2`，完成后运行 `python .weread-sync/scripts/validate_knowledge.py`。