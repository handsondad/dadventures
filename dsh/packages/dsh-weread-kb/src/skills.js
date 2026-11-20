import { readFileSync } from 'node:fs';
import path from 'node:path';
import { KB_DIR } from './layout.js';

// Skills come from two places:
//   - the ones written here, which describe how to work with this plugin's tools;
//   - the knowledge base's own rule files, registered as they are, so the rules are written in one place
//     (people and other agents read the same files).
// Skill text stays under 8,000 characters: DSH's standard tool-result pruner cuts results above 8,192, and a skill
// that arrives cut in the middle is worse than a shorter one. (This package's own presets raise that to 16,384.)

export const SKILL_LIMIT = 7800;
const runtime = (skill) => ({ source: 'runtime', invocation: { modelInvocable: true, userInvocable: true }, ...skill });

const ANSWER = runtime({
  name: 'kb-answer',
  description: '按问题类型回答读书知识库里的问题：先查哪类卡片、答案包含哪几部分、怎么写来源。',
  whenToUse: '要给出一个完整的、结构化的回答（解释概念、给做法、梳理主题、比较几本书、找表达素材）时。',
  content: `# 用读书知识库回答问题

## 先判断问题类型，再检索

\`kb_search\` 的 intent 会把最该先看的卡片类型排到前面：

| 用户在问 | intent | 先看 |
| --- | --- | --- |
| 这是什么意思、怎么理解 | concept | 概念卡 → 来源笔记 → 主题包 |
| 具体怎么做、怎么判断 | howto | 行动卡 → 主题包 → 概念卡 |
| 这个场景或问题有哪些相关主题 | topic | 主题包 → 行动卡 → 概念卡 |
| 有哪些闪光点、想法、表达素材 | ideas | 主题包 → 想法种子 → 概念卡 |
| 这本书是怎么说的 | book | 来源笔记 → 书目卡（加 book: 书名） |
| 不同的书怎么比较 | compare | 概念卡 → 主题包 → 来源笔记 |

q 怎么写：一两个关键词（“安全感”“护城河 银行”）按原样匹配，最准；整句问题按字词匹配，适合不知道笔记用什么词的时候。检索不懂同义词：整句命中少或不切题时，换成笔记里会用的词再搜（“立规矩”→“规则”“边界”）。结果提示“没有「X」这个说法”时，那些命中只是零散的字词重合，不切题就当作没有。

- 命中后用 \`kb_read\` 读最相关的 2-4 张再回答，snippet 只是片段。
- 想沿一个主题走下去，用 \`kb_links\`：主题包列出它包含的卡，卡片列出引用它的主题包和它的来源笔记。
- 知识库没有整理到的内容，用 \`notes_search\` 搜原始笔记（划线和当时写的想法），用 \`notes_read\` 读上下文。
- 问“某本书”而它还没整理（\`notes_books\` 的 stage 是 pending）时，直接基于原始笔记回答，并说明这本书还没整理进知识库。

## 答案包含什么

解释概念：核心定义 → 为什么重要 → 关键判断 → 常见误解或边界 → 跨书对照（有才写）→ 来源。

给做法：适用场景 → 目标 → 执行步骤 → 关键判断规则或话术 → 不适用场景 → 观察信号 → 来源。

梳理主题：核心问题 → 相关主题 → 可用引用线索 → 我的想法或切入角度 → 可继续展开的结构。

比较几本书：各自的主张（每本一两句，带来源）→ 相同点 → 分歧和各自的前提 → 怎么取舍。

找表达素材：主题 → 来源 → 可引用片段线索 → 个人想法摘要。停在想法层，不要写成成稿或口播稿。

简单的问题直接回答，不必套全结构；先给结论，再给依据。

## 来源怎么写

- 每个要点后面标出处：《书名》+ 卡片 ref（如 \`parenting/concept-0068\`）；来自原始笔记的写《书名》·章节。
- 分清三种话：书里的观点、用户当时写下的想法（原始笔记里的“想法”）、你此刻的归纳。归纳要说是归纳。
- 没有页码就不写页码；不编书名、作者、章节、研究或数据。
- 引用要短：保留定位短句和转述，不堆长段原文。
- 优先用 status 为 reviewed / published 的卡；只有 draft 时照用，但说明是草稿。
- 知识库和原始笔记里都没有时，如实说没有。可以另外给出你自己的看法，但要和“笔记里的内容”明确分开。`,
});

const ORGANIZE = runtime({
  name: 'weread-organize-book',
  description: '把一本书（或一个公众号）的微信读书原始笔记整理进知识库：书目卡 → 来源笔记 → 概念卡 / 行动卡 → 主题包 → 想法种子。',
  whenToUse: '用户要整理某本书的读书笔记、问“还有哪些书没整理”、要接着上次的进度整理，或同步了新笔记之后。',
  content: `# 把一本书的微信读书笔记整理进知识库

目标：原始笔记 → 书目卡 → 来源笔记 → 概念卡 / 行动卡 → 主题包 → 想法种子，每一层都能沿 frontmatter 回到上一层。
规则全文是 skill \`kb-rules\`，各类卡片的最小标准是 skill \`kb-workflow\`，受控词表是 skill \`kb-taxonomy\`。

## 步骤

1. 选书：\`notes_books\`（stage: pending 是还没建书目卡的，registered 是建了书目卡还没有来源笔记的；q 找指定的书）。用户没指定时列出候选让用户挑，不要自己决定整理哪本。
2. 读原始笔记：\`notes_read\`（book）。第一页带章节目录；按 next_from 读完，或用 chapter 只读一部分。笔记多（80 条以上）的书按章节分批：一批写完、校验完，再读下一批。
3. 查重：\`kb_search\`（book: 书名）看这本书已有哪些卡；对准备写的每个主题再搜一次（不带 book）。已有同一主题的卡就补充那张，或在主题包里关联，不要再建一张。
4. 书目卡：没有就建（doc_type: source_book）。\`raw_source_path\` 写 notes_books 给出的来源路径，\`weread_book_id\` 写 bookId，\`note_count\` 写 notes_books 给出的笔记条数。
5. 来源笔记（source_note）：按章节或问题簇，一簇一张，通常 3-10 条原始笔记一张。写清：核心摘要（自己的话）、原始定位（章节名 + 可搜索短句；notes_read 给了 reviewId 就填进 \`source_review_ids\`）、可引用片段（短）、我的想法、可拆出的卡片方向。
6. 概念卡 / 行动卡：回答“这是什么意思”的拆 concept_card，回答“怎么做”的拆 action_card。每张用 \`source_refs\` 指向来源笔记，来源笔记的 \`derived_cards\` 反向列出它们。
7. 主题包（collection）：同一个问题下已有 3 张以上卡片时新建或更新，3-8 张为宜，用 \`included_cards\`；可以跨书、跨主题域。
8. 想法种子（idea_seed）：主题包稳定后再建，先写触发问题和闪光点，用 \`theme_refs\` 指向主题包。
9. 更新书目卡正文的“已产出内容”和处理进度。
10. 校验：\`kb_check\`（paths 传这次写的全部文件）。错误必须改完，提醒尽量处理。
11. 回报：新建和修改的文件及 ref；这本书还有哪些章节没整理；需要用户核对的地方。

每次建文件前都用 \`kb_schema\`（doc_type、subject、slug）拿模板、下一个 id 和文件路径，不要自己数编号。用文件工具写文件。

## 写法

- 新卡写 \`schema_version: 2\`，id 是 \`类型-主题域-四位编号\`，文件名 \`<id>-<english-slug>.md\`，\`status: draft\`，\`last_reviewed\` 写今天。
- 受控字段只用 \`kb_schema\` 列出的值；topic_tags、scenes、problems、idea_sparks 用 lower_snake_case。
- \`title_zh\` 写成一句能独立看懂的判断或问题：检索主要靠它。再补 \`search_terms\`（用户可能用的说法）。
- 引用同一主题域的卡写 id；引用别的主题域的卡写 \`主题域/id\`，例如 \`parenting/concept-0068\`。
- 原始笔记里的“想法”是用户当时写的话：保留它的意思，放在“我的想法”里，和书里的观点分开。
- 只保留短定位片段和转述，不整段照抄原文。没有页码就不写页码。
- 一文件一单元；不把多本书、多个不相干的主题塞进一张卡。

## 不要做

- 不把 status 写成 reviewed 或 published，除非用户明确要求并已核对。
- 不改已有卡片的 id 和文件名：别的卡在引用它们。
- 不把整本原始笔记复制进知识库，也不改 \`notes/\` 和 \`.weread-sync/raw_notes/\` 里的文件。
- 没有原始笔记支撑的内容不写成书摘。人工综合写 \`source_book: manual_synthesis\`，并在正文说明来源性质。`,
});

const CONTRIBUTE = runtime({
  name: 'kb-contribute',
  description: '在读书知识库里新建或修改一张卡片：查重、拿模板和编号、按规范写、建立引用、校验。',
  whenToUse: '用户要把一段结论或想法写进知识库、补一张卡、改卡片字段或关联、把卡片从 draft 提升到 reviewed 时。',
  content: `# 往读书知识库写一张卡片

知识库在仓库的 \`kb/\` 下：\`sources/books\`、\`sources/notes\`、\`concepts\`、\`actions\`、\`collections\`、\`ideas\`，每类下面按主题域分目录。规则全文是 skill \`kb-rules\`。

## 步骤

1. 查重：\`kb_search\` 用用户的说法搜，\`kb_read\` 读最接近的两三张。已有同一单元就改那张。
2. 定类型和主题域：解释性的是 concept_card，可执行的是 action_card，围绕一个问题聚合几张卡的是 collection，还没成形的闪光点是 idea_seed。主题域用 \`kb_overview\` 列出的 id。
3. 取模板和编号：\`kb_schema\`（doc_type、subject、slug）。
4. 写文件：用文件工具在给出的路径创建。frontmatter 按模板填，\`schema_version: 2\`，\`status: draft\`，\`last_reviewed\` 写今天。正文先给结论，再给依据和边界。
5. 来源链路：概念卡和行动卡用 \`source_refs\` 指向来源笔记；主题包用 \`included_cards\`；想法种子用 \`theme_refs\`。聊天里产生、没有单本书来源的结论，先建一张 \`source_book: manual_synthesis\` 的来源笔记写明依据，再让卡片引用它。
6. 关联：\`kb_links\`（ref，suggest: true）看有哪些卡值得写进 related_concepts / related_actions，读过确认相关再写。别的主题域的卡写 \`主题域/id\`。
7. 校验：\`kb_check\`（paths 传刚写的文件）。
8. 回报：文件、ref、还需要用户核对的地方。

## 修改已有卡片

- 只改内容和字段，不改 id、文件名和所在目录。
- 旧卡（没有 schema_version，id 形如 \`concept-0068\`）保持旧格式：不要给它加 \`schema_version: 2\`，v2 要求新格式的 id，而 id 不能改。
- 提升状态：用户确认内容和来源都核对过，才把 draft 改为 reviewed，并更新 \`last_reviewed\`。published 只在用户明确说可以稳定复用时用。

## 不要做

- 不伪造书名、作者、章节、页码或研究依据。
- 不新造受控词：确实需要时先和用户确认，把它加进 \`taxonomy/taxonomy.md\`，再使用。
- 不在 \`_templates/\`、\`taxonomy/\` 里放知识卡。`,
});

const SYNC = runtime({
  name: 'weread-sync',
  description: '从微信读书同步新的划线和想法，转成 Markdown 档案，再看有哪些书需要整理。',
  whenToUse: '用户说“同步一下微信读书”“拉最新的笔记”，或要整理的书在仓库里还没有原始笔记时。',
  content: `# 同步微信读书笔记

同步要联网并使用用户的微信读书 API Key，先征得用户同意再运行。命令都在仓库根目录执行。

1. 确认 API Key：环境变量 \`WEREAD_API_KEY\`（或 \`~/.codebuddy/.env\`）。只确认它是否已设置，不要显示它的值，不要把它写进任何文件、命令历史说明或回复里。没有设置就请用户自己设置后再继续。
2. 同步：\`python .weread-sync/scripts/sync_final.py\`。它分页拉取有笔记的书，只更新有变化的书，结果写入 \`.weread-sync/raw_notes/<书>/raw.json\`。有书失败时进程返回非零：把失败的书名和错误告诉用户，成功的结果已经保存。
3. 需要 Markdown 阅读档案时：\`python .weread-sync/scripts/json2md.py "<raw_notes 下的书目录名>"\`，输出到 \`notes/未分类/\`。不转也可以：\`notes_read\` 直接读 raw.json。
4. 看结果：\`notes_books\`（stage: pending）列出还没整理的书和公众号，告诉用户新增了哪些、各有多少条笔记。
5. 用户要继续整理时，按 skill \`weread-organize-book\` 做。

不要手工编辑 \`.weread-sync/raw_notes/\` 和 \`.weread-sync/state/\` 里的文件。`,
});

export const ANSWER_SKILLS = [ANSWER];
export const MAINTENANCE_SKILLS = [ORGANIZE, CONTRIBUTE, SYNC];

const RULE_FILES = [
  {
    file: 'AGENTS.md', name: 'kb-rules',
    description: '读书知识库的规则全文（kb/AGENTS.md）：各类问题先查哪里、回答原则和结构、写回知识库的规则和顺序。',
    whenToUse: '写卡片或整理笔记之前；不确定某类问题该怎么回答、某种内容该写成哪类卡片时。',
  },
  {
    file: 'IDEA_CAPTURE_WORKFLOW.md', name: 'kb-workflow',
    description: '从原始笔记到来源笔记、概念卡 / 行动卡、主题包、想法种子的标准流程，以及每类卡片的最小可用标准（kb/IDEA_CAPTURE_WORKFLOW.md）。',
    whenToUse: '整理一本书、做主题包或沉淀想法种子时，用来对照每一步该产出什么、做到什么程度算可用。',
  },
  {
    file: 'taxonomy/taxonomy.md', name: 'kb-taxonomy',
    description: '读书知识库的受控词表（kb/taxonomy/taxonomy.md）：主题域、笔记类型、概念类型、行动类型、来源依据、受众、用途、状态，以及新增词的规则。',
    whenToUse: '填写或修改卡片的受控字段、想新增一个标签或主题域时。',
  },
];

/** The knowledge base's own rule files as skills. Problems are returned, not thrown: a missing file must not hide the rest. */
export function loadRuleSkills(kbDir) {
  const skills = [];
  const problems = [];
  for (const { file, ...skill } of RULE_FILES) {
    let content;
    try { content = readFileSync(path.join(kbDir, ...file.split('/')), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim(); } catch { problems.push(`${file} 读不到，没有注册 skill ${skill.name}。`); continue; }
    if (content.length > SKILL_LIMIT) content = `${content.slice(0, SKILL_LIMIT)}\n\n…（已截断，完整内容用文件工具读 ${KB_DIR}/${file}）`;
    skills.push(runtime({ ...skill, content }));
  }
  return { skills, problems };
}
