import { NOTIFIER_TYPES } from './notify.js';
import { languages } from './i18n.js';

// Thrown with an i18n key; the server turns it into a 400 in the admin's language.
export class InputError extends Error {}

const fail = (key) => {
  throw new InputError(key);
};
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const int = (value) => Number.parseInt(value, 10);
const bool = (value, fallback) => (value === undefined ? fallback : value === true || value === 'true' || value === 'on');

export function httpUrl(value) {
  try {
    const url = new URL(text(value, 2000));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function monitorInput(body) {
  const m = { name: text(body.name, 100) };
  if (!m.name) fail('err.name');
  m.type = body.type === 'tcp' ? 'tcp' : 'http';
  if (m.type === 'http') {
    m.url = httpUrl(body.url);
    if (!m.url) fail('err.url');
    m.method = ['GET', 'HEAD', 'POST'].includes(body.method) ? body.method : 'GET';
    m.expectedStatus = text(body.expectedStatus, 100).replace(/\s+/g, '') || '200-399';
    if (!/^\d{3}(-\d{3})?(,\d{3}(-\d{3})?)*$/.test(m.expectedStatus)) fail('err.status');
    m.keyword = text(body.keyword, 200);
  } else {
    m.host = text(body.host, 255);
    if (!m.host || /[\s/]/.test(m.host)) fail('err.host');
    m.port = int(body.port);
    if (!(m.port >= 1 && m.port <= 65535)) fail('err.port');
  }
  m.interval = int(body.interval ?? 60);
  if (!(m.interval >= 30 && m.interval <= 86_400)) fail('err.interval');
  m.timeout = int(body.timeout ?? 10);
  if (!(m.timeout >= 1 && m.timeout <= 60 && m.timeout < m.interval)) fail('err.timeout');
  const retries = int(body.retries);
  m.retries = Number.isFinite(retries) ? Math.min(5, Math.max(0, retries)) : 1;
  m.public = bool(body.public, true);
  m.enabled = bool(body.enabled, true);
  return m;
}

export function notifierInput(body) {
  if (!NOTIFIER_TYPES.includes(body.type)) fail('err.notFound');
  const n = { type: body.type, name: text(body.name, 100) || body.type, enabled: bool(body.enabled, true) };
  if (n.type === 'telegram') {
    n.token = text(body.token, 200);
    n.chatId = text(body.chatId, 100);
    if (!n.token || !n.chatId) fail('err.telegram');
  } else {
    n.url = httpUrl(body.url);
    if (!n.url) fail('err.notifUrl');
    if (n.type === 'ntfy') n.token = text(body.token, 200);
  }
  return n;
}

export function incidentInput(body) {
  const incident = {
    title: text(body.title, 150),
    impact: ['minor', 'major', 'maintenance'].includes(body.impact) ? body.impact : 'minor',
    message: text(body.message, 5000),
  };
  if (!incident.title) fail('err.title');
  return incident;
}

export function settingsInput(body) {
  const settings = {
    title: text(body.title, 100),
    description: text(body.description, 500),
    lang: body.lang in languages ? body.lang : 'en',
    logoUrl: text(body.logoUrl, 2000) ? httpUrl(body.logoUrl) : '',
  };
  if (!settings.title) fail('err.title');
  if (settings.logoUrl === null) fail('err.url');
  return settings;
}

export const messageInput = (body) => text(body.message, 5000);
