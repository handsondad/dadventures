# @dadventures/dsh-weread-kb

微信读书笔记知识库的 DSH 插件：一个共享服务、九个工具、几份 skill，以及「读书问答模式」和「读书整理模式」两个 preset。安装和使用见 [`dsh/README.md`](../../README.md)。

没有运行时依赖，需要 Node.js 24 以上和 DSH `>=0.2.0-rc.2 <0.3.0`。

## 行和配置

| 行 | 入口 | 配置 |
| --- | --- | --- |
| 宿主行 `weread-kb` | `@dadventures/dsh-weread-kb` | `repoRoot`：dadventures 仓库根目录。留空时读环境变量 `DADVENTURES_ROOT`。提供服务 `wereadKb` |
| 工具行 `weread-kb-tools` | `@dadventures/dsh-weread-kb/tools` | `maintain: true` 再注册 `kb_schema`、`kb_check` 和整理用的 skill；`skills: false` 不注册 skill。读宿主行的 `wereadKb` 服务，自己不带路径 |

`cordis.patch.yml` 插入宿主行（`repoRoot` 为空，由 Profile 自己的 patch 按 id 覆盖）和两个 preset：`preset-wereadask`（工具行不开 `maintain`，没有文件工具和终端）、`preset-wereadkb`（`maintain: true`，加文件工具、终端、计划模式、待办）。两个 preset 都把工具结果裁剪阈值提到 16384 字符，`notes_read` 的一页（最多 12000 字符）不会被截断。

没有配置好 `repoRoot` 时，每个工具都报同一条说明（指向安装脚本）。

## 源码

| 文件 | 内容 |
| --- | --- |
| `src/settings.js` | 宿主行：`ctx.provide('wereadKb', …)` |
| `src/service.js` | 共享服务：知识库索引、原始笔记索引、两者对上之后的“书”清单（`inventory()`、`book()`） |
| `src/index.js` | 知识库索引：读卡片的 frontmatter，按 `主题域/id` 寻址，解析引用，沿来源链路找到每张卡对应的书，检索 |
| `src/sources.js` | 原始笔记：解析微信读书导出的 Markdown 档案和同步下来的 `raw.json`，同一本书的两个来源合并成一本 |
| `src/search.js` | 检索打分（见下） |
| `src/check.js` | 校验规则 |
| `src/layout.js` | 目录结构、卡片类型、必填字段、引用字段、问题类型（intent） |
| `src/tools.js` | 工具行：九个工具和它们的 Markdown 输出 |
| `src/skills.js` | 内置 skill，以及把 `kb/` 的规则文件注册成 skill |
| `bin/weread-kb.js` | 命令行：`weread-kb <tool> [value] [--name value …] [--json] [--repo <dir>]`，`--list` 列出工具 |

索引和笔记都按文件的修改时间和大小缓存在内存里，文件一变就重读那一个文件；不落盘（笔记是个人数据，不往仓库外复制）。

## 检索

不分词，也不做语义检索：

- 查询按空格和标点切成词。两个字的词和非中文词按原样匹配。
- 三到六个字的中文词是关键词：被搜的文档里有这个词时按原样匹配（`安全感` 不会带出 `安全边际`）；没有时退回到相邻两字的片段，并在结果的 `missing` 里报告，工具输出会明说“没有「X」这个说法”。
- 更长的中文词当作一句话，按相邻两字的片段匹配（去掉“怎么”“什么”这类片段）。
- 每个词或片段按它在被搜文档里的稀有程度加权，所以“孩子发脾气的时候怎么办”主要由“发脾气”决定；同一个词重复出现时收益递减。
- 命中要占到查询权重的一定份额，并且不低于最佳命中的一半；标题、检索词、标签、正文的权重依次降低。
- 卡片的命中还看它来源的书名和主题域；原始笔记的命中只看笔记自己的想法和原文，章节名和书名只加分。
- `kb_search` 的 `intent` 把回答这类问题的卡片类型排到前面，`reviewed` / `published` 的卡略微靠前。

## 校验

`kb_check` 的错误与 `.weread-sync/scripts/validate_knowledge.py` 是同一套规则：frontmatter、必填字段、`doc_type`、v2 的 id 格式、模板占位符、受控词（v2 卡片，或 `strict`）、同一主题域内 id 重复、引用字段指向不存在或有歧义的 id。引用别的主题域写 `主题域/id`，两个校验器都接受。

提醒是它多出来的：主题域目录不在词表里、关联字段指向找不到的卡、文件名不以 id 开头或含非 ASCII 字符、卡片放错目录、旧卡的状态不在 draft / reviewed / published 里、来源笔记没有 `source_book`、卡片既没有来源也没有任何引用。全库校验时每类提醒只列前 5 条，传 `paths` 或 `subject` 可以看全。

## 给别的插件用

同一个 Profile 里的其他插件可以用 `ctx.get('wereadKb')` 取到服务（`index()`、`sources()`、`inventory()`、`book()`），也可以 `import … from '@dadventures/dsh-weread-kb/lib'` 取纯函数（索引、校验、解析、打分）。DSH 把每个包作为独立副本装进 Profile，所以跨包共享状态要走服务，不要互相 import 源文件。

## 测试

```powershell
node --test tests/*.test.js
```

`tests/helpers.js` 里有一个小的仓库夹具（十张卡、一份导出档案、几份 `raw.json`）；`real.test.js` 检查本仓库的真实数据；`dsh-native.test.js` 需要 `DADVENTURES_DSH_PACKAGE`，没有时跳过。
