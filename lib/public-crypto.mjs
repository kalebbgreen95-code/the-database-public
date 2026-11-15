import { allocationSignal } from "./allocation.mjs";

const names = {BTC:"Bitcoin",ETH:"Ethereum",SOL:"Solana",XRP:"XRP",LINK:"Chainlink",LTC:"Litecoin"};
const day = 86400000;

export async function refreshPublicCrypto(now=new Date(),fetcher=fetch) {
  const midnight = Math.floor(+now/day)*day;
  const results = await Promise.allSettled(Object.entries(names).map(async([symbol,name])=>{
    const url = new URL("https://api.exchange.coinbase.com/products/"+symbol+"-USD/candles");
    url.search = new URLSearchParams({granularity:"86400",start:new Date(midnight-31*day).toISOString(),end:now.toISOString()});
    const response = await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(6500)});
    if (!response.ok) throw Error("Crypto candles unavailable");
    const candles = await response.json();
    if (!Array.isArray(candles)) throw Error("Invalid crypto candles");
    const closes = new Map(candles.filter(row=>Array.isArray(row) && Number.isFinite(row[0]) &&
      Number.isFinite(row[4]) && row[4]>0 && row[0]*1000<=midnight).map(row=>[row[0]*1000,row[4]]));
    const latest = closes.has(midnight) ? midnight : midnight-day;
    const price = closes.get(latest);
    if (!price) throw Error("No recent crypto candles");
    const changes = Object.fromEntries([["1D",1],["1W",7],["1M",30]].map(([period,days])=>{
      const prior = closes.get(latest-days*day);
      return [period,prior ? {percent:price/prior-1,dollars:price-prior} : null];
    }));
    const bars = [...closes].sort(([a],[b])=>a-b).map(([at,c])=>({t:new Date(at).toISOString(),c}));
    return {symbol,name,price,changes,signal:allocationSignal("cryptoDaily",bars,+now)};
  }));
  const coins = results.filter(row=>row.status==="fulfilled").map(row=>row.value);
  return {coins,checkedAt:now.toISOString(),source:"Coinbase Exchange daily candles",partial:coins.length!==results.length};
}
