(() => {
  const { lang, dict, languages } = JSON.parse(document.getElementById('i18n').textContent);
  const t = (key, vars = {}) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const view = document.getElementById('view');
  const dialog = document.getElementById('dialog');
  const toastEl = document.getElementById('toast');
  const TABS = ['monitors', 'incidents', 'notifications', 'settings'];
  let state = null;
  let tab = 'monitors';

  // ---------- helpers ----------

  async function api(method, url, body) {
    const res = await fetch(`/api/admin${url}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-vigie': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error(t('error'));
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t('error'));
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('error', isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), isError ? 6000 : 2500);
  }

  const pct = (value) => (value === null || value === undefined ? '—' : value === 100 ? '100%' : `${Math.floor(value * 100) / 100}%`);
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  function ago(time) {
    if (!time) return t('never');
    const seconds = Math.round((time - Date.now()) / 1000);
    if (Math.abs(seconds) < 60) return relative.format(seconds, 'second');
    if (Math.abs(seconds) < 3600) return relative.format(Math.round(seconds / 60), 'minute');
    if (Math.abs(seconds) < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
    return relative.format(Math.round(seconds / 86400), 'day');
  }
  const dateTime = (time) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time));
  const target = (m) => (m.type === 'tcp' ? `${m.host}:${m.port}` : m.url);

  const icons = {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    badge: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    test: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  };
  const iconBtn = (action, id, icon, label, extra = '') =>
    `<button type="button" class="icon-btn ${extra}" data-action="${action}" data-id="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24">${icons[icon]}</svg></button>`;

  function spark(values) {
    const ok = values.filter((v) => v !== null);
    if (values.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
    const w = 120;
    const h = 32;
    const max = Math.max(...ok, 1);
    const x = (i) => ((i / (values.length - 1)) * (w - 4) + 2).toFixed(1);
    const y = (v) => (h - 3 - (v / max) * (h - 8)).toFixed(1);
    const points = values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
    const fails = values.map((v, i) => (v === null ? `<circle class="fail" cx="${x(i)}" cy="${h - 3}" r="2.2"/>` : '')).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${points}"/>${fails}</svg>`;
  }

  // ---------- forms ----------

  function fieldHtml(f) {
    const label = typeof f.label === 'function' ? '' : f.label;
    if (f.type === 'checkbox') {
      return `<label class="check" data-field="${f.name}"><input type="checkbox" name="${f.name}"${f.value ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    }
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}">${f.options
        .map(([value, text]) => `<option value="${esc(value)}"${String(value) === String(f.value) ? ' selected' : ''}>${esc(text)}</option>`)
        .join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}"${f.required ? ' required' : ''}>${esc(f.value)}</textarea>`;
    } else {
      input = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(f.value)}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${
        f.required ? ' required' : ''
      }${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}>`;
    }
    return `<label class="field" data-field="${f.name}"><span>${esc(label)}</span>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
  }

  const fieldsHtml = (fields) => fields.map((f) => (f.row ? `<div class="grid-2">${f.row.map(fieldHtml).join('')}</div>` : fieldHtml(f))).join('');

  // Wires show/hide conditions and dynamic labels, returns a function reading the values.
  function bindForm(form, fields) {
    const flat = fields.flatMap((f) => f.row ?? [f]);
    const raw = () => Object.fromEntries(flat.map((f) => [f.name, f.type === 'checkbox' ? form.elements[f.name].checked : form.elements[f.name].value]));
    const sync = () => {
      const values = raw();
      for (const f of flat) {
        const wrap = form.querySelector(`[data-field="${f.name}"]`);
        if (f.show) {
          const visible = f.show(values);
          wrap.hidden = !visible;
          form.elements[f.name].disabled = !visible;
        }
        if (typeof f.label === 'function') wrap.querySelector('span').textContent = f.label(values);
      }
    };
    form.addEventListener('change', sync);
    sync();
    return () => {
      const values = {};
      for (const f of flat) {
        const el = form.elements[f.name];
        if (!el.disabled) values[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      }
      return values;
    };
  }

  async function submitWith(form, button, action) {
    const errorEl = form.querySelector('.form-error');
    if (!form.reportValidity()) return false;
    button.disabled = true;
    errorEl.hidden = true;
    try {
      await action();
      return true;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      return false;
    } finally {
      button.disabled = false;
    }
  }

  function openForm({ title, fields, submitLabel = t('save'), onSubmit }) {
    dialog.innerHTML = `<form><h2>${esc(title)}</h2><p class="form-error" role="alert" hidden></p>${fieldsHtml(fields)}
      <div class="dialog-actions"><button type="button" class="btn" data-close>${esc(t('cancel'))}</button><button type="submit" class="btn btn-primary">${esc(submitLabel)}</button></div></form>`;
    const form = dialog.querySelector('form');
    const read = bindForm(form, fields);
    form.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const done = await submitWith(form, form.querySelector('[type=submit]'), () => onSubmit(read()));
      if (done) dialog.close();
    });
    dialog.showModal();
    form.querySelector('input:not([type=checkbox]), textarea, select')?.focus();
  }

  // ---------- monitors ----------

  function monitorFields(m = {}) {
    const http = (v) => v.type === 'http';
    const tcp = (v) => v.type === 'tcp';
    return [
      { name: 'name', label: t('mon.name'), value: m.name ?? '', required: true, placeholder: 'My website' },
      { name: 'type', label: t('mon.type'), type: 'select', value: m.type ?? 'http', options: [['http', t('mon.typeHttp')], ['tcp', t('mon.typeTcp')]] },
      { name: 'url', label: t('mon.url'), type: 'url', value: m.url ?? '', placeholder: 'https://example.com', required: true, show: http },
      {
        row: [
          { name: 'method', label: t('mon.method'), type: 'select', value: m.method ?? 'GET', options: [['GET', 'GET'], ['HEAD', 'HEAD'], ['POST', 'POST']], show: http },
          { name: 'expectedStatus', label: t('mon.expectedStatus'), value: m.expectedStatus ?? '200-399', hint: t('mon.expectedStatusHint'), show: http },
        ],
      },
      { name: 'keyword', label: t('mon.keyword'), value: m.keyword ?? '', show: http },
      {
        row: [
          { name: 'host', label: t('mon.host'), value: m.host ?? '', placeholder: 'db.example.com', required: true, show: tcp },
          { name: 'port', label: t('mon.port'), type: 'number', value: m.port ?? '', min: 1, max: 65535, required: true, show: tcp },
        ],
      },
      {
        row: [
          { name: 'interval', label: t('mon.interval'), type: 'number', value: m.interval ?? 60, min: 30, max: 86400, required: true },
          { name: 'timeout', label: t('mon.timeout'), type: 'number', value: m.timeout ?? 10, min: 1, max: 60, required: true },
        ],
      },
      { name: 'retries', label: t('mon.retries'), type: 'number', value: m.retries ?? 1, min: 0, max: 5 },
      { name: 'public', label: t('mon.public'), type: 'checkbox', value: m.public ?? true },
      { name: 'enabled', label: t('mon.enabled'), type: 'checkbox', value: m.enabled ?? true },
    ];
  }

  function monitorSub(m) {
    if (m.status === 'down' && m.lastError) return { cls: 'error', text: m.lastError };
    if (m.cert?.validTo) {
      const days = Math.floor((m.cert.validTo - Date.now()) / 86400000);
      if (days <= 14) return { cls: 'warn', text: t('mon.certDays', { n: days }) };
    }
    return { cls: '', text: `${target(m)} · ${t('mon.lastCheck')} ${ago(m.lastCheck)}` };
  }

  function renderMonitors() {
    const monitors = state.monitors;
    const count = (status) => monitors.filter((m) => m.status === status).length;
    const summary = [
      ['up', count('up'), 'mon.summaryUp'],
      ['down', count('down'), 'mon.summaryDown'],
      ['paused', count('paused'), 'mon.summaryPaused'],
    ]
      .filter(([, n]) => n)
      .map(([status, n, key]) => `<span class="pill pill-${status}">${esc(t(key, { n }))}</span>`)
      .join('');
    const addButton = `<button type="button" class="btn btn-primary" data-action="add-monitor">+ ${esc(t('mon.add'))}</button>`;
    const rows = monitors
      .map((m) => {
        const sub = monitorSub(m);
        return `<div class="row">
  <div class="row-main">
    <span class="dot dot-${m.status}" title="${esc(t(`status.${m.status}`))}"></span>
    <div class="row-text">
      <div class="row-title">${esc(m.name)}${m.public ? '' : `<span class="pill pill-paused">${esc(t('mon.private'))}</span>`}</div>
      <div class="row-sub ${sub.cls}" title="${esc(sub.text)}">${esc(sub.text)}</div>
    </div>
  </div>
  <div class="spark-cell">${spark(m.spark)}</div>
  <div class="metric"><b>${m.status === 'up' && m.lastMs !== null ? `${m.lastMs} ms` : '—'}</b><span>${esc(t('mon.response'))}</span></div>
  <div class="metric metric-secondary"><b>${pct(m.uptime24)}</b><span>${esc(t('mon.uptime24'))}</span></div>
  <div class="actions">
    ${m.enabled ? iconBtn('check-monitor', m.id, 'check', t('mon.checkNow')) : ''}
    ${iconBtn('toggle-monitor', m.id, m.enabled ? 'pause' : 'play', m.enabled ? t('mon.pause') : t('mon.resume'))}
    ${m.public ? iconBtn('badge-monitor', m.id, 'badge', t('mon.badge')) : ''}
    ${iconBtn('edit-monitor', m.id, 'edit', t('edit'))}
    ${iconBtn('delete-monitor', m.id, 'trash', t('delete'), 'danger')}
  </div>
</div>`;
      })
      .join('');
    view.innerHTML = `<div class="view-head"><div class="view-title"><h1>${esc(t('nav.monitors'))}</h1><div class="summary">${summary}</div></div>${monitors.length ? addButton : ''}</div>
      ${monitors.length ? `<div class="list">${rows}</div>` : `<div class="card empty"><p>${esc(t('mon.empty'))}</p>${addButton}</div>`}`;
  }

  // ---------- incidents ----------

  function renderIncidents() {
    const addButton = `<button type="button" class="btn btn-primary" data-action="add-incident">+ ${esc(t('inc.add'))}</button>`;
    const cards = state.incidents
      .map((i) => {
        const resolved = Boolean(i.resolvedAt);
        return `<article class="incident incident-admin incident-${resolved ? 'resolved' : i.impact}">
  <header><h3>${esc(i.title)}</h3><span class="pill pill-${resolved ? 'resolved' : i.impact}">${esc(resolved ? t('page.resolved') : `${t('inc.active')} · ${t(`impact.${i.impact}`)}`)}</span></header>
  <ol class="timeline">${[...i.updates]
    .reverse()
    .map((u) => `<li><time>${esc(dateTime(u.at))}</time><p>${esc(u.message)}</p></li>`)
    .join('')}</ol>
  <div class="actions">
    ${resolved ? '' : `<button type="button" class="btn btn-sm" data-action="update-incident" data-id="${i.id}">${esc(t('inc.update'))}</button>`}
    ${resolved ? '' : `<button type="button" class="btn btn-sm" data-action="resolve-incident" data-id="${i.id}">${esc(t('inc.resolve'))}</button>`}
    <button type="button" class="btn btn-sm btn-ghost btn-danger" data-action="delete-incident" data-id="${i.id}">${esc(t('delete'))}</button>
  </div>
</article>`;
      })
      .join('');
    view.innerHTML = `<div class="view-head"><h1>${esc(t('nav.incidents'))}</h1>${state.incidents.length ? addButton : ''}</div>
      ${state.incidents.length ? cards : `<div class="card empty"><p>${esc(t('inc.empty'))}</p>${addButton}</div>`}`;
  }

  const impactOptions = () => ['minor', 'major', 'maintenance'].map((v) => [v, t(`impact.${v}`)]);

  // ---------- notifications ----------

  const notifierTypes = { discord: 'Discord', slack: 'Slack', telegram: 'Telegram', ntfy: 'ntfy', webhook: 'Webhook' };

  function notifierFields(n = {}) {
    const telegram = (v) => v.type === 'telegram';
    return [
      { name: 'type', label: t('notif.type'), type: 'select', value: n.type ?? 'discord', options: Object.entries(notifierTypes) },
      { name: 'name', label: t('notif.name'), value: n.name ?? '', placeholder: '#alerts' },
      {
        name: 'url',
        label: (v) => (v.type === 'ntfy' ? t('notif.ntfyUrl') : t('notif.url')),
        type: 'url',
        value: n.url ?? '',
        placeholder: 'https://',
        required: true,
        show: (v) => !telegram(v),
      },
      { name: 'token', label: (v) => (v.type === 'ntfy' ? t('notif.ntfyToken') : t('notif.token')), value: n.token ?? '', autocomplete: 'off', show: (v) => telegram(v) || v.type === 'ntfy' },
      { name: 'chatId', label: t('notif.chatId'), value: n.chatId ?? '', show: telegram },
      { name: 'enabled', label: t('mon.enabled'), type: 'checkbox', value: n.enabled ?? true },
    ];
  }

  function renderNotifications() {
    const addButton = `<button type="button" class="btn btn-primary" data-action="add-notifier">+ ${esc(t('notif.add'))}</button>`;
    const rows = state.notifiers
      .map(
        (n) => `<div class="row row-simple">
  <div class="row-main">
    <span class="dot ${n.enabled ? '' : 'dot-paused'}"></span>
    <div class="row-text"><div class="row-title">${esc(n.name)}</div><div class="row-sub">${esc(notifierTypes[n.type])}${n.enabled ? '' : ` · ${esc(t('status.paused'))}`}</div></div>
  </div>
  <div class="actions">
    ${iconBtn('test-notifier', n.id, 'test', t('notif.test'))}
    ${iconBtn('edit-notifier', n.id, 'edit', t('edit'))}
    ${iconBtn('delete-notifier', n.id, 'trash', t('delete'), 'danger')}
  </div>
</div>`,
      )
      .join('');
    view.innerHTML = `<div class="view-head"><h1>${esc(t('nav.notifications'))}</h1>${state.notifiers.length ? addButton : ''}</div>
      ${state.notifiers.length ? `<div class="list">${rows}</div>` : `<div class="card empty"><p>${esc(t('notif.empty'))}</p>${addButton}</div>`}`;
  }

  // ---------- settings ----------

  function renderSettings() {
    const s = state.settings;
    const pageFields = [
      { name: 'title', label: t('set.title'), value: s.title, required: true },
      { name: 'description', label: t('set.description'), type: 'textarea', value: s.description },
      { name: 'lang', label: t('set.lang'), type: 'select', value: s.lang, options: Object.entries(languages) },
      { name: 'logoUrl', label: t('set.logoUrl'), type: 'url', value: s.logoUrl, placeholder: 'https://' },
    ];
    const passwordFields = [
      { name: 'current', label: t('set.currentPassword'), type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'next', label: t('set.newPassword'), type: 'password', required: true, autocomplete: 'new-password', hint: t('setup.tooShort') },
    ];
    view.innerHTML = `<div class="view-head"><h1>${esc(t('nav.settings'))}</h1></div>
  <form class="panel" id="settings-form"><h2>${esc(t('set.page'))}</h2><p class="form-error" role="alert" hidden></p>${fieldsHtml(pageFields)}
    <button type="submit" class="btn btn-primary">${esc(t('save'))}</button></form>
  <section class="panel"><h2>${esc(t('set.password'))}</h2>${
    s.passwordFromEnv
      ? `<p class="muted">${esc(t('set.envPassword'))}</p>`
      : `<form id="password-form"><p class="form-error" role="alert" hidden></p>${fieldsHtml(passwordFields)}<button type="submit" class="btn">${esc(t('set.change'))}</button></form>`
  }</section>
  <section class="panel"><h2>${esc(t('set.backup'))}</h2><p class="muted">${esc(t('set.backupText'))}</p><a class="btn" href="/api/admin/export" download>${esc(t('set.export'))}</a></section>`;

    const settingsForm = document.getElementById('settings-form');
    const readSettings = bindForm(settingsForm, pageFields);
    settingsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const before = state.settings.lang;
      const ok = await submitWith(settingsForm, settingsForm.querySelector('[type=submit]'), async () => {
        state.settings = await api('PUT', '/settings', readSettings());
      });
      if (!ok) return;
      if (state.settings.lang !== before) location.reload();
      else toast(t('set.saved'));
    });

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
      const readPassword = bindForm(passwordForm, passwordFields);
      passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ok = await submitWith(passwordForm, passwordForm.querySelector('[type=submit]'), () => api('PUT', '/password', readPassword()));
        if (ok) {
          passwordForm.reset();
          toast(t('set.passwordChanged'));
        }
      });
    }
  }

  // ---------- actions ----------

  const byId = (list, id) => list.find((x) => x.id === id);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      window.prompt('', text);
      return false;
    }
  }

  const actions = {
    'add-monitor': () =>
      openForm({ title: t('mon.add'), fields: monitorFields(), onSubmit: async (v) => { await api('POST', '/monitors', v); await load(); } }),
    'edit-monitor': (id) =>
      openForm({ title: t('mon.edit'), fields: monitorFields(byId(state.monitors, id)), onSubmit: async (v) => { await api('PUT', `/monitors/${id}`, v); await load(); } }),
    'check-monitor': async (id, button) => {
      button.classList.add('spin');
      try {
        await api('POST', `/monitors/${id}/check`);
        await load();
      } finally {
        button.classList.remove('spin');
      }
    },
    'toggle-monitor': async (id) => {
      await api('PATCH', `/monitors/${id}`, { enabled: !byId(state.monitors, id).enabled });
      await load();
    },
    'delete-monitor': async (id) => {
      if (!confirm(t('mon.confirmDelete', { name: byId(state.monitors, id).name }))) return;
      await api('DELETE', `/monitors/${id}`);
      await load();
    },
    'badge-monitor': async (id) => {
      const m = byId(state.monitors, id);
      const markdown = `[![${m.name.replace(/[[\]]/g, '')}](${location.origin}/badge/${id}.svg)](${location.origin}/)`;
      if (await copyText(markdown)) toast(t('mon.badgeCopied'));
    },
    'add-incident': () =>
      openForm({
        title: t('inc.add'),
        fields: [
          { name: 'title', label: t('inc.title'), required: true },
          { name: 'impact', label: t('inc.impact'), type: 'select', value: 'minor', options: impactOptions() },
          { name: 'message', label: t('inc.message'), type: 'textarea' },
        ],
        onSubmit: async (v) => { await api('POST', '/incidents', v); await load(); },
      }),
    'update-incident': (id) =>
      openForm({
        title: t('inc.update'),
        fields: [{ name: 'message', label: t('inc.message'), type: 'textarea', required: true }],
        onSubmit: async (v) => { await api('POST', `/incidents/${id}/updates`, v); await load(); },
      }),
    'resolve-incident': (id) =>
      openForm({
        title: t('inc.resolve'),
        fields: [{ name: 'message', label: t('inc.message'), type: 'textarea', value: t('inc.resolvedMessage'), required: true }],
        submitLabel: t('inc.resolve'),
        onSubmit: async (v) => { await api('POST', `/incidents/${id}/updates`, { ...v, resolve: true }); await load(); },
      }),
    'delete-incident': async (id) => {
      if (!confirm(t('inc.confirmDelete'))) return;
      await api('DELETE', `/incidents/${id}`);
      await load();
    },
    'add-notifier': () =>
      openForm({ title: t('notif.add'), fields: notifierFields(), onSubmit: async (v) => { await api('POST', '/notifiers', v); await load(); } }),
    'edit-notifier': (id) =>
      openForm({ title: t('notif.edit'), fields: notifierFields(byId(state.notifiers, id)), onSubmit: async (v) => { await api('PUT', `/notifiers/${id}`, v); await load(); } }),
    'test-notifier': async (id) => {
      await api('POST', `/notifiers/${id}/test`);
      toast(t('notif.testSent'));
    },
    'delete-notifier': async (id) => {
      if (!confirm(t('notif.confirmDelete'))) return;
      await api('DELETE', `/notifiers/${id}`);
      await load();
    },
  };

  view.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !actions[button.dataset.action]) return;
    try {
      await actions[button.dataset.action](button.dataset.id, button);
    } catch (err) {
      toast(err.message, true);
    }
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  // ---------- routing & refresh ----------

  const renderers = { monitors: renderMonitors, incidents: renderIncidents, notifications: renderNotifications, settings: renderSettings };

  function render() {
    for (const link of document.querySelectorAll('.tabs a')) {
      if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (state) renderers[tab]();
  }

  async function load() {
    state = await api('GET', '/state');
    render();
  }

  function route() {
    const wanted = location.hash.slice(1);
    tab = TABS.includes(wanted) ? wanted : 'monitors';
    render();
  }

  window.addEventListener('hashchange', route);
  route();
  load().catch((err) => toast(err.message, true));

  // Only the monitors view changes on its own; refreshing other views would wipe forms being edited.
  setInterval(() => {
    if (document.hidden || tab !== 'monitors' || dialog.open) return;
    load().catch(() => {});
  }, 15_000);
})();
