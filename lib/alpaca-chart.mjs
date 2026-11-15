export async function alpacaChart(fetcher, keys, symbol, crypto) {
  const url = new URL(crypto ? "/v1beta3/crypto/us/bars" : "/v2/stocks/" + encodeURIComponent(symbol) + "/bars","https://data.alpaca.markets");
  const day = 86400000;
  const end = Math.floor(Date.now() / day) * day;
  url.search = new URLSearchParams({timeframe:"1Day",limit:"730",end:new Date(end-1).toISOString(),
    start:new Date(end-690*day).toISOString()});
  if (crypto) url.searchParams.set("symbols",symbol);
  else {
    url.searchParams.set("feed","iex");
    url.searchParams.set("adjustment","split");
  }
  const response = await fetcher(url,{headers:{"APCA-API-KEY-ID":keys.keyId,"APCA-API-SECRET-KEY":keys.secret},
    redirect:"error",signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error("Alpaca history unavailable.");
  const data = await response.json();
  const raw = crypto ? data.bars?.[symbol] : data.bars;
  if (!Array.isArray(raw) || data.next_page_token) throw Error("Alpaca history incomplete.");
  const bars = raw.filter(bar=>Number.isFinite(Date.parse(bar.t)) && Number.isFinite(bar.c) && bar.c > 0)
    .sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
  const sum = [0];
  const rows = bars.map((bar,index)=>{
    sum.push(sum[index] + bar.c);
    const average = days=>index + 1 >= days ? (sum[index + 1] - sum[index + 1 - days]) / days : null;
    return {date:bar.t.slice(0,10),close:bar.c,volume:bar.v,sma50:average(50),sma200:average(200)};
  }).slice(-370);
  if (!rows.length) throw Error("Alpaca returned no usable bars.");
  return {source:crypto ? "Alpaca Crypto US" : "Alpaca IEX",rows};
}
