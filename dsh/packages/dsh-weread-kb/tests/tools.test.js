import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SKILL_LIMIT } from '../src/skills.js';
import { createKbTools } from '../src/tools.js';
import { KB_DIR, card, fakeHost, repoFixture, sessionExec, tempDir, writeTree } from './helpers.js';

const READ_ONLY = ['kb_overview', 'kb_search', 'kb_read', 'kb_links', 'notes_books', 'notes_read', 'notes_search'];

function mounted(t, config = {}) {
  const fixture = repoFixture(t);
  const host = fakeHost({ repoRoot: fixture.repo });
  createKbTools(host.ctx, config);
  return { ...fixture, ...host };
}

test('问答模式 gets the read-only tools and one skill; 整理模式 adds the writing tools and the knowledge base rules', (t) => {
  const ask = mounted(t);
  assert.deepEqual([...ask.tools.keys()], READ_ONLY);
  assert.deepEqual([...ask.skills.keys()], ['kb-answer']);

  const edit = mounted(t, { maintain: true });
  assert.deepEqual([...edit.tools.keys()], [...READ_ONLY, 'kb_schema', 'kb_check']);
  assert.deepEqual([...edit.skills.keys()], ['kb-answer', 'weread-organize-book', 'kb-contribute', 'weread-sync', 'kb-rules', 'kb-workflow', 'kb-taxonomy']);
  assert.match(edit.skills.get('kb-rules').content, /^# 微信读书知识库规则/);
  assert.match(edit.skills.get('kb-taxonomy').content, /## Subject Domains/);
  for (const skill of edit.skills.values()) {
    assert.ok(skill.content.length < SKILL_LIMIT, `${skill.name} fits under the pruner threshold`);
    assert.ok(skill.description && skill.whenToUse, `${skill.name} says when to use it`);
    assert.deepEqual([skill.source, skill.invocation.modelInvocable], ['runtime', true]);
  }
  assert.deepEqual([...mounted(t, { maintain: true, skills: false }).skills.keys()], []);
});

test('tools are described in English with closed parameter schemas', (t) => {
  const { tools } = mounted(t, { maintain: true });
  for (const tool of tools.values()) {
    assert.ok(tool.description.length > 80 && !/[\u4e00-\u9fff]{6,}/.test(tool.description), `${tool.name} description`);
    assert.equal(tool.parameters.additionalProperties, false);
    for (const [name, spec] of Object.entries(tool.parameters.properties)) {
      assert.ok(['string', 'integer', 'boolean', 'array'].includes(spec.type), `${tool.name}.${name} type`);
      assert.ok(!('minimum' in spec) && !('maximum' in spec), `${tool.name}.${name} has no numeric bounds in the schema`);
    }
    assert.equal(typeof tool.output.render, 'function');
  }
});

test('kb_overview: the map of the knowledge base, then one subject', async (t) => {
  const { call, say } = mounted(t);
  const all = await call('kb_overview');
  assert.equal(all.total, 10);
  assert.deepEqual(all.sources, { total: 4, books: 3, mp: 1, pending: 2, registered: 0, organized: 2 });
  const text = await say('kb_overview');
  assert.match(text, /\| 育儿 \| `parenting` \| 1 \| 1 \| 1 \| 1 \| 1 \| 1 \|/);
  assert.match(text, /原始笔记：4 个来源（书 3、公众号 1）— 已整理 2、已建档 0、未整理 2/);

  const parenting = await say('kb_overview', { subject: '育儿' });
  assert.match(parenting, /\*\*育儿\*\*（`parenting`）：6 张卡片/);
  assert.match(parenting, /《孩子的大脑》 `parenting\/book-0001` — 已整理 · 来源笔记 1 \/ 概念 1 \/ 行动 1 \/ 主题包 1 \/ 想法 1 · 原始笔记 6 条/);
  assert.match(parenting, /- `parenting\/collection-0001` 孩子的安全感从哪里来/);
  await assert.rejects(call('kb_overview', { subject: '天文' }), /没有这个主题域/);
  await assert.rejects(call('kb_overview', { topic: 'x' }), /不接受参数 topic/);
});

test('kb_search: intent, book and subject; and how much the raw notes hold beyond the cards', async (t) => {
  const { call, say } = mounted(t);
  const found = await call('kb_search', { q: '安全感', intent: 'howto' });
  assert.equal(found.items[0].ref, 'parenting/action-0001');
  assert.equal(found.items[0].subject_label, '育儿');
  assert.deepEqual(found.raw, { total: 1, books: [{ title: '孩子的大脑', hits: 1 }], more: false, missing: [] });
  assert.deepEqual(found.missing, []);
  const text = await say('kb_search', { q: '安全感', intent: 'concept', limit: 2 });
  assert.match(text, /^共 5 张卡片命中，显示前 2 张：/);
  assert.match(text, /- \*\*安全感是大脑健康发育的基础\*\* — ref `parenting\/concept-0001`（概念卡 · 育儿 · reviewed · 《孩子的大脑》）/);
  assert.match(text, /原始笔记里另有 1 条命中（《孩子的大脑》1）：用 notes_search 查看。/);

  const byBook = await call('kb_search', { book: '金钱心理学', doc_type: 'concept_card' });
  assert.deepEqual(byBook.items.map((item) => item.ref).sort(), ['investing/concept-0001', 'investing/concept-investing-0002']);
  assert.equal(byBook.raw, null);
  assert.match(await say('kb_search', { book: '金钱心理学' }), /^共 6 张卡片，显示前 6 张：/);

  // Nothing organised on it yet, but the raw notes have it: say so instead of "no result".
  const gap = await say('kb_search', { q: '教育者' });
  assert.match(gap, /知识库里没有命中的卡片。/);
  assert.match(gap, /原始笔记里另有 1 条命中（《把整颗心献给孩子》1）/);
  assert.match(gap, /还没整理成卡片，可以直接基于原始笔记回答/);
  assert.match(await say('kb_search', { q: '量子纠缠' }), /如实告诉用户笔记里没有/);

  // A keyword the cards do not have: hits on its fragments (安全…) are shown, and named for what they are.
  const loose = await call('kb_search', { q: '安全垫' });
  assert.deepEqual(loose.missing, ['安全垫']);
  assert.ok(loose.items.length > 0);
  const said = await say('kb_search', { q: '安全垫' });
  assert.match(said, /注意：卡片里没有「安全垫」这个说法，上面的命中靠的是其余的词或零散的字/);
  assert.match(said, /原始笔记里另有 \d 条命中（.+），其中没有「安全垫」这个说法：/);
  assert.match(await say('notes_search', { q: '安全垫' }), /注意：原始笔记里没有「安全垫」这个说法/);

  await assert.rejects(call('kb_search', { book: '把整颗心献给孩子', q: '健康' }), /还没有整理进知识库.*notes_search/s);
  await assert.rejects(call('kb_search', {}), /至少要 q/);
  await assert.rejects(call('kb_search', { q: 'x', intent: 'why' }), /intent 只能是 concept、howto/);
  await assert.rejects(call('kb_search', { q: 'x', limit: 99 }), /limit 必须是 1 到 30/);
});

test('kb_read and kb_links: the card, where it comes from, what it connects to', async (t) => {
  const { call, say } = mounted(t);
  const text = await say('kb_read', { ref: 'parenting/concept-0001' });
  assert.match(text, /^ref: `parenting\/concept-0001` · 概念卡 · 育儿 · reviewed · concepts\/parenting\/concept-0001-safe-base\.md/);
  assert.match(text, /来自：《孩子的大脑》（`parenting\/book-0001`）/);
  assert.match(text, /引用：`parenting\/note-0001` 第一章 安全感是地基（source_refs）；`parenting\/action-0001`/);
  assert.match(text, /被引用：.*`parenting\/collection-0001` 孩子的安全感从哪里来（included_cards）/);
  assert.match(text, /# 核心定义\n\n没有安全感/);
  const paged = await call('kb_read', { ref: 'parenting/concept-0001', offset: 40 });
  assert.equal(paged.next_offset, null);
  assert.ok(paged.content.length < paged.total_chars);
  await assert.rejects(call('kb_read', { ref: 'concept-0001' }), /主题域\/id/);

  const links = await say('kb_links', { ref: 'parenting/collection-0001' });
  assert.match(links, /来自：《孩子的大脑》（`parenting\/book-0001`）、《金钱心理学：财富、人性和幸福的永恒真相》（`investing\/book-0002`）/);
  assert.match(links, /引用（3）：\n- `parenting\/concept-0001`.*\n- `parenting\/action-0001`.*\n- `investing\/concept-0001` 复利需要时间，而时间需要先活下来（included_cards）/);
  assert.match(links, /被引用（1）：\n- `parenting\/idea-0001`/);
  assert.ok(!links.includes('可能相关'));

  // The idea is linked to the collection only; the two cards about 安全感 are worth a look.
  const suggested = await call('kb_links', { ref: 'parenting/idea-0001', suggest: true });
  assert.deepEqual(suggested.suggestions.map((item) => item.ref).sort(), ['parenting/action-0001', 'parenting/concept-0001']);
  assert.match(await say('kb_links', { ref: 'parenting/idea-0001', suggest: true }), /可能相关、还没有关联的卡片（2，先 kb_read 确认/);
  await assert.rejects(call('kb_links', { ref: 'parenting/concept-0001', suggest: 'yes' }), /suggest 必须是 true 或 false/);
});

test('notes_books: what there is to organise, and how far each book has come', async (t) => {
  const { call, say } = mounted(t);
  const all = await call('notes_books');
  assert.deepEqual(all.items.map((row) => [row.title, row.stage]), [
    ['把整颗心献给孩子', 'pending'], ['某公众号', 'pending'], ['孩子的大脑', 'organized'], ['金钱心理学：财富、人性和幸福的永恒真相', 'organized'],
  ]);
  assert.deepEqual(all.stages, { pending: 2, registered: 0, organized: 2 });
  assert.ok(!('entry' in all.items[0]), 'only plain data leaves the tool');
  JSON.stringify(all);

  const text = await say('notes_books');
  assert.match(text, /- 《把整颗心献给孩子》 苏霍姆林斯基 — 未整理 · 1 条笔记 · 1 章\n  来源：\.weread-sync\/raw_notes\/把整颗心献给孩子\/raw\.json · bookId `901`/);
  assert.match(text, /- 《某公众号》 公众号 — 未整理 · 公众号 · 1 条笔记/);
  assert.match(text, /- 《孩子的大脑》 阿尔瓦罗·毕尔巴鄂 — 已整理 · 书目卡 `parenting\/book-0001` · 6 条笔记 · 3 章 · 来源笔记 1 \/ 概念 1 \/ 行动 1 \/ 主题包 1 \/ 想法 1\n  来源：notes\/育儿\/孩子的大脑\.md；\.weread-sync\/raw_notes\/孩子的大脑\/raw\.json · bookId `902`/);

  assert.deepEqual((await call('notes_books', { stage: 'pending', kind: 'book' })).items.map((row) => row.title), ['把整颗心献给孩子']);
  assert.deepEqual((await call('notes_books', { q: '豪泽尔' })).items.map((row) => row.card), ['investing/book-0002']);
  assert.deepEqual((await call('notes_books', { subject: '育儿' })).items.map((row) => row.title), ['孩子的大脑']);
  const paged = await call('notes_books', { limit: 1, offset: 1 });
  assert.deepEqual([paged.items[0].title, paged.total, paged.next_offset], ['某公众号', 4, 2]);
});

test('notes_books: a book card without notes yet is registered; a card whose notes are gone says so', async (t) => {
  const { kbDir, say } = mounted(t);
  writeTree(kbDir, {
    'sources/books/parenting/book-parenting-0002-heart.md': card('doc_type: source_book\nschema_version: 2\nid: book-parenting-0002\ntitle_zh: 把整颗心献给孩子\nweread_book_id: "901"\nstatus: draft', '# 书籍定位'),
    'sources/books/work/book-0009-lost.md': card('doc_type: source_book\nid: book-0009\ntitle_zh: 一本找不到笔记的书\nstatus: active', '# 书籍定位'),
  });
  const text = await say('notes_books');
  assert.match(text, /（未整理 1 \/ 已建档 2 \/ 已整理 2）/);
  assert.match(text, /- 《把整颗心献给孩子》 苏霍姆林斯基 — 已建档 · 书目卡 `parenting\/book-parenting-0002` · 1 条笔记 · 1 章 · 还没有卡片/);
  assert.match(text, /- 《一本找不到笔记的书》 — 已建档 · 书目卡 `work\/book-0009` · 仓库里没有原始笔记 · 还没有卡片/);
});

test('notes_read: one book in book order, by page, chapter and kind', async (t) => {
  const { call, say } = mounted(t);
  const text = await say('notes_read', { book: '孩子的大脑' });
  assert.match(text, /^《孩子的大脑》 阿尔瓦罗·毕尔巴鄂 — 已整理（书目卡 `parenting\/book-0001`） · 来源 notes\/育儿\/孩子的大脑\.md · bookId `902`\n6 条笔记（想法 5 \/ 划线 1）；本页 #1 到 #6。/);
  assert.match(text, /另一个来源 \.weread-sync\/raw_notes\/孩子的大脑\/raw\.json 有 1 条，传 source: raw 可读。/);
  assert.match(text, /章节（3）：点评 ×1、第一章 安全感是地基 ×3、第二章 惩罚为什么没用？ ×2/);
  assert.match(text, /### 点评\n\n\*\*#1\*\* · 点评（认为好看） · 2024\/06\/26\n作者从大脑发育的阶段讲怎么教育孩子，很实用！/);
  assert.match(text, /\*\*#3\*\* · 想法 · 2024\/06\/21\n三件小事值得每天做\n> 每天可以做的三件小事：\n> 抱一抱\n> 说出他的感受\n> 一起收拾/);
  assert.match(text, /\*\*#4\*\* · 划线\n> 边界要说得真实而尊重/);

  const page = await call('notes_read', { book: '孩子的大脑', limit: 2 });
  assert.deepEqual([page.items.map((item) => item.n), page.next_from, page.outline.length], [[1, 2], 3, 3]);
  const next = await call('notes_read', { book: '孩子的大脑', limit: 2, from: 3 });
  assert.deepEqual([next.items.map((item) => item.n), next.next_from, next.outline], [[3, 4], 5, null]);
  assert.match(await say('notes_read', { book: '孩子的大脑', limit: 2 }), /> 还没读完：用 from=3 继续。/);

  const chapter = await call('notes_read', { book: 'parenting/book-0001', chapter: '惩罚' });
  assert.deepEqual([chapter.items.map((item) => item.n), chapter.filtered], [[5, 6], 2]);
  await assert.rejects(call('notes_read', { book: '孩子的大脑', chapter: '第九章' }), /没有名字包含「第九章」的章节。章节有：点评、第一章 安全感是地基、第二章 惩罚为什么没用？/);
  assert.deepEqual((await call('notes_read', { book: '孩子的大脑', kind: 'highlight' })).items.map((item) => item.n), [4]);

  // The synced data carries the WeRead ids a source note should keep.
  const raw = await say('notes_read', { book: '金钱心理学', from: 3 });
  assert.match(raw, /— 已整理（书目卡 `investing\/book-0002`） · 来源 \.weread-sync\/raw_notes\/金钱心理学\/raw\.json · bookId `900`/);
  assert.match(raw, /### 第4章 复利之谜\n\n\*\*#3\*\* · 想法 · 2025\/06\/1\d · reviewId `r-money-2` · chapterUid 7 · range `300-360`\n复利需要时间，而时间需要活下来\n> 巴菲特的财富大部分来自六十岁以后。/);
  assert.match(raw, /\*\*#4\*\* · 划线 · 2025\/06\/1\d · bookmarkId `m-money-2` · chapterUid 7 · range `900-950`/);
  assert.equal((await call('notes_read', { book: '孩子的大脑', source: 'raw' })).total, 1);
  await assert.rejects(call('notes_read', { book: '金钱心理学', source: 'archive' }), /没有 Markdown 档案/);
  await assert.rejects(call('notes_read', {}), /book 不能为空/);
});

test('notes_read pages by size as well as by count', async (t) => {
  const { repo, call } = mounted(t);
  const long = Array.from({ length: 30 }, (_, index) => `◆ 2024/01/${String(index + 1).padStart(2, '0')}发表想法\n\n第 ${index + 1} 条想法：${'想'.repeat(900)}\n\n原文：${'文'.repeat(1500)}第 ${index + 1} 段。`).join('\n\n');
  writeTree(repo, { 'notes/工作/长书.md': `《长书》\n\n作者\n30个笔记\n\n第一章\n\n${long}\n` });
  const first = await call('notes_read', { book: '长书' });
  assert.ok(first.items.length < 30 && first.items.length >= 5, `a page holds ${first.items.length} notes`);
  assert.equal(first.next_from, first.items.length + 1);
  const seen = new Set();
  for (let from = 1; from !== null;) {
    const page = await call('notes_read', { book: '长书', from });
    for (const item of page.items) seen.add(item.n);
    from = page.next_from;
  }
  assert.equal(seen.size, 30, 'paging reaches every note exactly once');
});

test('notes_search: the reader\'s own words and the passages, with where each book stands', async (t) => {
  const { call, say } = mounted(t);
  const text = await say('notes_search', { q: '后果和惩罚' });
  assert.match(text, /^原始笔记共 1 条命中，分布在 1 本书（《孩子的大脑》1）。显示前 1 条：\n- 《孩子的大脑》#5 · 第二章 惩罚为什么没用？ · 2024\/06\/22（已整理 `parenting\/book-0001`）\n  想法：后果不是惩罚\n  原文：孩子更容易在自然后果里学会规则/);
  const pending = await call('notes_search', { q: '健康', book: '把整颗心' });
  assert.deepEqual(pending.items.map((item) => [item.book, item.n, item.stage, item.card]), [['把整颗心献给孩子', 1, 'pending', null]]);
  assert.equal((await call('notes_search', { q: '预测', kind: 'highlight' })).total, 1);
  assert.equal((await call('notes_search', { q: '复利', kind: 'highlight' })).total, 0, 'a highlight in the chapter 复利之谜 that does not say 复利');
  assert.equal((await call('notes_search', { q: '复利', limit: 1 })).items.length, 1);
  assert.match(await say('notes_search', { q: '量子纠缠' }), /原始笔记里没有命中/);
  await assert.rejects(call('notes_search', { q: '复利', book: '三体' }), /没有找到「三体」/);
});

test('kb_schema: types and subjects, then everything needed to write one card', async (t) => {
  const { repo, kbDir, call, say } = mounted(t, { maintain: true });
  const types = await say('kb_schema');
  assert.match(types, /- `concept_card` 概念卡：回答“这是什么意思、为什么重要”；id 前缀 concept，放在 concepts\/<主题域>\/，现有 3 张/);
  assert.match(types, /主题域：`parenting` 育儿、`investing` 投资、`work` 工作/);

  const schema = await call('kb_schema', { doc_type: 'concept_card', subject: '育儿', slug: 'natural-consequences' }, sessionExec(repo));
  assert.equal(schema.next_id, 'concept-parenting-0002');
  assert.equal(schema.write_path, `${KB_DIR}/concepts/parenting/concept-parenting-0002-natural-consequences.md`);
  assert.equal(schema.file, path.join(kbDir, 'concepts', 'parenting', 'concept-parenting-0002-natural-consequences.md'));
  assert.deepEqual(schema.ref_fields, ['source_refs', 'related_actions']);
  assert.deepEqual(schema.controlled, [{ field: 'concept_type', values: ['principle', 'mental_model'] }, { field: 'claim_basis', values: ['direct_book_note', 'multi_book_synthesis'] }]);
  const text = await say('kb_schema', { doc_type: 'concept_card', subject: '育儿', slug: 'natural-consequences' }, sessionExec(repo));
  assert.match(text, /^\*\*概念卡\*\*（concept_card） · 主题域 育儿（`parenting`）\n- 下一个 id：`concept-parenting-0002`（同主题域已有 1 张）/);
  assert.match(text, /新卡写 schema_version: 2、status: draft、last_reviewed: \d{4}-\d{2}-\d{2}/);
  assert.match(text, /- concept_type 只能用：principle、mental_model/);
  assert.match(text, /模板（_templates\/concept_card_template\.md），把示例值都换掉：\n\n---\ndoc_type: concept_card/);

  // v2 ids count on from the older ones, per subject and per type.
  assert.equal((await call('kb_schema', { doc_type: 'concept_card', subject: 'investing' })).next_id, 'concept-investing-0003');
  assert.equal((await call('kb_schema', { doc_type: 'source_book', subject: 'work' })).next_id, 'book-work-0001');
  assert.equal((await call('kb_schema', { doc_type: 'idea_seed' })).next_id, null);

  // From a session directory that does not contain the knowledge base, the path is absolute and the tool warns.
  const elsewhere = await call('kb_schema', { doc_type: 'action_card', subject: 'work', slug: 'x' }, sessionExec(tempDir(t)));
  assert.equal(elsewhere.write_path, elsewhere.file);
  assert.match(elsewhere.location, /⚠ 当前会话目录.*请在 dadventures 仓库目录新开会话/);
  await assert.rejects(call('kb_schema', { doc_type: 'concept_card', subject: 'work', slug: 'Bad Slug' }), /slug 只能用小写英文字母/);
  await assert.rejects(call('kb_schema', { doc_type: 'essay' }), /doc_type 只能是 source_book/);
});

test('writing a card: schema, write, check, and it is searchable at once', async (t) => {
  const { repo, call, say } = mounted(t, { maintain: true });
  const schema = await call('kb_schema', { doc_type: 'concept_card', subject: 'parenting', slug: 'natural-consequences' }, sessionExec(repo));
  assert.ok(!existsSync(schema.file));
  writeFileSync(schema.file, card(`
doc_type: concept_card
schema_version: 2
id: ${schema.next_id}
title: natural-consequences
title_zh: 自然后果不是惩罚
status: draft
subject_domains:
  - parenting
concept_type: principle
claim_basis: direct_book_note
source_refs:
  - note-0001
  - investing/note-0001
last_reviewed: ${schema.today}
`, '# 核心定义\n\n后果让孩子自己学会规则。'), 'utf8');
  const checked = await call('kb_check', { paths: [schema.write_path] });
  assert.deepEqual([checked.ok, checked.checked, checked.errors, checked.warnings], [true, 1, [], []]);
  assert.equal((await call('kb_search', { q: '自然后果' })).items[0].ref, 'parenting/concept-parenting-0002');
  assert.equal((await call('kb_schema', { doc_type: 'concept_card', subject: 'parenting' })).next_id, 'concept-parenting-0003');

  writeFileSync(schema.file, card(`doc_type: concept_card\nschema_version: 2\nid: ${schema.next_id}\ntitle_zh: 自然后果不是惩罚\nstatus: done\nconcept_type: hunch\nsource_refs:\n  - note-0404`, '# x'), 'utf8');
  const broken = await say('kb_check', { paths: ['parenting/concept-parenting-0002'] });
  assert.match(broken, /^检查了 1 张卡片：3 个错误，0 个提醒。/);
  assert.match(broken, /✗ concepts\/parenting\/concept-parenting-0002-natural-consequences\.md concept_type 的值 hunch 不在 taxonomy\.md 的 Concept Types 里。/);
  assert.match(broken, /status 的值 done/);
  assert.match(broken, /source_refs 引用的 note-0404 找不到。/);
  assert.match(broken, /错误必须修完/);
  await assert.rejects(call('kb_check', { paths: ['concepts/parenting/nothing.md'] }), /没有找到这些卡片/);
});

test('kb_check sweep: every error, a few reminders per rule', async (t) => {
  const { kbDir, call, say } = mounted(t, { maintain: true });
  const clean = await say('kb_check');
  assert.match(clean, /^检查了 10 张卡片：0 个错误，2 个提醒。\n- ! sources\/books\/investing\/book-0002-investing-01\.md status 只用 draft \/ reviewed \/ published，现在是 active。/);
  assert.match(clean, /没有错误。$/);
  assert.match(await say('kb_check', { warnings: false }), /^检查了 10 张卡片：0 个错误，2 个提醒。\n没有错误。$/);
  assert.equal((await call('kb_check', { subject: '投资' })).checked, 4);
  assert.equal((await call('kb_check', { strict: true })).errors.length, 2);

  writeTree(kbDir, Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `sources/books/work/book-00${index + 10}-work.md`, card(`doc_type: source_book\nid: book-00${index + 10}\ntitle_zh: 旧书 ${index}\nstatus: active`, '# x'),
  ])));
  const swept = await call('kb_check');
  assert.equal(swept.warnings.length, 10);
  assert.equal(swept.shown.length, 5);
  assert.deepEqual(swept.folded, [{ rule: 'status', more: 5 }]);
  assert.match(await say('kb_check'), /- ! 同类提醒还有 5 条（status）/);
});

test('a tools row can name its own repository; without any it explains how to configure one', async (t) => {
  const { repo } = repoFixture(t);
  const own = fakeHost();
  createKbTools(own.ctx, { repoRoot: repo });
  assert.equal((await own.call('kb_overview')).total, 10);

  const saved = process.env.DADVENTURES_ROOT;
  delete process.env.DADVENTURES_ROOT;
  t.after(() => { if (saved !== undefined) process.env.DADVENTURES_ROOT = saved; });
  const none = fakeHost();
  createKbTools(none.ctx, { maintain: true });
  assert.deepEqual([...none.skills.keys()], ['kb-answer', 'weread-organize-book', 'kb-contribute', 'weread-sync'], 'built-in skills still register');
  await assert.rejects(none.call('kb_search', { q: '安全感' }), (error) => error.code === 'NOT_CONFIGURED' && /install-dadventures/.test(error.message));
  process.env.DADVENTURES_ROOT = repo;
  const fromEnv = fakeHost();
  createKbTools(fromEnv.ctx);
  assert.equal((await fromEnv.call('kb_overview')).total, 10);
  delete process.env.DADVENTURES_ROOT;
});
