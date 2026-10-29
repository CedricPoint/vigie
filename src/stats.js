export const DAY = 86_400_000;

// Days are bucketed in UTC so the history does not depend on the server's timezone.
export const dayKey = (time) => new Date(time).toISOString().slice(0, 10);

// Uptime percentage over the last `days` days, or null when there is no data.
// The last 24 hours come from individual checks, longer periods from daily totals.
export function uptime(h, days) {
  let up = 0;
  let total = 0;
  if (days === 1) {
    const since = Date.now() - DAY;
    for (const [time, ok] of h.beats) {
      if (time < since) continue;
      total++;
      up += ok;
    }
  } else {
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const day = h.days[dayKey(now - i * DAY)];
      if (!day) continue;
      up += day[0];
      total += day[1];
    }
  }
  return total ? (up / total) * 100 : null;
}

// Average response time (ms) of successful checks in the last 24 hours.
export function averageMs(h) {
  const since = Date.now() - DAY;
  let sum = 0;
  let count = 0;
  for (const [time, ok, ms] of h.beats) {
    if (time < since || !ok) continue;
    sum += ms;
    count++;
  }
  return count ? Math.round(sum / count) : null;
}

// One entry per day, oldest first, for the status page history bars.
export function dailyBars(h, count = 90) {
  const bars = [];
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    const date = dayKey(now - i * DAY);
    const day = h.days[date];
    bars.push({
      date,
      uptime: day && day[1] ? (day[0] / day[1]) * 100 : null,
      checks: day ? day[1] : 0,
    });
  }
  return bars;
}

export function formatPercent(value) {
  if (value === null) return '—';
  if (value === 100) return '100%';
  return `${Math.floor(value * 100) / 100}%`;
}

export function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ');
}
