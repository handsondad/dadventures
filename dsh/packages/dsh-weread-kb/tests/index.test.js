import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkKnowledge } from '../src/check.js';
import { parseFrontmatter } from '../src/frontmatter.js';
import { createKnowledgeIndex, nextId } from '../src/index.js';
import { parseTaxonomy } from '../src/layout.js';
import { queryTerms, rank, squash } from '../src/search.js';
import { TAXONOMY, KB_DIR, card, repoFixture, writeTree } from './helpers.js';

const rules = (issues) => issues.map((issue) => `${issue.rule}:${issue.path}`).sort();

test('frontmatter: scalars, quoted values, inline and block lists', () => {
  const { data, body, frontmatter } = parseFrontmatter('---\r\nid: note-0001\r\ntitle_zh: "带：冒号"\r\ntags: [a, "b"]\r\nrefs:\r\n  - x-1\r\n  - y-2\r\nempty:\r\n---\r\n\r\n# 正文\r\n');
  assert.equal(frontmatter, true);
  assert.equal(data.id, 'note-0001');
  assert.equal(data.title_zh, '带：冒号');
  assert.deepEqual(data.tags, ['a', 'b']);
  assert.deepEqual(data.refs, ['x-1', 'y-2']);
  assert.equal(body.trim(), '# 正文');
  assert.equal(parseFrontmatter('# 没有 frontmatter\n').frontmatter, false);
});

test('taxonomy: sections, and Chinese names for subject domains', () => {
  const taxonomy = parseTaxonomy(TAXONOMY);
  assert.deepEqual(taxonomy.subjects, [{ id: 'parenting', label: '育儿' }, { id: 'investing', label: '投资' }, { id: 'work', label: '工作' }]);
  assert.deepEqual([...taxonomy.sections.get('Claim Basis')], ['direct_book_note', 'multi_book_synthesis']);
  assert.deepEqual([...taxonomy.sections.get('Status')], ['draft', 'reviewed', 'published']);
});

test('search text: Chinese without spaces, and titles compared without punctuation', () => {
  const terms = queryTerms('安全感怎么影响大脑');
  assert.ok(terms.grams.includes('安全') && terms.grams.includes('大脑'));
  assert.ok(!terms.grams.includes('怎么'));
  const kinds = queryTerms('复利 CRISPR 第一性原理 为什么长期主义很难坚持');
  assert.deepEqual(kinds.plain, ['复利', 'crispr']);
  assert.deepEqual(kinds.keywords.map((item) => item.term), ['第一性原理']);
  assert.deepEqual(kinds.sentences.map((item) => item.term), ['为什么长期主义很难坚持']);

  const texts = ['安全感是大脑健康发育的基础', '安全边际留给意外', '复利需要时间', '最危险的时候是最有信心的时候', '改革的时候', '那个时候的故事', '大脑还小', '发脾气是求助'];
  const own = (text) => [{ text, weight: 1 }];
  const search = (query, docs = texts) => {
    const { hits, missing } = rank(docs, queryTerms(query), { own });
    return { found: hits.sort((a, b) => b.score - a.score).map((hit) => hit.doc), missing };
  };
  // A sentence is matched by its words: the text that holds most of the question; 大脑 alone is far from it.
  assert.deepEqual(search('安全感怎么影响大脑').found, ['安全感是大脑健康发育的基础']);
  // 的时候 is everywhere and 发脾气 is not: the rare words decide, however often the common ones repeat.
  assert.equal(search('孩子发脾气的时候怎么办').found[0], '发脾气是求助');
  // A keyword the texts have is matched as written: 安全感 is not 安全边际.
  assert.deepEqual(search('安全感'), { found: ['安全感是大脑健康发育的基础'], missing: [] });
  // A keyword they do not have falls back to its fragments, and is reported as missing.
  assert.deepEqual(search('安全垫'), { found: ['安全感是大脑健康发育的基础', '安全边际留给意外'], missing: ['安全垫'] });
  assert.deepEqual(search('安全感 护城河'), { found: ['安全感是大脑健康发育的基础'], missing: ['护城河'] });
  assert.deepEqual(search('护城河'), { found: [], missing: ['护城河'] });
  assert.deepEqual(search(' ，'), { found: [], missing: [] });
  assert.deepEqual(search('复利', []), { found: [], missing: [] });
  assert.equal(squash('父母：挑战（果麦经典）'), squash('父母 挑战 果麦经典'));
});

test('a card is addressed by subject/id because subjects reuse ids', (t) => {
  const index = createKnowledgeIndex(repoFixture(t).kbDir);
  assert.equal(index.entries().length, 10);
  assert.equal(index.find('parenting/concept-0001').title, '安全感是大脑健康发育的基础');
  assert.equal(index.find('investing/concept-0001').title, '复利需要时间，而时间需要先活下来');
  assert.equal(index.find('投资/concept-0001').ref, 'investing/concept-0001');
  assert.equal(index.find(`${KB_DIR}/concepts/parenting/concept-0001-safe-base.md`).ref, 'parenting/concept-0001');
  assert.equal(index.find('concepts\\investing\\concept-0001-compounding').ref, 'investing/concept-0001');
  assert.equal(index.find('concept-investing-0002').ref, 'investing/concept-investing-0002');
  assert.throws(() => index.find('concept-0001'), /多个主题域.*investing\/concept-0001.*主题域\/id/s);
  assert.throws(() => index.find('concept-9999'), /知识库里没有/);
  // A source note without title_zh is titled by the section it covers.
  assert.equal(index.find('parenting/note-0001').title, '第一章 安全感是地基');
});

test('subjects by id, Chinese name, or part of it', (t) => {
  const index = createKnowledgeIndex(repoFixture(t).kbDir);
  assert.equal(index.subject('育儿').id, 'parenting');
  assert.equal(index.subject('INVESTING').id, 'investing');
  assert.throws(() => index.subject('天文'), /没有这个主题域.*parenting（育儿）/);
  assert.deepEqual(index.overview().map((subject) => [subject.id, subject.total]), [['parenting', 6], ['investing', 4], ['work', 0]]);
});

test('references resolve in the card\'s own subject first, and subject/id reaches another subject', (t) => {
  const index = createKnowledgeIndex(repoFixture(t).kbDir);
  const links = index.links(index.find('parenting/collection-0001'));
  assert.deepEqual(links.outgoing.map((link) => link.ref), ['parenting/concept-0001', 'parenting/action-0001', 'investing/concept-0001']);
  assert.deepEqual(links.incoming.map((link) => `${link.field}:${link.ref}`), ['theme_refs:parenting/idea-0001']);
  // Provenance follows source_refs / included_cards / theme_refs down to the book cards.
  assert.deepEqual(links.books.map((book) => book.title).sort(), ['孩子的大脑', '金钱心理学：财富、人性和幸福的永恒真相']);
  assert.deepEqual(index.links(index.find('parenting/idea-0001')).books.map((book) => book.ref).sort(), ['investing/book-0002', 'parenting/book-0001']);
  assert.deepEqual(index.links(index.find('investing/concept-0001')).incoming.map((link) => link.ref).sort(),
    ['investing/note-0001', 'parenting/collection-0001']);
});

test('search ranks by the words, the question type and the book', (t) => {
  const index = createKnowledgeIndex(repoFixture(t).kbDir);
  const concept = index.search('安全感', { intent: 'concept' });
  assert.equal(concept.items[0].ref, 'parenting/concept-0001');
  assert.deepEqual(concept.items[0].books, ['孩子的大脑']);
  assert.equal(index.search('安全感', { intent: 'howto' }).items[0].ref, 'parenting/action-0001');
  assert.deepEqual(index.search('安全感', { intent: 'ideas' }).items.slice(0, 2).map((item) => item.doc_type).sort(), ['collection', 'idea_seed']);
  // The book's title and the subject's Chinese name count as context for every card that goes back to them.
  assert.ok(index.search('金钱心理学 复利').items.some((item) => item.ref === 'investing/concept-0001'));
  const [book] = index.findBooks('金钱心理学');
  assert.equal(book.ref, 'investing/book-0002');
  const fromBook = index.search('', { books: [book] });
  assert.deepEqual(fromBook.items.map((item) => item.ref).sort(),
    ['investing/book-0002', 'investing/concept-0001', 'investing/concept-investing-0002', 'investing/note-0001', 'parenting/collection-0001', 'parenting/idea-0001']);
  // 安全边际 shares one fragment with 安全感: not a hit beside cards that say 安全感, a fallback when there are none.
  assert.ok(!index.search('安全感', { limit: 30 }).items.some((item) => item.ref === 'investing/concept-investing-0002'));
  assert.equal(index.search('安全感', { subject: '投资' }).items[0].ref, 'investing/concept-investing-0002');
  assert.equal(index.search('怎么才能让孩子多喝水呢').total, 0, 'of a long question, one shared fragment is chance');
  assert.equal(index.search('', { docType: 'collection' }).total, 1);
  assert.equal(index.search('量子纠缠').total, 0);
  assert.equal(index.search('模板正文').total, 0, '_templates is not content');
});

test('the index follows the files: new, changed and deleted cards', (t) => {
  const { kbDir } = repoFixture(t);
  const index = createKnowledgeIndex(kbDir);
  assert.equal(index.search('延迟满足').total, 0);
  writeTree(kbDir, { 'concepts/parenting/concept-parenting-0002-delay.md': card('doc_type: concept_card\nschema_version: 2\nid: concept-parenting-0002\ntitle_zh: 延迟满足不是忍耐\nstatus: draft', '# 核心定义\n\n延迟满足。') });
  assert.equal(index.search('延迟满足').items[0].ref, 'parenting/concept-parenting-0002');
  rmSync(path.join(kbDir, 'concepts', 'parenting', 'concept-parenting-0002-delay.md'));
  assert.equal(index.search('延迟满足').total, 0);
});

test('nextId continues after the highest number the subject uses, old style or new', () => {
  assert.equal(nextId(['concept-0001', 'concept-0068', 'concept-parenting-0070'], 'concept', 'parenting'), 'concept-parenting-0071');
  assert.equal(nextId([], 'note', 'work'), 'note-work-0001');
  assert.equal(nextId(['collection-0003', 'concept-0100'], 'collection', 'investing'), 'collection-investing-0004');
});

test('check: the fixture is valid; older book cards only get a reminder about their status', (t) => {
  const index = createKnowledgeIndex(repoFixture(t).kbDir);
  const result = checkKnowledge(index);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 10);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(rules(result.warnings), ['status:sources/books/investing/book-0002-investing-01.md', 'status:sources/books/parenting/book-0001-parenting-01.md']);
  assert.equal(checkKnowledge(index, { subject: 'investing' }).checked, 4);
  assert.equal(checkKnowledge(index, { paths: [`${KB_DIR}/concepts/parenting/concept-0001-safe-base.md`, 'investing/concept-0001'] }).checked, 2);
  // --strict-taxonomy holds older cards to the vocabulary too: `active` is then an error, as in the Python validator.
  assert.deepEqual(rules(checkKnowledge(index, { strictTaxonomy: true }).errors),
    ['taxonomy:sources/books/investing/book-0002-investing-01.md', 'taxonomy:sources/books/parenting/book-0001-parenting-01.md']);
});

test('check: every rule of validate_knowledge.py is an error', (t) => {
  const { kbDir } = repoFixture(t);
  writeTree(kbDir, {
    'concepts/work/no-frontmatter.md': '# 没有 frontmatter\n',
    'concepts/work/concept-0001-missing.md': card('doc_type: concept_card\nid: concept-0001\ntitle_zh: 缺状态', '# x'),
    'concepts/work/concept-0002-type.md': card('doc_type: essay\nid: concept-0002\nstatus: draft', '# x'),
    'concepts/work/concept-0003-v2-id.md': card('doc_type: concept_card\nschema_version: 2\nid: concept-0003\nstatus: draft\ntitle_zh: v2 要新格式的 id', '# x'),
    'concepts/work/concept-work-0004-placeholder.md': card('doc_type: concept_card\nschema_version: 2\nid: concept-work-0004\ntitle: fill_in_short_slug\nstatus: draft', '# x'),
    'concepts/work/concept-work-0005-taxonomy.md': card('doc_type: concept_card\nschema_version: 2\nid: concept-work-0005\nstatus: active\nconcept_type: hunch\nsubject_domains:\n  - work\n  - cooking', '# x'),
    'concepts/work/concept-0006-a.md': card('doc_type: concept_card\nid: concept-0006\nstatus: draft', '# x'),
    'concepts/work/concept-0006-b.md': card('doc_type: concept_card\nid: concept-0006\nstatus: draft', '# x'),
    'actions/work/action-0001-refs.md': card('doc_type: action_card\nid: action-0001\nstatus: draft\nsource_refs:\n  - note-0001\n  - note-4040\n  - parenting/note-0001\n  - parenting/note-4040\nrelated_cards:\n  - concept-7777', '# x'),
  });
  const result = checkKnowledge(createKnowledgeIndex(kbDir), { subject: 'work' });
  assert.equal(result.ok, false);
  const errors = result.errors.map((issue) => `${issue.rule}:${path.basename(issue.path)}:${issue.message}`);
  const has = (pattern) => assert.ok(errors.some((line) => pattern.test(line)), `${pattern} in\n${errors.join('\n')}`);
  has(/^frontmatter:no-frontmatter\.md/);
  has(/^required:concept-0001-missing\.md:缺少 status/);
  has(/^doc_type:concept-0002-type\.md:不认识的 doc_type essay/);
  has(/^id:concept-0003-v2-id\.md:schema_version 2 的 id/);
  has(/^placeholder:concept-work-0004-placeholder\.md/);
  has(/^taxonomy:concept-work-0005-taxonomy\.md:concept_type 的值 hunch/);
  has(/^taxonomy:concept-work-0005-taxonomy\.md:subject_domains 的值 cooking/);
  has(/^taxonomy:concept-work-0005-taxonomy\.md:status 的值 active/);
  has(/^duplicate:concept-0006-a\.md/);
  has(/^duplicate:concept-0006-b\.md/);
  // note-0001 is in two other subjects: ambiguous. note-4040 is nowhere. parenting/note-0001 is exact.
  has(/^ref:action-0001-refs\.md:source_refs 引用的 note-0001 在多个主题域里都有/);
  has(/^ref:action-0001-refs\.md:source_refs 引用的 note-4040 找不到/);
  has(/^ref:action-0001-refs\.md:source_refs 引用的 parenting\/note-4040 找不到/);
  assert.ok(!errors.some((line) => line.includes('parenting/note-0001 ')), 'the qualified ref resolves');
  assert.equal(result.errors.length, 13);
  // Links the Python validator does not look at are reminders, not errors.
  assert.ok(result.warnings.some((issue) => issue.rule === 'ref' && /related_cards 引用的 concept-7777 找不到/.test(issue.message)));
});

test('check: reminders about file names, folders, subjects and missing sources', (t) => {
  const { kbDir } = repoFixture(t);
  writeTree(kbDir, {
    'concepts/parenting/wrong-name.md': card('doc_type: concept_card\nid: concept-0050\nstatus: draft\nsource_refs:\n  - note-0001', '# x'),
    'concepts/parenting/concept-0051-中文名.md': card('doc_type: concept_card\nid: concept-0051\nstatus: draft\nsource_refs:\n  - note-0001', '# x'),
    'concepts/parenting/action-0052-misfiled.md': card('doc_type: action_card\nid: action-0052\nstatus: draft\nsource_refs:\n  - note-0001', '# x'),
    'concepts/parenting/concept-investing-0053-subject.md': card('doc_type: concept_card\nschema_version: 2\nid: concept-investing-0053\nstatus: draft\nsource_refs:\n  - note-0001', '# x'),
    'concepts/parenting/concept-0054-orphan.md': card('doc_type: concept_card\nid: concept-0054\nstatus: draft', '# x'),
    'sources/notes/parenting/note-0055-no-book.md': card('doc_type: source_note\nid: note-0055\nstatus: draft', '# x'),
    'sources/notes/parenting/note-0056-manual.md': card('doc_type: source_note\nid: note-0056\nsource_book: manual_synthesis\nstatus: draft', '# x'),
    'concepts/cooking/concept-0001-new-subject.md': card('doc_type: concept_card\nid: concept-0001\nstatus: draft\nsource_refs:\n  - parenting/note-0001', '# x'),
  });
  const result = checkKnowledge(createKnowledgeIndex(kbDir));
  assert.deepEqual(result.errors, []);
  const warnings = result.warnings.filter((issue) => issue.rule !== 'status').map((issue) => `${issue.rule}:${path.basename(issue.path)}`).sort();
  assert.deepEqual(warnings, [
    'filename:concept-0051-中文名.md', 'filename:wrong-name.md', 'folder:action-0052-misfiled.md', 'id:concept-investing-0053-subject.md',
    'source:concept-0054-orphan.md', 'source:note-0055-no-book.md', 'subject:cooking',
  ]);
});

test('check: a raw_source_path or a Markdown link that leads nowhere is a reminder', (t) => {
  const { kbDir } = repoFixture(t);
  const front = 'doc_type: source_note\nsource_book: book-0001\nstatus: draft';
  writeTree(kbDir, {
    'sources/notes/parenting/note-0060-good.md': card(`${front}\nid: note-0060\nraw_source_path: "notes/育儿/孩子的大脑.md"`,
      '看 [安全基地](../../../concepts/parenting/concept-0001-safe-base.md#定义)、[同目录](note-0001-safe-base.md)、[网页](https://example.com/a.md)、[原文](weread://reading?bId=1) 和 [本页](#小结)。'),
    'sources/notes/parenting/note-0061-stale.md': card(`${front}\nid: note-0061\nraw_source_path: "微信读书笔记/育儿/孩子的大脑.md"`,
      '看 [旧路径](weread_kb/agent/workspace/concepts/parenting/concept-0001-safe-base.md)。'),
  });
  const result = checkKnowledge(createKnowledgeIndex(kbDir), { paths: ['parenting/note-0060', 'parenting/note-0061'] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings.map((issue) => `${issue.rule}:${path.basename(issue.path)}:${issue.message}`), [
    'path:note-0061-stale.md:raw_source_path 指向的 微信读书笔记/育儿/孩子的大脑.md 不存在（路径相对仓库根目录）。',
    'path:note-0061-stale.md:正文里的链接 weread_kb/agent/workspace/concepts/parenting/concept-0001-safe-base.md 打不开（链接相对这张卡所在的目录）。',
  ]);
});
