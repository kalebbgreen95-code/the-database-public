import { allocations } from "./allocation.mjs";
import { cryptoExecutionQuote, intradayCryptoExit, intradayCryptoSignal } from "./strategy.mjs";

const paper = "https://paper-api.alpaca.markets";
const market = "https://data.alpaca.markets";
const symbols = allocations.cryptoDaily.symbols;
const entryCap = 200;
const minimumEntry = 10;
const prefix = "database-paper-";
const interval = 300000;
const normalize = symbol=>symbol?.replace("/","");
const running = new Set();

export function cryptoEntryBudget(account,positions) {
  const equity = Number(account.equity);
  const exposure = positions.reduce((sum,position)=>sum+Math.abs(Number(position.market_value)),0);
  const limit = Math.min(entryCap, equity*.01, equity*.05-exposure, Number(account.cash),
    Number(account.buying_power),Number(account.non_marginable_buying_power ?? account.cash));
  return Number.isFinite(limit) && limit >= minimumEntry ? Math.floor(limit) : 0;
}

export async function runPaperCrypto(keys,fetcher=fetch,now=Date.now) {
  if (running.has(keys.keyId)) return {message:"A paper bot run is already in progress."};
  running.add(keys.keyId);
  try { return await evaluate(keys,fetcher,now); }
  finally { running.delete(keys.keyId); }
}

async function evaluate(keys,fetcher,now) {
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
  const tracked = positions.filter(row=>symbols.some(symbol=>normalize(symbol)===normalize(row.symbol)));
  if (tracked.length > 1) return {message:"Multiple tracked paper positions already exist."};
  const [candles,quotes,recent] = await Promise.all([
    get(market,"/v1beta3/crypto/us/bars",{symbols:symbols.join(","),timeframe:"5Min",
      start:new Date(started-250*60000).toISOString(),limit:"400"}),
    get(market,"/v1beta3/crypto/us/latest/quotes",{symbols:symbols.join(",")}),
    get(paper,"/v2/orders",{status:"closed",limit:"40",direction:"desc"}),
  ]);
  if (candles.next_page_token) throw Error("Incomplete Alpaca candles.");
  const at = now();
  const bucket = Math.floor(started/interval);
  const clientOrderId = prefix + bucket;
  if (Math.floor(at/interval) !== bucket || recent.some(order=>order.client_order_id===clientOrderId ||
      (order.client_order_id?.startsWith(prefix) && Date.parse(order.submitted_at)>at-interval))) {
    return {message:"This five-minute window has already been checked for an order."};
  }
  const rows = symbols.map(symbol=>({symbol,
    signal:intradayCryptoSignal(candles.bars?.[symbol]??[],at),
    quote:cryptoExecutionQuote(quotes.quotes?.[symbol],at)}));
  let order, reason;
  if (tracked.length) {
    const holding = tracked[0];
    const row = rows.find(item=>normalize(item.symbol)===normalize(holding.symbol));
    const fills = recent.filter(item=>normalize(item.symbol)===normalize(holding.symbol) && Number(item.filled_qty)>0);
    const entryIndex = fills.findIndex(item=>item.side==="buy");
    const last = fills[entryIndex];
    const exits = fills.slice(0,Math.max(0,entryIndex));
    const qty = Number(holding.qty);
    const bought = Number(last?.filled_qty);
    const remaining = bought - exits.reduce((sum,item)=>sum+Number(item.filled_qty),0);
    // Alpaca deducts the entry fee from the crypto received, up to 25 basis points.
    const adjustedQuantity = qty <= remaining + 1e-9 && qty >= remaining - bought*.0025 - 1e-9;
    if (last?.side !== "buy" || !last.client_order_id?.startsWith(prefix) || !(qty > 0) ||
        exits.some(item=>item.side!=="sell" || !item.client_order_id?.startsWith(prefix)) ||
        !adjustedQuantity ||
        !(Number(holding.qty_available) >= qty)) {
      return {message:"A tracked position already exists outside this bot’s order history."};
    }
    if (row.quote && Number(last.filled_avg_price)>0) {
      reason = intradayCryptoExit({price:Number(last.filled_avg_price),at:last.filled_at},row.quote.bid,row.signal,at);
      if (reason) order = {symbol:row.symbol,side:"sell",qty:holding.qty,limit_price:String(row.quote.bid)};
    }
  } else {
    const stake = cryptoEntryBudget(account,positions);
    const row = rows.filter(item=>item.signal?.action==="Buy" && item.quote && item.quote.spread <= .006)
      .sort((a,b)=>(b.signal.evidence?.length??0)-(a.signal.evidence?.length??0) || b.signal.score-a.signal.score)[0];
    if (row && stake) {
      reason = "Intraday crypto entry · $" + stake + " after cash, buying power and exposure limits";
      const qty = Math.floor(stake / row.quote.ask * 1e8) / 1e8;
      if (qty > 0) order = {symbol:row.symbol,side:"buy",qty:qty.toFixed(8),limit_price:String(row.quote.ask)};
    }
  }
  if (!order) return {message:"No qualifying crypto paper order on this run."};
  const response = await request(paper,"/v2/orders",null,{...order,type:"limit",time_in_force:"ioc",client_order_id:clientOrderId})
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
