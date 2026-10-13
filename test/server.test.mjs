import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { saveMiddleware, allowedRequest } from '../src/server.js';

const token = 'a'.repeat(64);
test('save endpoint rejects cross-origin, missing token, remote, and invalid requests', async t => {
  const calls = [];
  const reads = [];
  const selections = [];
  const middleware = saveMiddleware({ endpoint: '/base/__copyedit__/save', token, sources: { async selection(ids) { selections.push(ids); return { id: 'c'.repeat(32), text: 'synthetic fragment', scopes: [] }; }, async source(id, text, scope) { reads.push({ id, text, scope }); return { text: 'synthetic raw source', scopes: [] }; }, async save(id, text) { calls.push({ id, text }); return { changed: true }; } } });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Copyedit-Token': token };
  const body = JSON.stringify({ id: 'b'.repeat(32), text: 'synthetic fixture' });
  const request = (overrides = {}) => fetch(`${origin}/base/__copyedit__/save`, { method: 'POST', headers, body, ...overrides });
  assert.equal((await request()).status, 200);
  assert.equal(calls.length, 1);
  assert.equal((await request({ headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request({ headers: { ...headers, 'X-Copyedit-Token': '' } })).status, 403);
  assert.equal((await request({ headers: { ...headers, 'Content-Type': 'text/plain' } })).status, 403);
  assert.equal((await request({ body: '{' })).status, 400);
  assert.equal((await request({ body: JSON.stringify({ id: '../../file.md', text: 'fixture' }) })).status, 400);
  assert.equal((await request({ body: 'x'.repeat(70_000) })).status, 413);
  assert.equal((await fetch(`${origin}/base/__copyedit__/save`)).status, 405);
  assert.equal((await fetch(`${origin}/__copyedit__/save`)).status, 404);
  assert.equal((await request({ body: JSON.stringify({ id: 'b'.repeat(32), text: 'draft', operation: 'source', scope: 0 }) })).status, 200);
  assert.equal(reads.length, 1);
  assert.equal((await request({ headers: { ...headers, 'X-Copyedit-Token': '' }, body: JSON.stringify({ id: 'b'.repeat(32), text: 'draft', operation: 'source' }) })).status, 403);
  for (const extra of [{ operation: 'unknown' }, { mode: 'unknown' }, { scope: -1 }, { scope: 0.5 }]) {
    assert.equal((await request({ body: JSON.stringify({ id: 'b'.repeat(32), text: 'draft', ...extra }) })).status, 400);
  }
  assert.equal(reads.length, 1);
  assert.equal(calls.length, 1);
  const selection = JSON.stringify({ operation: 'selection', ids: ['b'.repeat(32), 'c'.repeat(32)] });
  assert.equal((await request({ body: selection })).status, 200);
  assert.equal((await request({ body: selection, headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
  for (const ids of [[], ['invalid'], Array(257).fill('b'.repeat(32)), null]) {
    assert.equal((await request({ body: JSON.stringify({ operation: 'selection', ids }) })).status, 400);
  }
  assert.equal(selections.length, 1);
  assert.equal((await request({ body: JSON.stringify({ operation: 'source', id: 'b'.repeat(32) }) })).status, 200);
  assert.equal(allowedRequest({ headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', 'content-type': 'application/json', 'x-copyedit-token': token }, socket: { remoteAddress: '192.0.2.1' } }, token), false);
});
