// End-to-end test: starts the real server on a free port with a temporary data
// directory and a local target, then drives it through HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-test-'));
let server;
let target;
let targetPort;
let cookie = '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, url, body) {
  const res = await fetch(`${BASE}/api/admin${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-vigie': '1', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

before(async () => {
  target = http.createServer((req, res) => res.end('hello vigie'));
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetPort = target.address().port;

  server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: '' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  target?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('first visit asks for a password', async () => {
  const res = await fetch(`${BASE}/admin`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/setup');
});

test('setup creates the password and signs in', async () => {
  const res = await fetch(`${BASE}/setup`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ password: 'correct horse', confirm: 'correct horse', lang: 'fr' }),
  });
  assert.equal(res.status, 302);
  cookie = res.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^vigie_session=/);
  const again = await fetch(`${BASE}/setup`, { redirect: 'manual' });
  assert.equal(again.headers.get('location'), '/admin');
});

test('admin API refuses anonymous and cross-site requests', async () => {
  const anonymous = await fetch(`${BASE}/api/admin/state`);
  assert.equal(anonymous.status, 401);
  const noHeader = await fetch(`${BASE}/api/admin/monitors`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
});

test('wrong password is rejected', async () => {
  const res = await fetch(`${BASE}/login`, { method: 'POST', body: new URLSearchParams({ password: 'nope' }) });
  assert.equal(res.status, 401);
});

test('validation errors come back translated', async () => {
  const res = await api('POST', '/monitors', { name: 'x', type: 'http', url: 'ftp://nope' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /URL complète/);
});

test('HTTP and TCP monitors are checked and shown publicly', async () => {
  const web = await api('POST', '/monitors', { name: 'Local web', type: 'http', url: `http://127.0.0.1:${targetPort}/`, keyword: 'vigie', interval: 60, timeout: 5 });
  assert.equal(web.status, 201);
  const tcp = await api('POST', '/monitors', { name: 'Closed port', type: 'tcp', host: '127.0.0.1', port: 1, interval: 60, timeout: 2, retries: 0 });
  assert.equal(tcp.status, 201);

  const checkedWeb = await api('POST', `/monitors/${web.body.id}/check`);
  assert.equal(checkedWeb.body.status, 'up');
  const checkedTcp = await api('POST', `/monitors/${tcp.body.id}/check`);
  assert.equal(checkedTcp.body.status, 'down');

  const status = await (await fetch(`${BASE}/api/status`)).json();
  assert.equal(status.overall, 'degraded');
  assert.equal(status.monitors.length, 2);
  assert.equal(status.monitors[0].bars.length, 90);

  const page = await (await fetch(BASE)).text();
  assert.match(page, /Local web/);
  assert.match(page, /Certains services rencontrent des problèmes/);

  const badge = await fetch(`${BASE}/badge/${web.body.id}.svg`);
  assert.equal(badge.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.match(await badge.text(), />up</);
});

test('missing keyword marks the check as failed', async () => {
  const m = await api('POST', '/monitors', { name: 'Keyword', type: 'http', url: `http://127.0.0.1:${targetPort}/`, keyword: 'absent', retries: 0 });
  const checked = await api('POST', `/monitors/${m.body.id}/check`);
  assert.equal(checked.body.status, 'down');
  assert.match(checked.body.lastError, /absent/);
  await api('DELETE', `/monitors/${m.body.id}`);
});

test('incidents appear on the status page until resolved', async () => {
  const created = await api('POST', '/incidents', { title: 'Database slow', impact: 'major', message: 'Investigating' });
  assert.equal(created.status, 201);
  let status = await (await fetch(`${BASE}/api/status`)).json();
  assert.equal(status.overall, 'outage');
  await api('POST', `/incidents/${created.body.id}/updates`, { resolve: true });
  status = await (await fetch(`${BASE}/api/status`)).json();
  assert.equal(status.activeIncidents.length, 0);
  assert.equal(status.pastIncidents.length, 1);
});

test('changing the password signs other sessions out', async () => {
  const res = await api('PUT', '/password', { current: 'correct horse', next: 'battery staple' });
  assert.equal(res.status, 200);
  const old = await fetch(`${BASE}/api/admin/state`, { headers: { cookie } });
  assert.equal(old.status, 401);
});

test('configuration is saved to disk', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'vigie.json'), 'utf8'));
  assert.equal(saved.monitors.length, 2);
  assert.equal(saved.settings.lang, 'fr');
  assert.match(saved.settings.passwordHash, /^scrypt:/);
});
