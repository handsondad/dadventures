import path from 'node:path';

// Where things live in the dadventures repository, and the rules of its knowledge base. The rules mirror
// kb/AGENTS.md and .weread-sync/scripts/validate_knowledge.py: keep the three in step.

/** Knowledge cards. */
export const KB_DIR = 'kb';
/** Markdown archives of the WeRead notes, one file per book, in category folders. */
export const NOTES_DIR = 'notes';
/** Synced WeRead data, one folder per book with a raw.json. */
export const RAW_DIR = '.weread-sync/raw_notes';

export const repoPaths = (repoRoot) => ({
  repo: repoRoot,
  kb: path.join(repoRoot, KB_DIR),
  archive: path.join(repoRoot, NOTES_DIR),
  raw: path.join(repoRoot, ...RAW_DIR.split('/')),
});

/**
 * A card as a caller may name it, made relative to the knowledge base: an absolute path under `root`, a path from
 * the repository (`kb/concepts/...`), or one already relative to the knowledge base. Refs pass through unchanged.
 */
export const insideKb = (value, root) => {
  const wanted = String(value ?? '').trim();
  if (root && path.isAbsolute(wanted)) {
    const relative = path.relative(root, wanted);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.replaceAll('\\', '/');
  }
  const local = wanted.replaceAll('\\', '/').replace(/^\.\//, '');
  return local.startsWith(`${KB_DIR}/`) ? local.slice(KB_DIR.length + 1) : local;
};

/** Card types in pipeline order: sources first, abstractions after. `answers` is the question a type is for. */
export const DOC_TYPES = {
  source_book: { label: '书目卡', prefix: 'book', folder: 'sources/books', template: '_templates/source_book_template.md', answers: '这本书讲什么、整理到哪了' },
  source_note: { label: '来源笔记', prefix: 'note', folder: 'sources/notes', template: '_templates/source_note_template.md', answers: '这本书（这一章）是怎么说的' },
  concept_card: { label: '概念卡', prefix: 'concept', folder: 'concepts', template: '_templates/concept_card_template.md', answers: '这是什么意思、为什么重要' },
  action_card: { label: '行动卡', prefix: 'action', folder: 'actions', template: '_templates/action_card_template.md', answers: '具体怎么做、怎么判断' },
  collection: { label: '主题包', prefix: 'collection', folder: 'collections', template: '_templates/collection_template.md', answers: '围绕一个问题有哪些卡片和引用' },
  idea_seed: { label: '想法种子', prefix: 'idea', folder: 'ideas', template: '_templates/idea_seed_template.md', answers: '有哪些闪光点和待展开的想法' },
};

export const REQUIRED = ['doc_type', 'id', 'status'];
export const STATUSES = ['draft', 'reviewed', 'published'];
export const MANUAL_SOURCE = 'manual_synthesis';

/** A broken reference in these fields is an error (the same set validate_knowledge.py checks). */
export const REFERENCE_FIELDS = ['source_book', 'source_refs', 'derived_cards', 'related_actions', 'related_concepts', 'theme_refs', 'included_cards'];
/** Older cards also link through these; they join the link graph, and a broken one is only a warning. */
export const LINK_FIELDS = ['related_collections', 'related_cards', 'related_ideas', 'card_refs', 'includes'];
/** Following these from a card leads back to the book it came from. */
export const PROVENANCE_FIELDS = ['source_refs', 'included_cards', 'theme_refs'];

/** Frontmatter field → taxonomy.md section that lists its allowed values. */
export const CONTROLLED_FIELDS = {
  subject_domains: 'Subject Domains',
  note_kind: 'Note Kinds',
  concept_type: 'Concept Types',
  action_type: 'Action Types',
  claim_basis: 'Claim Basis',
  audiences: 'Audiences',
  use_cases: 'Use Cases',
  effort: 'Effort',
  time_horizon: 'Time Horizon',
  collection_kind: 'Collection Kinds',
  idea_kind: 'Idea Kinds',
  status: 'Status',
};

/** Which question types prefer which card types, from the priority tables in the knowledge base's AGENTS.md. */
export const INTENTS = {
  concept: { label: '这是什么意思、怎么理解', order: ['concept_card', 'source_note', 'collection', 'source_book'] },
  howto: { label: '具体怎么做、怎么判断', order: ['action_card', 'collection', 'concept_card', 'source_note'] },
  topic: { label: '这个场景或问题有哪些相关主题', order: ['collection', 'action_card', 'concept_card', 'source_note'] },
  ideas: { label: '有哪些闪光点、想法和表达素材', order: ['collection', 'idea_seed', 'concept_card', 'action_card', 'source_note'] },
  book: { label: '这本书是怎么说的', order: ['source_note', 'source_book', 'concept_card'] },
  compare: { label: '不同的书怎么比较', order: ['concept_card', 'collection', 'source_note', 'source_book'] },
};

/** New ids are `<prefix>-<subject>-<4 digits>`; older cards use `<prefix>-<digits>` scoped to their subject folder. */
export const v2IdPattern = (prefix) => new RegExp(`^${prefix}-[a-z0-9]+(?:_[a-z0-9]+)*-\\d{4}$`);

/** taxonomy.md: `## Section` headings, each followed by "- `value`" or "- `value`: 中文名" lines. */
export function parseTaxonomy(source) {
  const sections = new Map();
  const labels = new Map();
  let current = null;
  for (const line of String(source ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) { current = heading[1]; sections.set(current, new Set()); continue; }
    if (!current) continue;
    const item = line.match(/^\s*-\s+`([^`]+)`(?:\s*[:：]\s*(.+?))?\s*$/);
    if (!item) continue;
    sections.get(current).add(item[1]);
    if (current === 'Subject Domains' && item[2]) labels.set(item[1], item[2]);
  }
  const subjects = [...(sections.get('Subject Domains') ?? [])].map((id) => ({ id, label: labels.get(id) ?? id }));
  return { sections, subjects };
}
