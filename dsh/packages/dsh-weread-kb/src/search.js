// Lexical ranking that works for Chinese without a segmenter.
//
// A keyword (安全感, 护城河, CRISPR) is matched as written when the notes have it, so 安全感 does not bring up
// 安全边际. A sentence ("安全感怎么影响大脑"), and a keyword the notes do not have, is matched by its character
// bigrams. Every unit is weighted by how rare it is among the documents searched, so 发脾气 decides a question and
// 的时候 does not.

const SEPARATORS = /[\s,，。、;；:：!！?？()（）\[\]【】{}<>《》"'“”‘’`/\\|+=*#~^&%$@·…—\-_]+/u;
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/u;
// Bigrams that almost every question contains; as fragments they rank nothing.
const FILLER_GRAMS = new Set(['怎么', '什么', '么办', '么是', '是什', '可以', '一个', '我们', '如何', '一下', '这个', '那个', '有没', '没有', '为什',
  '的是', '哪些', '有哪', '这本', '本书', '书里', '关于', '于是', '是怎', '么说', '怎样', '是不', '不是']);

/** CJK terms up to this many characters are keywords; longer ones are sentences. */
const KEYWORD_CHARS = 6;
/** A bigram counts this much of a term found as written. */
const GRAM_GAIN = 0.35;
/**
 * A hit holds at least this share of the query's weight (of a long query: the weight of this many ordinary units),
 * and this share of what the best hit holds.
 */
const MIN_COVER = 0.2;
const MIN_UNITS = 2;
const NEAR_BEST = 0.5;

export function normalize(value) {
  return String(value ?? '').toLowerCase();
}

/** Letters, digits and CJK only: "父母：挑战（果麦经典）" and "父母挑战 果麦经典" compare equal. */
export function squash(value) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

const bigrams = (term) => {
  const chars = [...term];
  const grams = [];
  if (chars.length <= 2 || !chars.some((char) => CJK.test(char))) return grams;
  for (let index = 0; index < chars.length - 1; index++) {
    const gram = chars[index] + chars[index + 1];
    if (CJK.test(gram) && !FILLER_GRAMS.has(gram)) grams.push(gram);
  }
  return grams;
};

/**
 * whole: the terms as typed. Each is one of: plain (no bigrams: two characters, or not CJK), a keyword (a short
 * CJK term, with its bigrams as a fallback) or a sentence (bigrams only). grams: every bigram, for snippets.
 */
export function queryTerms(query) {
  const whole = [...new Set(normalize(query).split(SEPARATORS).filter(Boolean))];
  const plain = [];
  const keywords = [];
  const sentences = [];
  const grams = new Set();
  for (const term of whole) {
    const own = bigrams(term);
    if (!own.length) { plain.push(term); continue; }
    ([...term].length <= KEYWORD_CHARS ? keywords : sentences).push({ term, grams: own });
    for (const gram of own) grams.add(gram);
  }
  return { whole, plain, keywords, sentences, grams: [...grams], phrase: normalize(query).trim() };
}

const occurrences = (haystack, needle, cap) => {
  let count = 0;
  let from = 0;
  while (count < cap) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
};

/** Repeats count less each time: a text that says 的时候 four times is not four times as much about it. */
const weigh = (fields, needle, cap) => {
  let hit = 0;
  for (const field of fields) hit += Math.sqrt(occurrences(field.text, needle, field.cap ?? cap)) * field.weight;
  return hit;
};

/** 1 for a unit that 2% of the documents hold, about 2 for one that a single document holds, 0.2 for one in all. */
const rarity = (holders, total) => Math.log(1 + total / holders) / Math.log(51);

/**
 * Rank documents against a query. `own(doc)` gives the fields ([{ text, weight, cap?, phrase? }], lower-cased) that
 * decide whether the document is a hit; `around(doc)` gives fields that only lift a hit (the chapter and book a
 * note sits in).
 *
 * Returns { hits: [{ doc, score }] (unsorted), missing: [term] }. A hit holds a fair share of the query, measured
 * against the best hit. `missing` lists the keywords no document holds as written: hits on those are fragments
 * only (量子 and 纠缠 somewhere for 量子纠缠) and the caller should say so.
 */
export function rank(docs, terms, { own, around }) {
  const { plain, keywords, sentences, phrase } = terms;
  const empty = { hits: [], missing: [] };
  if (!terms.whole.length || !docs.length) return empty;

  const exact = new Set(plain);
  const cut = [...sentences];
  for (const keyword of keywords) {
    if (docs.some((doc) => own(doc).some((field) => field.text.includes(keyword.term)))) exact.add(keyword.term);
    else cut.push(keyword);
  }
  const units = [...new Set([...exact, ...cut.flatMap((item) => item.grams)])];

  const holders = units.map(() => 0);
  const rows = [];
  for (const doc of docs) {
    const fields = own(doc);
    let any = false;
    const found = units.map((unit, at) => {
      const hit = weigh(fields, unit, exact.has(unit) ? 3 : 2);
      if (hit) { holders[at]++; any = true; }
      return hit;
    });
    if (any) rows.push({ doc, fields, found });
  }
  const missing = [...plain.filter((term) => !holders[units.indexOf(term)]), ...keywords.filter((item) => !exact.has(item.term)).map((item) => item.term)];
  if (!rows.length) return { hits: [], missing };

  // A unit no document holds is a word the notes do not have, or two characters that are not a word at all
  // ("感怎"); it weighs like the average unit that is held, so that a question is not judged by its leftovers alone.
  const known = holders.filter(Boolean).map((count) => rarity(count, docs.length));
  const average = known.reduce((sum, value) => sum + value, 0) / known.length;
  const weight = units.map((unit, at) => (holders[at] ? rarity(holders[at], docs.length) : average));
  const gain = units.map((unit) => (exact.has(unit) ? 1 : GRAM_GAIN));
  const all = weight.reduce((sum, value) => sum + value, 0);
  // A sentence found as written (a title typed in full) counts on top of its bigrams.
  const written = cut.map(({ term, grams }) => ({ term, weight: Math.max(...grams.map((gram) => weight[units.indexOf(gram)])) }));

  const hits = rows.map(({ doc, fields, found }) => {
    const extra = around ? around(doc) : [];
    let score = 0;
    let held = 0;
    units.forEach((unit, at) => {
      if (found[at]) held += weight[at];
      score += (found[at] + (extra.length ? weigh(extra, unit, 1) : 0)) * gain[at] * weight[at];
    });
    for (const item of written) score += (weigh(fields, item.term, 3) + (extra.length ? weigh(extra, item.term, 1) : 0)) * item.weight;
    if (phrase.length > 1) for (const field of fields) if (field.phrase && field.text.includes(phrase)) score += field.phrase;
    return { doc, score: score * (0.4 + 0.6 * held / all), held };
  });
  const floor = Math.max(Math.min(MIN_COVER * all, MIN_UNITS * average), NEAR_BEST * Math.max(...hits.map((hit) => hit.held)));
  return { hits: hits.filter((hit) => hit.held >= floor).map(({ doc, score }) => ({ doc, score })), missing };
}

/** A short window of text around the first typed term found, or else the first bigram, whitespace collapsed. */
export function snippet(body, terms, size = 140) {
  const flat = String(body ?? '').replace(/[#>*`|]/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const first = (needles) => needles.reduce((at, needle) => {
    const found = lower.indexOf(needle);
    return found !== -1 && (at === -1 || found < at) ? found : at;
  }, -1);
  let at = first(terms.whole);
  if (at === -1) at = first(terms.grams);
  if (at === -1) return flat.slice(0, size);
  const start = Math.max(0, at - Math.floor(size / 3));
  const piece = flat.slice(start, start + size);
  return `${start > 0 ? '…' : ''}${piece}${start + size < flat.length ? '…' : ''}`;
}
