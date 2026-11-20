#!/usr/bin/env node
// The plugin's tools from a terminal, without DSH: the same code and the same output the agent sees.
//
//   node dsh/packages/dsh-weread-kb/bin/weread-kb.js <tool> [value] [--name value ...] [--json] [--repo <dir>]
//
//   weread-kb kb_check                          validate the whole knowledge base (exit 1 on errors)
//   weread-kb kb_search 安全感 --intent concept
//   weread-kb notes_books --stage pending
//   weread-kb notes_read 父母挑战 --from 41
//
// <tool> may drop its prefix (check, search, books). [value] fills the tool's main parameter. Arrays repeat the
// flag or take comma-separated values. The repository is --repo, then DADVENTURES_ROOT, then the one this file is in.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKbTools } from '../src/tools.js';

const argv = process.argv.slice(2);
const usage = (message) => {
  if (message) console.error(message);
  console.error('用法：weread-kb <tool> [value] [--name value ...] [--json] [--repo <dir>]；weread-kb --list 列出工具。');
  process.exit(2);
};

const options = {};
const positional = [];
for (let at = 0; at < argv.length; at++) {
  const arg = argv[at];
  if (!arg.startsWith('--')) { positional.push(arg); continue; }
  const [name, inline] = arg.slice(2).split(/=(.*)/s);
  const next = argv[at + 1];
  const value = inline !== undefined ? inline : (next !== undefined && !next.startsWith('--') ? argv[++at] : true);
  (options[name] ??= []).push(value);
}
const take = (name) => { const value = options[name]; delete options[name]; return value; };
const json = Boolean(take('json'));
const list = Boolean(take('list'));
const repo = take('repo')?.[0];
const repoRoot = path.resolve(typeof repo === 'string' ? repo : process.env.DADVENTURES_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'));

const tools = new Map();
createKbTools({ tools: { register(tool) { tools.set(tool.name, tool); } } }, { repoRoot, maintain: true, skills: false });

if (list || !positional.length) {
  for (const tool of tools.values()) {
    const { properties, required = [] } = tool.parameters;
    console.log(`${tool.name}  ${Object.keys(properties).map((key) => (required.includes(key) ? `<${key}>` : `[--${key}]`)).join(' ')}`);
  }
  process.exit(list ? 0 : 2);
}

const wanted = positional.shift().replaceAll('-', '_');
const tool = tools.get(wanted) ?? tools.get(`kb_${wanted}`) ?? tools.get(`notes_${wanted}`);
if (!tool) usage(`没有工具 ${wanted}。可用：${[...tools.keys()].join('、')}。`);

const { properties, required = [] } = tool.parameters;
const main = required[0] ?? ['paths', 'q', 'doc_type', 'subject'].find((key) => key in properties);
if (positional.length) {
  if (!main) usage(`${tool.name} 不接受位置参数。`);
  (options[main] ??= []).unshift(...(properties[main].type === 'array' ? positional : [positional.join(' ')]));
}
const args = {};
for (const [name, values] of Object.entries(options)) {
  const spec = properties[name];
  if (!spec) usage(`${tool.name} 没有参数 --${name}。可用：${Object.keys(properties).map((key) => `--${key}`).join(' ')}`);
  const last = values.at(-1);
  if (spec.type === 'array') args[name] = values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
  else if (spec.type === 'boolean') args[name] = last === true || last === 'true';
  else if (spec.type === 'integer') args[name] = Number(last);
  else args[name] = last === true ? '' : String(last);
}

try {
  const value = await tool.execute(args, { agent: { session: { header: { cwd: process.cwd() } } } });
  console.log(json ? JSON.stringify(value, null, 2) : tool.output.render(args, value).map((part) => part.text).join(''));
  process.exit(value?.ok === false ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(error.code === 'NOT_CONFIGURED' ? 2 : 1);
}
