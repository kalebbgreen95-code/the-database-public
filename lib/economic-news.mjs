import { openData } from "./providers.mjs";
export const economicFeeds = [
  {source:"Bureau of Labor Statistics",url:"https://www.bls.gov/feed/bls_latest.rss",hosts:["www.bls.gov"]},
  {source:"Bureau of Economic Analysis",url:"https://apps.bea.gov/rss/rss.xml",hosts:["www.bea.gov","apps.bea.gov"]},
  {source:"Census Bureau",url:"https://www.census.gov/economic-indicators/indicator.xml",hosts:["www.census.gov","www2.census.gov"]},
  {source:"Government & economy news",url:"https://news.google.com/rss/search?" + new URLSearchParams({
    q:'(tariffs OR "war threat" OR "military escalation" OR inflation OR "fuel shortage" OR "oil supply" OR "government shutdown" OR "new law raises costs") when:1d',
    hl:"en-US",gl:"US",ceid:"US:en",
  }),hosts:["news.google.com"]},
];
const publisherFeeds = [
  {source:"CoinDesk",url:"https://www.coindesk.com/arc/outboundfeeds/rss/",hosts:["www.coindesk.com","coindesk.com","news.google.com"],
    fallback:"https://news.google.com/rss/search?q=site%3Acoindesk.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen"},
  {source:"Cointelegraph",url:"https://cointelegraph.com/rss",hosts:["cointelegraph.com","www.cointelegraph.com"]},
  {source:"Decrypt",url:"https://decrypt.co/feed",hosts:["decrypt.co","www.decrypt.co"]},
  {source:"The Block",url:"https://www.theblock.co/rss.xml",hosts:["www.theblock.co","theblock.co"]},
  {source:"Yahoo Finance",url:"https://news.google.com/rss/search?q=site%3Afinance.yahoo.com+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen",
    hosts:["news.google.com","finance.yahoo.com"]},
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
      filingDate:new Date(timestamp).toISOString().slice(0,10),source:feed.source,governmentFeed:feed.governmentFeed ?? true,symbols:[]}];
  }).slice(0,8);
}

export async function economicNews(fetcher = fetch) {
  const feeds = [...economicFeeds,...publisherFeeds.map(feed=>({...feed,governmentFeed:false}))];
  const results = await Promise.all(feeds.map(async feed => {
    for (const url of [feed.url,feed.fallback].filter(Boolean)) {
      try {
        const response = await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(4500)});
        const items = response.ok ? parseEconomicFeed(await response.text(),feed) : [];
        if (items.length) return {source:feed.source,available:true,items};
      } catch {}
    }
    return {source:feed.source,available:false,items:[]};
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

export function parseSecSearch(data) {
  const hits = data?.hits?.hits;
  if (!Array.isArray(hits)) return [];
  const filings = new Map();
  for (const {_source:row} of hits) {
    const accession = row?.adsh;
    const cik = row?.ciks?.[0];
    const form = row?.form;
    const filingDate = row?.file_date;
    const timestamp = Date.parse(filingDate + "T00:00:00Z");
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^\d{1,10}$/.test(cik) ||
        !/^(8-K|10-K|10-Q|6-K|20-F)$/.test(form) || !Number.isFinite(timestamp) || filings.has(accession)) continue;
    const name = clean(String(row.display_names?.[0] ?? "")).replace(/\s*\(CIK \d+\)$/,"");
    filings.set(accession,{
      headline:(form + " filing" + (name ? " · " + name : "")).slice(0,240),
      url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-","")}/${accession}-index.htm`,
      timestamp,filingDate,source:secFeed.source,governmentFeed:false,
      symbols:[...name.matchAll(/\(([A-Z][A-Z0-9.\-]{0,9})\)/g)].map(match=>match[1]),
    });
  }
  return [...filings.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,12);
}

async function secFilings(now) {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent) return [];
  const headers = {"User-Agent":userAgent};
  const date = time=>new Date(time).toISOString().slice(0,10);
  const search = new URL("https://efts.sec.gov/LATEST/search-index");
  search.search = new URLSearchParams({dateRange:"custom",startdt:date(+now-4*86400000),enddt:date(now),
    forms:"8-K,10-Q,10-K,6-K,20-F"});
  try {
    const response = await fetch(search,{redirect:"error",signal:AbortSignal.timeout(4300),headers});
    if (response.ok) {
      const filings = parseSecSearch(await response.json());
      if (filings.length) return filings;
    }
  } catch {}
  try {
    const response = await fetch(secFeed.url,{redirect:"error",signal:AbortSignal.timeout(4300),headers});
    return response.ok ? parseSecFilings(await response.text()) : [];
  } catch { return []; }
}

export async function directBenzinga(token, fetcher=fetch) {
  if (!token) return null;
  try {
    const url = new URL("https://api.benzinga.com/api/v2/news");
    url.search = new URLSearchParams({token,pageSize:"20",displayOutput:"headline"});
    const response = await fetcher(url,{headers:{Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(6500)});
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.flatMap(row=>{
      if (typeof row?.title!=="string") return [];
      const headline = clean(row.title);
      const timestamp = Date.parse(row.created);
      let article;
      try { article = new URL(row.url); } catch { return []; }
      if (!headline || !Number.isFinite(timestamp) || article.protocol!=="https:" ||
          !["benzinga.com","www.benzinga.com"].includes(article.hostname) || article.username || article.password) return [];
      return [{headline:headline.slice(0,240),url:article.href,timestamp,
        filingDate:new Date(timestamp).toISOString().slice(0,10),source:"Benzinga",symbols:[]}];
    }).slice(0,20);
  } catch { return []; }
}

export async function publicFeedUpdate(now=new Date()) {
  const [{treasury,headlines},macro,filings,benzinga] = await Promise.all([
    openData(now),economicNews(),secFilings(now),directBenzinga(process.env.BENZINGA_API_KEY?.trim()),
  ]);
  const news = [...headlines.map(row=>({headline:row.title,url:row.url,filingDate:row.date,
    timestamp:Date.parse(row.date),source:"Federal Reserve",governmentFeed:true,symbols:[]})),...macro.items,...filings,...(benzinga??[])]
    .sort((a,b)=>b.timestamp-a.timestamp);
  const sources = [{source:"Federal Reserve",available:headlines.length>0},
    {source:"U.S. Treasury",available:treasury!==null},...macro.sources,
    {source:secFeed.source,available:filings.length>0},
    ...(benzinga ? [{source:"Benzinga",available:benzinga.length>0}] : [])];
  return {news,treasury,sources,checkedAt:new Date().toISOString()};
}
