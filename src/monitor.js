import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { config, historyOf, touchHistory } from './store.js';
import { DAY, dayKey } from './stats.js';
import { notifyAll } from './notify.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;
const USER_AGENT = `Vigie/${VERSION} (+https://github.com/CedricPoint/vigie)`;

const KEEP_DAYS = 120;
const CERT_REFRESH = 12 * 3600_000;
const CERT_WARN_DAYS = 14;
const RETRY_DELAY = 20;

// monitor id -> { gen, handle }. The generation lets a rescheduled monitor
// stop the loop that was running before the edit.
const timers = new Map();
const running = new Map();
let generation = 0;

export function startAll() {
  config.monitors.forEach((m, i) => schedule(m, Math.min(i * 500, 15_000)));
}

export function stopAll() {
  for (const id of [...timers.keys()]) unschedule(id);
}

export function unschedule(id) {
  clearTimeout(timers.get(id)?.handle);
  timers.delete(id);
}

export function schedule(monitor, delay = 0) {
  unschedule(monitor.id);
  if (!monitor.enabled) return;
  const id = monitor.id;
  const gen = ++generation;
  const loop = async () => {
    const m = config.monitors.find((x) => x.id === id);
    if (!m || !m.enabled || timers.get(id)?.gen !== gen) return;
    await runCheck(m);
    const timer = timers.get(id);
    if (timer?.gen !== gen) return;
    const h = historyOf(id);
    // A failing service that is not yet marked down is checked again sooner.
    const next = h.fails > 0 && h.status !== 'down' ? Math.min(m.interval, RETRY_DELAY) : m.interval;
    timer.handle = setTimeout(loop, next * 1000);
  };
  timers.set(id, { gen, handle: setTimeout(loop, delay) });
}

// A check already in flight for the same monitor is shared, not started twice.
// Keyed by object: an edited monitor is a new object and gets a fresh check.
export function runCheck(m) {
  if (!running.has(m)) running.set(m, check(m));
  return running.get(m);
}

async function check(m) {
  try {
    const result = m.type === 'tcp' ? await checkTcp(m) : await checkHttp(m);
    // Edited or deleted while the check was running: the result is stale.
    if (!config.monitors.includes(m)) return;
    record(m, result);
    if (m.type !== 'tcp' && m.url.startsWith('https:')) await refreshCertificate(m);
  } catch (err) {
    console.error(`[vigie] check of "${m.name}" crashed: ${err.stack || err}`);
  } finally {
    running.delete(m);
  }
}

export function statusMatches(code, spec) {
  return (spec || '200-399').split(',').some((part) => {
    const [from, to] = part.trim().split('-').map(Number);
    return to ? code >= from && code <= to : code === from;
  });
}

function describeError(err, timeout) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return `Timeout (${timeout}s)`;
  const cause = err.cause ?? err;
  const known = {
    ENOTFOUND: 'DNS lookup failed',
    EAI_AGAIN: 'DNS lookup failed',
    ECONNREFUSED: 'Connection refused',
    ECONNRESET: 'Connection reset',
    EHOSTUNREACH: 'Host unreachable',
    ENETUNREACH: 'Network unreachable',
    ETIMEDOUT: `Timeout (${timeout}s)`,
    CERT_HAS_EXPIRED: 'SSL certificate expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed SSL certificate',
    SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed SSL certificate',
    ERR_TLS_CERT_ALTNAME_INVALID: 'SSL certificate does not match the host name',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Incomplete SSL certificate chain',
  };
  return known[cause.code] ?? cause.message ?? String(err);
}

async function checkHttp(m) {
  const start = performance.now();
  try {
    const res = await fetch(m.url, {
      method: m.method || 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(m.timeout * 1000),
    });
    const ms = Math.round(performance.now() - start);
    const body = m.keyword ? await res.text() : (await res.body?.cancel(), '');
    if (!statusMatches(res.status, m.expectedStatus)) return { ok: false, ms, error: `HTTP ${res.status}` };
    if (m.keyword && !body.includes(m.keyword)) return { ok: false, ms, error: `Text "${m.keyword}" not found` };
    return { ok: true, ms };
  } catch (err) {
    return { ok: false, ms: null, error: describeError(err, m.timeout) };
  }
}

function checkTcp(m) {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = net.connect({ host: m.host, port: m.port });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(m.timeout * 1000, () => done({ ok: false, ms: null, error: `Timeout (${m.timeout}s)` }));
    socket.once('connect', () => done({ ok: true, ms: Math.round(performance.now() - start) }));
    socket.once('error', (err) => done({ ok: false, ms: null, error: describeError(err, m.timeout) }));
  });
}

function record(m, { ok, ms, error }) {
  const now = Date.now();
  const h = historyOf(m.id);
  h.lastCheck = now;
  h.lastMs = ms;
  h.lastError = ok ? null : error;

  h.beats.push([now, ok ? 1 : 0, ms ?? 0]);
  const cutoff = now - DAY;
  let old = 0;
  while (old < h.beats.length && h.beats[old][0] < cutoff) old++;
  if (old) h.beats.splice(0, old);

  const key = dayKey(now);
  if (!h.days[key]) {
    h.days[key] = [0, 0];
    const oldest = dayKey(now - KEEP_DAYS * DAY);
    for (const day of Object.keys(h.days)) if (day < oldest) delete h.days[day];
  }
  h.days[key][1]++;
  if (ok) h.days[key][0]++;

  if (ok) {
    h.fails = 0;
    if (h.status !== 'up') {
      const wasDown = h.status === 'down';
      const downSince = h.since;
      h.status = 'up';
      h.since = now;
      if (wasDown) notifyAll({ kind: 'up', monitor: m, duration: now - downSince });
    }
  } else {
    h.fails++;
    if (h.status !== 'down' && h.fails > m.retries) {
      h.status = 'down';
      h.since = now;
      notifyAll({ kind: 'down', monitor: m, error });
    }
  }
  touchHistory();
}

function readCertificateExpiry(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (cert?.valid_to) resolve(Date.parse(cert.valid_to));
        else reject(new Error('No certificate'));
      },
    );
    socket.setTimeout(timeout * 1000, () => {
      socket.destroy();
      reject(new Error('Timeout'));
    });
    socket.once('error', reject);
  });
}

async function refreshCertificate(m) {
  const h = historyOf(m.id);
  const { hostname, port } = new URL(m.url);
  if (h.cert?.host === hostname && Date.now() - h.cert.checkedAt < CERT_REFRESH) return;
  const previous = h.cert?.host === hostname ? h.cert : null;
  try {
    const validTo = await readCertificateExpiry(hostname, Number(port) || 443, m.timeout);
    h.cert = { host: hostname, validTo, checkedAt: Date.now(), warnedFor: previous?.warnedFor ?? null };
    const daysLeft = Math.floor((validTo - Date.now()) / DAY);
    if (daysLeft <= CERT_WARN_DAYS && h.cert.warnedFor !== validTo) {
      h.cert.warnedFor = validTo;
      notifyAll({ kind: 'cert', monitor: m, daysLeft });
    }
  } catch (err) {
    h.cert = { host: hostname, error: err.message, checkedAt: Date.now(), warnedFor: previous?.warnedFor ?? null };
  }
  touchHistory();
}
