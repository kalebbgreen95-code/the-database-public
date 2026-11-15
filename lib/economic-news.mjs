import { openData } from "./providers.mjs";
export const economicFeeds = [
  {source:"Bureau of Labor Statistics",url:"https://www.bls.gov/feed/bls_latest.rss",hosts:["www.bls.gov"]},
  {source:"Bureau of Economic Analysis",url:"https://apps.bea.gov/rss/rss.xml",hosts:["www.bea.gov","apps.bea.gov"]},
  {source:"Census Bureau",url:"https://www.census.gov/economic-indicators/indicator.xml",hosts:["www.census.gov","www2.census.gov"]},
];

function clean(raw) {
  return raw.trim().replace(/^<!\[CDATA\[|\]\]>$/g,"")
    .replace(/<[^>]*>/g,"").replace(/&amp;|&quot;|&#39;|&apos;|&lt;|&gt;/g,
      entity=>({"&amp;":"&","&quot;":'"',"&#39;":"'","&apos;":"'","&lt;":"<","&gt;":">"})[entity])
    .replace(/\s+/g," ").trim();
}

export function parseEconomicFeed(xml, feed) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(([,item])=>{
    const get = name => clean(item.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"))?.[1] ?? "");
    const headline = get("title");
    const timestamp = Date.parse(get("pubDate") || get("dc:date"));
    let url;
    try { url = new URL(get("link"),feed.url); } catch { return []; }
    if (!headline || !get("link") || !Number.isFinite(timestamp) || url.protocol !== "https:" ||
        !feed.hosts.includes(url.hostname) || url.username || url.password) return [];
    return [{headline:headline.slice(0,240),url:url.href,timestamp,
      filingDate:new Date(timestamp).toISOString().slice(0,10),source:feed.source,governmentFeed:true,symbols:[]}];
  }).slice(0,8);
}

export async function economicNews(fetcher = fetch) {
  const results = await Promise.all(economicFeeds.map(async feed => {
    try {
      const response = await fetcher(feed.url,{redirect:"error",signal:AbortSignal.timeout(6500)});
      if (!response.ok) throw Error("Feed unavailable");
      const items = parseEconomicFeed(await response.text(),feed);
      return {source:feed.source,available:items.length>0,items};
    } catch { return {source:feed.source,available:false,items:[]}; }
  }));
  return {items:results.flatMap(result=>result.items),
    sources:results.map(({source,available})=>({source,available}))};
}
export async function publicFeedUpdate(now=new Date()) {
  const [{treasury,headlines},macro] = await Promise.all([openData(now),economicNews()]);
  const news = [...headlines.map(row=>({headline:row.title,url:row.url,filingDate:row.date,
    timestamp:Date.parse(row.date),source:"Federal Reserve",governmentFeed:true,symbols:[]})),...macro.items]
    .sort((a,b)=>b.timestamp-a.timestamp);
  const sources = [{source:"Federal Reserve",available:headlines.length>0},
    {source:"U.S. Treasury",available:treasury!==null},...macro.sources];
  return {news,treasury,sources,checkedAt:new Date().toISOString()};
}