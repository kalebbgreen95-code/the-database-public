import { createHmac } from "node:crypto";

const securityKinds = new Set(["stock","preferred_stock","adr","etf","mutualfund","cef"]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function createSnapTradeSource({clientId,consumerKey,accountLast4,fetcher = fetch}) {
  async function get(resource,signal) {
    const path = "/api/v1" + resource;
    const query = new URLSearchParams({clientId,timestamp:String(Math.floor(Date.now()/1000))}).toString();
    const signature = createHmac("sha256",consumerKey)
      .update(JSON.stringify({content:null,path,query})).digest("base64");
    const response = await fetcher(`https://api.snaptrade.com${path}?${query}`,{
      headers:{Accept:"application/json",Signature:signature},redirect:"error",signal,
    });
    if (!response.ok) throw Error("SnapTrade request failed");
    return response.json();
  }

  return async () => {
    if (!/^[a-z0-9]{4}$/i.test(accountLast4)) throw Error("Missing Robinhood account suffix");
    const signal = AbortSignal.timeout(12000);
    const [accounts,connections] = await Promise.all([get("/accounts/all",signal),get("/authorizations",signal)]);
    const robinhood = new Set(connections.filter(connection => !connection.disabled &&
      connection.brokerage?.slug === "ROBINHOOD").map(connection => connection.id));
    const matching = accounts.results.filter(account => robinhood.has(account.connection_id) && account.kind === "investment" &&
      !account.is_paper && (!account.status || account.status === "open") &&
      account.masked_account_number?.slice(-4).toUpperCase() === accountLast4.toUpperCase());
    if (matching.length !== 1 || !uuid.test(matching[0].id)) throw Error("Robinhood account could not be resolved");
    const path = "/accounts/" + matching[0].id;
    const [holdings,account] = await Promise.all([get(path+"/positions/all",signal),get(path+"/details",signal)]);
    const asOf = holdings.data_freshness?.as_of;
    const positions = holdings.results.flatMap(row => {
      const {kind,symbol,raw_symbol} = row.instrument;
      const crypto = kind === "crypto";
      if ((!crypto && !securityKinds.has(kind)) || row.cash_equivalent ||
          (row.currency && row.currency !== "USD") || !Number(row.units)) return [];
      const ticker = (raw_symbol || symbol).toUpperCase();
      return [{
        type:crypto ? "crypto" : "stock",
        symbol:crypto ? ticker.replace(/[-/]USD$/,"") + "/USD" : ticker,
        quantity:Number(row.units),
        averageCost:positiveNumber(row.cost_basis),
        price:positiveNumber(row.price),
      }];
    });
    return {asOf,positions,accountValue:account.net_value?.currency === "USD" ? account.net_value.amount : null};
  };
}
