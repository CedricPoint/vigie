import { t, dictionaries, languages } from './i18n.js';
import { formatPercent } from './stats.js';
import { VERSION } from './monitor.js';

const REPO = 'https://github.com/CedricPoint/vigie';

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const logo = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M6 17h5l2.5-6 4 11 3-8 1.5 3H26" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function layout({ lang, title, body, bodyClass = '', script = '' }) {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/style.css?v=${VERSION}">
${script ? `<script src="${script}?v=${VERSION}" defer></script>` : ''}
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

function brand(settings) {
  const mark = settings.logoUrl ? `<img class="logo" src="${esc(settings.logoUrl)}" alt="">` : logo;
  return `<a class="brand" href="/">${mark}<span>${esc(settings.title)}</span></a>`;
}

function barClass(bar) {
  if (bar.uptime === null) return 'bar-none';
  if (bar.uptime >= 99.9) return 'bar-ok';
  if (bar.uptime >= 99) return 'bar-minor';
  if (bar.uptime >= 95) return 'bar-warn';
  return 'bar-bad';
}

function formatDate(date, lang, withTime = false) {
  const options = withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(lang, options).format(new Date(date));
}

function incidentCard(incident, lang) {
  const resolved = Boolean(incident.resolvedAt);
  const updates = [...incident.updates].reverse();
  return `<article class="incident incident-${resolved ? 'resolved' : incident.impact}">
  <header>
    <h3>${esc(incident.title)}</h3>
    <span class="pill pill-${resolved ? 'resolved' : incident.impact}">${esc(resolved ? t(lang, 'page.resolved') : t(lang, `impact.${incident.impact}`))}</span>
  </header>
  <ol class="timeline">
    ${updates
      .map(
        (u) => `<li><time datetime="${new Date(u.at).toISOString()}" data-ts="${u.at}">${esc(formatDate(u.at, lang, true))}</time><p>${esc(u.message)}</p></li>`,
      )
      .join('')}
  </ol>
</article>`;
}

export function statusPage(data) {
  const { settings, overall, monitors, activeIncidents, pastIncidents, generatedAt } = data;
  const lang = settings.lang;
  const icons = {
    operational: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    degraded: '<path d="M12 7v6M12 16.5v.5"/>',
    outage: '<path d="M7 7l10 10M17 7L7 17"/>',
    maintenance: '<path d="M12 7v5l3 2"/>',
    empty: '<path d="M7 12h10"/>',
  };
  const services = monitors
    .map((m) => {
      const label = `${m.name}: ${t(lang, `status.${m.status}`)}, ${formatPercent(m.uptime90)} ${t(lang, 'page.uptime')}`;
      return `<div class="service">
  <div class="service-top">
    <span class="dot dot-${m.status}" aria-hidden="true"></span>
    <h3 class="service-name">${esc(m.name)}</h3>
    <span class="service-state state-${m.status}">${esc(t(lang, `status.${m.status}`))}</span>
  </div>
  <div class="bars" role="img" aria-label="${esc(label)}">${m.bars
    .map((b) => {
      const value = b.uptime === null ? t(lang, 'page.noData') : formatPercent(b.uptime);
      return `<span class="bar ${barClass(b)}" data-tip="${esc(`${formatDate(b.date, lang)} · ${value}`)}"></span>`;
    })
    .join('')}</div>
  <div class="bars-legend">
    <span><span class="wide">${esc(t(lang, 'page.daysAgo', { n: 90 }))}</span><span class="narrow">${esc(t(lang, 'page.daysAgo', { n: 45 }))}</span></span>
    <span class="rule"></span>
    <span>${esc(formatPercent(m.uptime90))} ${esc(t(lang, 'page.uptime'))}${m.avgMs !== null ? ` · ${m.avgMs} ms` : ''}</span>
    <span class="rule"></span>
    <span>${esc(t(lang, 'page.today'))}</span>
  </div>
</div>`;
    })
    .join('');

  const body = `<div class="page">
<header class="site-head">${brand(settings)}</header>
<main id="status">
  <section class="banner banner-${overall}">
    <svg class="banner-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[overall]}</svg>
    <div>
      <h1>${esc(t(lang, `overall.${overall}`))}</h1>
      ${settings.description ? `<p>${esc(settings.description)}</p>` : ''}
    </div>
  </section>
  ${
    activeIncidents.length
      ? `<section class="section"><h2>${esc(t(lang, 'page.activeIncidents'))}</h2>${activeIncidents.map((i) => incidentCard(i, lang)).join('')}</section>`
      : ''
  }
  ${monitors.length ? `<section class="section"><h2>${esc(t(lang, 'page.services'))}</h2><div class="card">${services}</div></section>` : ''}
  <section class="section">
    <h2>${esc(t(lang, 'page.pastIncidents'))}</h2>
    ${pastIncidents.length ? pastIncidents.map((i) => incidentCard(i, lang)).join('') : `<p class="muted">${esc(t(lang, 'page.noIncidents'))}</p>`}
  </section>
  <p class="updated muted">${esc(t(lang, 'page.lastUpdated'))} <time datetime="${new Date(generatedAt).toISOString()}" data-ts="${generatedAt}">${esc(formatDate(generatedAt, lang, true))}</time></p>
</main>
<footer class="site-foot">
  <span>${esc(t(lang, 'page.poweredBy'))} <a href="${REPO}" rel="noopener">Vigie</a></span>
  <a href="/admin">${esc(t(lang, 'page.admin'))}</a>
</footer>
</div>`;
  return layout({ lang, title: settings.title, body, bodyClass: 'public', script: '/static/status.js' });
}

function authCard(settings, { heading, intro = '', error = '', fields, submit, action }) {
  const lang = settings.lang;
  const body = `<main class="auth">
  <form class="auth-card" method="post" action="${action}">
    <div class="auth-logo">${logo}</div>
    <h1>${esc(heading)}</h1>
    ${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
    ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
    ${fields}
    <button class="btn btn-primary btn-block" type="submit">${esc(submit)}</button>
  </form>
</main>`;
  return layout({ lang, title: `${heading} · Vigie`, body, bodyClass: 'auth-page' });
}

export function loginPage(settings, error = '') {
  const lang = settings.lang;
  return authCard(settings, {
    heading: t(lang, 'login.title'),
    error,
    action: '/login',
    submit: t(lang, 'login.submit'),
    fields: `<label class="field"><span>${esc(t(lang, 'login.password'))}</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>`,
  });
}

export function setupPage(settings, error = '') {
  const lang = settings.lang;
  const options = Object.entries(languages)
    .map(([code, name]) => `<option value="${code}"${code === lang ? ' selected' : ''}>${name}</option>`)
    .join('');
  return authCard(settings, {
    heading: t(lang, 'setup.title'),
    intro: t(lang, 'setup.intro'),
    error,
    action: '/setup',
    submit: t(lang, 'setup.submit'),
    fields: `<label class="field"><span>${esc(t(lang, 'set.lang'))}</span><select name="lang">${options}</select></label>
    <label class="field"><span>${esc(t(lang, 'setup.password'))}</span><input type="password" name="password" autocomplete="new-password" minlength="8" required autofocus></label>
    <label class="field"><span>${esc(t(lang, 'setup.confirm'))}</span><input type="password" name="confirm" autocomplete="new-password" minlength="8" required></label>`,
  });
}

export function adminPage(settings) {
  const lang = settings.lang;
  const i18n = JSON.stringify({ lang, dict: { ...dictionaries.en, ...dictionaries[lang] }, languages }).replace(/</g, '\\u003c');
  const tabs = ['monitors', 'incidents', 'notifications', 'settings']
    .map((tab) => `<a href="#${tab}" data-tab="${tab}">${esc(t(lang, `nav.${tab}`))}</a>`)
    .join('');
  const body = `<div class="admin">
<header class="admin-head">
  <a class="brand" href="#monitors">${logo}<span>Vigie</span></a>
  <nav class="tabs">${tabs}</nav>
  <div class="head-actions">
    <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">${esc(t(lang, 'nav.statusPage'))} ↗</a>
    <form method="post" action="/logout"><button class="btn btn-ghost btn-sm" type="submit">${esc(t(lang, 'nav.logout'))}</button></form>
  </div>
</header>
<main id="view" class="admin-main" aria-live="polite"></main>
<footer class="admin-foot muted">Vigie ${VERSION} · <a href="${REPO}" rel="noopener">GitHub</a></footer>
</div>
<dialog id="dialog"></dialog>
<div id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="i18n">${i18n}</script>`;
  return layout({ lang, title: `${t(lang, 'page.admin')} · Vigie`, body, bodyClass: 'admin-page', script: '/static/admin.js' });
}
