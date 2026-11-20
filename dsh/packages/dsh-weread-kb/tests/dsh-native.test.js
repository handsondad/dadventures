import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { repoFixture, sessionExec } from './helpers.js';

// Loads the host row and the tools row into the installed DSH's own cordis runtime and runs every tool schema
// through its `assertSupportedJsonSchema`, the check `tools.register` applies. Set DADVENTURES_DSH_PACKAGE to the
// absolute path of the installed @deepseek-ai/dsh package. Without it this test is skipped, not passed.
const DSH = process.env.DADVENTURES_DSH_PACKAGE;
const dep = (name, entry) => pathToFileURL(path.join(DSH, 'node_modules', '@deepseek-ai', name, ...entry)).href;

test('the installed DSH mounts the rows and accepts every tool schema', { skip: !DSH && 'set DADVENTURES_DSH_PACKAGE to the installed @deepseek-ai/dsh path' }, async (t) => {
  const { Context } = await import(dep('cordis', ['lib', 'index.js']));
  const { assertSupportedJsonSchema } = await import(dep('dsh-tools', ['lib', 'index.js']));
  const settings = await import('../src/settings.js');
  const tools = await import('../src/tools.js');
  const { repo } = repoFixture(t);

  const mount = async (config) => {
    const registered = new Map();
    const skills = new Map();
    const root = new Context();
    await root.plugin((ctx) => ctx.provide('tools', { register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name); } }));
    await root.plugin((ctx) => ctx.provide('skills', { register(skill) { skills.set(skill.name, skill); return () => skills.delete(skill.name); } }));
    t.after(async () => { await root.fiber.dispose(); });
    await root.plugin((ctx) => settings.apply(ctx, { repoRoot: repo }));
    const row = (ctx) => tools.apply(ctx, config);
    row.inject = tools.inject;
    await root.plugin(row);
    return { registered, skills };
  };

  const ask = await mount({});
  assert.deepEqual([...ask.registered.keys()].sort(), ['kb_links', 'kb_overview', 'kb_read', 'kb_search', 'notes_books', 'notes_read', 'notes_search']);
  assert.deepEqual([...ask.skills.keys()], ['kb-answer']);

  const { registered, skills } = await mount({ maintain: true });
  assert.deepEqual([...registered.keys()].sort(), ['kb_check', 'kb_links', 'kb_overview', 'kb_read', 'kb_schema', 'kb_search', 'notes_books', 'notes_read', 'notes_search']);
  for (const name of ['kb-answer', 'weread-organize-book', 'kb-contribute', 'weread-sync', 'kb-rules', 'kb-workflow', 'kb-taxonomy']) assert.ok(skills.has(name), name);
  for (const [name, tool] of registered) {
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.parameters), `${name} parameters`);
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.output.schema), `${name} output`);
    assert.ok(tool.description.length > 40, `${name} explains itself`);
  }

  // The tools row has no repoRoot of its own: it reads the host row's wereadKb service.
  const search = await registered.get('kb_search').execute({ q: '安全感', intent: 'concept' }, {});
  assert.equal(search.items[0].ref, 'parenting/concept-0001');
  const notes = await registered.get('notes_read').execute({ book: '把整颗心献给孩子' }, {});
  assert.equal(notes.stage, 'pending');
  const schema = await registered.get('kb_schema').execute({ doc_type: 'concept_card', subject: 'parenting', slug: 'x' }, sessionExec(repo));
  assert.equal(schema.write_path, 'kb/concepts/parenting/concept-parenting-0002-x.md');
});
