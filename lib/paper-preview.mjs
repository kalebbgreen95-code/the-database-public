import { allocations } from "./allocation.mjs";
import { intradayCryptoSignal } from "./strategy.mjs";
import { stockPullbackSetup } from "./technicals.mjs";

const data = "https://data.alpaca.markets";
const paper = "https://paper-api.alpaca.markets";
const cryptoSymbols = allocations.cryptoDaily.symbols;
const etfs = allocations.stockMonthly.symbols;

export async function previewPaperSignals({keys,fetcher=fetch,now=Date.now}) {
  const auth = {"APCA-API-KEY-ID":keys.keyId,"APCA-API-SECRET-KEY":keys.secret};
  async function read(origin,path,params) {
    const url = new URL(path,origin);
    if (params) url.search = new URLSearchParams(params);
    const response = await fetcher(url,{headers:auth,redirect:"error",signal:AbortSignal.timeout(6500)});
    if (!response.ok) throw Error("Alpaca data unavailable.");
    return response.json();
  }
  async function bars(path,symbols,timeframe,lookback,extra={}) {
    const result = await read(data,path,{symbols:symbols.join(","),timeframe,
      start:new Date(now()-lookback*60000).toISOString(),limit:"400",...extra});
    if (result.next_page_token || !result.bars || typeof result.bars !== "object") throw Error("Incomplete candles.");
    return result.bars;
  }
  const crypto = async () => {
    const candles = await bars("/v1beta3/crypto/us/bars",cryptoSymbols,"5Min",250);
    const at = now();
    return cryptoSymbols.map(symbol => {
      const signal = intradayCryptoSignal(candles[symbol]??[],at);
      return {symbol,signal:signal?.action??"Unavailable",evidence:signal?.evidence??[],asOf:signal?.asOf??null};
    });
  };
  const stocks = async () => {
    const clock = await read(paper,"/v2/clock");
    if (clock.is_open === false) return {status:"Stock market closed",rows:[]};
    if (clock.is_open !== true) throw Error("Market status unavailable.");
    const candles = await bars("/v2/stocks/bars",etfs,"1Min",46,{feed:"iex"});
    const at = now();
    return {status:"Tracked ETF technical signals",rows:etfs.map(symbol => {
      const setup = stockPullbackSetup(candles[symbol]??[],at);
      return {symbol,signal:setup?.entry?"Entry setup":setup?.exit?"Exit setup":setup?"Hold":"Unavailable",
        evidence:[setup?.entry??setup?.exit].filter(Boolean)};
    })};
  };
  const [c,e] = await Promise.allSettled([crypto(),stocks()]);
  return {
    checkedAt:new Date(now()).toISOString(),
    crypto:c.status==="fulfilled"?{status:"Crypto momentum signals",rows:c.value}:{status:"Crypto feed unavailable",rows:[]},
    etfs:e.status==="fulfilled"?e.value:{status:"ETF feed unavailable",rows:[]},
  };
}