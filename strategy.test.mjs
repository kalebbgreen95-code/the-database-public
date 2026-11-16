import test from "node:test";
import assert from "node:assert/strict";
import { allocationSignal } from "./lib/allocation.mjs";
import { cryptoEntryBudget } from "./lib/paper-run.mjs";
import { strategies, signal, exitReason, performance, weight, intradayCryptoSignal, cryptoExecutionQuote, intradayCryptoExit } from "./lib/strategy.mjs";

test("intraday crypto waits through early weakness and requires two completed reversal candles", () => {
  const start = Date.parse("2026-01-02T00:00:00Z");
  const step = 5 * 60000;
  const bars = [100, 100, 100, 100, 100, 101, 99, 98].map((c, i) => ({
    t: new Date(start + i * step).toISOString(), c,
  }));
  const now = start + 8 * step + 10000;
  const single = intradayCryptoSignal(bars, now - step);
  const confirmed = intradayCryptoSignal(bars, now);
  assert.equal(single.action, "Sell");
  assert.equal(single.reversalConfirmed, false);
  assert.equal(confirmed.reversalConfirmed, true);
  const recent = {price: 100, at: new Date(now - 10 * 60000).toISOString()};
  const older = {price: 100, at: new Date(now - 86400000).toISOString()};
  assert.equal(intradayCryptoExit(recent, 99.6, confirmed, now), null);
  assert.equal(intradayCryptoExit(older, 99.6, single, now), null);
  assert.equal(intradayCryptoExit(older, 99.6, confirmed, now), "Trend reversal");
  assert.equal(intradayCryptoExit(recent, 90, confirmed, now), "Stop threshold");
  assert.equal(intradayCryptoExit(recent, 120, null, now), "Profit target");
  assert.equal(intradayCryptoExit(older, 99.6, confirmed, now - 1), null);
  assert.equal(intradayCryptoExit(recent, 90.01, confirmed, now), null);
  assert.equal(intradayCryptoExit(recent, 119.99, null, now), null);
  assert.equal(intradayCryptoExit(older, 99.6, null, now), null);
});

test("paper crypto execution requires fresh positive and uncrossed bid and ask quotes", () => {
  const t = "2026-01-02T00:00:00Z";
  const now = Date.parse(t) + 1000;
  const quote = {t, bp:100, ap:100.2};
  assert.ok(Math.abs(cryptoExecutionQuote(quote, now).spread - .002) < 1e-10);
  assert.equal(cryptoExecutionQuote(quote, now + 90000), null);
  assert.equal(cryptoExecutionQuote({...quote, ap:99}, now), null);
  assert.equal(cryptoExecutionQuote({...quote, bp:0}, now), null);
});

test("intraday crypto uses consecutive completed candles and ignores a live candle", () => {
  const start = Date.parse("2026-01-02T00:00:00Z");
  const step = 5 * 60000;
  const bars = Array.from({ length: 8 }, (_, i) => ({t:new Date(start + i * step).toISOString(), c:100 + i / 10, v:10}));
  const now = start + 7 * step + 10000;
  bars[7].c = 20;
  assert.equal(intradayCryptoSignal(bars, now).action, "Buy");
  assert.equal(intradayCryptoSignal(bars, now).relativeVolume, 1);
  assert.equal(intradayCryptoSignal(bars.filter((_, i) => i !== 4), now), null);
  assert.equal(intradayCryptoSignal(bars, now + 2 * step), null);
});

test("signals wait for sufficient history and distinguish rising and falling markets", () => {
  const rising = Array.from({ length: 40 }, (_, i) => ({ c: 100 + i }));
  assert.equal(signal(strategies.momentum, rising.slice(0, 20), 140), null);
  assert.equal(signal(strategies.momentum, rising, 140).action, "Buy");
  assert.equal(signal(strategies.momentum, [...rising].reverse(), 99).action, "Sell");
});

test("exit triggers reference the fill and enforce the holding limit", () => {
  const now = Date.now();
  const entry = { price: 100, at: new Date(now - 3 * 86400000).toISOString() };
  assert.equal(exitReason(strategies.momentum, entry, 98, "Hold", now), "Stop threshold");
  assert.equal(exitReason(strategies.momentum, entry, 104, "Hold", now), "Profit target");
  assert.equal(exitReason(strategies.momentum, entry, 101, "Hold", now), "Holding limit");
  assert.equal(exitReason(strategies.trend, entry, 101, "Sell", now), "Trend reversal");
});

test("losses and drawdown reduce allocation only after a minimum sample", () => {
  const losses = Array.from({ length: 5 }, () => ({ net: -.01 }));
  assert.equal(weight(losses.slice(0, 4)), 1);
  assert.ok(weight(losses) < 1);
  assert.equal(performance(losses).winRate, 0);
  assert.ok(performance(losses).drawdown > .04);
});

test("daily crypto momentum ignores the incomplete UTC candle and requires matched dates", () => {
  const now = Date.parse("2026-11-15T00:01:00Z");
  const completed = {t:"2026-11-14T00:00:00Z", c:110};
  const reference = {t:"2026-10-17T00:00:00Z", c:100};
  const partial = {t:"2026-11-15T00:00:00Z", c:75};
  const signal = allocationSignal("cryptoDaily", [reference, completed, partial], now);
  assert.equal(signal.action, "Buy");
  assert.equal(signal.asOf, "2026-11-14");
  assert.equal(signal.referenceDate, "2026-10-17");
  assert.equal(allocationSignal("cryptoDaily", [reference, partial], now), null);
});

test("recovery can enter below the old momentum cutoff, and catalysts need local price evidence", () => {
  const start = Date.parse("2026-01-02T00:00:00Z");
  const step = 5 * 60000;
  const now = start + 7 * step + 10000;
  const bars = Array.from({length: 7}, (_, i) => ({
    t: new Date(start + i * step).toISOString(), o: 100, c: 100, v: 10,
  }));
  const context = {btcRising: true, catalyst: "Bitcoin ETF approved"};
  assert.equal(intradayCryptoSignal(bars, now, context).action, "Hold");
  Object.assign(bars[5], {o: 100, c: 99.9});
  Object.assign(bars[6], {o: 99.9, c: 100.1, v: 20});
  const setup = intradayCryptoSignal(bars, now, context);
  assert.equal(setup.action, "Buy");
  assert.ok(setup.score < .0015);
  assert.ok(setup.evidence.includes("bullish engulfing candle"));
  assert.ok(setup.evidence.includes("up-candle volume dominates with elevated activity"));
  assert.ok(setup.evidence.includes("BTC 30-minute trend rising"));
  assert.ok(setup.evidence.includes("Recent catalyst · Bitcoin ETF approved"));
});

test("paper crypto sizing scales with equity and respects exposure and available cash", () => {
  const account = {equity:"10000",cash:"10000",buying_power:"40000",non_marginable_buying_power:"10000"};
  assert.equal(cryptoEntryBudget(account,[]),150);
  assert.equal(cryptoEntryBudget(account,[],false),100);
  assert.equal(cryptoEntryBudget({...account,equity:"5000"},[]),75);
  assert.equal(cryptoEntryBudget(account,[{market_value:"475"}]),25);
  assert.equal(cryptoEntryBudget({...account,non_marginable_buying_power:"8"},[]),0);
  assert.equal(cryptoEntryBudget(account,[{market_value:"500"}]),0);
});
