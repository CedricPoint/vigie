// Refresh the public status page every minute without a full reload.
(() => {
  const refresh = async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(location.pathname, { headers: { accept: 'text/html' }, cache: 'no-store' });
      if (!res.ok) return;
      const next = new DOMParser().parseFromString(await res.text(), 'text/html').querySelector('#status');
      if (next) document.querySelector('#status').replaceWith(next);
    } catch {
      // Offline or server restarting: keep the current content.
    }
  };
  setInterval(refresh, 60_000);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
})();
