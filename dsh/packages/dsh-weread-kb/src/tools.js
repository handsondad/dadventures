import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkKnowledge } from './check.js';
import { parseFrontmatter } from './frontmatter.js';
import { nextId } from './index.js';
import { CONTROLLED_FIELDS, DOC_TYPES, INTENTS, REFERENCE_FIELDS, REQUIRED, STATUSES } from './layout.js';
import { kbServiceOf } from './service.js';
import { MAX_TEXT, choice, compareText, cut, fail, flag, integer, inside, only, optionalText, output, parameters, posix, registerSkills, requiredText, sessionDirectory, textList } from './shared.js';
import { ANSWER_SKILLS, MAINTENANCE_SKILLS, loadRuleSkills } from './skills.js';

// 读书知识库工具。两个模式都挂这一行：
//   kb_overview / kb_search / kb_read / kb_links   知识库（整理好的卡片），只读；
//   notes_books / notes_read / notes_search        原始笔记（微信读书的划线和想法），只读；
//   kb_schema / kb_check                           maintain: true 时才有（读书整理模式），配合 DSH 自带的文件工具写卡片。
export const name = 'weread-kb-tools';
export const inject = ['tools'];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPES = Object.keys(DOC_TYPES);
const SHORT = { source_book: '书目', source_note: '来源笔记', concept_card: '概念', action_card: '行动', collection: '主题包', idea_seed: '想法' };
const STAGE_ORDER = ['pending', 'registered', 'organized'];
const PAGE_CHARS = 12_000;
const PASSAGE_CHARS = 700;
const WARNINGS_PER_RULE = 5;

const typeLabel = (type) => DOC_TYPES[type]?.label ?? type ?? '无类型';
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const oneLine = (value, max) => cut(String(value ?? '').replace(/\s+/g, ' ').trim(), max);
const quote = (value) => String(value).split('\n').map((line) => `> ${line}`).join('\n');
const quoted = (words) => words.map((word) => `「${word}」`).join('');
/** Hits that rest on fragments of a keyword, or on the other words only: say so, or they read as findings. */
const absent = (where, missing) => (missing?.length
  ? `\n注意：${where}里没有${quoted(missing)}这个说法，上面的命中靠的是其余的词或零散的字，先看标题和片段是否切题，不切题就当作没有。`
  : null);
const derivedText = (cards) => Object.entries(cards).filter(([, count]) => count).map(([type, count]) => `${SHORT[type]} ${count}`).join(' / ') || '还没有卡片';
const linkLine = (link) => (link.ref ? `\`${link.ref}\` ${link.title}（${link.field}）` : `\`${link.value}\` ⚠ ${link.problem === 'ambiguous' ? '多个主题域都有，要写成 主题域/id' : '找不到'}（${link.field}）`);
const hit = (item) => `- **${item.title}** — ref \`${item.ref}\`（${[typeLabel(item.doc_type), item.subject_label, item.status,
  item.books.length ? `《${item.books.join('》《')}》${item.more_books ? ` 等 ${item.books.length + item.more_books} 本` : ''}` : null].filter(Boolean).join(' · ')}）${item.snippet ? `\n  ${item.snippet}` : ''}`;

const bookLine = (row) => {
  const facts = [
    row.stage_label,
    row.kind === 'mp' ? '公众号' : null,
    row.card ? `书目卡 \`${row.card}\`` : (row.subject ? `建议主题域 ${row.subject}` : null),
    row.book ? `${row.notes} 条笔记${row.chapters ? ` · ${row.chapters} 章` : ''}` : '仓库里没有原始笔记',
    row.card ? derivedText(row.cards) : null,
  ].filter(Boolean).join(' · ');
  const where = [row.archive?.path, row.raw?.path].filter(Boolean).join('；');
  return `- 《${row.title}》${row.author ? ` ${row.author}` : ''} — ${facts}${where ? `\n  来源：${where}${row.book_id ? ` · bookId \`${row.book_id}\`` : ''}` : ''}`;
};

const noteBlock = (item) => {
  const head = [`**#${item.n}**`, item.rating ? `点评（${item.rating}）` : item.kind === 'thought' ? '想法' : '划线', item.date || null,
    item.reviewId ? `reviewId \`${item.reviewId}\`` : null, item.bookmarkId ? `bookmarkId \`${item.bookmarkId}\`` : null,
    item.chapterUid ? `chapterUid ${item.chapterUid}` : null, item.range ? `range \`${item.range}\`` : null].filter(Boolean).join(' · ');
  return [head, item.thought || null, item.text ? quote(cut(item.text, PASSAGE_CHARS)) : null].filter(Boolean).join('\n');
};

const markdownOf = {
  overview: (value) => (value.subject
    ? [
      `**${value.subject.label}**（\`${value.subject.id}\`）：${value.total} 张卡片 — ${TYPES.map((type) => `${SHORT[type]} ${value.counts[type]}`).join(' / ')}`,
      '',
      `书（${value.books.length}）：`,
      ...value.books.map((book) => `- 《${book.title}》 \`${book.card}\` — ${book.stage_label} · ${derivedText(book.cards)}${book.notes ? ` · 原始笔记 ${book.notes} 条` : ''}`),
      '',
      `主题包（${value.collections_total}${value.collections_total > value.collections.length ? `，显示前 ${value.collections.length}` : ''}）：`,
      ...value.collections.map((item) => `- \`${item.ref}\` ${item.title}`),
      '',
      '用 kb_search（subject、doc_type、intent）继续找；用 kb_links 从主题包走到它包含的卡片。',
    ].join('\n')
    : [
      `知识库共 ${value.total} 张卡片，${value.subjects.filter((subject) => subject.total).length} 个主题域有内容。`,
      '',
      `| 主题域 | id | ${TYPES.map((type) => SHORT[type]).join(' | ')} |`,
      `| --- | --- | ${TYPES.map(() => '---').join(' | ')} |`,
      ...value.subjects.map((subject) => `| ${subject.label} | \`${subject.id}\` | ${TYPES.map((type) => subject.counts[type] || '').join(' | ')} |`),
      '',
      `原始笔记：${value.sources.total} 个来源（书 ${value.sources.books}、公众号 ${value.sources.mp}）— 已整理 ${value.sources.organized}、已建档 ${value.sources.registered}、未整理 ${value.sources.pending}。用 notes_books 查看。`,
      '',
      '卡片类型：' + TYPES.map((type) => `${DOC_TYPES[type].label}（${type}）回答“${DOC_TYPES[type].answers}”`).join('；') + '。',
      '传 subject 看一个主题域里有哪些书和主题包。',
    ].join('\n')),
  search: (value) => [
    value.items.length
      ? [`共 ${value.total} 张卡片${value.query ? '命中' : ''}，显示前 ${value.items.length} 张：`, ...value.items.map(hit)].join('\n')
      : '知识库里没有命中的卡片。',
    value.items.length ? absent('卡片', value.missing) : null,
    value.raw?.total ? `\n原始笔记里另有 ${value.raw.total} 条命中（${value.raw.books.map((book) => `《${book.title}》${book.hits}`).join('、')}${value.raw.more ? ' 等' : ''}）${value.raw.missing.length ? `，其中没有${quoted(value.raw.missing)}这个说法` : ''}：用 notes_search 查看。` : null,
    value.items.length
      ? '\n引用时写出书名和卡片 ref；snippet 只是片段，要用卡片内容先 kb_read。'
      : `\n${value.raw?.total ? '这部分内容还没整理成卡片，可以直接基于原始笔记回答。' : '换个说法、去掉筛选条件再搜；都没有就如实告诉用户笔记里没有。'}`,
  ].filter(Boolean).join('\n'),
  read: (value) => [
    `ref: \`${value.ref}\` · ${typeLabel(value.doc_type)} · ${value.subject_label} · ${value.status ?? '无状态'} · ${value.path}`,
    value.links.books.length ? `来自：${value.links.books.map((book) => `《${book.title}》（\`${book.ref}\`）`).join('、')}` : null,
    value.links.outgoing.length ? `引用：${value.links.outgoing.map(linkLine).join('；')}` : null,
    value.links.incoming.length ? `被引用：${value.links.incoming.map(linkLine).join('；')}` : null,
    '',
    value.content,
    value.next_offset !== null ? `\n> 还没读完：共 ${value.total_chars} 字符，用 offset=${value.next_offset} 继续读。` : null,
  ].filter((part) => part !== null).join('\n'),
  links: (value) => [
    `**${value.title}**（\`${value.ref}\`，${typeLabel(value.doc_type)}）`,
    value.books.length ? `来自：${value.books.map((book) => `《${book.title}》（\`${book.ref}\`）`).join('、')}` : null,
    `引用（${value.outgoing.length}）：${value.outgoing.length ? '' : '无'}`, ...value.outgoing.map((link) => `- ${linkLine(link)}`),
    `被引用（${value.incoming.length}）：${value.incoming.length ? '' : '无'}`, ...value.incoming.map((link) => `- ${linkLine(link)}`),
    ...(value.suggestions ? [`可能相关、还没有关联的卡片（${value.suggestions.length}，先 kb_read 确认再写进 frontmatter）：`,
      ...value.suggestions.map((item) => `- \`${item.ref}\` ${item.title}（${typeLabel(item.doc_type)} · ${item.subject_label}）`)] : []),
  ].filter((part) => part !== null).join('\n'),
  schema: (value) => (value.doc_type
    ? [
      `**${value.label}**（${value.doc_type}）${value.subject ? ` · 主题域 ${value.subject.label}（\`${value.subject.id}\`）` : ''}`,
      value.next_id ? `- 下一个 id：\`${value.next_id}\`（同主题域已有 ${value.existing} 张）` : '- 传 subject 才能算出 id 和路径。',
      value.next_id ? `- 文件：${value.write_path ? `\`${value.write_path}\`` : `\`${value.folder}/${value.next_id}-<slug>.md\`（给 slug 就会算出完整路径）`}` : null,
      `- 必填：${value.required.join('、')}；新卡写 schema_version: 2、status: draft、last_reviewed: ${value.today}`,
      `- 引用字段：${value.ref_fields.join('、') || '无'}（同主题域写 id，别的主题域写 主题域/id）`,
      ...value.controlled.map((field) => `- ${field.field} 只能用：${field.values.join('、')}`),
      value.location,
      '',
      value.template ? `模板（${value.template_path}），把示例值都换掉：\n\n${value.template}` : '没有找到模板，参照同类型的现有卡片。',
    ].filter((part) => part !== null).join('\n')
    : [
      '卡片类型：',
      ...value.doc_types.map((type) => `- \`${type.doc_type}\` ${type.label}：回答“${type.answers}”；id 前缀 ${type.prefix}，放在 ${type.folder}/<主题域>/，现有 ${type.count} 张`),
      '',
      `主题域：${value.subjects.map((subject) => `\`${subject.id}\` ${subject.label}`).join('、')}`,
      '',
      '传 doc_type、subject（和 slug）拿模板、下一个 id 和文件路径。',
    ].join('\n')),
  check: (value) => [
    `检查了 ${value.checked} 张卡片：${value.errors.length} 个错误，${value.warnings.length} 个提醒。`,
    ...value.shown.map((issue) => `- ${issue.level === 'error' ? '✗' : '!'} ${issue.path ?? ''} ${issue.message}`),
    ...value.folded.map((fold) => `- ! 同类提醒还有 ${fold.more} 条（${fold.rule}），传 paths 或 subject 缩小范围可以看全。`),
    value.hidden_errors ? `…还有 ${value.hidden_errors} 个错误没有列出，缩小 subject 或 paths 再查。` : null,
    value.ok ? '没有错误。' : '错误必须修完：它们会让引用或校验失效。',
  ].filter(Boolean).join('\n'),
  books: (value) => [
    `共 ${value.total} 个来源符合条件（未整理 ${value.stages.pending} / 已建档 ${value.stages.registered} / 已整理 ${value.stages.organized}）${value.items.length < value.total ? `，显示第 ${value.offset + 1}-${value.offset + value.items.length} 个` : ''}：`,
    ...value.items.map(bookLine),
    value.next_offset !== null ? `\n还有更多：用 offset=${value.next_offset} 继续。` : null,
    '\n未整理 = 还没有书目卡；已建档 = 有书目卡、还没有来源笔记；已整理 = 已有来源笔记（不代表每一章都整理了）。读笔记用 notes_read（book 传书名）。',
  ].filter(Boolean).join('\n'),
  notes: (value) => {
    const lines = [
      `《${value.title}》${value.author ? ` ${value.author}` : ''} — ${value.stage_label}${value.card ? `（书目卡 \`${value.card}\`）` : ''} · 来源 ${value.source_path}${value.book_id ? ` · bookId \`${value.book_id}\`` : ''}`,
      `${value.total} 条笔记（想法 ${value.thoughts} / 划线 ${value.highlights}）${value.filtered !== value.total ? `，筛选后 ${value.filtered} 条` : ''}；本页 #${value.items[0]?.n ?? '-'} 到 #${value.items.at(-1)?.n ?? '-'}。`,
      value.other ? `另一个来源 ${value.other.path} 有 ${value.other.notes} 条，传 source: ${value.other.source} 可读。` : null,
      value.outline ? `章节（${value.outline.length}）：${value.outline.map((chapter) => `${chapter.name || '（无章节）'} ×${chapter.notes}`).join('、')}` : null,
      '',
    ];
    let chapter = null;
    for (const item of value.items) {
      if (item.chapter !== chapter) { chapter = item.chapter; lines.push(`### ${chapter || '（无章节）'}`, ''); }
      lines.push(noteBlock(item), '');
    }
    if (!value.items.length) lines.push('没有符合条件的笔记。');
    if (value.next_from !== null) lines.push(`> 还没读完：用 from=${value.next_from} 继续。`);
    lines.push('“想法”下面的正文是读者当时写的话，引用块是书里的原文。');
    return lines.filter((line) => line !== null).join('\n');
  },
  noteHits: (value) => (value.items.length
    ? [
      `原始笔记共 ${value.total} 条命中，分布在 ${value.books.length} 本书（${value.books.slice(0, 5).map((book) => `《${book.title}》${book.hits}`).join('、')}${value.books.length > 5 ? ' 等' : ''}）。显示前 ${value.items.length} 条：`,
      ...value.items.map((item) => [
        `- 《${item.book}》#${item.n}${item.chapter ? ` · ${item.chapter}` : ''}${item.date ? ` · ${item.date}` : ''}（${item.stage_label}${item.card ? ` \`${item.card}\`` : ''}）`,
        item.thought ? `  想法：${oneLine(item.thought, 260)}` : null,
        item.text ? `  原文：${oneLine(item.text, 260)}` : null,
      ].filter(Boolean).join('\n')),
      absent('原始笔记', value.missing),
      '',
      '读上下文用 notes_read（book 传书名，from 传 # 后面的序号）。引用时写《书名》和章节。',
    ].filter((part) => part !== null).join('\n')
    : '原始笔记里没有命中。换个说法或去掉 book / kind 再搜。'),
};

export function createKbTools(ctx, config = {}) {
  const service = kbServiceOf(ctx, config);
  const kb = () => service.index();
  const maintain = config.maintain === true;
  const register = (tool) => ctx.tools.register(tool);
  const labelOf = (index) => { const { labelOf: labels } = index.graph(); return (subject) => labels.get(subject) ?? subject ?? ''; };
  const subjectArg = (index, value) => { const wanted = optionalText(value, 'subject', 60); return wanted ? index.subject(wanted) : null; };

  register({
    name: 'kb_overview',
    description: 'Map of the reading knowledge base (cards organised from the user\'s WeRead notes): how many cards of each type every subject domain holds, and how many books are organised or still pending. Pass subject (id such as parenting, or its Chinese name such as 育儿) to list that domain\'s books and topic collections. Use it to answer "what is in my notes" and to pick a subject id for the other tools.',
    parameters: parameters({
      subject: { type: 'string', description: 'Subject domain id or Chinese name, e.g. parenting or 育儿.' },
    }),
    output: output({ total: { type: 'integer' } }, markdownOf.overview),
    async execute(args) {
      only(args, ['subject'], 'kb_overview');
      const index = kb();
      const subject = subjectArg(index, args.subject);
      const overview = index.overview();
      const rows = service.inventory();
      if (subject) {
        const collections = index.search('', { subject: subject.id, docType: 'collection', limit: 40 });
        const { total, counts } = overview.find((item) => item.id === subject.id);
        return {
          subject: { id: subject.id, label: subject.label }, total, counts,
          books: rows.filter((row) => row.entry?.subject === subject.id)
            .map(({ title, card, stage, stage_label: stageLabel, cards, notes }) => ({ title, card, stage, stage_label: stageLabel, cards, notes })),
          collections: collections.items.map(({ ref, title }) => ({ ref, title })), collections_total: collections.total,
        };
      }
      const withNotes = rows.filter((row) => row.book);
      return {
        subject: null,
        total: overview.reduce((sum, item) => sum + item.total, 0),
        subjects: overview.map(({ id, label, total, counts }) => ({ id, label, total, counts })),
        sources: {
          total: withNotes.length, books: withNotes.filter((row) => row.kind === 'book').length, mp: withNotes.filter((row) => row.kind === 'mp').length,
          ...Object.fromEntries(STAGE_ORDER.map((stage) => [stage, withNotes.filter((row) => row.stage === stage).length])),
        },
      };
    },
  });

  register({
    name: 'kb_search',
    description: 'Search the organised reading cards before answering. q is a keyword or two (安全感, 护城河 银行), which is matched as written, or the user\'s question as one sentence, which is matched by its words. intent says what kind of question it is and moves the card types that answer it to the front: concept (what does it mean), howto (what to do, how to judge), topic (which themes relate to a situation), ideas (sparks and material for expression), book (what one book says), compare (how books differ). book keeps only cards that go back to that book (title or part of it). subject narrows to one domain (id or Chinese name); doc_type to one card type. Without q it lists what the filters select. The result also says how many raw notes match, for content not yet organised into cards. Matching is by wording, not meaning: judge hits by title and snippet, and try the keyword the notes would use when a question finds little. Cite hits by book title and ref; when nothing fits, say the notes have nothing on it.',
    parameters: parameters({
      q: { type: 'string', description: 'Keywords separated by spaces, or one question. Optional when a filter is given.' },
      intent: { type: 'string', enum: Object.keys(INTENTS), description: 'Kind of question: concept, howto, topic, ideas, book, compare.' },
      book: { type: 'string', description: 'Book title or part of it, or a book card ref.' },
      subject: { type: 'string', description: 'Subject domain id or Chinese name, e.g. investing or 投资.' },
      doc_type: { type: 'string', enum: TYPES, description: 'Card type.' },
      limit: { type: 'integer', description: 'How many hits to return, 1 to 30 (default 8).' },
    }),
    output: output({ items: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' } }, markdownOf.search),
    async execute(args) {
      only(args, ['q', 'intent', 'book', 'subject', 'doc_type', 'limit'], 'kb_search');
      const index = kb();
      const q = optionalText(args.q, 'q', 300);
      const intent = choice(args.intent, 'intent', Object.keys(INTENTS));
      const docType = choice(args.doc_type, 'doc_type', TYPES);
      const subject = subjectArg(index, args.subject);
      const wantedBook = optionalText(args.book, 'book', 200);
      const limit = integer(args.limit, 'limit', { min: 1, max: 30, fallback: 8 });
      if (!q && !subject && !docType && !wantedBook) fail('kb_search 至少要 q，或 subject / doc_type / book 中的一个。');
      let books;
      let sourceBooks;
      if (wantedBook) {
        const row = service.book(wantedBook, { needNotes: false });
        if (!row.entry) fail(`《${row.title}》还没有整理进知识库（没有书目卡）。用 notes_search（book）或 notes_read 直接看它的原始笔记。`);
        books = [row.entry];
        sourceBooks = row.book ? [row.book] : [];
      }
      const result = index.search(q, { subject: subject?.id, docType, intent, books, limit });
      const label = labelOf(index);
      let raw = null;
      if (q) {
        const found = service.sources().search(q, { books: sourceBooks, limit: 0 });
        raw = { total: found.total, books: found.books.slice(0, 3), more: found.books.length > 3, missing: found.missing };
      }
      return { query: q, total: result.total, missing: result.missing, items: result.items.map((item) => ({ ...item, subject_label: label(item.subject) })), raw };
    },
  });

  register({
    name: 'kb_read',
    description: 'Read one card in full by its ref (subject/id, as kb_search returns), its path, or an id that only one subject uses. Shows the book it goes back to, the cards it references and the cards that reference it. Long cards come in pages: pass the returned next_offset as offset to continue.',
    parameters: parameters({
      ref: { type: 'string', description: 'The ref from kb_search, e.g. parenting/concept-0068.' },
      offset: { type: 'integer', description: 'Character offset to continue a long card from.' },
    }, ['ref']),
    output: output({ ref: { type: 'string' }, content: { type: 'string' } }, markdownOf.read),
    async execute(args) {
      only(args, ['ref', 'offset'], 'kb_read');
      const index = kb();
      const entry = index.find(requiredText(args.ref, 'ref', 400));
      const offset = integer(args.offset, 'offset', { min: 0, max: 10_000_000, fallback: 0 });
      const full = readFileSync(entry.file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      return {
        ref: entry.ref, title: entry.title, subject: entry.subject, subject_label: labelOf(index)(entry.subject), doc_type: entry.doc_type,
        path: entry.path, status: entry.status, links: index.links(entry),
        content: full.slice(offset, offset + MAX_TEXT), total_chars: full.length, next_offset: offset + MAX_TEXT < full.length ? offset + MAX_TEXT : null,
      };
    },
  });

  register({
    name: 'kb_links',
    description: 'Show how one card connects to the rest: the book it goes back to, the cards it references (source notes, derived cards, cards in a collection, related cards) and the cards that reference it. Use it to walk from a topic collection to its cards, from a card back to its source note and book, or from a book card to everything organised from it. With suggest=true it also proposes cards that look related but are not linked yet.',
    parameters: parameters({
      ref: { type: 'string', description: 'Card ref (subject/id), path, or an id that only one subject uses.' },
      suggest: { type: 'boolean', description: 'Also suggest related cards that are not linked yet (default false).' },
      limit: { type: 'integer', description: 'How many suggestions, 1 to 12 (default 6).' },
    }, ['ref']),
    output: output({ ref: { type: 'string' }, outgoing: { type: 'array' }, incoming: { type: 'array' } }, markdownOf.links),
    async execute(args) {
      only(args, ['ref', 'suggest', 'limit'], 'kb_links');
      const suggest = flag(args.suggest, 'suggest');
      const limit = integer(args.limit, 'limit', { min: 1, max: 12, fallback: 6 });
      const index = kb();
      const entry = index.find(requiredText(args.ref, 'ref', 400));
      const { outgoing, incoming, books } = index.links(entry);
      let suggestions = null;
      if (suggest) {
        const linked = new Set([entry.ref, ...outgoing.map((link) => link.ref), ...incoming.map((link) => link.ref)]);
        const words = [entry.title, ...[entry.data.search_terms, entry.data.aliases, entry.data.core_questions].flat().filter((item) => typeof item === 'string')].slice(0, 6).join(' ');
        const label = labelOf(index);
        suggestions = index.search(words, { limit, exclude: (other) => linked.has(other.ref) || !other.doc_type || other.doc_type.startsWith('source_') })
          .items.map((item) => ({ ...item, subject_label: label(item.subject) }));
      }
      return { ref: entry.ref, title: entry.title, doc_type: entry.doc_type, books, outgoing, incoming, suggestions };
    },
  });

  register({
    name: 'notes_books',
    description: 'List the books (and WeChat official accounts) the user has WeRead notes on, with how far each has been organised into the knowledge base: pending (no book card yet), registered (book card, no source notes yet), organized (has source notes). Shows note counts, where the raw notes are, the book card ref and how many cards came from the book. q matches title or author. Use it to find what to organise next, or to check whether a book is in the notes at all.',
    parameters: parameters({
      q: { type: 'string', description: 'Part of a title or author.' },
      stage: { type: 'string', enum: STAGE_ORDER, description: 'pending, registered or organized.' },
      kind: { type: 'string', enum: ['book', 'mp'], description: 'book, or mp for WeChat official accounts.' },
      subject: { type: 'string', description: 'Subject domain id or Chinese name.' },
      limit: { type: 'integer', description: 'How many to list, 1 to 60 (default 25).' },
      offset: { type: 'integer', description: 'Skip this many, to page through.' },
    }),
    output: output({ items: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' } }, markdownOf.books),
    async execute(args) {
      only(args, ['q', 'stage', 'kind', 'subject', 'limit', 'offset'], 'notes_books');
      const q = service.text.squash(optionalText(args.q, 'q', 200));
      const stage = choice(args.stage, 'stage', STAGE_ORDER);
      const kind = choice(args.kind, 'kind', ['book', 'mp']);
      const subject = subjectArg(kb(), args.subject);
      const limit = integer(args.limit, 'limit', { min: 1, max: 60, fallback: 25 });
      const offset = integer(args.offset, 'offset', { min: 0, max: 100_000, fallback: 0 });
      const rows = service.inventory().filter((row) => (!q || service.text.squash(`${row.title} ${row.author}`).includes(q))
        && (!stage || row.stage === stage) && (!kind || row.kind === kind) && (!subject || row.subject === subject.id));
      rows.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || b.notes - a.notes || compareText(a.title, b.title));
      const items = rows.slice(offset, offset + limit).map(({ book: _book, entry: _entry, ...row }) => ({ ...row, book: Boolean(_book) }));
      return {
        total: rows.length, offset, items, next_offset: offset + limit < rows.length ? offset + limit : null,
        stages: Object.fromEntries(STAGE_ORDER.map((name) => [name, rows.filter((row) => row.stage === name).length])),
      };
    },
  });

  register({
    name: 'notes_read',
    description: 'Read the raw WeRead notes of one book in book order: the user\'s own thoughts (想法) each with the passage it was written on, and highlighted passages (划线), grouped by chapter, with WeRead ids when the source has them. book is a title or part of it, a WeRead bookId, or a book card ref. The first page lists the chapters; long books come in pages: pass the returned next_from as from. chapter keeps only chapters whose name contains the text; kind keeps only thoughts or highlights. This is the source material for organising a book, and the fallback for questions about a book that is not organised yet.',
    parameters: parameters({
      book: { type: 'string', description: 'Book title or part of it, WeRead bookId, or book card ref.' },
      chapter: { type: 'string', description: 'Only chapters whose name contains this text.' },
      kind: { type: 'string', enum: ['thought', 'highlight'], description: 'Only thoughts or only highlights.' },
      from: { type: 'integer', description: 'Note number (#) to start from; default 1.' },
      limit: { type: 'integer', description: 'Most notes per page, 1 to 80 (default 40). A page also ends at about 12,000 characters.' },
      source: { type: 'string', enum: ['archive', 'raw'], description: 'Force the Markdown archive or the synced raw.json; default is whichever holds more notes.' },
    }, ['book']),
    output: output({ title: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } }, markdownOf.notes),
    async execute(args) {
      only(args, ['book', 'chapter', 'kind', 'from', 'limit', 'source'], 'notes_read');
      const row = service.book(requiredText(args.book, 'book', 300));
      const wantedSource = choice(args.source, 'source', ['archive', 'raw']);
      const kind = choice(args.kind, 'kind', ['thought', 'highlight']);
      const chapter = service.text.squash(optionalText(args.chapter, 'chapter', 200));
      const from = integer(args.from, 'from', { min: 1, max: 1_000_000, fallback: 1 });
      const limit = integer(args.limit, 'limit', { min: 1, max: 80, fallback: 40 });
      const source = service.sources().pick(row.book, wantedSource);
      const selected = source.items.filter((item) => (!kind || item.kind === kind) && (!chapter || service.text.squash(item.chapter).includes(chapter)));
      if (chapter && !selected.length) {
        fail(`《${row.title}》没有名字包含「${args.chapter}」的章节。章节有：${[...new Set(source.items.map((item) => item.chapter).filter(Boolean))].slice(0, 40).join('、')}。`);
      }
      const page = [];
      let used = 0;
      let nextFrom = null;
      for (const item of selected) {
        if (item.n < from) continue;
        const size = item.thought.length + Math.min(item.text.length, PASSAGE_CHARS) + 80;
        if (page.length && (page.length >= limit || used + size > PAGE_CHARS)) { nextFrom = item.n; break; }
        used += size;
        page.push({ n: item.n, kind: item.kind, chapter: item.chapter, date: item.date, rating: item.rating || '', thought: item.thought, text: item.text,
          ...(item.reviewId ? { reviewId: item.reviewId } : {}), ...(item.bookmarkId ? { bookmarkId: item.bookmarkId } : {}),
          ...(item.chapterUid ? { chapterUid: item.chapterUid } : {}), ...(item.range ? { range: item.range } : {}) });
      }
      const outline = [];
      if (from === 1) {
        for (const item of selected) {
          const tail = outline.at(-1);
          if (tail && tail.name === item.chapter) tail.notes++; else outline.push({ name: item.chapter, notes: 1 });
        }
      }
      const other = source === row.book.archive ? row.book.raw : row.book.archive;
      return {
        title: row.title, author: row.author, book_id: row.book_id, card: row.card, stage: row.stage, stage_label: row.stage_label,
        source: source.source, source_path: source.path, total: source.total, thoughts: source.thoughts, highlights: source.highlights, filtered: selected.length,
        other: other && !wantedSource ? { source: other.source, path: other.path, notes: other.total } : null,
        outline: from === 1 ? outline.slice(0, 80) : null, items: page, next_from: nextFrom,
      };
    },
  });

  register({
    name: 'notes_search',
    description: 'Search the raw WeRead notes (the user\'s thoughts and highlighted passages) across all books, including books not yet organised into cards. q is a keyword or two (matched as written) or a question as one sentence (matched by its words). book narrows to one book; kind to thoughts or highlights. Each hit gives the book, chapter, note number (#) and whether that book is organised. Use it when kb_search finds nothing or too little, to find what a book literally says, or to find the user\'s own words on a topic. Read around a hit with notes_read (book, from).',
    parameters: parameters({
      q: { type: 'string', description: 'Keywords separated by spaces, or one question.' },
      book: { type: 'string', description: 'Book title or part of it, WeRead bookId, or book card ref.' },
      kind: { type: 'string', enum: ['thought', 'highlight'], description: 'Only thoughts or only highlights.' },
      limit: { type: 'integer', description: 'How many hits to return, 1 to 30 (default 10).' },
    }, ['q']),
    output: output({ items: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' } }, markdownOf.noteHits),
    async execute(args) {
      only(args, ['q', 'book', 'kind', 'limit'], 'notes_search');
      const q = requiredText(args.q, 'q', 300);
      const kind = choice(args.kind, 'kind', ['thought', 'highlight']);
      const limit = integer(args.limit, 'limit', { min: 1, max: 30, fallback: 10 });
      const wantedBook = optionalText(args.book, 'book', 300);
      const rows = service.inventory();
      const rowOf = new Map(rows.filter((row) => row.book).map((row) => [row.book, row]));
      const books = wantedBook ? [service.book(wantedBook).book] : undefined;
      const found = service.sources().search(q, { books, kind, limit });
      return {
        total: found.total, books: found.books, missing: found.missing,
        items: found.items.map(({ book, item }) => {
          const row = rowOf.get(book);
          return { book: book.title, n: item.n, kind: item.kind, chapter: item.chapter, date: item.date, thought: item.thought, text: cut(item.text, PASSAGE_CHARS),
            stage: row?.stage ?? 'pending', stage_label: row?.stage_label ?? '未整理', card: row?.card ?? null };
        }),
      };
    },
  });

  if (maintain) {
    register({
      name: 'kb_schema',
      description: 'Before writing a card: the template, the next free id, the file path, required fields, reference fields and the allowed values of controlled fields for one card type in one subject domain. Without doc_type it lists the card types and subject domains. Write the file yourself with the file tools, then run kb_check on it.',
      parameters: parameters({
        doc_type: { type: 'string', enum: TYPES, description: 'Card type.' },
        subject: { type: 'string', description: 'Subject domain id or Chinese name, e.g. parenting.' },
        slug: { type: 'string', description: 'English kebab-case slug for the file name, e.g. delayed-gratification.' },
      }),
      output: output({ doc_type: { type: 'string' }, next_id: { type: 'string' } }, markdownOf.schema),
      async execute(args, exec) {
        only(args, ['doc_type', 'subject', 'slug'], 'kb_schema');
        const index = kb();
        const docType = choice(args.doc_type, 'doc_type', TYPES);
        const subject = subjectArg(index, args.subject);
        const entries = index.entries();
        if (!docType) {
          return {
            doc_type: null,
            doc_types: TYPES.map((type) => ({ doc_type: type, ...DOC_TYPES[type], count: entries.filter((entry) => entry.doc_type === type).length })),
            subjects: index.subjects().map(({ id, label }) => ({ id, label })),
          };
        }
        const spec = DOC_TYPES[docType];
        const slug = optionalText(args.slug, 'slug', 60);
        if (slug && !SLUG.test(slug)) fail('slug 只能用小写英文字母、数字和连字符，例如 delayed-gratification。');
        if (subject && !subject.listed) fail(`主题域 ${subject.id} 还不在 taxonomy/taxonomy.md 的 Subject Domains 里，先和用户确认并把它加进去。`);
        const id = subject ? nextId(index.ids(subject.id, spec.prefix), spec.prefix, subject.id) : null;
        const file = id && slug ? path.join(index.root, ...spec.folder.split('/'), subject.id, `${id}-${slug}.md`) : null;
        const cwd = sessionDirectory(exec);
        const reachable = !cwd || inside(cwd, index.root);
        let template = null;
        try { template = readFileSync(path.join(index.root, ...spec.template.split('/')), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim(); } catch { template = null; }
        const fields = template ? Object.keys(parseFrontmatter(template).data) : [];
        const taxonomy = index.taxonomy();
        return {
          doc_type: docType, label: spec.label, subject: subject ? { id: subject.id, label: subject.label } : null,
          next_id: id, existing: subject ? index.ids(subject.id, spec.prefix).length : 0,
          folder: `${spec.folder}/${subject?.id ?? '<主题域>'}`, file,
          write_path: file ? (cwd && reachable ? posix(path.relative(cwd, file)) : file) : null,
          required: REQUIRED, statuses: STATUSES, today: today(),
          ref_fields: REFERENCE_FIELDS.filter((field) => fields.includes(field)),
          controlled: Object.entries(CONTROLLED_FIELDS).filter(([field]) => field !== 'status' && field !== 'subject_domains' && fields.includes(field))
            .map(([field, section]) => ({ field, values: [...(taxonomy.sections.get(section) ?? [])] })),
          template_path: spec.template, template: template ? cut(template, 6000) : null,
          location: reachable
            ? `- 路径${cwd ? '相对当前会话目录' : '是绝对路径'}；知识库在 ${index.root}。`
            : `- ⚠ 当前会话目录 ${cwd} 不包含知识库（${index.root}），文件工具可能写不进去：请在 dadventures 仓库目录新开会话。`,
        };
      },
    });

    register({
      name: 'kb_check',
      description: 'Validate knowledge cards: frontmatter, required fields, doc types, ids, controlled vocabulary (schema_version 2 cards), duplicate ids, and that every reference resolves; plus reminders about file names, folders, missing source links, and raw_source_path or Markdown links that point at a file which is not there. Errors are the same ones .weread-sync/scripts/validate_knowledge.py reports. Run it on the files you just wrote (paths relative to the knowledge base or the repository, or refs) and fix every error before finishing. Without paths it checks everything, or one subject.',
      parameters: parameters({
        paths: { type: 'array', items: { type: 'string' }, description: 'Card paths (e.g. concepts/investing/concept-investing-0072-x.md) or refs (investing/concept-investing-0072).' },
        subject: { type: 'string', description: 'Only check this subject domain.' },
        warnings: { type: 'boolean', description: 'List reminders too (default true).' },
        strict: { type: 'boolean', description: 'Also hold older cards (no schema_version) to the controlled vocabulary (default false).' },
      }),
      output: output({ ok: { type: 'boolean' }, errors: { type: 'array' }, warnings: { type: 'array' } }, markdownOf.check),
      async execute(args) {
        only(args, ['paths', 'subject', 'warnings', 'strict'], 'kb_check');
        const index = kb();
        const subject = subjectArg(index, args.subject);
        const paths = textList(args.paths, 'paths', { max: 80, itemMax: 500 });
        const withWarnings = flag(args.warnings, 'warnings', true);
        const result = checkKnowledge(index, { subject: subject?.id, paths, strictTaxonomy: flag(args.strict, 'strict') });
        if (paths.length && !result.checked) fail(`没有找到这些卡片：${paths.join('、')}。路径相对 kb/，例如 concepts/investing/concept-investing-0072-x.md。`);
        // Every error; reminders in full for a targeted check, a few per rule for a sweep.
        const shownErrors = result.errors.slice(0, 80);
        const perRule = new Map();
        const shownWarnings = [];
        for (const issue of withWarnings ? result.warnings : []) {
          const seen = (perRule.get(issue.rule) ?? 0) + 1;
          perRule.set(issue.rule, seen);
          if (paths.length || seen <= WARNINGS_PER_RULE) shownWarnings.push(issue);
        }
        return {
          ...result, shown: [...shownErrors, ...shownWarnings.slice(0, 80)], hidden_errors: result.errors.length - shownErrors.length,
          folded: paths.length ? [] : [...perRule].filter(([, count]) => count > WARNINGS_PER_RULE).map(([rule, count]) => ({ rule, more: count - WARNINGS_PER_RULE })),
        };
      },
    });
  }

  let disposeSkills = () => {};
  if (config.skills !== false) {
    let ruleSkills = [];
    if (maintain) {
      try { ruleSkills = loadRuleSkills(service.paths().kb).skills; } catch { ruleSkills = []; }
    }
    disposeSkills = registerSkills(ctx, [...ANSWER_SKILLS, ...(maintain ? MAINTENANCE_SKILLS : []), ...ruleSkills]);
  }

  return { dispose() { disposeSkills(); } };
}

export function apply(ctx, config = {}) {
  const { dispose } = createKbTools(ctx, config);
  ctx.on('dispose', dispose);
}
