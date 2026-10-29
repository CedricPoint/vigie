// Persistence: two JSON files in DATA_DIR.
// vigie.json holds the configuration (rarely written, saved immediately),
// history.json holds check results (written often, flushed every few seconds).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'vigie.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function load(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Never silently overwrite a file we could not read: keep a copy first.
    const copy = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, copy);
    console.error(`[vigie] ${path.basename(file)} is not valid JSON, a copy was kept in ${copy}`);
    return fallback;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export const newId = () => crypto.randomBytes(6).toString('base64url');

function defaults() {
  return {
    settings: {
      title: 'Service status',
      description: '',
      lang: process.env.VIGIE_LANG === 'fr' ? 'fr' : 'en',
      logoUrl: '',
      passwordHash: null,
      sessionSecret: crypto.randomBytes(32).toString('hex'),
    },
    monitors: [],
    notifiers: [],
    incidents: [],
  };
}

const stored = load(CONFIG_FILE, null);
export const config = stored ?? defaults();
config.settings = { ...defaults().settings, ...config.settings };
for (const key of ['monitors', 'notifiers', 'incidents']) config[key] ??= [];

export const history = load(HISTORY_FILE, {});

export function saveConfig() {
  writeAtomic(CONFIG_FILE, config);
}

if (!stored) saveConfig();

let historyDirty = false;

export function touchHistory() {
  historyDirty = true;
}

export function flushHistory() {
  if (!historyDirty) return;
  historyDirty = false;
  writeAtomic(HISTORY_FILE, history);
}

setInterval(flushHistory, 10_000).unref();

export function historyOf(id) {
  return (history[id] ??= {
    status: 'pending',
    since: Date.now(),
    lastCheck: null,
    lastMs: null,
    lastError: null,
    fails: 0,
    beats: [],
    days: {},
  });
}

export function forgetHistory(id) {
  delete history[id];
  touchHistory();
}
