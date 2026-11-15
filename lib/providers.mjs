export const treasurySource = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve";
const feeds = {
  treasury: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve",
  fed: "https://www.federalreserve.gov/feeds/press_all.xml",
};
const timeout = () => ({signal:AbortSignal.timeout(8000), redirect:"error"});
export function parseTreasury(xml) {
  const rows = [...xml.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)].map(([,block])=>{
    const get = key => block.match(new RegExp("<d:"+key+"(?: [^>]*)?>([^<]+)</d:"+key+">"))?.[1];
    const date=get("NEW_DATE")?.slice(0,10);
    return {date, rates:["BC_3MONTH","BC_2YEAR","BC_10YEAR","BC_30YEAR"].map(key=> Number(get(key)))};
  }).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? "") && row.rates.every(Number.isFinite));
  return rows.sort((a,b)=>b.date.localeCompare(a.date))[0] ?? null;
}
const plain = s => s.replace(/^<!\[CDATA\[|\]\]>$/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").trim();
export function parseFed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([,item]) => {
    const get = key => plain(item.match(new RegExp("<"+key+">([\\s\\S]*?)</"+key+">"))?.[1] ?? "");
    const path=get("link"), title=get("title"), date=Date.parse(get("pubDate"));
    if (!/^https:\/\/www\.federalreserve\.gov\/newsevents\/(?:pressreleases|speeches)\/[a-z0-9-]+\.htm$/i.test(path) ||
        !title || /[<>]/.test(title) || !Number.isFinite(date)) return [];
    return [{title:title.slice(0,240),url:path,date:new Date(date).toISOString().slice(0,10)}];
  }).slice(0,8);
}
export async function openData(now = new Date(), get = fetch) {
  const text = async url => {
    const response = await get(url,timeout());
    if (!response.ok) throw Error("Feed unavailable");
    return await response.text();
  };
  const ym = date => date.toISOString().slice(0,7).replace("-","");
  const previous = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));
  const rateData = async () => {
    for (const month of [ym(now),ym(previous)]) {
      try {
        const rates=parseTreasury(await text(feeds.treasury+"&field_tdr_date_value_month="+month));
        if (rates) return rates;
      } catch {}
    }
    return null;
  };
  const [treasury, headlines] = await Promise.all([rateData(),text(feeds.fed).then(parseFed).catch(()=>[])]);
  return {treasury,headlines};
}
