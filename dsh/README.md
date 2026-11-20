# DSH 接入：读书问答模式和读书整理模式

DSH 是 DeepSeek Harness（0.2.x，基于 cordis 插件系统）。本仓库给它加一个插件包和两个模式，两个模式读的是同一份数据：整理好的知识库（`kb/`）和原始笔记（`notes/`、`.weread-sync/raw_notes/`）。

| 位置 | 说明 |
| --- | --- |
| `packages/dsh-weread-kb/` | 插件包。宿主行 `weread-kb`（只有 `repoRoot`）提供共享服务 `wereadKb`；工具行 `@dadventures/dsh-weread-kb/tools` 提供知识库工具 `kb_*` 和原始笔记工具 `notes_*`；包内 `cordis.patch.yml` 声明两个模式。另有命令行 `bin/weread-kb.js` |
| `scripts/install-dadventures.ps1` / `.sh` | 开发安装：把包装进一个 DSH Profile，写入仓库路径，并检查组合后的配置里宿主行和两个 preset 都在 |
| `scripts/profile-config.js` | 安装脚本用来改 Profile 自己的 `cordis.patch.yml`：只改一段带标记的区块，重跑会替换它，区块外的内容保持不变 |

## 两个模式

**读书问答模式**（preset `wereadask`）：基于笔记回答问题。只读：没有文件工具和终端，所以会话目录选哪里都行，也改不了仓库。Agent 先用 `kb_search` 查整理好的卡片（按问题类型传 `intent`，把最该先看的卡片类型排到前面），用 `kb_read` 读卡、`kb_links` 沿引用走；卡片不够、或问的是书里的原话和当时写的想法时，用 `notes_search` / `notes_read` 查原始笔记，所以还没整理的书也能问。每个要点标出《书名》和卡片 ref。skill `kb-answer` 给出各类问题的回答结构。

**读书整理模式**（preset `wereadkb`）：把原始笔记整理成卡片。会话目录选本仓库根目录。Agent 用 `notes_books` 看哪些书还没整理、`notes_read` 读原始笔记、`kb_search` 查重，用 `kb_schema` 拿模板、下一个编号和文件路径，用 DSH 的文件工具写卡片，最后 `kb_check` 校验。带计划模式和待办列表，适合一次整理一整本书。skill：`weread-organize-book`（整理一本书）、`kb-contribute`（写或改一张卡）、`weread-sync`（同步新笔记）；知识库自己的规则文件原样注册成 `kb-rules`（`kb/AGENTS.md`）、`kb-workflow`（`kb/IDEA_CAPTURE_WORKFLOW.md`）、`kb-taxonomy`（`kb/taxonomy/taxonomy.md`），规则仍然只写在 `kb/` 一处。新卡一律 `schema_version: 2`、`status: draft`。`kb_schema` 发现会话目录不包含知识库时会提醒换目录。

## 工具

| 工具 | 模式 | 作用 |
| --- | --- | --- |
| `kb_overview` | 两个 | 各主题域有多少张卡；传 `subject` 看一个主题域里的书和主题包 |
| `kb_search` | 两个 | 搜卡片：`q`、`intent`（concept / howto / topic / ideas / book / compare）、`book`、`subject`、`doc_type`。同时报告原始笔记里有多少条命中 |
| `kb_read` | 两个 | 读一张卡的全文，带来源的书、它引用的卡和引用它的卡 |
| `kb_links` | 两个 | 一张卡的来源链路和关联；`suggest: true` 推荐还没关联的相近卡片 |
| `notes_books` | 两个 | 有笔记的书和公众号，以及整理进度：未整理 / 已建档 / 已整理 |
| `notes_read` | 两个 | 按书内顺序读一本书的划线和想法，可按章节、类型筛选，分页 |
| `notes_search` | 两个 | 跨书搜原始笔记 |
| `kb_schema` | 整理 | 某类卡片在某个主题域的模板、下一个 id、文件路径、受控字段的可选值 |
| `kb_check` | 整理 | 校验 frontmatter、id、受控词和引用（与 `validate_knowledge.py` 同一套规则），另外提醒文件名、目录和来源链路的问题 |

卡片用 `主题域/id` 寻址（如 `parenting/concept-0068`）：旧卡的短 id 在不同主题域里会重复。

检索按字面匹配，不做语义检索：一两个关键词（`安全感`、`护城河 银行`）在笔记里有这个词时按原样匹配；整句问题、以及笔记里没有的关键词，按相邻两字的片段匹配，并按片段在笔记里的稀有程度加权。关键词在笔记里不存在时，结果会明说“没有「X」这个说法”。

## 安装

先装好 DSH（脚本不会替你装）：`npm install -g @deepseek-ai/dsh@0.2.0-rc.2`。然后从仓库根目录运行：

```powershell
.\dsh\scripts\install-dadventures.ps1                            # 新建 dadventures Profile，默认模式设为读书问答模式
.\dsh\scripts\install-dadventures.ps1 -ModelsFrom kids-ai-lab    # 同上，并从已有 Profile 复制模型配置
.\dsh\scripts\install-dadventures.ps1 -ProfileName kids-ai-lab   # 给已有 Profile 加上这两个模式
```

POSIX：`bash dsh/scripts/install-dadventures.sh [--profile NAME] [--models-from PROFILE]`。

新建的 Profile 没有模型配置：用 `-ModelsFrom` 从已有 Profile 复制（复制的行里带那个 Profile 的 API Key，只写进新 Profile 的 `cordis.patch.yml`，不打印），或启动后在 DSH Web 的设置里配。

然后启动 DSH Web：`dsh --profile dadventures --port 3091`，新建会话时选模式；读书整理模式的会话目录选本仓库。

什么时候要重来：

- 改了插件代码：重跑安装脚本再重启（pnpm 会把 `file:` 依赖复制一份）。重跑是安全的：上次写入的默认模式和模型配置会保留。
- 改了 `kb/` 下的 `AGENTS.md`、`IDEA_CAPTURE_WORKFLOW.md`、`taxonomy/taxonomy.md`：重启（skill 在启动时注册；受控词表的校验不用重启）。
- 改了卡片、同步了新笔记：什么都不用做，索引按文件修改时间增量更新。
- 仓库换了位置：重跑安装脚本。

DSH 进程里第一次调用工具要把 1100 多张卡片和全部原始笔记读一遍，在这台机器上是 3 到 10 秒；之后每次检索约 0.1 秒。

## 不经过 DSH 直接用

同一套工具可以在终端里跑，输出和 Agent 看到的一样（每次都要重新读一遍文件，约十秒）：

```powershell
npm run kb -- --list                          # 列出工具和参数
npm run kb:check                              # 校验整个知识库，有错误时退出码为 1
npm run kb -- search 安全感 --intent concept
npm run kb -- books --stage pending           # 还没整理的书
npm run kb -- notes_read 孩子的大脑 --chapter 注意力
```

## 测试

```powershell
npm test                                      # 仓库根目录；不需要 npm install
python -m unittest discover -s .weread-sync\tests
```

`npm test` 包含对本仓库真实数据的检查（知识库零错误、每张书目卡都能对上原始笔记）。设置 `DADVENTURES_DSH_PACKAGE` 指向已安装的 `@deepseek-ai/dsh` 包目录时，会额外在真实的 cordis 运行时里加载插件，并用 DSH 自己的 JSON Schema 检查校验所有工具参数；不设置时这一项标记为跳过。
