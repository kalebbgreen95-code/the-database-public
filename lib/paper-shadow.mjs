import { cryptoIntradayRule, intradayCryptoExit } from "./strategy.mjs";

export const shadowStake = 50;
export const shadowCapital = 250;
export const shadowFee = .003;

function book() {
  return {cash: shadowCapital, peak: shadowCapital, drawdown: 0, positions: {}, cooldowns: {}, closed: 0,
    regimes: {bullish: {count: 0, net: 0}, other: {count: 0, net: 0}}};
}

export function newShadowComparison(now) {
  return {since: new Date(now).toISOString(), baseline: book(), btcFilter: book()};
}

export function evaluateShadow(state, candidates, now, maxSpread) {
  const rows = new Map(candidates.map(row => [row.symbol, row]));
  const btc = rows.get("BTC/USD")?.signals.cryptoIntraday;
  const btcAge = now - Date.parse(btc?.asOf);
  const synchronized = btcAge >= 0 && btcAge < 300000;
  const bullish = btc?.action === "Buy";
  const eligible = candidates.filter(row => row.symbol !== "BTC/USD" && row.execution &&
    row.execution.spread <= maxSpread && row.signals.cryptoIntraday?.action === "Buy" &&
    row.signals.cryptoIntraday.asOf === btc?.asOf).sort((a, b) => b.signals.cryptoIntraday.score - a.signals.cryptoIntraday.score);

  for (const [variant, account] of Object.entries({baseline: state.baseline, btcFilter: state.btcFilter})) {
    let exited = false;
    for (const [symbol, position] of Object.entries(account.positions)) {
      const row = rows.get(symbol);
      if (!row?.execution) continue;
      const {bid} = row.execution;
      position.mark = position.qty * bid * (1 - shadowFee);
      if (exited || !intradayCryptoExit(position, bid, row.signals.cryptoIntraday, now)) continue;
      account.cash += position.mark;
      account.closed++;
      const outcome = account.regimes[position.regime];
      outcome.count++;
      outcome.net += position.mark - shadowStake;
      account.cooldowns[symbol] = now + (position.mark < shadowStake ? 60 : 15) * 60000;
      delete account.positions[symbol];
      exited = true;
    }
    if (!exited && synchronized && (variant === "baseline" || bullish) && account.cash >= shadowStake) {
      const candidate = eligible.find(row => !account.positions[row.symbol] && !(account.cooldowns[row.symbol] > now));
      if (candidate && Object.keys(account.positions).length < shadowCapital / shadowStake) {
        const {ask, bid} = candidate.execution;
        const qty = shadowStake * (1 - shadowFee) / ask;
        account.cash -= shadowStake;
        account.positions[candidate.symbol] = {at: new Date(now).toISOString(), price: ask, qty,
          mark: qty * bid * (1 - shadowFee), regime: bullish ? "bullish" : "other"};
      }
    }
    const equity = account.cash + Object.values(account.positions).reduce((sum, position) => sum + position.mark, 0);
    account.peak = Math.max(account.peak, equity);
    account.drawdown = Math.max(account.drawdown, 1 - equity / account.peak);
  }
}

export function summarizeShadow(state) {
  if (!state) return null;
  const summary = {since: state.since, fee: shadowFee, stake: shadowStake, capital: shadowCapital};
  for (const variant of ["baseline", "btcFilter"]) {
    const account = state[variant];
    const equity = account.cash + Object.values(account.positions).reduce((sum, position) => sum + position.mark, 0);
    summary[variant] = {netReturn: equity / shadowCapital - 1, drawdown: account.drawdown, closed: account.closed,
      open: Object.keys(account.positions).length, cash: account.cash, regimes: account.regimes};
  }
  const {baseline, btcFilter} = summary;
  const enough = baseline.regimes.bullish.count >= 10 && baseline.regimes.other.count >= 10 && btcFilter.closed >= 20;
  summary.review = !enough ? "Collecting evidence" : btcFilter.regimes.bullish.net > 0 &&
    btcFilter.netReturn > 0 && btcFilter.netReturn > baseline.netReturn &&
    btcFilter.drawdown <= baseline.drawdown ? "Candidate for review" : "No improvement demonstrated";
  return summary;
}

export function nextIntradayExit(position) {
  return {eligibleAt: new Date(Date.parse(position.at) + cryptoIntradayRule.minHoldHours * 3600000).toISOString(),
    stop: position.price * (1 - cryptoIntradayRule.stop), target: position.price * (1 + cryptoIntradayRule.target)};
}
