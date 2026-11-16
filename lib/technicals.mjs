function ema(values, period) {
  if (values.length < period) return [];
  let average = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const result = [average];
  const weight = 2 / (period + 1);
  for (const value of values.slice(period)) {
    average += weight * (value - average);
    result.push(average);
  }
  return result;
}

export function relativeStrength(closes) {
  const period = 14;
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    gain = i <= period ? gain + up / period : (gain * (period - 1) + up) / period;
    loss = i <= period ? loss + down / period : (loss * (period - 1) + down) / period;
  }
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
}

function movingAverage(closes, index, period) {
  if (index + 1 < period) return null;
  const window = closes.slice(index + 1 - period, index + 1);
  return window.every(price => Number.isFinite(price) && price > 0)
    ? window.reduce((sum, price) => sum + price, 0) / period : null;
}

function averageTrueRange(bars) {
  const period = 14;
  let count = 0;
  let average = 0;
  for (let i = 1; i < bars.length; i++) {
    const { h: high, l: low } = bars[i];
    const previous = bars[i - 1].c;
    if (![high, low, previous].every(Number.isFinite) || low <= 0 || high < low || previous <= 0) {
      count = 0;
      average = 0;
      continue;
    }
    const range = Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous));
    count++;
    average += count <= period ? range / period : (range - average) / period;
  }
  return count >= period ? average : null;
}

export function recoverySignals(bars, today) {
  const completed = bars.filter(bar => bar.t.slice(0, 10) < today);
  const stats = technicalAnalysis(completed, today);
  if (!stats) return null;
  const latest = completed.at(-1);
  const prior = completed.at(-2);
  const closes = completed.map(bar => bar.c);
  const averages = closes.every(close => Number.isFinite(close) && close > 0) ? ema(closes, 200) : [];
  const ema200 = averages.at(-1) ?? null;
  const priorEma = averages.at(-2);
  const crossedAbove = priorEma != null && prior.c <= priorEma && latest.c > ema200;
  const bullishEngulfing = prior?.c < prior?.o && latest.c > latest.o &&
    latest.o <= prior.c && latest.c >= prior.o;
  const higherRange = [prior?.h, prior?.l, latest.h, latest.l].every(Number.isFinite) &&
    latest.h > prior.h && latest.l > prior.l;
  const recent = completed.slice(-5);
  const volumeAvailable = recent.length === 5 &&
    recent.every(bar => [bar.o, bar.c, bar.v].every(Number.isFinite) && bar.v >= 0);
  const directionalVolume = volumeAvailable ? recent.filter(bar => bar.c !== bar.o) : [];
  const totalVolume = directionalVolume.reduce((sum, bar) => sum + bar.v, 0);
  const upVolume = directionalVolume.filter(bar => bar.c > bar.o).reduce((sum, bar) => sum + bar.v, 0);
  return {
    date: stats.date, close: latest.c, ema200, crossedAbove, bullishEngulfing, higherRange,
    rsi: stats.rsi, previousRsi: stats.previousRsi, relativeVolume: stats.volume?.relative ?? null,
    upCandleVolumeShare: totalVolume > 0 ? upVolume / totalVolume : null,
  };
}

export function technicalAnalysis(bars, today, includeChart = false) {
  const completed = bars.filter(bar => bar.t.slice(0, 10) < today);
  const latest = completed.at(-1);
  if (!latest) return null;
  const closes = completed.map(bar => bar.c);
  const validCloses = closes.every(close => Number.isFinite(close) && close > 0);
  const rsi = validCloses ? relativeStrength(closes) : null;
  const fast = validCloses ? ema(closes, 12) : [];
  const slow = validCloses ? ema(closes, 26) : [];
  const macdValues = slow.map((value, i) => fast[i + 14] - value);
  const signals = ema(macdValues, 9);
  const signal = signals.at(-1);
  const line = macdValues.at(-1);
  const macd = signal == null ? null : {
    line, signal, histogram: line - signal,
    previousHistogram: signals.length > 1 ? macdValues.at(-2) - signals.at(-2) : null,
  };
  const baseline = completed.slice(-21, -1);
  const average = baseline.length === 20 && baseline.every(bar => Number.isFinite(bar.v) && bar.v >= 0)
    ? baseline.reduce((sum, bar) => sum + bar.v, 0) / 20 : null;
  const volume = Number.isFinite(latest.v) && latest.v >= 0
    ? { latest: latest.v, average, relative: average > 0 ? latest.v / average : null } : null;
  const lastIndex = closes.length - 1;
  const atr = averageTrueRange(completed);
  const trend = {
    close: latest.c,
    sma50: movingAverage(closes, lastIndex, 50),
    sma200: movingAverage(closes, lastIndex, 200),
  };
  const chart = includeChart ? completed.map((bar, index) => ({
    date: bar.t.slice(0, 10), close: bar.c, volume: bar.v,
    sma50: movingAverage(closes, index, 50), sma200: movingAverage(closes, index, 200),
  })) : undefined;
  return {
    date: latest.t.slice(0, 10), rsi, macd, volume, trend, atr,
    atrPercent: atr != null && latest.c > 0 ? atr / latest.c : null,
    previousRsi: validCloses ? relativeStrength(closes.slice(0, -1)) : null,
    chart,
  };
}

export function stockPullbackSetup(bars, now, adverseHeadline) {
  const minute = 60000;
  const cutoff = Math.floor(now / minute) * minute;
  const recent = bars.filter(bar => {
    const time = Date.parse(bar.t);
    return time >= cutoff - 45 * minute && time < cutoff && Number.isFinite(bar.c) && bar.c > 0;
  });
  const last = recent.at(-1);
  if (recent.length < 20 || cutoff - Date.parse(last.t) > 3 * minute) return null;

  const closes = recent.map(bar => bar.c);
  const rsi = relativeStrength(closes);
  const priorRsi = relativeStrength(closes.slice(0, -1));
  const windowRsi = closes.slice(-12).map((_, i) => relativeStrength(closes.slice(0, closes.length - 11 + i)))
    .filter(Number.isFinite);
  const prior = recent.at(-2);
  const third = recent.at(-3);
  const dip = 1 - Math.min(prior.c, third.c) / Math.max(...closes.slice(0, -3));
  const recovering = last.c > prior.c && prior.c > third.c;
  const bullishEngulfing = prior.c < prior.o && last.c > last.o && last.o <= prior.c && last.c >= prior.o;
  const bearishEngulfing = prior.c > prior.o && last.c < last.o && last.o >= prior.c && last.c <= prior.o;
  const bearishTrend = last.c < prior.c && prior.c < third.c;
  const volume = recent.slice(-5);
  const baseline = recent.slice(-20, -5);
  const volumeKnown = [...volume, ...baseline].every(bar => Number.isFinite(bar.o) &&
    Number.isFinite(bar.v) && bar.v >= 0);
  const directionalVolume = volumeKnown ? volume.filter(bar => bar.c !== bar.o) : [];
  const up = directionalVolume.filter(bar => bar.c > bar.o).reduce((sum, bar) => sum + bar.v, 0);
  const down = directionalVolume.filter(bar => bar.c < bar.o).reduce((sum, bar) => sum + bar.v, 0);
  const baselineVolume = baseline.reduce((sum, bar) => sum + bar.v, 0) / baseline.length;
  const elevatedVolume = volumeKnown && baselineVolume > 0 && up + down >= 5 * baselineVolume * 1.2;
  const buyerVolume = elevatedVolume && up >= (up + down) * .6 && last.c > last.o;
  const sellerVolume = elevatedVolume && down >= (up + down) * .6 && last.c < last.o;
  const oversold = Math.min(...windowRsi) <= 30 && rsi > priorRsi;
  const overbought = Math.max(...windowRsi) >= 70;
  const entry = (dip >= .01 || oversold) && last.c > prior.c && (recovering || bullishEngulfing || buyerVolume) && !adverseHeadline
    ? [dip >= .01 && (dip * 100).toFixed(1) + "% pullback", oversold && "RSI recovering from oversold",
      recovering && "rising completed closes", bullishEngulfing && "bullish engulfing candle",
      buyerVolume && "elevated up-candle volume"].filter(Boolean).join(" · ") : null;
  const fourth = recent.at(-4);
  const lowerTrend = bearishTrend && third.c < fourth.c && last.c < movingAverage(closes, closes.length - 1, 10);
  const exit = lowerTrend && (sellerVolume || ((overbought || adverseHeadline) && bearishEngulfing))
    ? [overbought && "recent RSI reached overbought", adverseHeadline && "adverse headline: " + adverseHeadline,
      bearishTrend && "falling completed closes", bearishEngulfing && "bearish engulfing candle",
      sellerVolume && "elevated down-candle volume"].filter(Boolean).join(" · ") : null;
  const recentHigh = Math.max(...closes);
  return { entry: exit ? null : entry, exit, ...(exit && { exitPullback: (recentHigh - last.c) / recentHigh }) };
}
