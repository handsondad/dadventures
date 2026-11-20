# AGENTS.md

这个仓库保存一个人的微信读书笔记，并把它们整理成可检索、能回到来源的 Markdown 知识库。

## 目录

| 位置 | 内容 |
| --- | --- |
| `.weread-sync/raw_notes/<书>/raw.json` | 从微信读书同步的原始数据（划线、想法、章节）。不要手工改 |
| `notes/<类别>/<书>.md` | 按书导出的 Markdown 阅读档案。不要改 |
| `kb/` | 知识库：`sources/books`、`sources/notes`、`concepts`、`actions`、`collections`、`ideas`，每类下面按主题域分目录；另有 `_templates/`、`taxonomy/`、`_reports/` |
| `.weread-sync/scripts/` | 同步（`sync_final.py`）、转 Markdown（`json2md.py`）、校验（`validate_knowledge.py`） |
| `dsh/` | DeepSeek Harness 插件：读书问答模式和读书整理模式，见 `dsh/README.md` |

## 知识库的规则

规则只写在一处：`kb/AGENTS.md`（先查哪里、怎么回答、怎么写回），流程标准在 `kb/IDEA_CAPTURE_WORKFLOW.md`，受控词表在 `kb/taxonomy/taxonomy.md`，目录和字段说明在 `kb/README.md`。写卡片前先读它们；在 DSH 的读书整理模式里它们是 skill `kb-rules`、`kb-workflow`、`kb-taxonomy`。

最容易出错的几条：

- 写回顺序是书目卡 → 来源笔记 → 概念卡 / 行动卡 → 主题包 → 想法种子，不跳过来源层。
- 新卡 `schema_version: 2`、`status: draft`，id 是 `类型-主题域-四位编号`，文件名 `<id>-<english-slug>.md`。
- 不改已有卡片的 id 和文件名；旧卡（id 形如 `concept-0068`）不要加 `schema_version: 2`。
- 引用同一主题域的卡写 id，别的主题域写 `主题域/id`：旧的短 id 在不同主题域里会重复。
- 不伪造书名、作者、章节、页码或引文；读者当时的想法、书里的观点和归纳分开写；不整段照抄原文。

## 命令

在仓库根目录运行，Node.js 24 以上，不需要 `npm install`：

```powershell
npm run kb:check                                   # 校验知识库（改完卡片后运行）
npm run kb -- --list                               # 知识库和原始笔记的命令行工具
python .weread-sync\scripts\validate_knowledge.py  # Python 校验器，规则相同
npm test                                           # 插件测试，含真实数据检查
python -m unittest discover -s .weread-sync\tests  # 同步脚本测试
```

## 注意

- `.weread-sync/raw_notes/` 和 `notes/` 是个人阅读数据，不要复制到仓库外或贴到外部服务。
- 微信读书 API Key 只从环境变量 `WEREAD_API_KEY` 读取：不要写进任何文件，也不要显示它的值。
- 不要自行 `git commit` 或 `git push`，除非用户要求。
- 改了 `dsh/packages/dsh-weread-kb/` 的代码后要重跑 `dsh/scripts/install-dadventures.ps1` 再重启 DSH，Profile 里装的是副本。`install-dadventures.ps1` 只能用 ASCII 字符。
