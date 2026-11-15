const day = 86400000;
const avg = rows => rows.reduce((sum, row) => sum + row.c, 0) / rows.length;

function signals(rows) {
  let monthEnds = [];
  return rows.map((row, i) => {
    const date = row.t.slice(0, 10);
    const next = rows[i + 1]?.t.slice(0, 10);
    const monthEnd = next && next.slice(0, 7) !== date.slice(0, 7);
    const weekEnd = next && (new Date(date).getUTCDay() + Math.round((Date.parse(next) - Date.parse(date)) / day) - 1 >= 7 || new Date(date).getUTCDay() === 0);
    if (monthEnd) monthEnds.push(row);
    const priorYear = monthEnds.at(-13);
    return {
      date, o: row.o, c: row.c,
      targets: {
        buyHold: true,
        sma10month: monthEnd && monthEnds.length >= 10 ? row.c > avg(monthEnds.slice(-10)) : undefined,
        return12month: monthEnd && priorYear ? row.c > priorYear.c : undefined,
        sma200day: i >= 199 ? row.c > avg(rows.slice(i - 199, i + 1)) : undefined,
        return28day: weekEnd && i >= 28 ? row.c > rows[i - 28].c : undefined,
      },
    };
  });
}

function metrics(equity, [start, end]) {
  const sample = equity.filter(row => row.date >= start && row.date <= end);
  const initial = equity.findLast(row => row.date < start)?.value ?? 10000;
  let peak = initial;
  let peakDate = equity.findLast(row => row.date < start)?.date ?? start;
  let maxDrawdown = 0;
  let worst;
  for (const { date, value } of sample) {
    if (value > peak) { peak = value; peakDate = date; }
    const drawdown = 1 - value / peak;
    if (drawdown > maxDrawdown) { maxDrawdown = drawdown; worst = { peakDate, troughDate: date }; }
  }
  const finish = sample.at(-1).value;
  const startDate = Date.parse(start);
  const years = (Date.parse(end) - startDate + day) / (365.2425 * day);
  return { return: finish / initial - 1, cagr: (finish / initial) ** (1 / years) - 1, maxDrawdown, worst };
}

function simulate(series, rule, fee, periods, allocation = 1) {
  const [first, last] = periods.full;
  const sleeves = Object.values(series).map(rows => ({
    rows, cash: allocation * 10000 / Object.keys(series).length, qty: 0, desired: rule === "buyHold",
  }));
  const equity = [];
  let orders = 0, spent = 0, invested = 0;
  for (const [i, date] of sleeves[0].rows.map(row => row.date).entries()) {
    if (date > last) break;
    let value = (1 - allocation) * 10000, exposure = 0;
    for (const sleeve of sleeves) {
      const row = sleeve.rows[i];
      if (row?.date !== date) throw Error("Input calendars do not match on " + date);
      if (date >= first && sleeve.desired !== (sleeve.qty > 0)) {
        const gross = sleeve.desired ? sleeve.cash / (1 + fee) : sleeve.qty * row.o;
        spent += gross * fee;
        orders++;
        if (sleeve.desired) { sleeve.qty = gross / row.o; sleeve.cash = 0; }
        else { sleeve.cash = gross * (1 - fee); sleeve.qty = 0; }
      }
      const target = row.targets[rule];
      if (target !== undefined) sleeve.desired = target;
      const marked = sleeve.qty * row.c;
      value += sleeve.cash + marked;
      exposure += marked;
    }
    if (date >= first) {
      equity.push({ date, value });
      invested += exposure / value;
    }
  }
  const windows = Object.fromEntries(Object.entries(periods).map(([name, range]) => [name, metrics(equity, range)]));
  return { windows, orders, costs: spent, averageExposure: invested / equity.length };
}


export function compareHistoricalStrategies(history) {
  const allDays = history.SPY;
  const [first, last] = [allDays.at(-180).date, allDays.at(-1).date];
  const periods = {full:[first,last],later:[allDays.at(-90).date,last]};
  const compare = (symbols, rule, fee, allocation = 1) => {
    const series = Object.fromEntries(symbols.map(symbol => [symbol, signals(history[symbol])]));
    return {...simulate(series,rule,fee,periods,allocation),doubleCost:simulate(series,rule,fee*2,periods,allocation).windows};
  };
  const etfs = ["SPY","QQQ","IWM","DIA"];
  const crypto = ["BTC/USD","ETH/USD"];
  return {stocks:{
    buyHold:compare(etfs,"buyHold",.001), sma10month:compare(etfs,"sma10month",.001),
    spyBuyHold:compare(["SPY"],"buyHold",.001), spySma10month:compare(["SPY"],"sma10month",.001),
  }, crypto:{
    buyHold:compare(crypto,"buyHold",.003), return28day:compare(crypto,"return28day",.003),
    halfCapitalMomentum:compare(crypto,"return28day",.003,.5),
  }};
}
