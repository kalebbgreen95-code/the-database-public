import { createPrivateKey, sign } from "node:crypto";

export function createRobinhoodCryptoSource({apiKey,privateKey,accountLast4,fetcher=fetch}) {
  const origin = "https://trading.robinhood.com";
  return async () => {
    const key = createPrivateKey({key:Buffer.from(privateKey,"base64"),format:"der",type:"pkcs8"});
    const signal = AbortSignal.timeout(12000);
    async function get(path) {
      const url = new URL(path,origin);
      if (url.origin !== origin || !url.pathname.startsWith("/api/v1/crypto/")) throw Error("Invalid crypto URL");
      const timestamp = String(Math.floor(Date.now()/1000));
      const message = apiKey + timestamp + url.pathname + url.search + "GET";
      const signature = sign(null,Buffer.from(message),key).toString("base64");
      const response = await fetcher(url,{headers:{Accept:"application/json","x-api-key":apiKey,
        "x-timestamp":timestamp,"x-signature":signature},redirect:"error",signal});
      if (!response.ok) throw Error("Robinhood Crypto request failed");
      return response.json();
    }
    const account = await get("/api/v1/crypto/trading/accounts/");
    if (!account.account_number || account.account_number.slice(-4) !== accountLast4) throw Error("Unexpected crypto account");
    const rows = [];
    let page = "/api/v1/crypto/trading/holdings/";
    for (let i=0;page && i<20;i++) {
      const data = await get(page);
      if (data.results.some(row=>row.account_number !== account.account_number)) throw Error("Unexpected crypto holding account");
      rows.push(...data.results.filter(row=>Number(row.total_quantity)>0));
      page = data.next;
    }
    if (page) throw Error("Too many crypto holdings pages");
    if (!rows.length) return [];
    const query = new URLSearchParams(rows.map(row=>["symbol",row.asset_code+"-USD"]));
    const quotes = await get("/api/v1/crypto/marketdata/best_bid_ask/?"+query);
    const prices = new Map(quotes.results.map(quote=>[quote.symbol,quote]));
    return rows.map(row=>{
      const quote = prices.get(row.asset_code+"-USD");
      return {type:"crypto",symbol:row.asset_code+"/USD",quantity:Number(row.total_quantity),
        price:Number(quote?.price)>0 ? Number(quote.price) : null,quoteAt:quote?.timestamp??null};
    });
  };
}
