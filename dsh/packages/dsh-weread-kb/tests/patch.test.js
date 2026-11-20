import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createKbTools } from '../src/tools.js';
import { PACKAGE_DIR, fakeHost, repoFixture } from './helpers.js';

const patch = readFileSync(path.join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
// Tools the DSH presets bring: asked for by the prompts, not registered by this package.
const DSH_TOOLS = ['ask_user_question', 'exit_plan_mode', 'todo_write'];
const TOOL_NAME = /\b((?:kb|notes)_[a-z_]+|ask_user_question|exit_plan_mode|todo_write)\b/g;

/** The text of one preset: from its `id: preset-…` row to the next top-level `- insert:`. */
const preset = (id) => {
  const from = patch.indexOf(`id: preset-${id}`);
  assert.notEqual(from, -1, `preset-${id} is declared`);
  const to = patch.indexOf('\n- insert:', from);
  // The comment above the next row belongs to that row.
  return patch.slice(from, to === -1 ? undefined : to).replace(/(\n#[^\n]*)+$/, '');
};

test('every @dadventures row names an exported entry, and the package is a DSH bundle', () => {
  const rows = [...patch.matchAll(/name: '(@dadventures\/[^']*)'/g)].map((match) => match[1]);
  assert.deepEqual(rows, ['@dadventures/dsh-weread-kb', '@dadventures/dsh-weread-kb/tools', '@dadventures/dsh-weread-kb/tools']);
  for (const row of rows) {
    const subpath = row === manifest.name ? '.' : `.${row.slice(manifest.name.length)}`;
    assert.ok(manifest.exports[subpath], `${row} is exported`);
  }
  assert.equal(manifest.dsh.manifestVersion, 1);
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'no runtime dependencies: DSH installs a plain copy');
});

test('the two modes: 读书问答模式 cannot write, 读书整理模式 can', () => {
  const ask = preset('wereadask');
  const edit = preset('wereadkb');
  assert.match(ask, /id: wereadask\r?\n\s+name: 读书问答模式/);
  assert.match(edit, /id: wereadkb\r?\n\s+name: 读书整理模式/);
  for (const row of ['dsh-tool-fs', 'dsh-tool-pwsh', 'dsh-tool-bash', 'dsh-agent-instructions', 'maintain: true']) {
    assert.ok(!ask.includes(row), `读书问答模式 has no ${row}`);
    assert.ok(edit.includes(row), `读书整理模式 has ${row}`);
  }
  for (const text of [ask, edit]) {
    assert.match(text, /@dadventures\/dsh-weread-kb\/tools/);
    assert.match(text, /dsh-tool-skill/);
    assert.match(text, /dsh-tool-ask-user/);
    // A page of raw notes (12,000 characters) must survive the tool-result pruner whole.
    const [, threshold, head, tail] = text.match(/thresholdChars: (\d+)\s+headChars: (\d+)\s+tailChars: (\d+)/).map(Number);
    assert.ok(threshold > 12_000 && head + tail < threshold);
  }
  assert.match(patch, /- id: weread-kb\r?\n\s+name: '@dadventures\/dsh-weread-kb'\r?\n\s+config:\r?\n\s+repoRoot: ''/, 'the host row carries the repository path');
});

test('prompts and skills only name tools and skills that exist in that mode', (t) => {
  const { repo } = repoFixture(t);
  const ask = fakeHost({ repoRoot: repo });
  createKbTools(ask.ctx, {});
  const edit = fakeHost({ repoRoot: repo });
  createKbTools(edit.ctx, { maintain: true });

  for (const [id, host] of [['wereadask', ask], ['wereadkb', edit]]) {
    const text = preset(id);
    const named = new Set([...text.matchAll(TOOL_NAME)].map((match) => match[1]));
    assert.ok(named.size >= 5, `${id} tells the model which tools to use`);
    for (const tool of named) assert.ok(host.tools.has(tool) || DSH_TOOLS.includes(tool), `${id} names ${tool}`);
    for (const [, skill] of text.matchAll(/skill ([a-z][a-z-]+)/g)) assert.ok(host.skills.has(skill), `${id} names skill ${skill}`);
    for (const skill of host.skills.values()) {
      for (const [, tool] of skill.content.matchAll(TOOL_NAME)) assert.ok(host.tools.has(tool) || DSH_TOOLS.includes(tool), `${id}: skill ${skill.name} names ${tool}`);
      assert.ok(skill.content.length <= 8000, `${skill.name} fits a skill body`);
    }
  }
  // 读书问答模式 has no todo list and no plan mode.
  const askText = preset('wereadask');
  assert.ok(!askText.includes('todo_write') && !askText.includes('exit_plan_mode'));
  assert.deepEqual([...ask.skills.keys()], ['kb-answer']);
  assert.deepEqual([...edit.skills.keys()].sort(), ['kb-answer', 'kb-contribute', 'kb-rules', 'kb-taxonomy', 'kb-workflow', 'weread-organize-book', 'weread-sync']);
});
