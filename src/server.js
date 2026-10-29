import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, saveConfig, historyOf, flushHistory, forgetHistory, newId, DATA_DIR } from './store.js';
import { uptime, averageMs, dailyBars, formatPercent, DAY } from './stats.js';
import { startAll, stopAll, schedule, unschedule, runCheck, VERSION } from './monitor.js';
import { send } from './notify.js';
import { t, languages } from './i18n.js';
import { InputError, monitorInput, notifierInput, incidentInput, settingsInput, messageInput } from './validate.js';
import * as auth from './auth.js';
import * as views from './views.js';

const PORT = Number(process.env.PORT) || 3000;
const MAX_MONITORS = 500;
const MAX_NOTIFIERS = 50;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.disable('x-powered-by');

const trustProxy = process.env.TRUST_PROXY;
app.set(
  'trust proxy',
  trustProxy === undefined ? 'loopback, linklocal, uniquelocal' : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : trustProxy,
);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
});

app.use('/static', express.static(PUBLIC_DIR, { maxAge: '7d' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const lang = () => config.settings.lang;
const find = (list, id) => {
  const item = list.find((x) => x.id === id);
  if (!item) throw new InputError('err.notFound');
  return item;
};

// ---------- public ----------

function publicStatus() {
  const now = Date.now();
  const monitors = config.monitors
    .filter((m) => m.public)
    .map((m) => {
      const h = historyOf(m.id);
      return {
        id: m.id,
        name: m.name,
        status: m.enabled ? h.status : 'paused',
        uptime24: uptime(h, 1),
        uptime30: uptime(h, 30),
        uptime90: uptime(h, 90),
        avgMs: averageMs(h),
        bars: dailyBars(h, 90),
      };
    });
  const byNewest = (a, b) => b.createdAt - a.createdAt;
  const activeIncidents = config.incidents.filter((i) => !i.resolvedAt).sort(byNewest);
  const pastIncidents = config.incidents.filter((i) => i.resolvedAt && i.resolvedAt > now - 14 * DAY).sort(byNewest);

  const live = monitors.filter((m) => m.status !== 'paused');
  const down = live.filter((m) => m.status === 'down').length;
  const impacts = new Set(activeIncidents.map((i) => i.impact));
  let overall = 'operational';
  if (!monitors.length && !activeIncidents.length) overall = 'empty';
  else if ((live.length && down === live.length) || impacts.has('major')) overall = 'outage';
  else if (down || impacts.has('minor')) overall = 'degraded';
  else if (impacts.has('maintenance')) overall = 'maintenance';

  const { title, description, lang, logoUrl } = config.settings;
  return { settings: { title, description, lang, logoUrl }, overall, monitors, activeIncidents, pastIncidents, generatedAt: now };
}

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.send(views.statusPage(publicStatus()));
});

app.get('/api/status', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.json(publicStatus());
});

app.get('/healthz', (req, res) => res.json({ ok: true, version: VERSION }));

function badgeSvg(label, value, color) {
  const width = (s) => Math.round(s.length * 6.4 + 12);
  const lw = width(label);
  const vw = width(value);
  const w = lw + vw;
  const l = views.esc(label);
  const v = views.esc(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${v}"><title>${l}: ${v}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${l}</text><text x="${lw / 2}" y="14">${l}</text><text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${v}</text><text x="${lw + vw / 2}" y="14">${v}</text></g></svg>`;
}

app.get('/badge/:id', (req, res) => {
  const id = req.params.id.replace(/\.svg$/, '');
  const m = config.monitors.find((x) => x.id === id && x.public);
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60, s-maxage=60' });
  const custom = typeof req.query.label === 'string' ? req.query.label.slice(0, 40) : null;
  if (!m) return res.status(404).send(badgeSvg(custom ?? 'status', 'unknown', '#9f9f9f'));
  const h = historyOf(m.id);
  if (req.query.type === 'uptime') {
    const periods = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
    const period = req.query.period in periods ? req.query.period : '30d';
    const value = uptime(h, periods[period]);
    const color = value === null ? '#9f9f9f' : value >= 99.9 ? '#2ea44f' : value >= 99 ? '#97ca00' : value >= 95 ? '#dfb317' : '#e05d44';
    return res.send(badgeSvg(custom ?? `uptime ${period}`, formatPercent(value), color));
  }
  const status = m.enabled ? h.status : 'paused';
  const colors = { up: '#2ea44f', down: '#e05d44', pending: '#9f9f9f', paused: '#9f9f9f' };
  return res.send(badgeSvg(custom ?? m.name, status, colors[status]));
});

// ---------- auth pages ----------

app.get('/setup', (req, res) => {
  if (!auth.needsSetup()) return res.redirect('/admin');
  res.send(views.setupPage(config.settings));
});

app.post('/setup', (req, res) => {
  if (!auth.needsSetup()) return res.redirect('/admin');
  const { password = '', confirm = '' } = req.body;
  if (req.body.lang in languages) config.settings.lang = req.body.lang;
  if (password.length < 8) return res.status(400).send(views.setupPage(config.settings, t(lang(), 'setup.tooShort')));
  if (password !== confirm) return res.status(400).send(views.setupPage(config.settings, t(lang(), 'setup.mismatch')));
  config.settings.passwordHash = auth.hashPassword(password);
  saveConfig();
  auth.startSession(req, res);
  res.redirect('/admin');
});

app.get('/login', (req, res) => {
  if (auth.needsSetup()) return res.redirect('/setup');
  if (auth.isAuthenticated(req)) return res.redirect('/admin');
  res.send(views.loginPage(config.settings));
});

app.post('/login', (req, res) => {
  if (auth.needsSetup()) return res.redirect('/setup');
  if (auth.isLocked(req.ip)) return res.status(429).send(views.loginPage(config.settings, t(lang(), 'login.tooMany')));
  if (!auth.checkPassword(req.body.password)) {
    auth.recordFailure(req.ip);
    return res.status(401).send(views.loginPage(config.settings, t(lang(), 'login.wrong')));
  }
  auth.clearFailures(req.ip);
  auth.startSession(req, res);
  res.redirect('/admin');
});

app.post('/logout', (req, res) => {
  auth.endSession(res);
  res.redirect('/login');
});

app.get('/admin', (req, res) => {
  if (auth.needsSetup()) return res.redirect('/setup');
  if (!auth.isAuthenticated(req)) return res.redirect('/login');
  res.set('Cache-Control', 'no-store');
  res.send(views.adminPage(config.settings));
});

// ---------- admin API ----------

const api = express.Router();

api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!auth.isAuthenticated(req)) return res.status(401).json({ error: 'unauthorized' });
  // A custom header cannot be sent cross-site without a CORS preflight, which we never allow.
  if (req.method !== 'GET' && req.get('x-vigie') !== '1') return res.status(403).json({ error: 'forbidden' });
  next();
});

function monitorState(m) {
  const h = historyOf(m.id);
  return {
    ...m,
    status: m.enabled ? h.status : 'paused',
    since: h.since,
    lastCheck: h.lastCheck,
    lastMs: h.lastMs,
    lastError: h.lastError,
    uptime24: uptime(h, 1),
    uptime30: uptime(h, 30),
    avgMs: averageMs(h),
    cert: h.cert ? { validTo: h.cert.validTo ?? null, error: h.cert.error ?? null } : null,
    spark: h.beats.slice(-40).map(([, ok, ms]) => (ok ? ms : null)),
  };
}

function adminSettings() {
  const { title, description, lang, logoUrl } = config.settings;
  return { title, description, lang, logoUrl, passwordFromEnv: auth.passwordFromEnv() };
}

api.get('/state', (req, res) => {
  res.json({
    version: VERSION,
    settings: adminSettings(),
    monitors: config.monitors.map(monitorState),
    notifiers: config.notifiers,
    incidents: [...config.incidents].sort((a, b) => b.createdAt - a.createdAt),
  });
});

// Creating or editing a monitor answers once its first check is done,
// so the dashboard shows a real status right away.
api.post('/monitors', async (req, res) => {
  if (config.monitors.length >= MAX_MONITORS) throw new InputError('err.limit');
  const m = { id: newId(), ...monitorInput(req.body), createdAt: Date.now() };
  config.monitors.push(m);
  saveConfig();
  schedule(m);
  if (m.enabled) await runCheck(m);
  res.status(201).json(monitorState(m));
});

api.put('/monitors/:id', async (req, res) => {
  const old = find(config.monitors, req.params.id);
  const m = { id: old.id, createdAt: old.createdAt, ...monitorInput(req.body) };
  const target = (x) => `${x.type}|${x.url ?? ''}|${x.host ?? ''}|${x.port ?? ''}`;
  if (target(old) !== target(m)) forgetHistory(m.id);
  config.monitors[config.monitors.indexOf(old)] = m;
  saveConfig();
  schedule(m);
  if (m.enabled) await runCheck(m);
  res.json(monitorState(m));
});

api.patch('/monitors/:id', (req, res) => {
  const m = find(config.monitors, req.params.id);
  m.enabled = Boolean(req.body.enabled);
  saveConfig();
  schedule(m);
  res.json(monitorState(m));
});

api.delete('/monitors/:id', (req, res) => {
  const m = find(config.monitors, req.params.id);
  unschedule(m.id);
  config.monitors.splice(config.monitors.indexOf(m), 1);
  forgetHistory(m.id);
  saveConfig();
  res.status(204).end();
});

api.post('/monitors/:id/check', async (req, res) => {
  const m = find(config.monitors, req.params.id);
  await runCheck(m);
  res.json(monitorState(m));
});

api.post('/notifiers', (req, res) => {
  if (config.notifiers.length >= MAX_NOTIFIERS) throw new InputError('err.limit');
  const n = { id: newId(), ...notifierInput(req.body) };
  config.notifiers.push(n);
  saveConfig();
  res.status(201).json(n);
});

api.put('/notifiers/:id', (req, res) => {
  const old = find(config.notifiers, req.params.id);
  const n = { id: old.id, ...notifierInput(req.body) };
  config.notifiers[config.notifiers.indexOf(old)] = n;
  saveConfig();
  res.json(n);
});

api.delete('/notifiers/:id', (req, res) => {
  const n = find(config.notifiers, req.params.id);
  config.notifiers.splice(config.notifiers.indexOf(n), 1);
  saveConfig();
  res.status(204).end();
});

api.post('/notifiers/:id/test', async (req, res) => {
  const n = find(config.notifiers, req.params.id);
  try {
    await send(n, { kind: 'test' });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  res.json({ ok: true });
});

api.post('/incidents', (req, res) => {
  const { title, impact, message } = incidentInput(req.body);
  const now = Date.now();
  const incident = { id: newId(), title, impact, createdAt: now, resolvedAt: null, updates: [{ at: now, message: message || title }] };
  config.incidents.push(incident);
  saveConfig();
  res.status(201).json(incident);
});

api.post('/incidents/:id/updates', (req, res) => {
  const incident = find(config.incidents, req.params.id);
  const now = Date.now();
  const resolve = Boolean(req.body.resolve);
  const message = messageInput(req.body) || (resolve ? t(lang(), 'inc.resolvedMessage') : '');
  if (!message) throw new InputError('err.title');
  incident.updates.push({ at: now, message });
  if (resolve) incident.resolvedAt = now;
  saveConfig();
  res.json(incident);
});

api.delete('/incidents/:id', (req, res) => {
  const incident = find(config.incidents, req.params.id);
  config.incidents.splice(config.incidents.indexOf(incident), 1);
  saveConfig();
  res.status(204).end();
});

api.put('/settings', (req, res) => {
  Object.assign(config.settings, settingsInput(req.body));
  saveConfig();
  res.json(adminSettings());
});

api.put('/password', (req, res) => {
  if (auth.passwordFromEnv()) throw new InputError('set.envPassword');
  if (!auth.checkPassword(req.body.current)) throw new InputError('err.password');
  const next = typeof req.body.next === 'string' ? req.body.next : '';
  if (next.length < 8) throw new InputError('setup.tooShort');
  config.settings.passwordHash = auth.hashPassword(next);
  saveConfig();
  auth.startSession(req, res);
  res.json({ ok: true });
});

api.get('/export', (req, res) => {
  const { passwordHash, sessionSecret, ...settings } = config.settings;
  const date = new Date().toISOString().slice(0, 10);
  res.attachment(`vigie-backup-${date}.json`);
  res.json({ version: VERSION, exportedAt: new Date().toISOString(), settings, monitors: config.monitors, notifiers: config.notifiers, incidents: config.incidents });
});

app.use('/api/admin', api);

app.use((req, res) => res.status(404).type('text').send('Not found'));

app.use((err, req, res, next) => {
  if (err instanceof InputError) return res.status(400).json({ error: t(lang(), err.message) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(`[vigie] ${req.method} ${req.path}: ${err.stack || err}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: t(lang(), 'error') });
});

const server = app.listen(PORT, () => {
  console.log(`[vigie] ${VERSION} listening on http://localhost:${PORT} (data in ${DATA_DIR})`);
  if (auth.needsSetup()) console.log(`[vigie] open http://localhost:${PORT}/setup to choose the admin password`);
  startAll();
});

function shutdown(signal) {
  console.log(`[vigie] ${signal} received, saving and exiting`);
  stopAll();
  flushHistory();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
