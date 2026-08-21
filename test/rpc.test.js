import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, ok, err, content, SERVER_INFO } from '../src/rpc.js';

const deps = { list: () => [{ name: 'x' }], call: async (n, a) => content(`${n}:${JSON.stringify(a)}`) };

test('initialize echoes the client protocol version', async () => {
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, deps);
  assert.equal(r.result.protocolVersion, '2024-11-05');
  assert.equal(r.result.serverInfo.name, SERVER_INFO.name);
  assert.deepEqual(r.result.capabilities, { tools: {} });
});

test('initialize still answers when the client names no version', async () => {
  const r = await handle({ id: 1, method: 'initialize' }, deps);
  assert.match(r.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
});

test('notifications are never answered — replying to one is a protocol error', async () => {
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }, deps), null);
});

test('tools/list returns the catalogue', async () => {
  const r = await handle({ id: 2, method: 'tools/list' }, deps);
  assert.deepEqual(r.result.tools, [{ name: 'x' }]);
});

test('tools/call forwards name and arguments', async () => {
  const r = await handle({ id: 3, method: 'tools/call', params: { name: 'f', arguments: { a: 1 } } }, deps);
  assert.match(r.result.content[0].text, /f:\{"a":1\}/);
});

test('missing arguments become an empty object rather than undefined', async () => {
  const r = await handle({ id: 3, method: 'tools/call', params: { name: 'f' } }, deps);
  assert.match(r.result.content[0].text, /f:\{\}/);
});

test('an unknown method is a JSON-RPC error, not a crash', async () => {
  const r = await handle({ id: 4, method: 'resources/list' }, deps);
  assert.equal(r.error.code, -32601);
});

test('ping is answered — clients use it as a liveness check', async () => {
  assert.deepEqual((await handle({ id: 5, method: 'ping' }, deps)).result, {});
});

test('tool content is capped so one huge result cannot blow up the client', () => {
  assert.ok(content('x'.repeat(500_000)).content[0].text.length <= 100_000);
});

test('isError marks a failure the model should read, not a transport fault', () => {
  assert.equal(content('nope', true).isError, true);
  assert.equal(content('fine').isError, undefined);
});
