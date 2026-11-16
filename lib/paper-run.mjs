import { allocations, allocationSignal } from "./allocation.mjs";
import { cryptoExecutionQuote, intradayCryptoExit, intradayCryptoSignal } from "./strategy.mjs";
import { stockPullbackSetup } from "./technicals.mjs";

const paper = "https://paper-api.alpaca.markets";
const market = "https://data.alpaca.markets";
const symbols = allocations.cryptoDaily.symbols;
const entryCap = 200;
const minimumEntry = 10;
const prefix = "database-paper-";
const interval = 300000;
const normalize = symbol=>symbol?.replace("/","");
const running = new Set();

export function cryptoEntryBudget(account,positions,crypto=true) {
  const equity = Number(account.equity);
  const exposure = positions.reduce((sum,position)=>sum+Math.abs(Number(position.market_value)),0);
  const limit = Math.min(entryCap, equity*(crypto ? .015 : .01), equity*.05-exposure, Number(account.cash),
    Number(account.buying_power),crypto ? Number(account.non_marginable_buying_power ?? account.cash) : Infinity);
  return Number.isFinite(limit) && limit >= minimumEntry ? Math.floor(limit) : 0;
}

export async function runPaperCrypto(keys,fetcher=fetch,now=Date.now,loadStockScan) {
  if (running.has(keys.keyId)) return {message:"A paper bot run is already in progress."};
  running.add(keys.keyId);
  try { return await evaluate(keys,fetcher,now,loadStockScan); }
  finally { running.delete(keys.keyId); }
}

function ownedEntry(holding,recent,digital) {
  const fills = recent.filter(item=>normalize(item.symbol)===normalize(holding.symbol) && Number(item.filled_qty)>0);
  const index = fills.findIndex(item=>item.side==="buy");
  const entry = fills[index];
  if (!entry?.client_order_id?.startsWith(prefix) || !(Number(entry.filled_avg_price)>0) ||
      !Number.isFinite(Date.parse(entry.filled_at))) return null;
  const exits = fills.slice(0,index);
  if (exits.some(item=>item.side!=="sell" || !item.client_order_id?.startsWith(prefix))) return null;
  const bought = Number(entry.filled_qty);
  const remaining = bought - exits.reduce((sum,item)=>sum+Number(item.filled_qty),0);
  const qty = Number(holding.qty);
  const tolerance = digital ? bought*.003 : 1e-8;
  return qty > 0 && qty <= remaining+1e-8 && qty >= remaining-tolerance &&
    Number(holding.qty_available) >= qty ? entry : null;
}

function coolingDown(recent,symbol,at) {
  const fills = recent.filter(row=>normalize(row.symbol)===normalize(symbol) && Number(row.filled_qty)>0);
  const last = fills[0];
  if (last?.side!=="sell" || !last.client_order_id?.startsWith(prefix)) return false;
  const entry = fills.find(row=>row.side==="buy");
  const gain = Number(last.filled_avg_price) > Number(entry?.filled_avg_price);
  return at-Date.parse(last.filled_at) < (gain ? 15 : 60)*60000;
}

async function stockSignals(get,positions,loadStockScan,started) {
  const clock = await get(paper,"/v2/clock");
  if (clock.is_open !== true) return [];
  const scan = await loadStockScan?.().catch(()=>null);
  const fresh = scan && started-Date.parse(scan.checkedAt) <= 30*60000 &&
    Date.parse(scan.checkedAt) <= started;
  const checks = new Map((fresh ? scan.rows : []).map(row=>[row.symbol,
    row.trailing>0 && row.trailing<30 && row.checks[0]?.[1]===true &&
    row.checks.slice(0,4).filter(check=>check[1]===true).length>=2]));
  const picks = new Set([...allocations.stockMonthly.symbols,
    ...[...checks].filter(([,qualifies])=>qualifies).map(([symbol])=>symbol)]);
  const held = positions.filter(row=>row.asset_class==="us_equity" && /^[A-Z0-9.-]+$/.test(row.symbol));
  const tickers = [...new Set([...picks,...held.map(row=>row.symbol)])];
  const [candles,quotes] = await Promise.all([
    get(market,"/v2/stocks/bars",{symbols:tickers.join(","),timeframe:"1Min",
      start:new Date(started-46*60000).toISOString(),feed:"iex",limit:"5000"}),
    get(market,"/v2/stocks/quotes/latest",{symbols:tickers.join(","),feed:"iex"}),
  ]);
  if (candles.next_page_token) throw Error("Incomplete stock candles.");
  return tickers.map(symbol=>({symbol,eligible:picks.has(symbol),failedChecklist:checks.get(symbol)===false,
    candles:candles.bars?.[symbol]??[],
    quote:quotes.quotes?.[symbol]}));
}

async function evaluate(keys,fetcher,now,loadStockScan) {
  const started = now();
  const headers = {"APCA-API-KEY-ID":keys.keyId,"APCA-API-SECRET-KEY":keys.secret};
  async function request(origin,path,query,body) {
    const url = new URL(path,origin);
    if (query) url.search = new URLSearchParams(query);
    return fetcher(url,{method:body ? "POST" : "GET",redirect:"error",signal:AbortSignal.timeout(6800),
      headers:body ? {...headers,"Content-Type":"application/json"} : headers,body:body && JSON.stringify(body)});
  }
  async function get(origin,path,query) {
    const response = await request(origin,path,query);
    if (!response.ok) throw Error("Alpaca paper run data unavailable.");
    return response.json();
  }
  const [account,positions,open] = await Promise.all([
    get(paper,"/v2/account"),get(paper,"/v2/positions"),get(paper,"/v2/orders",{status:"open",limit:"500"}),
  ]);
  if (account.status !== "ACTIVE" || account.trading_blocked !== false || account.account_blocked !== false) {
    return {message:"Alpaca Paper is blocking trading on this account."};
  }
  if (open.length) return {message:"An open paper order already exists."};
  const [candles,quotes,recent,daily,stocks] = await Promise.all([
    get(market,"/v1beta3/crypto/us/bars",{symbols:symbols.join(","),timeframe:"5Min",
      start:new Date(started-250*60000).toISOString(),limit:"400"}),
    get(market,"/v1beta3/crypto/us/latest/quotes",{symbols:symbols.join(",")}),
    get(paper,"/v2/orders",{status:"closed",limit:"500",direction:"desc"}),
    get(market,"/v1beta3/crypto/us/bars",{symbols:symbols.join(","),timeframe:"1Day",
      start:new Date(started-32*86400000).toISOString(),limit:"300"}).catch(()=>null),
    stockSignals(get,positions,loadStockScan,started).catch(()=>[]),
  ]);
  if (candles.next_page_token) throw Error("Incomplete Alpaca candles.");
  const at = now();
  const bucket = Math.floor(started/interval);
  const suffix = "-" + bucket;
  if (Math.floor(at/interval) !== bucket || recent.some(order=>order.client_order_id===prefix+bucket ||
      (order.client_order_id?.startsWith(prefix) && Date.parse(order.submitted_at)>at-interval))) {
    return {message:"This five-minute window has already been checked for an order."};
  }
  const rows = symbols.map(symbol=>({symbol,
    signal:intradayCryptoSignal(candles.bars?.[symbol]??[],at),
    daily:daily && !daily.next_page_token ? allocationSignal("cryptoDaily",daily.bars?.[symbol]??[],at) : null,
    quote:cryptoExecutionQuote(quotes.quotes?.[symbol],at)}));
  const equities = stocks.map(row=>({...row,quote:cryptoExecutionQuote(row.quote,at),
    setup:stockPullbackSetup(row.candles,at)}));
  const holdings = new Map(positions.map(row=>[normalize(row.symbol),row]));
  let order,reason,strategy;
  for (const row of [...equities,...rows]) {
    const digital = row.symbol.includes("/");
    const holding = holdings.get(normalize(row.symbol));
    const entry = holding && row.quote && ownedEntry(holding,recent,digital);
    if (!entry) continue;
    const price = Number(entry.filled_avg_price);
    if (digital) {
      strategy = entry.client_order_id.startsWith(prefix+"daily-") ? "daily" : "intraday";
      reason = strategy==="daily" ? (row.daily?.action==="Cash" ? "Completed daily momentum moved to cash" : null)
        : intradayCryptoExit({price,at:entry.filled_at},row.quote.bid,row.signal,at);
    } else {
      strategy = "stock";
      reason = row.quote.bid<=price*.9 ? "10% paper stop threshold reached" :
        at-Date.parse(entry.filled_at)>=3600000
          ? (row.failedChecklist ? "Potential Buys checklist requirements no longer met" : row.setup?.exit) : null;
    }
    if (!reason) continue;
    order = {symbol:row.symbol,side:"sell",qty:holding.qty};
    break;
  }
  if (!order && positions.length < 6) {
    const eligible = row=>row.quote && !holdings.has(normalize(row.symbol));
    const crypto = rows.filter(row=>eligible(row) && !coolingDown(recent,row.symbol,at));
    const intraday = crypto.filter(row=>row.signal?.action==="Buy" && row.quote.spread<=.006)
      .sort((a,b)=>(b.signal.evidence?.length??0)-(a.signal.evidence?.length??0) || b.signal.score-a.signal.score);
    const intradaySymbols = new Set(intraday.map(row=>row.symbol));
    const dailyBuys = crypto.filter(row=>!intradaySymbols.has(row.symbol) && row.daily?.action==="Buy")
      .sort((a,b)=>b.daily.score-a.daily.score);
    const entries = [
      ...equities.filter(row=>eligible(row) && row.eligible && row.setup?.entry)
        .map(row=>({row,strategy:"stock",reason:row.setup.entry})),
      ...intraday.map(row=>({row,strategy:"intraday",reason:"Intraday momentum · "+row.signal.evidence.join(" · ")})),
      ...dailyBuys.map(row=>({row,strategy:"daily",reason:"Completed UTC 28-day momentum · "+row.daily.asOf})),
    ];
    for (const entry of entries) {
      const {symbol,quote} = entry.row;
      const digital = symbol.includes("/");
      const stake = cryptoEntryBudget(account,positions,digital);
      if (!stake) continue;
      const asset = await get(paper,"/v2/assets/"+encodeURIComponent(normalize(symbol))).catch(()=>null);
      if (asset?.status!=="active" || !asset.tradable || !asset.fractionable ||
          (digital && stake<Number(asset.min_order_size??0)*quote.ask*1.05)) continue;
      order = {symbol,side:"buy",notional:String(stake)};
      strategy = entry.strategy;
      reason = entry.reason + " · $" + stake + " within cash and exposure limits";
      break;
    }
  }
  if (!order || Math.floor(now()/interval)!==bucket) return {message:"No qualifying paper order on this run."};
  const clientOrderId = prefix + strategy + suffix;
  const response = await request(paper,"/v2/orders",null,{...order,type:"market",
    time_in_force:order.symbol.includes("/") ? "gtc" : "day",client_order_id:clientOrderId})
    .catch(()=>null);
  if (response?.ok) {
    const accepted = await response.json();
    return {submitted:true,message:reason + " · Alpaca Paper " + order.side + " " + order.symbol + " · " + accepted.status};
  }
  const existing = await request(paper,"/v2/orders:by_client_order_id",{client_order_id:clientOrderId}).catch(()=>null);
  if (existing?.ok) {
    const accepted = await existing.json();
    return {message:"Alpaca Paper already recorded " + accepted.side + " " + accepted.symbol + " · " + accepted.status};
  }
  if (!response) throw Error("Order status unconfirmed. Check Alpaca Paper activity before retrying.");
  throw Error("Alpaca Paper declined the order. Check Alpaca Paper activity.");
}
