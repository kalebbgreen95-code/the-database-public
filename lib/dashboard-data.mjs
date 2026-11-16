import { compareHistoricalStrategies } from "./historical-strategies.mjs";
import { marketMoves } from "./market-moves.mjs";
import { nextIntradayExit } from "./paper-shadow.mjs";
import { performance } from "./strategy.mjs";
import { compareCryptoRecovery, compareMomentumUniverses } from "./crypto-recovery-research.mjs";
import { rankChecklistRows, withTrendCheck } from "./stock-checklist.mjs";

const source = "Simulated daily close";
const avg = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const markDate = row => row.history.at(-1).date;
const asBars = row => row.history.map(candle => ({...candle, t:candle.date+"T00:00:00.000Z", c:candle.close}));
const strategyFor = row => row.kind === "Crypto" ? "cryptoIntraday" : "stockChecklist";
const labelFor = {stockChecklist:"Stock and ETF pullback",cryptoIntraday:"Intraday crypto momentum"};
const summary = (key, trades) => {
  const subset = trades.filter(t=>t.strategy===key);
  return {key, strategy:labelFor[key], asset:key==="cryptoIntraday"?"Crypto":"Stocks and ETFs", entryEnabled:true,
    ...performance(subset), averageNet:avg(subset.map(t=>t.net)), averageWin:avg(subset.filter(t=>t.net>0).map(t=>t.net)),
    averageLoss:avg(subset.filter(t=>t.net<0).map(t=>t.net))};
};

export function dashboardData(demo, publicData, generated) {
  const today = generated.slice(0,10);
  const assets = demo.assets;
  const catalog = assets.map(({symbol,name,kind})=>({symbol,name,kind}));
  const owned = new Set(demo.positions.map(p=>p.symbol));
  const history = Object.fromEntries(assets.map(row=>[row.symbol,asBars(row)]));
  const market = assets.map(row=>({
    symbol:row.symbol, price:row.close, quoteSource:source, time:Date.parse(markDate(row)+"T23:59:59Z"),
    changes:marketMoves(history[row.symbol],row.close,markDate(row)).changes, recentCloses:row.history.slice(-20).map(b=>b.close),
    signals:{cryptoDaily:row.momentum}, owned:owned.has(row.symbol), watched:true, fresh:true,
  }));
  const quotes = new Map(market.map(row=>[row.symbol,row]));
  const news = publicData.news;
  const details = Object.fromEntries(assets.map(row=>{
    const quote = quotes.get(row.symbol);
    const signal = row.momentum;
    return [row.symbol,{price:row.close, time:quote.time, changes:quote.changes,
      priceSource:source, changeSource:"Synthetic scenario", technicals:row.technicals,
      volume:row.technicals.volume.latest, volumeDate:markDate(row), volumeSource:"Synthetic scenario",
      profile:{text:row.ai?.description??row.name, source:"Demo universe"},
      headlines:[], fund:row.kind==="ETF"?{}:undefined,
      fundamentals:row.fundamentals?{...row.fundamentals, cashDate:markDate(row), equityDate:markDate(row), revenueDate:markDate(row)}:undefined,
      forwardEstimate:row.forwardPe?{epsAvg:row.close/row.forwardPe, date:markDate(row), source:"Synthetic scenario"}:undefined,
      simulatedTrailingPe:row.trailingPe,
      setup:signal?[{label:"Daily momentum", evidence:signal.action+" on the "+signal.asOf+" close",
        invalidation:"The completed 28-day return changes sign."}]:[]}];
  }));
  const rows = rankChecklistRows(assets.filter(row=>row.kind==="Stock").map(row=>withTrendCheck({
    symbol:row.symbol, checks:row.checks, passes:row.checks.filter(check=>check[1]).length,
    trailing:row.trailingPe, forward:row.forwardPe, gaps:[], quote:quotes.get(row.symbol),
    year:quotes.get(row.symbol).changes?.["1Y"]?.percent, technicals:{...row.technicals, chart:undefined, source:"Synthetic scenario"},
    theme:row.ai?.theme, aiDescription:row.ai?.description,
  })));
  const checklist = {rows, checkedAt:generated, funds:assets.filter(row=>row.kind==="ETF").map(row=>({
    symbol:row.symbol, quote:quotes.get(row.symbol), year:quotes.get(row.symbol).changes?.["1Y"]?.percent, profile:row.name,
  }))};
  const ai = {rows:rows.filter(row=>row.theme), checkedAt:generated};
  const activity = {updatedAt:generated, orders:demo.trades.map(t=>({
    id:"demo-"+Date.parse(t.at)+"-"+t.symbol.replace("/","")+"-"+t.side.toLowerCase(), symbol:t.symbol, side:t.side.toLowerCase(), status:"filled", automated:true,
    price:t.price, gross:t.amount, quantity:t.quantity.toFixed(6), requested:t.side==="Buy"?t.amount:undefined,
    filledAt:t.at, reason:t.reason,
  }))};
  const entries = new Map();
  const trades = [];
  const intradayOutcomes = {};
  for (const fill of [...demo.trades].reverse()) {
    if (fill.side==="Buy") {entries.set(fill.symbol,fill);continue;}
    const entry=entries.get(fill.symbol);
    entries.delete(fill.symbol);
    const net = fill.amount/entry.amount-1;
    const strategy = strategyFor(assets.find(a=>a.symbol===fill.symbol));
    trades.push({symbol:fill.symbol, at:fill.at, net, strategy, reason:fill.reason, entryReason:entry.reason,
      pnl:fill.amount-entry.amount});
    if (strategy==="cryptoIntraday") {
      const row=intradayOutcomes[fill.reason]??={count:0,wins:0,netSum:0};
      row.count++;
      row.wins+=Number(net>0);
      row.netSum+=net;
    }
  }
  const active = Object.fromEntries(demo.positions.map(p=>[p.symbol,{...p, qty:p.quantity.toFixed(6),
    nextExit:p.symbol.includes("/")?nextIntradayExit(p):undefined, reason:entries.get(p.symbol)?.reason, strategy:strategyFor(assets.find(a=>a.symbol===p.symbol))}]));
  const portfolio = {asOf:generated, accountValue:demo.equity, positions:demo.positions.map(p=>({
    symbol:p.symbol, quantity:Number(p.quantity.toFixed(6)), averageCost:p.price,
    price:demo.marks[p.symbol],
  }))};
  const notifications = activity.orders.slice(0,20).map(order=>({
    id:"fill:"+order.id, target:"./?screen=activity&notice="+encodeURIComponent("fill:"+order.id),
    title:"Simulated fill · "+order.side.toUpperCase()+" "+order.symbol,
    created:order.filledAt, body:order.reason, order,
  }));
  const crypto = assets.filter(row=>row.kind==="Crypto");
  const cryptoResearch = compareCryptoRecovery(history,today);
  const cryptoUniverseResearch = compareMomentumUniverses(history,today,crypto.map(row=>row.symbol));
  const equityCurve = demo.moves.map(row=>({day:row.date, equity:row.equity,cash:row.cash}));
  const paperBenchmarks = ["SPY","BTC/USD"].map(symbol=>{
    const first=equityCurve[0], last=equityCurve.at(-1);
    const bars=history[symbol];
    const from=bars.find(b=>b.date===first.day), to=bars.find(b=>b.date===last.day);
    return {symbol,from:first.day,to:last.day,priceReturn:to.c/from.c-1,accountReturn:last.equity/first.equity-1};
  });
  const dashboard = {
    updatedAt:generated, treasury:publicData.treasury, publicSources:publicData.sources, activity, market, news, notifications,
    broker:{status:"Simulated fills · synthetic market", cash:demo.cash, equity:demo.equity},
    quoteErrors:[], criticalNewsCheck:{checkedAt:publicData.checkedAt,status:news.length?(publicData.sources.some(feed=>!feed.available)?"partial":"ok"):"unavailable"},
    sourceFreshness:{quotes:generated,history:generated,paperCheck:generated,fullCheck:generated},
    robinhoodPortfolio:portfolio, robinhood:{asOf:generated,positions:[],lists:[{items:catalog.map(a=>({symbol:a.symbol}))}]},
    cryptoMarket:{checkedAt:generated,coins:crypto.map(row=>({symbol:row.symbol.split("/")[0],
      name:row.name,price:row.close,changes:quotes.get(row.symbol).changes}))},
    cryptoRecovery:crypto.slice(0,2).map(row=>({symbol:row.symbol,stats:row.recovery,news:[]})),
    cryptoResearch:{...cryptoResearch, universes:cryptoUniverseResearch, unavailable:!cryptoResearch},

    paperBenchmarks, historicalResearch:compareHistoricalStrategies(history),
    paper:{enabled:true, shadowComparison:demo.shadowComparison, active, pending:[], trades:trades.slice().reverse(), equityCurve, intradayOutcomes,
      results:Object.keys(labelFor).map(key=>summary(key,trades)), closedCount:trades.length,
      realizedNetDollars:trades.reduce((total,row)=>total+row.pnl,0),
      latestCycle:{decisions:{stockChecklist:"Daily replay includes stock and ETF pullback checks."},
        crypto:crypto.map(row=>({symbol:row.symbol,intradayReason:"Reviewed in the simulated replay",
          reason:row.momentum?.action??"Unavailable",signalDate:row.momentum?.asOf}))}},
  };
  return {dashboard, details, catalog, ai, checklist};
}
