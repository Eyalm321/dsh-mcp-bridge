import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, BY_NAME, declare, validate } from '../src/tools.js';

test('every tool declares a name, description and object schema', () => {
  for (const t of TOOLS) {
    assert.match(t.name, /^dsh_[a-z_]+$/, `${t.name} should be namespaced`);
    assert.ok(t.description.length > 20, `${t.name} needs a usable description`);
    assert.equal(t.schema.type, 'object');
  }
});

test('tool names are unique — a duplicate would silently shadow', () => {
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
});

test('the MCP declaration exposes inputSchema, not our internal shape', () => {
  const d = declare(BY_NAME.get('dsh_memory_search'));
  assert.deepEqual(Object.keys(d).sort(), ['description', 'inputSchema', 'name']);
  assert.equal(d.inputSchema.required[0], 'query');
});

test('required arguments are enforced before anything is spawned', () => {
  const t = BY_NAME.get('dsh_tasks_add');
  assert.match(validate(t, {}), /missing required argument/);
  assert.match(validate(t, { project: 'canora' }), /title/);
  assert.equal(validate(t, { project: 'canora', title: 'x' }), null);
});

test('whitespace-only arguments count as missing', () => {
  assert.match(validate(BY_NAME.get('dsh_memory_write'), { text: '   ' }), /text/);
});

test('optional arguments only appear in argv when supplied', () => {
  const t = BY_NAME.get('dsh_memory_write');
  assert.ok(!t.argv({ text: 'a' }).includes('--tags'));
  assert.ok(t.argv({ text: 'a', tags: 'x' }).includes('--tags'));
  assert.ok(t.argv({ text: 'a', pin: true }).includes('--pin'));
});

test('arguments are passed as argv elements, never interpolated into a shell string', () => {
  // A title containing shell metacharacters must arrive as one argument.
  const argv = BY_NAME.get('dsh_tasks_add').argv({ project: 'canora', title: 'x; rm -rf /' });
  assert.ok(argv.includes('x; rm -rf /'), 'the value stays a single argv element');
  assert.ok(!argv.some((a) => a.includes('&&') || a.includes('|')), 'no shell composition');
});

test('dispatch is marked background — it must not block the caller', () => {
  assert.equal(BY_NAME.get('dsh_dispatch').background, true);
  assert.equal(BY_NAME.get('dsh_memory_search').background, undefined);
});

test('mcp_call defaults params to an empty object rather than omitting the flag', () => {
  const argv = BY_NAME.get('dsh_mcp_call').argv({ server: 'github', tool: 'x' });
  assert.deepEqual(argv.slice(-2), ['--params', '{}']);
});

test('the catalogue covers memory, ledger, dispatch and the MCP estate', () => {
  const names = TOOLS.map((t) => t.name).join(' ');
  for (const probe of ['memory_search', 'memory_write', 'tasks_list', 'tasks_add', 'dispatch', 'job_status', 'mcp_call', 'notify']) {
    assert.match(names, new RegExp(probe));
  }
});
