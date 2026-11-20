#!/usr/bin/env node
// Writes the dadventures repository path (row weread-kb) into a DSH profile's own patch layer (cordis.patch.yml),
// inside one marked block that a rerun replaces. Everything outside the block is left as it is.
//
//   node profile-config.js <profileDir> <repoRoot> [--select-default] [--models-from <profileDir>]
//
// --select-default makes 读书问答模式 the preselected mode for new sessions (only when the profile has no
//   agent-preset-registry row of its own).
// --models-from copies the model provider rows (llm-pi-ai, agent-default-model) from another profile when this one
//   has none. Those rows hold that profile's API key; they are copied as they are and never printed.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BEGIN = '# >>> dadventures (managed by dsh/scripts/install-dadventures; rerun the script instead of editing)';
export const END = '# <<< dadventures';
const MODEL_ROWS = ['llm-pi-ai', 'agent-default-model'];
const OWN_ROWS = ['weread-kb', 'agent-preset-registry', ...MODEL_ROWS];

const quote = (value) => `'${String(value).replaceAll('\\', '/').replaceAll("'", "''")}'`;
const clean = (source) => String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/** Top-level `- id: <id>` rows of a patch file, each up to the next unindented line. */
export function rows(source) {
  const found = new Map();
  const lines = clean(source).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^- id:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (!match) continue;
    let end = index + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    while (end > index + 1 && lines[end - 1] === '') end--;
    found.set(match[1], lines.slice(index, end).join('\n'));
  }
  return found;
}

/**
 * The profile patch with the managed block rewritten.
 * original: the profile's cordis.patch.yml; modelSource: the patch of the profile to copy model rows from.
 */
export function managedPatch(original, { repoRoot, selectDefault = false, modelSource = '' }) {
  const text = clean(original);
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  const managed = begin !== -1 && end > begin;
  const previous = rows(managed ? text.slice(begin + BEGIN.length, end) : '');
  let outside = managed ? text.slice(0, begin) + text.slice(end + END.length) : text;
  // A fresh profile's patch is the empty list `[]`; rows cannot be appended to it.
  outside = outside.split('\n').filter((line) => line.trim() !== '[]').join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  // DSH appends its own rows (e.g. UI settings) to the end of the file, which can land inside the block.
  const foreign = [...previous].filter(([id]) => !OWN_ROWS.includes(id)).map(([, row]) => row);
  if (foreign.length) outside = [outside, ...foreign].filter(Boolean).join('\n');
  const existing = rows(outside);

  const block = [BEGIN, '- id: weread-kb', "  name: '@dadventures/dsh-weread-kb'", '  config:', `    repoRoot: ${quote(repoRoot)}`];
  // Rows an earlier run wrote into the block are kept, so a rerun without the flags does not drop them.
  let selected = false;
  if (!existing.has('agent-preset-registry')) {
    if (selectDefault) {
      block.push('- id: agent-preset-registry', "  name: '@deepseek-ai/dsh-agent-preset-registry'", '  config:', '    default: standard', '    selectedDefault: wereadask');
      selected = true;
    } else if (previous.has('agent-preset-registry')) {
      block.push(previous.get('agent-preset-registry'));
    }
  }
  const copied = [];
  const source = rows(modelSource);
  for (const id of MODEL_ROWS) {
    if (existing.has(id)) continue;
    if (source.has(id)) { block.push(source.get(id)); copied.push(id); } else if (previous.has(id)) block.push(previous.get(id));
  }
  block.push(END);
  return { text: `${outside ? `${outside}\n\n` : ''}${block.join('\n')}\n`, copied, selectedDefault: selected };
}

function main(argv) {
  const args = [...argv];
  const value = (name) => { const at = args.indexOf(name); if (at === -1) return null; const [, found] = args.splice(at, 2); return found ?? ''; };
  const selectDefault = args.includes('--select-default');
  if (selectDefault) args.splice(args.indexOf('--select-default'), 1);
  const modelsFrom = value('--models-from');
  const [profileDir, repoRoot] = args;
  if (!profileDir || !repoRoot) {
    console.error('usage: profile-config.js <profileDir> <repoRoot> [--select-default] [--models-from <profileDir>]');
    return 2;
  }
  const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
  const file = path.join(profileDir, 'cordis.patch.yml');
  if (modelsFrom && !existsSync(path.join(modelsFrom, 'cordis.patch.yml'))) {
    console.error(`--models-from: no cordis.patch.yml in ${modelsFrom}`);
    return 2;
  }
  const result = managedPatch(read(file), { repoRoot: path.resolve(repoRoot), selectDefault, modelSource: modelsFrom ? read(path.join(modelsFrom, 'cordis.patch.yml')) : '' });
  writeFileSync(file, result.text, 'utf8');
  console.log(JSON.stringify({ file, repoRoot: path.resolve(repoRoot), copied: result.copied, selectedDefault: result.selectedDefault }));
  return 0;
}

const invoked = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = main(process.argv.slice(2));
