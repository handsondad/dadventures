import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { checkKnowledge } from '../src/check.js';
import { createKbService } from '../src/service.js';
import { createKbTools } from '../src/tools.js';
import { REPO_ROOT, KB_DIR, fakeHost } from './helpers.js';

// The real knowledge base and notes of this repository. It grows, so the test holds invariants, not counts.
const present = existsSync(path.join(REPO_ROOT, KB_DIR, 'taxonomy', 'taxonomy.md'));

test('this repository: the knowledge base passes the check and every book finds its notes', { skip: !present && 'no knowledge base in this checkout' }, async () => {
  const service = createKbService({ repoRoot: REPO_ROOT });
  const index = service.index();
  const entries = index.entries();
  assert.ok(entries.length > 1000, 'the cards are indexed');
  assert.equal(new Set(entries.map((entry) => entry.ref)).size, entries.length, 'subject/id addresses one card');

  // Same verdict as .weread-sync/scripts/validate_knowledge.py: no errors.
  const check = checkKnowledge(index, {});
  assert.deepEqual(check.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`), []);
  assert.ok(check.checked >= entries.length);

  assert.deepEqual(service.sources().problems(), [], 'every raw.json and archive parses');
  const rows = service.inventory();
  const filed = rows.filter((row) => row.entry);
  assert.ok(filed.length >= 68);
  assert.deepEqual(filed.filter((row) => !row.book).map((row) => row.title), [], 'every book card is matched to its raw notes');
  assert.equal(new Set(filed.map((row) => row.book)).size, filed.length, 'and no two cards claim the same notes');
  assert.ok(rows.some((row) => row.stage === 'pending' && row.kind === 'mp'), 'official accounts are listed as sources');
  for (const row of rows.filter((item) => item.book)) assert.ok(row.notes > 0 || row.title, row.title);

  const concept = index.search('安全感', { intent: 'concept', limit: 3 });
  assert.deepEqual(concept.missing, []);
  assert.ok(concept.items.every((item) => item.title.includes('安全感') || item.snippet.includes('安全感')), 'a keyword is matched as written');
  assert.equal(concept.items[0].doc_type, 'concept_card');

  // The tools on the real data, as the model reads them.
  const host = fakeHost({ repoRoot: REPO_ROOT });
  createKbTools(host.ctx, { maintain: true });
  assert.match(await host.say('kb_overview'), /知识库共 \d+ 张卡片，\d+ 个主题域有内容。/);
  const book = filed[0];
  const notes = await host.call('notes_read', { book: book.card, limit: 3 });
  assert.equal(notes.card, book.card);
  assert.ok(notes.items.length > 0);
  const text = await host.say('kb_check', {});
  assert.match(text, /^检查了 \d+ 张卡片：0 个错误/);
  assert.ok(text.length < 4000, 'a sweep folds repeated reminders');
});
