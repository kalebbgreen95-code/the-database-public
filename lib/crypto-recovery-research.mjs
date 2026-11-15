import { recoverySignals } from "./technicals.mjs";

const day = 86400000;
const date = ms => new Date(ms).toISOString().slice(0, 10);
const costPerSide = 0.003;
const symbols = ["BTC/USD", "ETH/USD"];

export function compareMomentumUniverses(history, today, universe) {
  const bars = new Map(universe.map(symbol => [symbol, new Map(
    (history[symbol] ?? []).filter(bar => bar.t.slice(0, 10) < today).map(bar => [bar.t.slice(0, 10), bar]),
  )]));
  const evaluations = [...(bars.get("BTC/USD")?.keys() ?? [])].sort().flatMap(key => {
    const time = Date.parse(key);
    const rows = universe.map(symbol => {
      const days = bars.get(symbol);
      const reference = days.get(date(time - 28 * day))?.c;
      const close = days.get(key)?.c;
      const start = days.get(date(time + day))?.o;
      const end = days.get(date(time + 2 * day))?.o;
      return { symbol, reference, close, start, end, momentum: close > reference };
    });
    return rows.every(row => [row.reference, row.close, row.start, row.end].every(value => Number.isFinite(value) && value > 0))
      ? [{date: key, rows}] : [];
  });
  const baseline = evaluations.map(({date, rows}) => ({date, rows: rows.filter(row => symbols.includes(row.symbol))}));
  return {
    universe, first: evaluations[0]?.date, last: evaluations.at(-1)?.date, days: evaluations.length,
    baseline: simulate(baseline, "momentum"), expanded: simulate(evaluations, "momentum"),
  };
}

export function compareCryptoRecovery(history, today) {
  const bars = Object.fromEntries(symbols.map(symbol => [symbol,
    new Map((history[symbol] ?? []).filter(bar => bar.t.slice(0, 10) < today)
      .map(bar => [bar.t.slice(0, 10), bar]))]));
  const dates = [...bars["BTC/USD"].keys()].sort().filter(key => bars["ETH/USD"].has(key));
  const completed = Object.fromEntries(symbols.map(symbol => [symbol, []]));
  const evaluations = [];
  for (const key of dates) {
    const time = Date.parse(key);
    const btc = bars["BTC/USD"].get(key);
    for (const symbol of symbols) completed[symbol].push(bars[symbol].get(key));
    const btcStats = recoverySignals(completed["BTC/USD"].slice(-400), date(time + day));
    const next = date(time + day);
    const following = date(time + 2 * day);
    const rows = symbols.map(symbol => {
      const stats = symbol === "BTC/USD" ? btcStats : recoverySignals(completed[symbol].slice(-400), next);
      const reference = bars[symbol].get(date(time - 28 * day))?.c;
      const start = bars[symbol].get(next)?.o;
      const end = bars[symbol].get(following)?.o;
      const bullishCandle = stats.bullishEngulfing || stats.higherRange;
      const strongerVolume = stats.relativeVolume >= 1.2 && stats.upCandleVolumeShare > 0.5;
      const improvingRsi = Number.isFinite(stats.previousRsi) && stats.rsi > stats.previousRsi && stats.rsi >= 35;
      const btcTrend = btcStats.ema200 > 0 && btc.c > btcStats.ema200;
      const recovery = btcTrend && stats.close > stats.ema200 &&
        (stats.crossedAbove || [bullishCandle, strongerVolume, improvingRsi].filter(Boolean).length >= 2);
      return { symbol, momentum: reference > 0 && stats.close > reference, reference, start, end,
        recovery, btcTrend, bullishCandle, strongerVolume, improvingRsi, stats };
    });
    if (rows.every(row => row.stats.ema200 > 0 && row.reference > 0)) evaluations.push({ date: key, rows });
  }
  const windows = evaluations.filter(({ rows }) => rows.every(row => row.start > 0 && row.end > 0));
  const downturn = windows.filter(row => row.date.startsWith("2022"));
  return {
    first: windows[0]?.date, last: windows.at(-1)?.date, days: windows.length,
    downturnDays: downturn.length,
    comparisons: ["momentum", "recovery"].map(rule => ({
      rule, full: simulate(windows, rule), downturn: simulate(downturn, rule),
    })),
    evaluations: evaluations.slice(-7).reverse().map(row => ({
      date: row.date, rows: row.rows.map(({ start, end, reference, ...metrics }) => metrics),
    })),
  };
}

function simulate(rows, rule) {
  if (!rows.length || !rows[0].rows.length) return null;
  let peak = 1, drawdown = 0, entries = 0;
  const count = rows[0].rows.length;
  const equity = Array(count).fill(1 / count);
  const invested = Array(count).fill(false);
  let prior;
  for (const evaluation of rows) {
    for (const [index, row] of evaluation.rows.entries()) {
      if (prior && Date.parse(evaluation.date) - Date.parse(prior) !== day && invested[index]) {
        equity[index] *= 1 - costPerSide;
        invested[index] = false;
      }
      if (row[rule] !== invested[index]) {
        equity[index] *= 1 - costPerSide;
        if (row[rule]) entries++;
        invested[index] = row[rule];
      }
      if (invested[index]) equity[index] *= row.end / row.start;
    }
    const total = equity.reduce((sum, value) => sum + value, 0);
    peak = Math.max(peak, total);
    drawdown = Math.max(drawdown, 1 - total / peak);
    prior = evaluation.date;
  }
  const final = equity.reduce((sum, value, index) => sum + value * (invested[index] ? 1 - costPerSide : 1), 0);
  return { return: final - 1, drawdown: Math.max(drawdown, 1 - final / peak), entries };
}
