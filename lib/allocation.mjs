export const cryptoBenchmarkSymbols = ["BTC/USD", "ETH/USD"];

export const allocations = {
  stockMonthly: { label: "10-month moving average", asset: "Stock", symbols: ["SPY", "QQQ", "IWM", "DIA"] },
  cryptoDaily: { label: "Daily 28-day momentum", asset: "Crypto",
    symbols: [...cryptoBenchmarkSymbols, "SOL/USD", "XRP/USD", "LINK/USD", "LTC/USD"] },
  cryptoWeekly: { label: "Weekly 28-day momentum", asset: "Crypto", symbols: cryptoBenchmarkSymbols },
};

const day = 86400000;
const date = time => new Date(time).toISOString().slice(0, 10);
const eastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", dateStyle: "short" });

export function allocationSignal(name, bars, now, lastMonthSession) {
  if (name === "stockMonthly") {
    const currentMonth = eastern.format(now).slice(0, 7);
    const closes = new Map();
    for (const bar of bars) {
      const month = bar.t.slice(0, 7);
      if (month < currentMonth) closes.set(month, bar);
    }
    const recent = [...closes.values()].slice(-10);
    if (recent.length !== 10 || recent.at(-1).t.slice(0, 10) !== lastMonthSession) return null;
    const months = recent.map(row => row.t.slice(0, 7));
    const expected = Array.from({ length: 10 }, (_, i) => {
      const month = new Date(currentMonth + "-01T00:00:00Z");
      month.setUTCMonth(month.getUTCMonth() - 10 + i);
      return month.toISOString().slice(0, 7);
    });
    if (months.some((month, i) => month !== expected[i])) return null;
    const average = recent.reduce((sum, row) => sum + row.c, 0) / 10;
    return target(recent.at(-1), average);
  }
  const today = new Date(date(now) + "T00:00:00Z");
  const completed = +today - (name === "cryptoDaily" ? 1 : today.getUTCDay() || 7) * day;
  const closes = new Map(bars.map(row => [row.t.slice(0, 10), row]));
  const latest = closes.get(date(completed));
  const reference = closes.get(date(completed - 28 * day));
  return latest && reference ? target(latest, reference.c, date(completed - 28 * day)) : null;
}

function target(bar, reference, referenceDate) {
  return {
    action: bar.c > reference ? "Buy" : "Cash",
    score: bar.c / reference - 1,
    asOf: bar.t.slice(0, 10),
    close: bar.c, reference, referenceDate,
  };
}
