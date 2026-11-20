import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONTROLLED_FIELDS, DOC_TYPES, REQUIRED, STATUSES, insideKb, v2IdPattern } from './layout.js';
import { strings } from './shared.js';

// Checks cards against the knowledge base's rules. Errors are exactly what .weread-sync/scripts/validate_knowledge.py
// rejects, so the two agree on whether the knowledge base is valid; change them together. Warnings are conventions
// from kb/AGENTS.md that the Python validator does not look at.

const present = (value) => !(value === undefined || value === null || value === '' || (Array.isArray(value) && !value.filter((item) => item !== '').length));
const one = (value) => (typeof value === 'string' ? value.trim() : '');
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Markdown links in the body that point at a file which is not there. Web and app links are not looked at. */
function brokenLinks(entry) {
  const broken = [];
  for (const [, target] of entry.body.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (target.startsWith('#') || HAS_SCHEME.test(target)) continue;
    let file = target.replace(/[#?].*$/, '');
    try { file = decodeURIComponent(file); } catch { /* keep it as written */ }
    if (file && !existsSync(path.resolve(path.dirname(entry.file), file))) broken.push(target);
  }
  return broken;
}

export function checkKnowledge(index, { subject, paths, strictTaxonomy = false } = {}) {
  const taxonomy = index.taxonomy();
  const repo = path.dirname(index.root); // kb/ sits in the repository root; raw_source_path is written from there
  const { entries, outgoing, books, subjects } = index.graph();
  const issues = [];
  const add = (level, entry, rule, message) => issues.push({ level, rule, path: entry?.path ?? null, ref: entry?.ref ?? null, message });

  // A path may be given from the repository or from the knowledge base; a ref works too.
  const wanted = paths?.length ? new Set(paths.map((value) => insideKb(value, index.root))) : null;
  const inScope = (entry) => (!subject || entry.subject === subject) && (!wanted || wanted.has(entry.path) || wanted.has(entry.ref));

  if (taxonomy.missing) add('error', { path: 'taxonomy/taxonomy.md' }, 'taxonomy', '缺少受控词表 taxonomy/taxonomy.md。');
  for (const item of subjects) {
    if (!item.listed && (!subject || subject === item.id)) add('warning', { path: `${item.id}/` }, 'subject', `主题域 ${item.id} 不在 taxonomy.md 的 Subject Domains 里，先把它加进去。`);
  }

  const sameId = new Map();
  for (const entry of entries) {
    if (!entry.has_id) continue;
    const key = `${entry.subject}\n${entry.id}`;
    if (!sameId.has(key)) sameId.set(key, []);
    sameId.get(key).push(entry);
  }

  for (const entry of entries) {
    if (!inScope(entry)) continue;
    if (!entry.has_frontmatter) { add('error', entry, 'frontmatter', '缺少 YAML frontmatter，或格式不对。'); continue; }
    for (const field of REQUIRED) if (!present(entry.data[field])) add('error', entry, 'required', `缺少 ${field}。`);
    const spec = entry.doc_type ? DOC_TYPES[entry.doc_type] : null;
    if (entry.doc_type && !spec) add('error', entry, 'doc_type', `不认识的 doc_type ${entry.doc_type}，可用：${Object.keys(DOC_TYPES).join('、')}。`);
    const v2 = entry.version === '2';
    if (v2 && spec && !v2IdPattern(spec.prefix).test(entry.has_id ? entry.id : '')) {
      add('error', entry, 'id', `schema_version 2 的 id 要写成 ${spec.prefix}-<主题域>-<四位编号>，例如 ${spec.prefix}-investing-0001。`);
    }
    if (one(entry.data.title).startsWith('fill_in_')) add('error', entry, 'placeholder', 'title 还是模板里的占位符。');
    if (v2 || strictTaxonomy) {
      for (const [field, section] of Object.entries(CONTROLLED_FIELDS)) {
        const allowed = taxonomy.sections.get(section) ?? new Set();
        for (const value of strings(entry.data[field])) {
          if (!allowed.has(value)) add('error', entry, 'taxonomy', `${field} 的值 ${value} 不在 taxonomy.md 的 ${section} 里。`);
        }
      }
    }
    if (entry.has_id) {
      const twins = sameId.get(`${entry.subject}\n${entry.id}`).filter((other) => other !== entry);
      if (twins.length) add('error', entry, 'duplicate', `id ${entry.id} 在主题域 ${entry.subject || '（无）'} 里重复：${twins.map((other) => other.path).join('、')}。`);
    }
    for (const link of outgoing.get(entry) ?? []) {
      if (link.target) continue;
      const message = link.problem === 'ambiguous'
        ? `${link.field} 引用的 ${link.value} 在多个主题域里都有，写成 主题域/id。`
        : `${link.field} 引用的 ${link.value} 找不到。`;
      add(link.strict ? 'error' : 'warning', entry, 'ref', message);
    }

    // Conventions only (not checked by validate_knowledge.py).
    const base = path.basename(entry.file, '.md');
    if (entry.has_id && base !== entry.id && !base.startsWith(`${entry.id}-`)) add('warning', entry, 'filename', `文件名要以 id 开头：${entry.id}-<slug>.md。`);
    if (/[^\x20-\x7e]/.test(base)) add('warning', entry, 'filename', '文件名只用 ASCII（小写英文、数字、连字符）。');
    if (!entry.subject) add('warning', entry, 'folder', '卡片要放在主题域子目录里，例如 concepts/investing/。');
    if (spec && entry.folder_type !== entry.doc_type) add('warning', entry, 'folder', `${entry.doc_type} 应放在 ${spec.folder}/<主题域>/ 下。`);
    if (v2 && spec && entry.has_id) {
      const named = entry.id.slice(spec.prefix.length + 1, entry.id.lastIndexOf('-'));
      if (entry.subject && named && named !== entry.subject) add('warning', entry, 'id', `id 里的主题域是 ${named}，文件却在 ${entry.subject}/ 下。`);
    }
    if (!v2 && !strictTaxonomy && entry.status && !STATUSES.includes(entry.status)) {
      add('warning', entry, 'status', `status 只用 ${STATUSES.join(' / ')}，现在是 ${entry.status}。`);
    }
    const source = one(entry.data.raw_source_path).replaceAll('\\', '/');
    if (source && !HAS_SCHEME.test(source) && !existsSync(path.resolve(repo, source))) {
      add('warning', entry, 'path', `raw_source_path 指向的 ${source} 不存在（路径相对仓库根目录）。`);
    }
    for (const target of brokenLinks(entry)) add('warning', entry, 'path', `正文里的链接 ${target} 打不开（链接相对这张卡所在的目录）。`);
    if (entry.doc_type === 'source_note' && !present(entry.data.source_book)) add('warning', entry, 'source', '来源笔记没有 source_book（人工综合写 manual_synthesis）。');
    if (spec && !entry.doc_type.startsWith('source_') && !(books.get(entry)?.size) && !(outgoing.get(entry) ?? []).length) {
      add('warning', entry, 'source', '没有任何来源链路（source_refs / included_cards / theme_refs），回不到来源笔记。');
    }
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  const byRule = {};
  for (const issue of issues) byRule[`${issue.level}:${issue.rule}`] = (byRule[`${issue.level}:${issue.rule}`] ?? 0) + 1;
  return { ok: errors.length === 0, checked: entries.filter(inScope).length, errors, warnings, by_rule: byRule };
}
