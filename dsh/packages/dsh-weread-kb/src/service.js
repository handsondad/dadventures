import { createKnowledgeIndex } from './index.js';
import { DOC_TYPES, KB_DIR, NOTES_DIR, RAW_DIR, repoPaths } from './layout.js';
import { normalize, squash } from './search.js';
import { KB_SERVICE, NOT_CONFIGURED, existingDirectory, repoRootOf, strings } from './shared.js';
import { createSourceIndex } from './sources.js';

const DERIVED = Object.keys(DOC_TYPES).filter((type) => type !== 'source_book');
const STAGES = { pending: '未整理', registered: '已建档', organized: '已整理' };
const overlaps = (a, b) => { const [short, long] = a.length <= b.length ? [a, b] : [b, a]; return short.length >= 4 && long.includes(short); };
const sourceInfo = (source) => (source ? { path: source.path, notes: source.total, thoughts: source.thoughts, highlights: source.highlights } : null);

/**
 * The repository as one shared object: the host row provides it and the tool rows of both modes read it, so they see
 * the same cards and the same raw notes. It joins the two halves of the repository: what was read (raw notes per
 * book) and what has been organised from it (the book card and the cards that go back to it).
 */
export function createKbService(config = {}) {
  const repoRoot = repoRootOf(config);
  let state = null;

  const open = () => {
    const repo = existingDirectory(repoRoot, 'dadventures 仓库目录', NOT_CONFIGURED);
    if (!state || state.repo !== repo) {
      const paths = repoPaths(repo);
      existingDirectory(paths.kb, '知识库目录', `${repo} 不是 dadventures 仓库（里面没有 ${KB_DIR}/）。${NOT_CONFIGURED}`);
      state = { repo, paths, index: createKnowledgeIndex(paths.kb), sources: createSourceIndex(paths) };
    }
    return state;
  };

  /** Every book once: its raw notes, its book card, how far it has been organised. */
  const inventory = () => {
    const { index, sources } = open();
    const graph = index.graph();
    const cards = graph.entries.filter((entry) => entry.doc_type === 'source_book');
    const derived = new Map(cards.map((card) => [card, Object.fromEntries(DERIVED.map((type) => [type, 0]))]));
    for (const entry of graph.entries) {
      if (entry.doc_type === 'source_book') continue;
      for (const book of graph.books.get(entry)) {
        const counts = derived.get(book);
        if (counts && entry.doc_type in counts) counts[entry.doc_type]++;
      }
    }

    // A book card names its raw notes by path or by WeRead bookId; older cards only share the title.
    // The surest link first for every card, so a loose title match never takes a book another card names exactly.
    const books = sources.books();
    const taken = new Set();
    const matched = new Map();
    const titleOf = (card) => squash(strings(card.data.title_zh)[0] ?? card.title);
    const passes = [
      (card, book) => { const wanted = strings(card.data.raw_source_path)[0]?.replaceAll('\\', '/'); return Boolean(wanted) && (book.archive?.path === wanted || book.raw?.path === wanted); },
      (card, book) => { const wanted = strings(card.data.weread_book_id)[0]; return Boolean(wanted) && book.bookId === wanted; },
      (card, book) => { const wanted = titleOf(card); return Boolean(wanted) && (squash(book.title) === wanted || squash(book.archive?.name) === wanted); },
      (card, book) => overlaps(squash(book.title), titleOf(card)),
    ];
    passes.forEach((same, pass) => {
      for (const card of cards) {
        if (matched.has(card)) continue;
        const found = books.filter((book) => !taken.has(book) && same(card, book));
        if (!found.length || (pass === passes.length - 1 && found.length > 1)) continue;
        matched.set(card, found[0]);
        taken.add(found[0]);
      }
    });

    // Which subject an archive folder maps to, learned from the books already filed.
    const votes = new Map();
    for (const [card, book] of matched) {
      const category = book?.category;
      if (!category || !card.subject) continue;
      if (!votes.has(category)) votes.set(category, new Map());
      votes.get(category).set(card.subject, (votes.get(category).get(card.subject) ?? 0) + 1);
    }
    const subjectOfCategory = (category) => {
      const tally = votes.get(category);
      if (tally) return [...tally].sort((a, b) => b[1] - a[1])[0][0];
      return graph.subjects.find((subject) => subject.label === category)?.id ?? null;
    };

    const row = (book, card) => {
      const counts = card ? derived.get(card) : Object.fromEntries(DERIVED.map((type) => [type, 0]));
      const stage = !card ? 'pending' : counts.source_note ? 'organized' : 'registered';
      const picked = book ? sources.pick(book) : null;
      return {
        title: book?.title ?? card.title,
        author: book?.author || strings(card?.data.author)[0] || '',
        kind: book?.kind ?? 'book',
        book_id: book?.bookId || strings(card?.data.weread_book_id)[0] || '',
        category: book?.category ?? '',
        subject: card?.subject ?? (book?.category ? subjectOfCategory(book.category) : null),
        card: card?.ref ?? null,
        card_status: card?.status ?? null,
        stage,
        stage_label: STAGES[stage],
        notes: picked?.total ?? 0,
        chapters: picked ? new Set(picked.items.map((item) => item.chapter).filter(Boolean)).size : 0,
        archive: sourceInfo(book?.archive),
        raw: sourceInfo(book?.raw),
        cards: counts,
        book,
        entry: card ?? null,
      };
    };
    return [
      ...cards.map((card) => row(matched.get(card) ?? null, card)),
      ...books.filter((book) => !taken.has(book)).map((book) => row(book, null)),
    ];
  };

  /** One book from the user's wording: title (or part of it), WeRead bookId, book card ref, or a path. */
  const book = (value, { needNotes = true } = {}) => {
    const wanted = String(value ?? '').trim();
    const rows = inventory();
    const pathLike = wanted.replaceAll('\\', '/');
    const key = squash(wanted.replace(/^《(.*)》$/, '$1'));
    // The closest reading of the wording that names any book decides; only ties within it are ambiguous.
    const names = (row) => [row.title, row.book?.archive?.name, row.book?.raw?.dir].filter(Boolean).map(squash);
    const tiers = [
      (row) => row.card === wanted || row.entry?.id === wanted || (row.book_id && row.book_id === wanted) || row.archive?.path === pathLike || row.raw?.path === pathLike,
      (row) => Boolean(key) && names(row).includes(key),
      (row) => key.length >= 2 && squash(row.title).startsWith(key),
      (row) => key.length >= 2 && names(row).some((name) => name.includes(key)),
      (row) => key.length >= 4 && names(row).some((name) => name.length >= 4 && key.includes(name)),
    ];
    let found = [];
    for (const tier of tiers) {
      found = rows.filter(tier);
      if (found.length) break;
    }
    if (!found.length) throw new Error(`没有找到「${wanted}」这本书。用 notes_books（q 传书名里的词）看看有哪些书。`);
    if (found.length > 1) {
      throw new Error(`「${wanted}」对应多本书：${found.slice(0, 10).map((row) => `《${row.title}》${row.card ? `（${row.card}）` : ''}`).join('、')}${found.length > 10 ? ' 等' : ''}。请写完整书名或书目卡 ref。`);
    }
    if (needNotes && !found[0].book) throw new Error(`《${found[0].title}》有书目卡（${found[0].card}），但仓库里找不到它的原始笔记（${NOTES_DIR}/ 或 ${RAW_DIR}/）。`);
    return found[0];
  };

  return {
    repoRoot,
    configured: () => Boolean(repoRoot),
    paths: () => open().paths,
    index: () => open().index,
    sources: () => open().sources,
    inventory,
    book,
    text: { normalize, squash },
  };
}

/** A row's own repoRoot wins, then the host row's service, then the environment. */
export function kbServiceOf(ctx, config = {}) {
  if (typeof config.repoRoot === 'string' && config.repoRoot.trim()) return createKbService(config);
  if (typeof ctx?.get === 'function') {
    try {
      const shared = ctx.get(KB_SERVICE);
      if (shared?.index) return shared;
    } catch { /* not provided: fall back to the environment */ }
  }
  return createKbService({});
}
