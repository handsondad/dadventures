import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { DOC_TYPES, INTENTS, LINK_FIELDS, MANUAL_SOURCE, PROVENANCE_FIELDS, REFERENCE_FIELDS, insideKb, parseTaxonomy } from './layout.js';
import { normalize, queryTerms, rank, snippet, squash } from './search.js';
import { compareText, posix, strings } from './shared.js';

// One index over the knowledge base (kb/). Cards live in <type folder>/<subject>/;
// the subject folder is also the scope of an id, because older cards reuse `note-0001` in every subject. So a card
// is addressed by its ref, `<subject>/<id>`. Files are re-read only when their modification time or size changes,
// which makes cards written during a session searchable on the next call.

const FOLDERS = Object.entries(DOC_TYPES).map(([type, spec]) => ({ type, folder: spec.folder }));
const TYPE_ORDER = Object.keys(DOC_TYPES);
const TAG_FIELDS = ['topic_tags', 'theme_tags', 'scenes', 'problems', 'idea_sparks', 'application_scenarios', 'subject_domains'];
const STATUS_WEIGHT = { published: 1.15, reviewed: 1.1 };
const INTENT_BOOST = [1.8, 1.4, 1.15, 1.05, 1];
const OTHER_BOOST = 0.85;
const LOOKS_LIKE_REF = /^(?:[a-z0-9_]+\/)?[a-z]+(?:-[a-z0-9_]+)*-\d{3,}$/;

const one = (value) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

function walk(directory, found = []) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name)); } catch { return found; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

function entryOf(root, folder, folderType, file, source, stat) {
  const { data, body, frontmatter } = parseFrontmatter(source);
  const relative = posix(path.relative(root, file));
  const inner = relative.slice(folder.length + 1).split('/');
  const subject = inner.length > 1 ? inner[0] : '';
  const base = path.basename(file, '.md');
  const id = one(data.id);
  const key = id || base;
  const titleZh = one(data.title_zh);
  const section = one(data.source_section);
  const slug = (id && base.startsWith(`${id}-`) ? base.slice(id.length + 1) : '').replaceAll('-', ' ');
  const keys = [...strings(data.aliases), ...strings(data.search_terms), ...strings(data.core_questions)];
  const tags = TAG_FIELDS.flatMap((field) => strings(data[field])).map((tag) => tag.replaceAll('_', ' '));
  return {
    subject,
    ref: subject ? `${subject}/${key}` : key,
    id: key,
    has_id: Boolean(id),
    has_frontmatter: frontmatter,
    path: relative,
    file,
    folder_type: folderType,
    doc_type: typeof data.doc_type === 'string' ? data.doc_type : null,
    status: typeof data.status === 'string' ? data.status : null,
    version: data.schema_version === undefined || data.schema_version === null ? null : String(data.schema_version),
    title: titleZh || section || slug || base,
    data,
    body,
    fields: [
      { text: normalize(`${titleZh} ${one(data.title)} ${section} ${slug} ${key}`), weight: 12, phrase: 20 },
      { text: normalize(keys.join(' | ')), weight: 7, phrase: 10 },
      { text: normalize(tags.join(' | ')), weight: 3 },
      { text: normalize(body), weight: 1, cap: 6, phrase: 4 },
    ],
    mtime: stat.mtimeMs,
    size: stat.size,
  };
}

export function createKnowledgeIndex(root) {
  const cache = new Map();
  let taxonomy = { sections: new Map(), subjects: [], missing: true };
  let taxonomyStamp = '';
  let graph = null;

  const loadTaxonomy = () => {
    const file = path.join(root, 'taxonomy', 'taxonomy.md');
    let stamp = 'missing';
    try { const stat = statSync(file); stamp = `${stat.mtimeMs}:${stat.size}`; } catch { /* reported by kb_check */ }
    if (stamp === taxonomyStamp) return;
    taxonomyStamp = stamp;
    graph = null;
    try { taxonomy = { ...parseTaxonomy(readFileSync(file, 'utf8')), missing: false }; } catch { taxonomy = { sections: new Map(), subjects: [], missing: true }; }
  };

  const refresh = () => {
    loadTaxonomy();
    const seen = new Set();
    let changed = false;
    for (const { type, folder } of FOLDERS) {
      for (const file of walk(path.join(root, ...folder.split('/')))) {
        seen.add(file);
        let stat;
        try { stat = statSync(file); } catch { continue; }
        const cached = cache.get(file);
        if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) continue;
        try { cache.set(file, entryOf(root, folder, type, file, readFileSync(file, 'utf8'), stat)); } catch { cache.delete(file); }
        changed = true;
      }
    }
    for (const file of [...cache.keys()]) if (!seen.has(file)) { cache.delete(file); changed = true; }
    if (changed) graph = null;
    return [...cache.values()];
  };

  /** Subjects from taxonomy.md, plus any folder that is in use but not listed there. */
  const subjectList = (entries) => {
    const list = taxonomy.subjects.map((subject) => ({ ...subject, listed: true }));
    for (const subject of new Set(entries.map((entry) => entry.subject).filter(Boolean))) {
      if (!list.some((item) => item.id === subject)) list.push({ id: subject, label: subject, listed: false });
    }
    return list;
  };

  /** Outgoing references, backlinks, and the books each card goes back to. Rebuilt only when a file changed. */
  const build = () => {
    const entries = refresh();
    if (graph) return graph;
    const byId = new Map();
    for (const entry of entries) push(byId, entry.id, entry);

    // The same rule as validate_knowledge.py: `subject/id` names one subject; a bare id means this card's own
    // subject first, then the only other subject that has it.
    const resolve = (from, value) => {
      const slash = value.indexOf('/');
      if (slash > 0) {
        const found = (byId.get(value.slice(slash + 1)) ?? []).filter((entry) => entry.subject === value.slice(0, slash));
        return found.length ? { target: found[0] } : { target: null, problem: 'unknown' };
      }
      const all = byId.get(value) ?? [];
      if (!all.length) return { target: null, problem: 'unknown' };
      const local = all.find((entry) => entry.subject === from.subject);
      if (local) return { target: local };
      if (new Set(all.map((entry) => entry.subject)).size > 1) return { target: null, problem: 'ambiguous' };
      return { target: all[0] };
    };

    const outgoing = new Map();
    const incoming = new Map();
    for (const entry of entries) {
      const refs = [];
      for (const field of [...REFERENCE_FIELDS, ...LINK_FIELDS]) {
        const strict = REFERENCE_FIELDS.includes(field);
        for (const value of strings(entry.data[field])) {
          if (field === 'source_book' && value === MANUAL_SOURCE) continue;
          if (!strict && !LOOKS_LIKE_REF.test(value)) continue;
          const { target, problem } = resolve(entry, value);
          refs.push({ field, value, target, problem: problem ?? null, strict });
          if (target) push(incoming, target, { field, from: entry });
        }
      }
      outgoing.set(entry, refs);
    }

    const books = new Map(entries.map((entry) => [entry, new Set(entry.doc_type === 'source_book' ? [entry] : [])]));
    for (let round = 0; round < 6; round++) {
      let grew = false;
      for (const entry of entries) {
        if (entry.doc_type === 'source_book') continue;
        const own = books.get(entry);
        for (const link of outgoing.get(entry)) {
          if (!link.target || (link.field !== 'source_book' && !PROVENANCE_FIELDS.includes(link.field))) continue;
          for (const book of books.get(link.target)) if (!own.has(book)) { own.add(book); grew = true; }
        }
      }
      if (!grew) break;
    }

    const subjects = subjectList(entries);
    const labelOf = new Map(subjects.map((subject) => [subject.id, subject.label]));
    const context = new Map(entries.map((entry) => [entry, {
      text: normalize(`${labelOf.get(entry.subject) ?? ''} ${[...books.get(entry)].map((book) => book.title).join(' | ')}`), weight: 4,
    }]));
    graph = { entries, byId, outgoing, incoming, books, context, subjects, labelOf, resolve };
    return graph;
  };

  const subjectOf = (value, { subjects } = build()) => {
    const wanted = String(value ?? '').trim();
    const lower = wanted.toLowerCase();
    const exact = subjects.find((subject) => subject.id === lower || subject.label === wanted);
    if (exact) return exact;
    const near = subjects.filter((subject) => subject.label.includes(wanted) || wanted.includes(subject.label));
    if (near.length === 1) return near[0];
    throw new Error(`没有这个主题域：${wanted}。可用的有：${subjects.map((subject) => `${subject.id}（${subject.label}）`).join('、')}。`);
  };

  const brief = (entry) => ({ ref: entry.ref, title: entry.title, subject: entry.subject, doc_type: entry.doc_type });
  const typeRank = (entry) => { const at = TYPE_ORDER.indexOf(entry.doc_type); return at === -1 ? TYPE_ORDER.length : at; };

  return {
    root,
    entries: () => refresh(),
    graph: () => build(),
    taxonomy: () => { refresh(); return taxonomy; },
    subjects: () => build().subjects,
    subject: (value) => subjectOf(value),
    brief,
    books: (entry) => [...build().books.get(entry) ?? []],

    /** Card counts per subject and type. */
    overview() {
      const { entries, subjects } = build();
      return subjects.map((subject) => {
        const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
        let total = 0;
        for (const entry of entries) {
          if (entry.subject !== subject.id) continue;
          total++;
          if (entry.doc_type in counts) counts[entry.doc_type]++;
        }
        return { ...subject, total, counts };
      });
    },

    /** Book cards a user's wording points at: a ref or id, or part of the title. */
    findBooks(value) {
      const { entries } = build();
      const cards = entries.filter((entry) => entry.doc_type === 'source_book');
      const wanted = String(value ?? '').trim();
      const byRef = cards.filter((card) => card.ref === wanted || card.id === wanted);
      if (byRef.length) return byRef;
      const needle = squash(wanted);
      if (!needle) return [];
      return cards.filter((card) => { const title = squash(card.title); return title && (title.includes(needle) || needle.includes(title)); });
    },

    /**
     * Ranked cards. Without a query it lists what the filters select, sources first. `intent` moves the card types
     * that answer that kind of question to the front.
     */
    search(query, { subject, docType, intent, books: bookFilter, limit = 8, exclude } = {}) {
      const graph = build();
      const { entries, books, context } = graph;
      const only = subject ? subjectOf(subject, graph) : null;
      const terms = queryTerms(query ?? '');
      const order = intent ? INTENTS[intent]?.order : null;
      const wantedBooks = bookFilter ? new Set(bookFilter) : null;
      const selected = entries.filter((entry) => (!only || entry.subject === only.id) && (!docType || entry.doc_type === docType)
        && (!wantedBooks || [...books.get(entry)].some((book) => wantedBooks.has(book))) && !exclude?.(entry));
      // The book a card goes back to and its subject are part of what it is about: "金钱心理学 复利" finds that book's cards.
      const found = terms.whole.length
        ? rank(selected, terms, { own: (entry) => [...entry.fields, context.get(entry)] })
        : { hits: selected.map((entry) => ({ doc: entry, score: 1 })), missing: [] };
      const hits = found.hits.map(({ doc: entry, score }) => {
        const place = order ? order.indexOf(entry.doc_type) : -2;
        return { entry, score: score * (STATUS_WEIGHT[entry.status] ?? 1) * (place === -2 ? 1 : place === -1 ? OTHER_BOOST : INTENT_BOOST[place]) };
      });
      hits.sort((a, b) => b.score - a.score || typeRank(a.entry) - typeRank(b.entry) || compareText(a.entry.path, b.entry.path));
      return {
        total: hits.length,
        missing: found.missing,
        items: hits.slice(0, limit).map(({ entry, score }) => {
          const titles = [...books.get(entry)].map((book) => book.title);
          return {
            ...brief(entry),
            status: entry.status,
            path: entry.path,
            books: titles.slice(0, 3),
            more_books: Math.max(0, titles.length - 3),
            score: Math.round(score * 10) / 10,
            snippet: snippet(entry.body, terms),
          };
        }),
      };
    },

    /** One card by ref (`subject/id`), its path, a file name, or an id that only one subject uses. */
    find(value) {
      const { entries, subjects } = build();
      const wanted = insideKb(value, root).replace(/\.md$/, '');
      if (!wanted) throw new Error('ref 不能为空。');
      const exact = entries.filter((entry) => entry.ref === wanted || entry.path === `${wanted}.md`);
      if (exact.length === 1) return exact[0];
      const slash = wanted.indexOf('/');
      if (slash > 0) {
        const head = wanted.slice(0, slash);
        const subject = subjects.find((item) => item.id === head || item.label === head);
        if (subject) {
          const tail = wanted.slice(slash + 1);
          const found = entries.filter((entry) => entry.subject === subject.id && (entry.id === tail || path.basename(entry.file, '.md') === tail));
          if (found.length === 1) return found[0];
        }
      }
      const loose = entries.filter((entry) => entry.id === wanted || path.basename(entry.file, '.md') === wanted);
      if (loose.length === 1) return loose[0];
      if (loose.length > 1) {
        throw new Error(`${wanted} 在多个主题域里都有：${loose.slice(0, 12).map((entry) => entry.ref).join('、')}${loose.length > 12 ? ' 等' : ''}。请写成 主题域/id。`);
      }
      throw new Error(`知识库里没有 ${wanted}。先用 kb_search 找到条目，再用返回的 ref 读取。`);
    },

    /** What a card points to, what points to it, and the books it goes back to. */
    links(entry) {
      const { outgoing, incoming, books } = build();
      return {
        outgoing: (outgoing.get(entry) ?? []).map(({ field, value, target, problem }) => ({ field, value, ...(target ? brief(target) : { ref: null, problem }) })),
        incoming: (incoming.get(entry) ?? []).map(({ field, from }) => ({ field, ...brief(from) })),
        books: [...books.get(entry) ?? []].filter((book) => book !== entry).map(brief),
      };
    },

    /** Ids already used in one subject for one id prefix, for allocating the next one. */
    ids(subject, prefix) {
      return refresh().filter((entry) => entry.subject === subject && entry.id.startsWith(`${prefix}-`)).map((entry) => entry.id);
    },
  };
}

/** The next free `<prefix>-<subject>-NNNN`: one more than the highest number that subject uses, old style or new. */
export function nextId(ids, prefix, subject) {
  const pattern = new RegExp(`^${prefix}-(?:[a-z0-9_]+-)?(\\d+)$`);
  let highest = 0;
  for (const id of ids) {
    const match = id.match(pattern);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}-${subject}-${String(highest + 1).padStart(4, '0')}`;
}
