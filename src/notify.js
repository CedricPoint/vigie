import { config } from './store.js';
import { t } from './i18n.js';
import { formatDuration } from './stats.js';

export const NOTIFIER_TYPES = ['discord', 'slack', 'telegram', 'ntfy', 'webhook'];

export const targetOf = (m) => (m.type === 'tcp' ? `${m.host}:${m.port}` : m.url);

export function notifyAll(event) {
  for (const notifier of config.notifiers) {
    if (!notifier.enabled) continue;
    send(notifier, event).catch((err) => {
      console.error(`[vigie] notification "${notifier.name}" failed: ${err.message}`);
    });
  }
}

function format(event) {
  const lang = config.settings.lang;
  const m = event.monitor;
  switch (event.kind) {
    case 'down':
      return {
        title: `🔴 ${m.name} ${t(lang, 'notif.isDown')}`,
        text: `${targetOf(m)}\n${t(lang, 'notif.reason')}: ${event.error}`,
        color: 0xe5484d,
        priority: 5,
      };
    case 'up':
      return {
        title: `🟢 ${m.name} ${t(lang, 'notif.isUp')}`,
        text: `${targetOf(m)}\n${t(lang, 'notif.downFor')}: ${formatDuration(event.duration)}`,
        color: 0x30a46c,
        priority: 3,
      };
    case 'cert':
      return {
        title: `🟠 ${t(lang, 'notif.certTitle', { name: m.name, n: event.daysLeft })}`,
        text: targetOf(m),
        color: 0xf5a524,
        priority: 4,
      };
    default:
      return {
        title: `🔔 ${t(lang, 'notif.testTitle')}`,
        text: t(lang, 'notif.testText'),
        color: 0x0091ff,
        priority: 3,
      };
  }
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
  }
}

export async function send(notifier, event) {
  const msg = format(event);
  const m = event.monitor;
  switch (notifier.type) {
    case 'discord':
      return post(notifier.url, {
        username: 'Vigie',
        embeds: [{ title: msg.title, description: msg.text, color: msg.color, timestamp: new Date().toISOString() }],
      });
    case 'slack':
      return post(notifier.url, { text: `*${msg.title}*\n${msg.text}` });
    case 'telegram':
      return post(`https://api.telegram.org/bot${notifier.token}/sendMessage`, {
        chat_id: notifier.chatId,
        text: `${msg.title}\n${msg.text}`,
        disable_web_page_preview: true,
      });
    case 'ntfy': {
      // JSON publishing: POST to the server root with the topic in the body,
      // so titles may contain emoji (HTTP headers may not).
      const url = new URL(notifier.url);
      const headers = notifier.token ? { authorization: `Bearer ${notifier.token}` } : {};
      return post(url.origin, { topic: url.pathname.replace(/^\/+/, ''), title: msg.title, message: msg.text, priority: msg.priority }, headers);
    }
    case 'webhook':
      return post(notifier.url, {
        event: event.kind,
        title: msg.title,
        message: msg.text,
        monitor: m ? { id: m.id, name: m.name, type: m.type, target: targetOf(m) } : null,
        error: event.error ?? null,
        time: new Date().toISOString(),
      });
    default:
      throw new Error(`Unknown notifier type ${notifier.type}`);
  }
}
