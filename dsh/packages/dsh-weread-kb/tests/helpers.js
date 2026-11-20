import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKbService } from '../src/service.js';
import { KB_SERVICE } from '../src/shared.js';

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..', '..');
export const KB_DIR = 'kb';

/** A host with what the plugin uses: tools, skills and (optionally) the shared wereadKb service. */
export function fakeHost({ repoRoot } = {}) {
  const tools = new Map();
  const skills = new Map();
  const service = repoRoot === undefined ? undefined : createKbService({ repoRoot });
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
    skills: { register(skill) { skills.set(skill.name, skill); return () => skills.delete(skill.name); } },
    get(name) { return name === KB_SERVICE ? service : undefined; },
  };
  const call = async (name, args = {}, exec = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.execute(args, exec);
  };
  const text = (name, args, value) => tools.get(name).output.render(args, value).map((part) => part.text).join('');
  /** Run a tool and return what the model reads. */
  const say = async (name, args = {}, exec = {}) => text(name, args, await call(name, args, exec));
  return { ctx, tools, skills, service, call, text, say };
}

export const sessionExec = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: new AbortController().signal });

export function tempDir(t, prefix = 'weread-kb-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  }
}

export const card = (front, body) => `---\n${front.trim()}\n---\n\n${body.trim()}\n`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const template = (type, id, extra = '') => card(`doc_type: ${type}\nschema_version: 2\nid: ${id}\ntitle: fill_in_short_slug\ntitle_zh: 填写中文标题\nsubject_domains:\n  - investing\n${extra}status: draft\nlast_reviewed: 2026-03-13`, '# 模板正文\n\n安全感 这里不是知识。');

export const TAXONOMY = `# Taxonomy

## Subject Domains

- \`parenting\`: 育儿
- \`investing\`: 投资
- \`work\`: 工作

## Note Kinds

- \`chapter_summary\`
- \`theme_summary\`

## Concept Types

- \`principle\`
- \`mental_model\`

## Action Types

- \`checklist\`

## Claim Basis

- \`direct_book_note\`: 主要来自单本书
- \`multi_book_synthesis\`: 综合多本书

## Collection Kinds

- \`topic_dossier\`

## Idea Kinds

- \`theme_seed\`

## Status

- \`draft\`
- \`reviewed\`
- \`published\`

## Semi-Controlled Fields

- \`topic_tags\`
`;

/** WeRead's own export: a rating, chapters as bare lines, thoughts with their passage, the passage repeated as a highlight. */
export const ARCHIVE = [
  '《孩子的大脑》',
  '阿尔瓦罗·毕尔巴鄂\r\n9个笔记',
  '点评',
  '◆ 2024/06/26 认为好看',
  '作者从大脑发育的阶段讲怎么教育孩子，很实用！',
  '第一章 安全感是地基',
  '◆ 2024/06/20发表想法',
  '安全感是大脑发育的地基',
  '原文：孩子受惊时，大人先冷静地接住他，大脑才会从警报状态回到可以学习的状态。',
  '◆ 孩子受惊时，大人先冷静地接住他，大脑才会从警报状态回到可以学习的状态。',
  '◆ 2024/06/21发表想法',
  '三件小事值得每天做',
  '原文：每天可以做的三件小事：',
  '\uFFFC 抱一抱\r\n\uFFFC 说出他的感受\r\n\uFFFC 一起收拾',
  '◆ 每天可以做的三件小事：',
  '\uFFFC 抱一抱\r\n\uFFFC 说出他的感受\r\n\uFFFC 一起收拾',
  '◆ 边界要说得真实而尊重，不靠吓唬和羞辱。',
  '第二章 惩罚为什么没用？',
  '◆ 2024/06/22发表想法',
  '后果不是惩罚',
  '原文：孩子更容易在自然后果里学会规则，而不是在惩罚里。',
  '◆ 孩子更容易在自然后果里学会规则，而不是在惩罚里。图2-1展示了两者的差别。',
  '◆ 2024/06/23发表想法',
  '这一章没有划线的想法',
  '-- 来自微信读书',
].join('\r\n\r\n');

const review = (id, chapterUid, range, chapterName, content, abstract, createTime) => ({ reviewId: id, chapterUid, range, chapterName, content, abstract, createTime });

/**
 * A small dadventures: two subjects that reuse the same legacy ids, one v2 card, a cross-subject collection, a
 * Markdown archive, synced raw notes for a filed book, a pending book and a pending official account.
 */
export function repoFixture(t) {
  const repo = tempDir(t);
  writeTree(repo, {
    'README.md': '# 微信读书笔记知识库\n',
    'notes/育儿/孩子的大脑.md': ARCHIVE,
    '.weread-sync/raw_notes/孩子的大脑/raw.json': json({
      bookId: '902', title: '孩子的大脑', author: '阿尔瓦罗·毕尔巴鄂', reviewCount: 1,
      reviews: [review('r-brain-1', 3, '10-60', '第一章 安全感是地基', '安全感是大脑发育的地基', '孩子受惊时，大人先冷静地接住他。', 1718850000)],
    }),
    '.weread-sync/raw_notes/金钱心理学/raw.json': json({
      bookId: '900', title: '金钱心理学：财富、人性和幸福的永恒真相', author: '摩根·豪泽尔', fetchedAt: 1760000000,
      chapters: [{ chapterUid: 7, title: '第4章 复利之谜' }],
      reviews: [
        review('r-money-2', 7, '300-360', '', '复利需要时间，而时间需要活下来', '巴菲特的财富大部分来自六十岁以后。', 1750000100),
        review('r-money-1', 2, '40-90', '第1章 没有人真的疯了', '每个人对钱的看法都来自自己的经历', '你的个人经历只占世界的极小部分，却决定了你怎么看世界。', 1750000000),
        review('r-money-0', 0, '', '', '整本书最打动我的是“够了”这个词', '', 1750000900),
      ],
      marks: [
        { bookmarkId: 'm-money-1', chapterUid: 7, range: '300-360', markText: '巴菲特的财富大部分来自六十岁以后。', createTime: 1750000050 },
        { bookmarkId: 'm-money-2', chapterUid: 7, range: '900-950', markText: '安全边际的意义是让预测变得不必要。', createTime: 1750000200 },
      ],
    }),
    '.weread-sync/raw_notes/把整颗心献给孩子/raw.json': json({
      bookId: '901', title: '把整颗心献给孩子', author: '苏霍姆林斯基',
      reviews: [review('r-heart-1', 1, '5-20', '序', '教育首先是关心孩子的健康', '对健康的关注，是教育者最重要的工作。', 1740000000)],
    }),
    '.weread-sync/raw_notes/某公众号/raw.json': json({
      bookId: 'MP_WXS_1', title: '某公众号', author: '公众号',
      reviews: [review('r-mp-1', 1, '1-9', '', '芯片的复利效应', '摩尔定律本质上是一种复利。', 1730000000)],
    }),
    '.weread-sync/raw_notes/坏掉的/raw.json': '{ not json',
    [`${KB_DIR}/AGENTS.md`]: '# 微信读书知识库规则\n\n一文件一单元。安全感 这里不是知识。\n',
    [`${KB_DIR}/IDEA_CAPTURE_WORKFLOW.md`]: '# IDEA_CAPTURE_WORKFLOW.md\n\n先来源笔记，再概念卡和动作卡。\n',
    [`${KB_DIR}/taxonomy/taxonomy.md`]: TAXONOMY,
    [`${KB_DIR}/_templates/source_book_template.md`]: template('source_book', 'book-investing-0001', 'raw_source_path: notes/投资/书名.md\n'),
    [`${KB_DIR}/_templates/source_note_template.md`]: template('source_note', 'note-investing-0001', 'source_book: book-investing-0001\nnote_kind: chapter_summary\nclaim_basis: direct_book_note\nderived_cards:\n  - concept-investing-0001\n'),
    [`${KB_DIR}/_templates/concept_card_template.md`]: template('concept_card', 'concept-investing-0001', 'concept_type: principle\nclaim_basis: direct_book_note\nsource_refs:\n  - note-investing-0001\nrelated_actions:\n  - action-investing-0001\n'),
    [`${KB_DIR}/_templates/action_card_template.md`]: template('action_card', 'action-investing-0001', 'action_type: checklist\nsource_refs:\n  - note-investing-0001\n'),
    [`${KB_DIR}/_templates/collection_template.md`]: template('collection', 'collection-investing-0001', 'collection_kind: topic_dossier\nincluded_cards:\n  - concept-investing-0001\n'),
    [`${KB_DIR}/_templates/idea_seed_template.md`]: template('idea_seed', 'idea-investing-0001', 'idea_kind: theme_seed\ntheme_refs:\n  - collection-investing-0001\n'),

    [`${KB_DIR}/sources/books/parenting/book-0001-parenting-01.md`]: card(`
doc_type: source_book
id: book-0001
title: parenting-01
title_zh: "孩子的大脑"
author: "阿尔瓦罗·毕尔巴鄂"
raw_source_path: "notes/育儿/孩子的大脑.md"
subject_domains:
  - parenting
note_count: 9
status: active
`, '# 书籍定位\n\n从大脑发育讲养育。'),
    [`${KB_DIR}/sources/notes/parenting/note-0001-safe-base.md`]: card(`
doc_type: source_note
id: note-0001
source_book: book-0001
source_section: 第一章 安全感是地基
note_kind: theme_summary
derived_cards:
  - concept-0001
  - action-0001
status: draft
`, '# 核心摘要\n\n- 孩子受惊时先被冷静接住，大脑才回到能学习的状态。'),
    [`${KB_DIR}/concepts/parenting/concept-0001-safe-base.md`]: card(`
doc_type: concept_card
id: concept-0001
title: safe-base
title_zh: 安全感是大脑健康发育的基础
status: reviewed
topic_tags:
  - brain_development
search_terms:
  - 为什么先要接住孩子
source_refs:
  - note-0001
related_actions:
  - action-0001
`, '# 核心定义\n\n没有安全感，再多的刺激也难以发挥作用。\n\n## 为什么重要\n\n它是其他学习的前提。'),
    [`${KB_DIR}/actions/parenting/action-0001-calm-first.md`]: card(`
doc_type: action_card
id: action-0001
title_zh: 孩子受惊时怎么给安全感：先冷静接住，再讲道理
status: draft
source_refs:
  - note-0001
related_concepts:
  - concept-0001
`, '# 适用场景\n\n孩子受惊、摔倒或害怕时。\n\n## 执行步骤\n\n1. 蹲下来抱住。\n2. 说出他的感受，给他安全感。'),
    [`${KB_DIR}/collections/parenting/collection-0001-security.md`]: card(`
doc_type: collection
id: collection-0001
title_zh: 孩子的安全感从哪里来
status: draft
included_cards:
  - concept-0001
  - action-0001
  - investing/concept-0001
`, '# 主题说明\n\n把安全感相关的卡片放在一起，也借用投资里“活下来”的想法。'),
    [`${KB_DIR}/ideas/parenting/idea-0001-security-spark.md`]: card(`
doc_type: idea_seed
id: idea-0001
title_zh: 安全感像复利，早期的一点点会滚很久
search_terms:
  - 安全感
  - 复利
status: draft
theme_refs:
  - collection-0001
`, '# 想法摘要\n\n早期的安全感会在之后的每一次学习里生息。'),

    [`${KB_DIR}/sources/books/investing/book-0002-investing-01.md`]: card(`
doc_type: source_book
id: book-0002
title: investing-01
title_zh: "金钱心理学：财富、人性和幸福的永恒真相"
weread_book_id: "900"
status: active
`, '# 书籍定位\n\n钱的问题多半是行为问题。'),
    [`${KB_DIR}/sources/notes/investing/note-0001-compounding.md`]: card(`
doc_type: source_note
id: note-0001
source_book: book-0002
source_section: 第4章 复利之谜
derived_cards:
  - concept-0001
status: draft
`, '# 核心摘要\n\n- 复利的关键变量是时间，所以先要活下来。'),
    [`${KB_DIR}/concepts/investing/concept-0001-compounding.md`]: card(`
doc_type: concept_card
id: concept-0001
title_zh: 复利需要时间，而时间需要先活下来
status: published
source_refs:
  - note-0001
`, '# 核心定义\n\n长期回报来自不被打断的复利。'),
    [`${KB_DIR}/concepts/investing/concept-investing-0002-margin-of-safety.md`]: card(`
doc_type: concept_card
schema_version: 2
id: concept-investing-0002
title: margin-of-safety
title_zh: 安全边际让预测变得不必要
status: draft
subject_domains:
  - investing
concept_type: principle
claim_basis: direct_book_note
source_refs:
  - note-0001
`, '# 核心定义\n\n留出犯错的余地。'),
  });
  return { repo, kbDir: path.join(repo, KB_DIR) };
}
