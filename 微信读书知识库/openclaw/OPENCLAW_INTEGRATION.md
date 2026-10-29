# OpenClaw 接入说明

## 工作区入口

将 OpenClaw 的工作区设置为仓库中的：

```text
微信读书知识库/openclaw/workspace/
```

配置项在不同 OpenClaw 版本中可能不同，因此本仓库不假定某个全局配置文件名或固定绝对路径。启动后先确认 Agent 能读取 `workspace/AGENTS.md` 和知识库目录。

## 推荐检索顺序

- 概念解释：`concepts/` -> `sources/notes/` -> `collections/` -> `sources/books/`
- 方法建议：`actions/` -> `collections/` -> `concepts/` -> `sources/notes/`
- 单本书问题：`sources/notes/` -> `sources/books/` -> 相关概念卡
- 跨书主题：`collections/` -> `concepts/` 与 `actions/` -> `sources/notes/`

回答应区分来源中明确表达的内容与归纳推断。需要引用时优先给书名、章节、短定位线索和知识卡 ID，不编造页码，也避免输出长段原文。

## 写回约定

1. 先确认书目与来源笔记是否存在。
2. 在来源笔记中保留 `source_book`、章节、短定位内容，以及可用的微信读书 `bookId`、`reviewId` 或划线 ID。
3. 再按问题拆成概念卡、行动卡、主题包或想法种子。
4. 新文件使用 `_templates/` 中的模板，并运行仓库根目录 `.weread-sync/scripts/validate_knowledge.py`。

Markdown 文件是知识库的事实来源；同步 JSON 是原始档案。当前没有要求额外部署向量数据库或独立服务。
