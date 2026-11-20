import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BEGIN, END, managedPatch, rows } from '../../../scripts/profile-config.js';
import { REPO_ROOT, tempDir } from './helpers.js';

const SCRIPTS = path.join(REPO_ROOT, 'dsh', 'scripts');
const MODELS = `- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      - apiKey: sk-not-a-real-key
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    model: deepseek-chat
`;

test('a fresh profile gets the repository path, the default mode and the copied model rows', () => {
  const { text, copied, selectedDefault } = managedPatch('[]\n', { repoRoot: 'C:\\repos\\dad\'s notes', selectDefault: true, modelSource: MODELS });
  assert.ok(text.startsWith(BEGIN) && text.trimEnd().endsWith(END), 'the empty list is replaced, not appended to');
  assert.deepEqual([...rows(text).keys()], ['weread-kb', 'agent-preset-registry', 'llm-pi-ai', 'agent-default-model']);
  assert.match(text, /- id: weread-kb\n {2}name: '@dadventures\/dsh-weread-kb'\n {2}config:\n {4}repoRoot: 'C:\/repos\/dad''s notes'\n/);
  assert.match(text, /selectedDefault: wereadask/);
  assert.deepEqual(copied, ['llm-pi-ai', 'agent-default-model']);
  assert.equal(selectedDefault, true);
});

test('a rerun replaces the block and keeps what the user and DSH wrote', () => {
  const own = "- id: my-row\n  name: 'x'\n  config:\n    a: 1";
  const first = managedPatch(`${own}\n`, { repoRoot: '/old/repo', selectDefault: true, modelSource: MODELS }).text;
  // DSH appends its own rows at the end of the file, i.e. inside the block.
  const touched = first.replace(END, `- id: ui-settings\n  name: 'ui'\n${END}`);
  const second = managedPatch(touched, { repoRoot: '/new/repo' });
  assert.equal(second.text.split(BEGIN).length, 2, 'one block');
  assert.ok(second.text.startsWith(own));
  assert.ok(second.text.indexOf('- id: ui-settings') < second.text.indexOf(BEGIN), 'the foreign row moved out of the block');
  assert.match(second.text, /repoRoot: '\/new\/repo'/);
  assert.ok(!second.text.includes('/old/repo'));
  // Rows an earlier run wrote stay without repeating the flags.
  assert.match(second.text, /selectedDefault: wereadask/);
  assert.match(second.text, /apiKey: sk-not-a-real-key/);
  assert.deepEqual(second.copied, []);
  assert.equal(managedPatch(second.text, { repoRoot: '/new/repo' }).text, second.text, 'rerunning changes nothing');
});

test('rows the profile already has are not overridden', () => {
  const profile = "- id: agent-preset-registry\n  name: '@deepseek-ai/dsh-agent-preset-registry'\n  config:\n    selectedDefault: kidslab\n- id: llm-pi-ai\n  name: 'mine'\n";
  const { text, copied, selectedDefault } = managedPatch(profile, { repoRoot: '/repo', selectDefault: true, modelSource: MODELS });
  assert.equal(selectedDefault, false);
  assert.deepEqual(copied, ['agent-default-model']);
  assert.ok(!text.includes('wereadask') && !text.includes('sk-not-a-real-key'));
  assert.match(text, /selectedDefault: kidslab/);
});

test('the command writes the file and prints no key', (t) => {
  const profile = tempDir(t);
  const other = tempDir(t);
  writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n');
  writeFileSync(path.join(other, 'cordis.patch.yml'), MODELS);
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'profile-config.js'), profile, REPO_ROOT, '--select-default', '--models-from', other], { encoding: 'utf8' });
  const report = JSON.parse(out);
  assert.equal(report.repoRoot, REPO_ROOT);
  assert.deepEqual(report.copied, ['llm-pi-ai', 'agent-default-model']);
  assert.ok(!out.includes('sk-not-a-real-key'));
  const written = readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8');
  assert.match(written, new RegExp(`repoRoot: '${REPO_ROOT.replaceAll('\\', '/')}'`));
  assert.match(written, /apiKey: sk-not-a-real-key/);
  assert.throws(() => execFileSync(process.execPath, [path.join(SCRIPTS, 'profile-config.js'), profile], { stdio: 'pipe' }), /usage: profile-config\.js/);
});

test('the install scripts: ASCII-only PowerShell, LF shell, and the rows they verify exist', () => {
  const ps1 = readFileSync(path.join(SCRIPTS, 'install-dadventures.ps1'), 'utf8');
  // Windows PowerShell 5 reads a script without a BOM in the system code page; Chinese text would break it.
  assert.ok(!/[^\x00-\x7F]/.test(ps1), 'install-dadventures.ps1 is ASCII only');
  const sh = readFileSync(path.join(SCRIPTS, 'install-dadventures.sh'), 'utf8');
  assert.ok(sh.startsWith('#!/usr/bin/env bash\n') && !sh.includes('\r'), 'install-dadventures.sh has LF line endings');
  const patch = readFileSync(path.join(REPO_ROOT, 'dsh', 'packages', 'dsh-weread-kb', 'cordis.patch.yml'), 'utf8');
  for (const script of [ps1, sh]) {
    for (const row of ['weread-kb', 'preset-wereadask', 'preset-wereadkb']) {
      assert.ok(script.includes(row) && patch.includes(`id: ${row}`), row);
    }
    assert.ok(script.includes('profile-config.js') && script.includes('dsh-weread-kb'));
    assert.ok(!/npm(\.cmd)? install -g[^"\n]*\n/.test(script.replace(/echo .*|throw .*/g, '')), 'does not install DSH by itself');
  }
});
