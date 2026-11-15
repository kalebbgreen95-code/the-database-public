import { allocationSignal } from "./allocation.mjs";
import { intradayCryptoSignal, intradayCryptoExit } from "./strategy.mjs";
import { technicalAnalysis, recoverySignals, stockPullbackSetup } from "./technicals.mjs";
import { aiCompany, stockChecklist, rankChecklistRows } from "./stock-checklist.mjs";

export const assets = [
  ["NVDA", "NVIDIA", "Stock", 130], ["MSFT", "Microsoft", "Stock", 440],
  ["AMD", "AMD", "Stock", 145], ["SPY", "S&P 500 ETF", "ETF", 600],
  ["QQQ", "Nasdaq-100 ETF", "ETF", 520], ["IWM", "Russell 2000 ETF", "ETF", 220], ["DIA", "Dow Jones Industrial Average ETF", "ETF", 440], ["BTC/USD", "Bitcoin", "Crypto", 93000],
  ["ETH/USD", "Ether", "Crypto", 3100], ["SOL/USD", "Solana", "Crypto", 150],
  ["XRP/USD", "XRP", "Crypto", 2], ["LINK/USD", "Chainlink", "Crypto", 16],
  ["LTC/USD", "Litecoin", "Crypto", 100]
];
import { newShadowComparison, evaluateShadow, summarizeShadow } from "./paper-shadow.mjs";
const day = 86400000, minute = 60000;
const stamp = n => new Date(n).toISOString();
const cashRound = n => Math.round(n * 100) / 100;
const wave = (n, offset) => 1 + .035 * Math.sin((n + offset) / 4) + .07 * Math.sin((n + offset) / 18);
function bar(time, c, o, i) {
  return {t: stamp(time), c, o, h: Math.max(c,o)*1.002, l: Math.min(c,o)*.998, v: 50000 + i*2000};
}
function daily(base, index, date) {
  return Array.from({length: 540}, (_, i) => {
    const n = date - 540 + i;
    return bar(n * day, base * wave(n,index*9), base * wave(n-.4,index*9), i);
  });
}
function intraday(base, date, index, crypto) {
  const step = minute * (crypto ? 5 : 1);
  const cutoff = date * day + 20.5 * 3600000;
  const mid = base * wave(date,index*9);
  let previous = mid;
  const bars = Array.from({length: 48}, (_, i) => {
    const pulse = crypto ? .0012*(i-40)*Math.sin(date+index) :
      (-.027 * Math.exp(-((i-42)**2)/14)) + .0004*Math.sin(i+date);
    const c = mid * (1 + pulse);
    const row = bar(cutoff - (48-i)*step,c,previous,i);
    previous=c;
    return row;
  });
  return {bars, now: cutoff + 5500, price: bars.at(-1).c};
}
function checklist(index) {
  const fundamentals = {debtToEquity:.25 + index*.08, revenueGrowth:.25-index*.04, freeCashFlow:500e6,
    debtSource:"Synthetic scenario", revenueSource:"Synthetic scenario", cashSource:"Synthetic scenario"};
  const trailingPe = 24 + index;
  return {fundamentals, trailingPe, forwardPe:20+index, checks:stockChecklist(fundamentals,trailingPe,20+index)};
}

export function replay(now = Date.now()) {
  const today = Math.floor(now/day);
  const trades = [], positions = new Map(), moves = [];
  let cash = 5000;
  const shadow = newShadowComparison((today-30)*day);
  for (let date=today-30; date<today; date++) {
    const shadowRows = [];
    for (const [index,[symbol,,kind,base]] of assets.entries()) {
      const crypto = kind === "Crypto";
      if (!crypto && [0,6].includes(new Date(date*day).getUTCDay())) continue;
      const frame = intraday(base,date,index,crypto);
      const setup = crypto ? intradayCryptoSignal(frame.bars,frame.now) : stockPullbackSetup(frame.bars,frame.now);
      if (crypto) shadowRows.push({symbol, signals:{cryptoIntraday:setup}, execution:{bid:frame.price*.9995, ask:frame.price*1.0005, spread:.001}});
      const checks = kind === "Stock" ? checklist(index) : null;
      const eligible = !checks || (checks.trailingPe < 30 && checks.checks[0][1] && checks.checks.filter(c => c[1]).length >= 2);
      const held = positions.get(symbol);
      const exit = held && (crypto ? intradayCryptoExit(held,frame.price,setup,frame.now) :
        frame.price <= held.price*.8 ? "20% stop threshold" : setup?.exit ? "Trend reversal" : !eligible ? "Checklist requirements no longer met" : null);
      if (exit) {
        const proceeds = cashRound(held.quantity * frame.price);
        cash = cashRound(cash+proceeds);
        trades.push({symbol, side:"Sell", at: stamp(frame.now), price:frame.price, quantity:held.quantity, amount:proceeds, reason:setup?.exit && exit==="Trend reversal" ? setup.exit : exit});
        positions.delete(symbol);
      } else if (!held && eligible && cash >= 250 && (crypto ? setup?.action === "Buy" : setup?.entry)) {
        const entry = {symbol, at:stamp(frame.now), price:frame.price, quantity:250/frame.price};
        cash = cashRound(cash-250);
        positions.set(symbol,entry);
        trades.push({...entry, side:"Buy", amount:250, reason:crypto ? setup.evidence.join(" · ") : setup.entry});
      }
    }
    evaluateShadow(shadow, shadowRows, date*day+20.5*3600000+5500, .005);
    moves.push({cash, date:stamp(date*day).slice(0,10), equity:cashRound(cash + [...positions.values()].reduce((total,p) => {
      const i=assets.findIndex(a=>a[0]===p.symbol);
      return total+p.quantity*intraday(assets[i][3],date,i,assets[i][2]==="Crypto").price;
    },0))});
  }
  const rows = assets.map(([symbol,name,kind,base],i)=>{
    const bars=daily(base,i,today);
    return {symbol,name,kind,close:bars.at(-1).c,history:bars.map(b=>({date:b.t.slice(0,10),close:b.c,o:b.o,h:b.h,l:b.l,v:b.v})),
      technicals:technicalAnalysis(bars,stamp(today*day).slice(0,10),true),
      ...(kind === "Crypto" ? {recovery:recoverySignals(bars,stamp(today*day).slice(0,10)),momentum:allocationSignal("cryptoDaily",bars,now)} : {}),
      ...(kind === "Stock" ? {...checklist(i), ai:aiCompany(symbol)} : {})};
  });
  const ranked = rankChecklistRows(rows.filter(r=>r.kind==="Stock"));
  const marks = Object.fromEntries([...positions.values()].map(p => { const i=assets.findIndex(a=>a[0]===p.symbol); return [p.symbol,intraday(assets[i][3],today-1,i,assets[i][2]==="Crypto").price]; }));
  return {marks, shadowComparison:summarizeShadow(shadow), mode:"simulation", windowDays:30, cash, equity:moves.at(-1).equity, trades:trades.reverse(), positions:[...positions.values()], moves, assets:rows,
    ranked:ranked.map(row=>row.symbol)};
}
