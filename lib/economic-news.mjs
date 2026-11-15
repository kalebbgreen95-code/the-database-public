import { openData } from "./providers.mjs";
export const economicFeeds = [
  {source:"Bureau of Labor Statistics",url:"https://www.bls.gov/feed/bls_latest.rss",hosts:["www.bls.gov"]},
  {source:"Bureau of Economic Analysis",url:"https://apps.bea.gov/rss/rss.xml",hosts:["www.bea.gov","apps.bea.gov"]},
  {source:"Census Bureau",url:"https://www.census.gov/economic-indicators/indicator.xml",hosts:["www.census.gov","www2.census.gov"]},
];
const secFeed = {
  source:"SEC filings",
  url:"https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&count=40&output=atom&owner=exclude",
};

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

export function parseSecFilings(xml) {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].flatMap(([,entry])=>{
    const headline = clean(entry.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const timestamp = Date.parse(entry.match(/<updated>([^<]+)<\/updated>/i)?.[1] ?? "");
    const link = entry.match(/<link\s[^>]*\bhref=["']([^"']+)["']/i)?.[1] ?? "";
    let url;
    try { url = new URL(clean(link)); } catch { return []; }
    if (!headline || !Number.isFinite(timestamp) || url.origin !== "https://www.sec.gov" ||
        url.username || url.password || !url.pathname.startsWith("/Archives/edgar/data/")) return [];
    return [{headline:headline.slice(0,240),url:url.href,timestamp,filingDate:new Date(timestamp).toISOString().slice(0,10),
      source:secFeed.source,governmentFeed:false,symbols:[]}];
  }).slice(0,12);
}

async function secFilings() {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent) return [];
  try {
    const response = await fetch(secFeed.url,{redirect:"error",signal:AbortSignal.timeout(6500),
      headers:{"User-Agent":userAgent}});
    return response.ok ? parseSecFilings(await response.text()) : [];
  } catch { return []; }
}

export async function publicFeedUpdate(now=new Date()) {
  const [{treasury,headlines},macro,filings] = await Promise.all([openData(now),economicNews(),secFilings()]);
  const news = [...headlines.map(row=>({headline:row.title,url:row.url,filingDate:row.date,
    timestamp:Date.parse(row.date),source:"Federal Reserve",governmentFeed:true,symbols:[]})),...macro.items,...filings]
    .sort((a,b)=>b.timestamp-a.timestamp);
  const sources = [{source:"Federal Reserve",available:headlines.length>0},
    {source:"U.S. Treasury",available:treasury!==null},...macro.sources,
    {source:secFeed.source,available:filings.length>0}];
  return {news,treasury,sources,checkedAt:new Date().toISOString()};
}
