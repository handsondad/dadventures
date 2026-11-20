import assert from 'node:assert/strict';
import test from 'node:test';
import { repoPaths } from '../src/layout.js';
import { createKbService } from '../src/service.js';
import { createSourceIndex, parseArchive, parseRaw, wereadLink } from '../src/sources.js';
import { ARCHIVE, repoFixture, writeTree } from './helpers.js';

const brief = (item) => [item.n, item.kind, item.chapter, item.thought, item.text];

test('WeRead export: rating, chapters, thoughts with their passage, the repeated highlight dropped', () => {
  const archive = parseArchive(ARCHIVE, '文件名');
  assert.equal(archive.title, '孩子的大脑');
  assert.equal(archive.author, '阿尔瓦罗·毕尔巴鄂');
  assert.deepEqual(archive.items.map(brief), [
    [1, 'thought', '点评', '作者从大脑发育的阶段讲怎么教育孩子，很实用！', ''],
    [2, 'thought', '第一章 安全感是地基', '安全感是大脑发育的地基', '孩子受惊时，大人先冷静地接住他，大脑才会从警报状态回到可以学习的状态。'],
    // A passage that runs over several paragraphs stays one passage; the image placeholders are gone.
    [3, 'thought', '第一章 安全感是地基', '三件小事值得每天做', '每天可以做的三件小事：\n抱一抱\n说出他的感受\n一起收拾'],
    [4, 'highlight', '第一章 安全感是地基', '', '边界要说得真实而尊重，不靠吓唬和羞辱。'],
    // The highlight repeats the passage and runs longer: the longer text is kept, once.
    [5, 'thought', '第二章 惩罚为什么没用？', '后果不是惩罚', '孩子更容易在自然后果里学会规则，而不是在惩罚里。图2-1展示了两者的差别。'],
    [6, 'thought', '第二章 惩罚为什么没用？', '这一章没有划线的想法', ''],
  ]);
  assert.equal(archive.items[0].rating, '认为好看');
  assert.equal(archive.items[1].date, '2024/06/20');
});

test('WeRead export: what follows a passage is more passage or the next chapter', () => {
  const archive = parseArchive([
    '《书》', '作者\n4个笔记',
    '点评', '◆ 2023/02/23 认为好看',
    '1 首先，这是一份工作',
    '◆ 2023/02/24发表想法', '想法一', '原文：第一段原文。', '图1-1 一张图的说明', '所有的一切都始于一个拥抱！',
    '◆ 第一段原文。\n图1-1 一张图的说明\n所有的一切都始于一个拥抱！',
    '第三章 很长的章节名，为什么繁荣反而加速了大革命的到来',
    '◆ 只有划线的一段。', '划线的第二段，是一句完整的话。', '第四章 到底在想什么？',
    '◆ 2023/02/25发表想法', '想法的第一段', '想法的第二段，没有句号', '原文：第二段原文。',
  ].join('\n\n'));
  assert.deepEqual(archive.items.map(brief), [
    // A rating with no review: the line after it is the first chapter.
    [1, 'thought', '点评', '', ''],
    [2, 'thought', '1 首先，这是一份工作', '想法一', '第一段原文。\n图1-1 一张图的说明\n所有的一切都始于一个拥抱！'],
    [3, 'highlight', '第三章 很长的章节名，为什么繁荣反而加速了大革命的到来', '', '只有划线的一段。\n划线的第二段，是一句完整的话。'],
    [4, 'thought', '第四章 到底在想什么？', '想法的第一段\n想法的第二段，没有句号', '第二段原文。'],
  ]);
});

test('json2md output: bookId, locators, and the highlight section', () => {
  const archive = parseArchive([
    '《金钱心理学》', '摩根·豪泽尔', '微信读书 bookId：`900`', '1 条划线，2 条想法/点评（同步时间：2026/01/01）',
    '点评', '◆ 2025/06/15发表想法', '整本书最打动我的是“够了”', '来源定位：reviewId: `r0`；[在微信读书打开](weread://reading?bId=900)',
    '第4章 复利之谜', '◆ 2025/06/16发表想法', '复利需要时间', '来源定位：reviewId: `r1`；chapterUid: `7`；range: `300-360`；[在微信读书打开](weread://x)', '原文：巴菲特的财富大部分来自六十岁以后。',
    '划线', '### 第4章 复利之谜', '> 安全边际的意义是让预测变得不必要。', '划线时间：2025/06/17\n来源定位：bookmarkId: `m2`；chapterUid: `7`；range: `900-950`',
  ].join('\n\n'), 'x');
  assert.equal(archive.author, '摩根·豪泽尔');
  assert.equal(archive.bookId, '900');
  assert.deepEqual(archive.items.map(brief), [
    [1, 'thought', '点评', '整本书最打动我的是“够了”', ''],
    [2, 'thought', '第4章 复利之谜', '复利需要时间', '巴菲特的财富大部分来自六十岁以后。'],
    [3, 'highlight', '第4章 复利之谜', '', '安全边际的意义是让预测变得不必要。'],
  ]);
  assert.deepEqual([archive.items[1].reviewId, archive.items[1].chapterUid, archive.items[1].range], ['r1', 7, '300-360']);
  assert.deepEqual([archive.items[2].bookmarkId, archive.items[2].date], ['m2', '2025/06/17']);
});

test('an empty or headerless archive is still a book', () => {
  assert.deepEqual(parseArchive('', '纳瓦尔宝典'), { title: '纳瓦尔宝典', author: '', bookId: '', items: [] });
  assert.equal(parseArchive('第一章\n\n◆ 一段划线', '无题').items[0].chapter, '第一章');
});

test('raw.json: book order, chapter names from the chapter list, a mark under a review is not repeated', (t) => {
  const { repo } = repoFixture(t);
  const sources = createSourceIndex(repoPaths(repo));
  const money = sources.books().find((book) => book.bookId === '900').raw;
  assert.deepEqual(money.items.map((item) => [item.n, item.kind, item.chapter, item.reviewId ?? item.bookmarkId]), [
    [1, 'thought', '', 'r-money-0'],
    [2, 'thought', '第1章 没有人真的疯了', 'r-money-1'],
    [3, 'thought', '第4章 复利之谜', 'r-money-2'],
    [4, 'highlight', '第4章 复利之谜', 'm-money-2'],
  ]);
  assert.deepEqual([money.total, money.thoughts, money.highlights], [4, 3, 1]);
  assert.equal(wereadLink('900', money.items[2]), 'weread://bestbookmark?bookId=900&chapterUid=7&rangeStart=300&rangeEnd=360');
  assert.equal(wereadLink('900', { chapterUid: 0, range: '' }), '');
  assert.deepEqual(parseRaw({ title: 'x', reviews: [{ content: ' ', abstract: '' }] }).items, []);
});

test('an archive and a raw.json of the same book are one book; unreadable files are reported, not fatal', (t) => {
  const { repo } = repoFixture(t);
  const sources = createSourceIndex(repoPaths(repo));
  const books = sources.books();
  assert.deepEqual(books.map((book) => [book.title, book.kind, Boolean(book.archive), Boolean(book.raw)]), [
    ['孩子的大脑', 'book', true, true],
    ['把整颗心献给孩子', 'book', false, true],
    ['某公众号', 'mp', false, true],
    ['金钱心理学：财富、人性和幸福的永恒真相', 'book', false, true],
  ]);
  const brain = books[0];
  assert.equal(brain.bookId, '902');
  assert.equal(brain.category, '育儿');
  // The archive holds more notes than the sync, so it is the one to read.
  assert.equal(sources.pick(brain).source, 'archive');
  assert.equal(sources.pick(brain, 'raw').total, 1);
  assert.throws(() => sources.pick(books[1], 'archive'), /没有 Markdown 档案/);
  assert.deepEqual(sources.problems().map((problem) => problem.replace(/：.*/s, '')), ['.weread-sync/raw_notes/坏掉的/raw.json 读不了']);
  assert.equal(sources.books(), books, 'unchanged files are not merged again');
});

test('notes search: across books, one book, one kind; one stray fragment is not a hit', (t) => {
  const { repo } = repoFixture(t);
  const sources = createSourceIndex(repoPaths(repo));
  const found = sources.search('复利');
  // The two notes that say 复利; the highlight that merely sits in the chapter 复利之谜 is not a hit beside them.
  assert.deepEqual(found.items.map((hit) => [hit.book.title, hit.item.n]), [['某公众号', 1], ['金钱心理学：财富、人性和幸福的永恒真相', 3]]);
  assert.deepEqual(found.books, [{ title: '某公众号', hits: 1 }, { title: '金钱心理学：财富、人性和幸福的永恒真相', hits: 1 }]);
  assert.equal(sources.search('复利', { limit: 0 }).total, 2);
  assert.deepEqual(sources.search('惩罚和后果有什么区别').items.map((hit) => hit.item.thought), ['后果不是惩罚']);
  assert.equal(sources.search('预测', { kind: 'thought' }).total, 0);
  assert.equal(sources.search('预测', { kind: 'highlight' }).items[0].item.bookmarkId, 'm-money-2');
  assert.equal(sources.search('安全感', { books: [sources.books()[1]] }).total, 0);
  // 安全感 is not 安全边际: one shared fragment counts only when nothing says the whole word.
  assert.deepEqual(sources.search('安全感').items.map((hit) => hit.item.thought), ['安全感是大脑发育的地基']);
  assert.ok(sources.search('安全垫').items.some((hit) => hit.item.thought === '安全感是大脑发育的地基'), 'nothing says 安全垫, so 安全… is offered');
  assert.equal(sources.search('安全感怎么影响孩子的学习成绩和睡眠').total, 1, 'of a long question, one shared fragment is chance');
  assert.equal(sources.search('怎么才能让孩子多喝水呢').total, 0);
});

test('inventory: every book once, with its card, its stage and what came from it', (t) => {
  const service = createKbService({ repoRoot: repoFixture(t).repo });
  const rows = service.inventory().map((row) => [row.title, row.stage, row.card, row.subject, row.notes, row.cards.source_note + row.cards.concept_card]);
  assert.deepEqual(rows, [
    ['金钱心理学：财富、人性和幸福的永恒真相', 'organized', 'investing/book-0002', 'investing', 4, 3],
    ['孩子的大脑', 'organized', 'parenting/book-0001', 'parenting', 6, 2],
    ['把整颗心献给孩子', 'pending', null, null, 1, 0],
    ['某公众号', 'pending', null, null, 1, 0],
  ]);
  // The cross-subject collection and the idea built on it go back to both books.
  assert.deepEqual(service.inventory()[0].cards, { source_note: 1, concept_card: 2, action_card: 0, collection: 1, idea_seed: 1 });
});

test('a book from the user\'s wording: title, part of it, bookId, card ref, path', (t) => {
  const { repo } = repoFixture(t);
  writeTree(repo, { '.weread-sync/raw_notes/孩子如何学习/raw.json': JSON.stringify({ bookId: '903', title: '孩子如何学习', reviews: [{ reviewId: 'r', content: '观察孩子', abstract: '' }] }) });
  const service = createKbService({ repoRoot: repo });
  for (const wording of ['孩子的大脑', '《孩子的大脑》', '902', 'parenting/book-0001', 'book-0001', 'notes/育儿/孩子的大脑.md', 'notes\\育儿\\孩子的大脑.md']) {
    assert.equal(service.book(wording).title, '孩子的大脑', wording);
  }
  assert.equal(service.book('金钱心理学').card, 'investing/book-0002');
  assert.equal(service.book('把整颗心').stage, 'pending');
  // Titles that start with the wording come before titles that merely contain it; a tie is the user's to settle.
  assert.equal(service.book('献给孩子').title, '把整颗心献给孩子');
  assert.throws(() => service.book('孩子'), /对应多本书：《孩子的大脑》（parenting\/book-0001）、《孩子如何学习》。/);
  assert.throws(() => service.book('三体'), /没有找到「三体」.*notes_books/s);
});

test('not configured, or not this repository: the error says what to do', (t) => {
  assert.throws(() => createKbService({ repoRoot: '' }).index(), (error) => error.code === 'NOT_CONFIGURED' && /repoRoot/.test(error.message));
  const { repo } = repoFixture(t);
  assert.throws(() => createKbService({ repoRoot: `${repo}-missing` }).index(), /不存在/);
  assert.throws(() => createKbService({ repoRoot: `${repo}/.weread-sync` }).index(), /不是 dadventures 仓库/);
});
