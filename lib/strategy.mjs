import { relativeStrength } from "./technicals.mjs";

const avg = values => values.reduce((sum, x) => sum + x, 0) / values.length;

const fiveMinutes = 5 * 60000;
export const cryptoIntradayRule = {
  label: "Intraday crypto momentum", asset: "Crypto", stop: .10, target: .20, minHoldHours: 24,
};

export function cryptoExecutionQuote(quote, now) {
  const time = Date.parse(quote?.t);
  const bid = quote?.bp;
  const ask = quote?.ap;
  if (!Number.isFinite(time) || now - time >= 90000 || time > now + 5000 ||
      !Number.isFinite(bid) || bid <= 0 || !Number.isFinite(ask) || ask < bid) return null;
  return { bid, ask, time, spread: ask / bid - 1 };
}

export function intradayCryptoSignal(bars, now, context = {}) {
  // Allow the provider a few seconds to publish the just-closed candle.
  const lastStart = Math.floor((now - 5000) / fiveMinutes) * fiveMinutes - fiveMinutes;
  const completed = bars.filter(bar => Date.parse(bar.t) <= lastStart).slice(-48);
  const recent = completed.slice(-7);
  if (recent.length !== 7 || recent.some((bar, index) =>
    Date.parse(bar.t) !== lastStart - (6 - index) * fiveMinutes || !(bar.c > 0) || !Number.isFinite(bar.c))) return null;
  const last = recent.at(-1);
  const score = last.c / recent[0].c - 1;
  const shortMean = avg(recent.slice(-4, -1).map(bar => bar.c));
  const previous = recent.slice(0, -1);
  const reversal = score <= 0 && last.c < shortMean;
  const priorAnchor = completed.at(-8);
  const priorClose = previous.at(-1).c;
  const reversalConfirmed = reversal && priorAnchor?.c > 0 && Number.isFinite(priorAnchor.c) &&
    Date.parse(priorAnchor.t) === lastStart - 7 * fiveMinutes &&
    priorClose <= priorAnchor.c && priorClose < avg(previous.slice(-4, -1).map(bar => bar.c));
  const volumeMean = previous.every(bar => Number.isFinite(bar.v) && bar.v >= 0) ? avg(previous.map(bar => bar.v)) : 0;
  const relativeVolume = volumeMean > 0 && Number.isFinite(last.v) && last.v >= 0 ? last.v / volumeMean : null;
  const prior = recent.at(-2);
  const rising = last.c > prior.c && last.c > shortMean;
  const momentum = score >= .0015 && last.c > shortMean;
  const bullishCandle = prior.c < prior.o && last.c > last.o &&
    last.o <= prior.c && last.c >= prior.o;
  const directional = recent.slice(-5);
  const volumeKnown = directional.every(bar =>
    Number.isFinite(bar.o) && Number.isFinite(bar.v) && bar.v >= 0);
  const upVolume = directional.filter(bar => bar.c > bar.o).reduce((sum, bar) => sum + bar.v, 0);
  const downVolume = directional.filter(bar => bar.c < bar.o).reduce((sum, bar) => sum + bar.v, 0);
  const volumeSupports = volumeKnown && upVolume > downVolume && relativeVolume >= 1.2 && last.c > last.o;
  const closes = completed.slice(-28).map(bar => bar.c);
  const rsiReady = closes.length === 28 && completed.slice(-28).every((bar, i) =>
    Date.parse(bar.t) === lastStart - (27 - i) * fiveMinutes && Number.isFinite(bar.c) && bar.c > 0);
  const priorRsi = rsiReady ? relativeStrength(closes.slice(0, -1)) : null;
  const rsi = rsiReady ? relativeStrength(closes) : null;
  const improvingRsi = priorRsi != null && priorRsi < 50 && rsi >= 30 && rsi >= priorRsi + 2;
  const confirmations = [
    [momentum, "30-minute momentum"],
    [bullishCandle, "bullish engulfing candle"],
    [volumeSupports, "up-candle volume dominates with elevated activity"],
    [improvingRsi, "5-minute RSI improving to " + rsi?.toFixed(1)],
    [context.crossedAbove, "completed daily close crossed above its 200-day EMA"],
    [context.btcRising, "BTC 30-minute trend rising"],
    [context.catalyst, context.catalyst ? "Recent catalyst · " + context.catalyst : ""],
  ].filter(([confirmed]) => confirmed).map(([, reason]) => reason);
  const localRecovery = momentum || bullishCandle || volumeSupports || improvingRsi || context.crossedAbove;
  return {
    action: rising && localRecovery ? "Buy" : reversal ? "Sell" : "Hold",
    evidence: confirmations,
    score, close: last.c, shortMean, relativeVolume, reversalConfirmed,
    asOf: new Date(lastStart + fiveMinutes).toISOString(),
  };
}

export const strategies = {
  momentum: { horizon: "Short term", frame: "minute", fast: 10, slow: 35, lookback: 10, stop: .015, target: .03, days: 2 },
  trend: { horizon: "Long term", frame: "day", fast: 20, slow: 60, lookback: 20, stop: .07, target: .15, days: 90 },
};

export function signal(strategy, bars, price) {
  const { fast, slow, lookback } = strategy;
  const closes = bars.slice(-slow).map(bar => bar.c);
  if (closes.length < slow || !Number.isFinite(price) || price <= 0) return null;
  const short = avg(closes.slice(-fast));
  const long = avg(closes);
  const change = price / closes.at(-lookback) - 1;
  const score = (short / long - 1) + change;
  const action = price > short && short > long && change > 0 ? "Buy"
    : price < long || (short < long && change < 0) ? "Sell" : "Hold";
  return { action, score, price, entry: price, stop: price * (1 - strategy.stop), target: price * (1 + strategy.target) };
}

export function exitReason(strategy, entry, price, action, now) {
  if (price <= entry.price * (1 - strategy.stop)) return "Stop threshold";
  if (price >= entry.price * (1 + strategy.target)) return "Profit target";
  if (now - Date.parse(entry.at) >= strategy.days * 86400000) return "Holding limit";
  if (action === "Sell") return "Trend reversal";
  return null;
}

export function intradayCryptoExit(entry, price, setup, now) {
  const { stop, target, minHoldHours } = cryptoIntradayRule;
  if (price <= entry.price * (1 - stop)) return "Stop threshold";
  if (price >= entry.price * (1 + target)) return "Profit target";
  const waited = now - Date.parse(entry.at) >= minHoldHours * 3600000;
  return waited && setup?.reversalConfirmed ? "Trend reversal" : null;
}

export function performance(trades) {
  let equity = 1, peak = 1, drawdown = 0, wins = 0;
  for (const trade of trades) {
    if (trade.net > 0) wins++;
    equity *= 1 + trade.net;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, 1 - equity / peak);
  }
  return { count: trades.length, winRate: trades.length ? wins / trades.length : null, return: equity - 1, drawdown };
}

// Compare each strategy within its asset class. Shrink small samples toward zero.
export function weight(trades) {
  if (trades.length < 5) return 1;
  const result = performance(trades);
  const adjustment = (result.return - 1.5 * result.drawdown) * trades.length / (trades.length + 20);
  return Math.max(.5, Math.min(1.5, 1 + adjustment));
}
