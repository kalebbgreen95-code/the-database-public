const day = 86400000;
export const periods = { "1D": 1, "1W": 7, "1M": 30, "11M": 335, "1Y": 365 };

export function marketMoves(history, price, date, completedDate = date) {
  const asOf = Date.parse(date);
  if (!(price > 0) || !Number.isFinite(asOf)) return {};
  const changes = Object.fromEntries(Object.entries(periods).map(([period, days]) => {
    const cutoff = new Date(asOf - days * day).toISOString().slice(0, 10);
    const bar = history.findLast(row => row.t.slice(0, 10) <= cutoff);
    if (!(bar?.c > 0) || Date.parse(cutoff) - Date.parse(bar.t.slice(0, 10)) > 7 * day) return [period, null];
    return [period, { dollars: price - bar.c, percent: price / bar.c - 1, referenceDate: bar.t.slice(0, 10) }];
  }));
  const completed = history.filter(row => row.t.slice(0, 10) < completedDate);
  const recent = completed.slice(-22);
  const latest = recent.at(-1);
  const average = recent.slice(0, -1).reduce((sum, row) => sum + (row.v || 0), 0) / 21;
  const volume = recent.length === 22 && average > 0 && latest.v / average >= 2 &&
      Date.parse(completedDate) - Date.parse(latest.t.slice(0, 10)) <= 5 * day
    ? { ratio: latest.v / average, date: latest.t.slice(0, 10), change: latest.c / recent.at(-2).c - 1 } : null;
  return { changes, volume };
}
