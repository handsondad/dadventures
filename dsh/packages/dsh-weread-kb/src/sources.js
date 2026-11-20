import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NOTES_DIR, RAW_DIR } from './layout.js';
import { normalize, queryTerms, rank, squash } from './search.js';
import { compareText, posix } from './shared.js';

// The reading notes before anyone organised them. Two places hold them:
//   notes/<类别>/<书>.md                  Markdown archives (WeRead's own export, or .weread-sync/scripts/json2md.py)
//   .weread-sync/raw_notes/<书>/raw.json  what .weread-sync/scripts/sync_final.py fetched from the WeRead API
// A book can be in either or both. Both are read into the same list of notes: a 想法 (the reader's own thought, with
// the passage it was written on) or a 划线 (a highlighted passage).

const THOUGHT_HEAD = /^◆\s*(\d{4}\/\d{1,2}\/\d{1,2})\s*(发表想法|认为\S*)$/;
const TRAILER = /^--\s*来自微信读书$/;
const SENTENCE_END = /[。！!；;…][”’」』）)]*$/;
const CAPTION = /^[图表]\s*\d/;
const flat = (value) => String(value ?? '').replace(/[\s\uFFFC]+/g, '');
const str = (value) => (value === undefined || value === null ? '' : String(value).trim());

/** `weread://` link to a note's place in the book, when the note says where that is. */
export function wereadLink(bookId, item) {
  if (!bookId) return '';
  const range = String(item.range ?? '').match(/^(\d+)-(\d+)$/);
  if (item.chapterUid && range) return `weread://bestbookmark?bookId=${encodeURIComponent(bookId)}&chapterUid=${item.chapterUid}&rangeStart=${range[1]}&rangeEnd=${range[2]}`;
  if (item.chapterUid) return `weread://reading?bId=${encodeURIComponent(bookId)}&chapterUid=${item.chapterUid}`;
  return '';
}

/** Two passages are the same when one is the other, or a long enough beginning of it. */
const samePassage = (a, b) => {
  const [short, long] = flat(a).length <= flat(b).length ? [flat(a), flat(b)] : [flat(b), flat(a)];
  return Boolean(short) && long.startsWith(short) && (short.length === long.length || short.length >= 6);
};

/**
 * A Markdown archive. WeRead's export has no markup beyond `◆`, so the structure is read from the order of
 * paragraphs:
 *
 *   《书名》 / 作者 + "N个笔记"
 *   章节名                         a bare line
 *   ◆ 2024/01/02发表想法           a thought: the next paragraph is the thought, then `原文：` and the passage
 *   ◆ 被划线的原文                 a highlight; right after a thought it repeats that thought's passage
 *   ◆ 2024/06/10 认为好看          the reader's rating and review, under the chapter "点评"
 *
 * A passage may run over several paragraphs, and a chapter name may follow it, with nothing to tell them apart but
 * how they read; see `continues`. json2md.py's output adds `来源定位：` lines with the WeRead ids and a `划线`
 * section of `### 章节` + `> 划线`.
 */
export function parseArchive(source, fallbackTitle = '') {
  const paragraphs = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.replace(/\uFFFC/g, '').trim()).filter(Boolean).join('\n'))
    .filter(Boolean);
  const header = { title: fallbackTitle, author: '', bookId: '' };
  let at = 0;
  const titled = paragraphs[0]?.match(/^《(.+)》$/);
  if (titled) {
    header.title = titled[1].trim();
    at = 1;
    const isMeta = (line) => /^\d+\s*个笔记$/.test(line) || /^微信读书 bookId：/.test(line) || /^\d+ 条划线，\d+ 条想法/.test(line);
    const lines = (index) => (paragraphs[index] ?? '').split('\n');
    // The author has a paragraph of their own only when the note count shares it or the bookId line follows.
    if (!lines(1).every(isMeta) && !paragraphs[1]?.startsWith('◆') && (lines(1).some(isMeta) || lines(2).some(isMeta))) {
      header.author = lines(1).filter((line) => !isMeta(line)).join(' ');
      at = 2;
    }
    while (at < paragraphs.length && lines(at).every(isMeta)) at++;
    header.bookId = paragraphs.slice(1, at).join('\n').match(/^微信读书 bookId：`([^`]*)`/m)?.[1] ?? '';
  }

  const items = [];
  let chapter = '';
  let open = null; // { item, part: 'thought' | 'passage' | 'repeat' | 'highlight' }
  let last = null;
  const add = (item) => { items.push(item); last = item; return item; };
  const close = () => {
    // A rating with one short line after it and no review: that line was the next chapter's name.
    if (open?.part === 'thought' && open.item.rating && open.single && isTitle(open.item.thought) && open.item.thought.length <= 30) {
      chapter = open.item.thought;
      open.item.thought = '';
    }
    open = null;
  };
  const isTitle = (paragraph) => !paragraph.includes('\n') && !SENTENCE_END.test(paragraph) && !CAPTION.test(paragraph);
  const upTo = (index, test) => {
    for (let next = index + 1; next < paragraphs.length; next++) {
      if (test(paragraphs[next])) return paragraphs[next];
      if (paragraphs[next].startsWith('◆')) return null;
    }
    return null;
  };
  /** After a passage: more of the passage (several lines, a caption, a sentence, or text the repeat below has too)? */
  const continues = (paragraph, index) => {
    if (!isTitle(paragraph)) return true;
    if (open.part !== 'passage') return false;
    const repeat = upTo(index, (next) => next.startsWith('◆') && !THOUGHT_HEAD.test(next));
    return Boolean(repeat) && flat(repeat).includes(flat(paragraph));
  };
  const locate = (item, paragraph) => {
    if (!item) return;
    for (const name of ['reviewId', 'bookmarkId', 'chapterUid', 'range']) {
      const found = paragraph.match(new RegExp(`${name}: \`([^\`]+)\``));
      if (found) item[name] = name === 'chapterUid' ? Number(found[1]) || 0 : found[1];
    }
    const date = paragraph.match(/^划线时间：(\d{4}\/\d{1,2}\/\d{1,2})/);
    if (date) item.date = date[1];
  };

  for (let index = at; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index];
    if (TRAILER.test(paragraph)) continue;
    if (paragraph.startsWith('◆')) {
      close();
      const head = paragraph.match(THOUGHT_HEAD);
      if (head) {
        open = { item: add({ kind: 'thought', chapter, date: head[1], rating: head[2] === '发表想法' ? '' : head[2], thought: '', text: '' }), part: 'thought' };
        continue;
      }
      const text = paragraph.replace(/^◆\s*/, '');
      if (last?.kind === 'thought' && last.head && (samePassage(last.head, text) || samePassage(last.text, text))) {
        if (flat(text).length > flat(last.text).length) last.text = text;
        open = { item: last, part: 'repeat' };
      } else {
        open = { item: add({ kind: 'highlight', chapter, date: '', rating: '', thought: '', text }), part: 'highlight' };
      }
      continue;
    }
    if (/^(来源定位|划线时间)：/.test(paragraph)) { locate(open?.item ?? last, paragraph); continue; }
    if (paragraph.startsWith('原文：')) {
      const text = paragraph.slice(3).trim();
      const item = open?.part === 'thought' ? open.item : add({ kind: 'highlight', chapter, date: '', rating: '', thought: '', text: '' });
      item.text = text;
      item.head = text;
      open = { item, part: 'passage' };
      continue;
    }
    if (paragraph.startsWith('### ')) { close(); chapter = paragraph.slice(4).trim(); continue; }
    if (paragraph.startsWith('>')) {
      close();
      open = { item: add({ kind: 'highlight', chapter, date: '', rating: '', thought: '', text: paragraph.replace(/^>\s?/gm, '').trim() }), part: 'highlight' };
      continue;
    }

    // A bare paragraph: part of the note that is open, or the next chapter's name.
    if (open?.part === 'thought') {
      const { item } = open;
      if (!item.thought) { item.thought = paragraph; open.single = true; continue; }
      open.single = false;
      const passageAhead = !item.rating && upTo(index, (next) => next.startsWith('原文：'));
      if (passageAhead || !isTitle(paragraph)) { item.thought += `\n${paragraph}`; continue; }
    } else if (open && continues(paragraph, index)) {
      if (open.part !== 'repeat') open.item.text += `\n${paragraph}`;
      else if (!flat(open.item.text).includes(flat(paragraph))) open.item.text += `\n${paragraph}`;
      continue;
    }
    close();
    chapter = paragraph.split('\n')[0];
  }
  close();
  items.forEach((item, index) => { item.n = index + 1; delete item.head; });
  return { ...header, items };
}

const day = (seconds) => {
  if (!seconds) return '';
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
};

/** raw.json: `reviews` (thoughts, with the passage in `abstract`) and, in newer syncs, `marks` and `chapters`. */
export function parseRaw(data, fallbackTitle = '') {
  const chapters = new Map((Array.isArray(data.chapters) ? data.chapters : []).map((chapter) => [String(chapter.chapterUid), str(chapter.title)]));
  const chapterName = (item) => str(item.chapterName) || chapters.get(String(item.chapterUid)) || '';
  const items = [];
  const placed = new Set();
  for (const review of Array.isArray(data.reviews) ? data.reviews : []) {
    const thought = str(review.content);
    const text = str(review.abstract);
    if (!thought && !text) continue;
    const range = str(review.range);
    if (range) placed.add(`${review.chapterUid}:${range}`);
    items.push({
      kind: thought ? 'thought' : 'highlight', chapter: chapterName(review), date: day(review.createTime), rating: '', thought, text: text === thought ? '' : text,
      reviewId: str(review.reviewId), chapterUid: Number(review.chapterUid) || 0, range, ts: Number(review.createTime) || 0,
    });
  }
  for (const mark of Array.isArray(data.marks) ? data.marks : []) {
    const text = str(mark.markText);
    const range = str(mark.range);
    if (!text || (range && placed.has(`${mark.chapterUid}:${range}`))) continue;
    items.push({
      kind: 'highlight', chapter: chapterName(mark), date: day(mark.createTime), rating: '', thought: '', text,
      bookmarkId: str(mark.bookmarkId), chapterUid: Number(mark.chapterUid) || 0, range, ts: Number(mark.createTime) || 0,
    });
  }
  // Book order: whole-book reviews first, then by chapter and position in the chapter.
  const start = (item) => Number(item.range.split('-')[0]) || 0;
  items.sort((a, b) => a.chapterUid - b.chapterUid || start(a) - start(b) || a.ts - b.ts);
  items.forEach((item, index) => { item.n = index + 1; });
  return { title: str(data.title) || fallbackTitle, author: str(data.author), bookId: str(data.bookId), fetchedAt: Number(data.fetchedAt) || 0, items };
}

const overlaps = (a, b) => { const [short, long] = a.length <= b.length ? [a, b] : [b, a]; return short.length >= 4 && long.includes(short); };
const tally = (items) => ({ total: items.length, thoughts: items.filter((item) => item.kind === 'thought').length, highlights: items.filter((item) => item.kind === 'highlight').length });

export function createSourceIndex({ repo, archive, raw }) {
  const cache = new Map();
  let merged = { stamp: null, books: [], problems: [] };

  const load = (file, parse, stamps, problems) => {
    let stat;
    try { stat = statSync(file); } catch { return null; }
    stamps.push(`${file}:${stat.mtimeMs}:${stat.size}`);
    let cached = cache.get(file);
    if (!cached || cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
      cached = { mtime: stat.mtimeMs, size: stat.size, value: null, problem: null };
      try { cached.value = parse(readFileSync(file, 'utf8')); } catch (error) { cached.problem = `${posix(path.relative(repo, file))} 读不了：${error.message}`; }
      cache.set(file, cached);
    }
    if (cached.problem) problems.push(cached.problem);
    return cached.value;
  };
  const list = (directory) => { try { return readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name)); } catch { return []; } };

  const refresh = () => {
    const stamps = [];
    const problems = [];
    const archives = [];
    for (const category of list(archive)) {
      if (!category.isDirectory() || category.name.startsWith('.')) continue;
      for (const entry of list(path.join(archive, category.name))) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const file = path.join(archive, category.name, entry.name);
        const name = path.basename(entry.name, '.md');
        const parsed = load(file, (source) => parseArchive(source, name), stamps, problems);
        if (parsed) archives.push({ source: 'archive', file, path: posix(path.relative(repo, file)), category: category.name, name, ...parsed, ...tally(parsed.items) });
      }
    }
    const raws = [];
    for (const entry of list(raw)) {
      if (!entry.isDirectory()) continue;
      const file = path.join(raw, entry.name, 'raw.json');
      const parsed = load(file, (source) => parseRaw(JSON.parse(source.replace(/^\uFEFF/, '')), entry.name), stamps, problems);
      if (parsed) raws.push({ source: 'raw', file, path: posix(path.relative(repo, file)), dir: entry.name, ...parsed, ...tally(parsed.items) });
    }
    const stamp = stamps.join('\n');
    if (stamp === merged.stamp) return merged;

    // One entry per book: an archive and a raw.json are the same book when the bookId or the title agrees.
    const books = archives.map((item) => ({ title: item.title, author: item.author, bookId: item.bookId, category: item.category, kind: 'book', archive: item, raw: null }));
    for (const item of raws) {
      const key = squash(item.title);
      const free = books.filter((book) => book.archive && !book.raw);
      let match = free.find((book) => (item.bookId && book.bookId === item.bookId) || squash(book.title) === key);
      if (!match) {
        const near = free.filter((book) => overlaps(squash(book.title), key));
        if (near.length === 1) match = near[0];
      }
      if (match) {
        match.raw = item;
        match.bookId ||= item.bookId;
        match.author ||= item.author;
      } else {
        books.push({ title: item.title, author: item.author, bookId: item.bookId, category: '', kind: item.bookId.startsWith('MP_') ? 'mp' : 'book', archive: null, raw: item });
      }
    }
    merged = { stamp, books, problems };
    return merged;
  };

  /** The source to read a book from: the one asked for, else whichever holds more notes (raw.json on a tie: it has ids). */
  const pick = (book, wanted) => {
    if (wanted === 'archive' || wanted === 'raw') {
      if (!book[wanted]) throw new Error(`《${book.title}》没有${wanted === 'archive' ? ` Markdown 档案（${NOTES_DIR}/）` : `同步的原始数据（${RAW_DIR}/）`}。`);
      return book[wanted];
    }
    if (book.archive && book.raw) return book.archive.total > book.raw.total ? book.archive : book.raw;
    return book.archive ?? book.raw;
  };

  return {
    books: () => refresh().books,
    problems: () => refresh().problems,
    pick,

    /** Notes ranked against a query. The note's own words decide whether it is a hit; chapter and book only lift it. */
    search(query, { books, kind, limit = 10 } = {}) {
      const terms = queryTerms(query);
      const notes = [];
      for (const book of books ?? refresh().books) {
        const source = pick(book);
        if (!source) continue;
        const title = { text: normalize(`${book.title} ${book.author}`), weight: 2 };
        for (const item of source.items) {
          if (kind && item.kind !== kind) continue;
          item.fields ??= [
            { text: normalize(item.thought), weight: 5, phrase: 8 },
            { text: normalize(item.text), weight: 3, phrase: 6 },
          ];
          item.chapterField ??= { text: normalize(item.chapter), weight: 2 };
          notes.push({ book, source, item, around: [item.chapterField, title] });
        }
      }
      const found = rank(notes, terms, { own: (note) => note.item.fields, around: (note) => note.around });
      const hits = found.hits.map(({ doc: { book, source, item }, score }) => ({ book, source, item, score }));
      const perBook = new Map();
      for (const hit of hits) perBook.set(hit.book, (perBook.get(hit.book) ?? 0) + 1);
      hits.sort((a, b) => b.score - a.score || compareText(a.book.title, b.book.title) || a.item.n - b.item.n);
      return {
        total: hits.length,
        missing: found.missing,
        items: hits.slice(0, limit),
        books: [...perBook].sort((a, b) => b[1] - a[1]).map(([book, count]) => ({ title: book.title, hits: count })),
      };
    },
  };
}
