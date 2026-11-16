import {createHash,timingSafeEqual} from "node:crypto";

const digest = value=>createHash("sha256").update(value).digest();
const ticker = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const number = value=>Number.isFinite(value) ? value : null;
const label = value=>typeof value === "string" ? value.slice(0,500) : undefined;

function scanSnapshot(scan) {
  const time = Date.parse(scan?.checkedAt);
  if (!Number.isFinite(time) || time > Date.now()+60000 || scan.pending ||
      !Array.isArray(scan.rows) || scan.rows.length > 25) throw Error("Invalid completed scan");
  const rows = scan.rows.map(row=>{
    if (!ticker.test(row?.symbol ?? "") || !Array.isArray(row.checks) || row.checks.length !== 5 ||
        row.checks.some(check=>!Array.isArray(check) || typeof check[0] !== "string" ||
          ![true,false,null].includes(check[1]))) throw Error("Invalid checklist row");
    const checks = row.checks.map(([name,result,measurement])=>[label(name),result,label(measurement) ?? ""]);
    const t = row.technicals;
    return {
      symbol:row.symbol,checks,passes:checks.filter(check=>check[1]===true).length,
      quote:{price:number(row.quote?.price),time:number(row.quote?.time)},
      trailing:number(row.trailing),forward:number(row.forward),year:number(row.year),
      gaps:Array.isArray(row.gaps) ? row.gaps.slice(0,6).map(label).filter(Boolean) : [],
      technicals:{atr:number(t?.atr),atrPercent:number(t?.atrPercent),date:label(t?.date),source:label(t?.source)},
      industry:label(row.industry),peerMedian:number(row.peerMedian),peerCount:number(row.peerCount),
      theme:label(row.theme),aiDescription:label(row.aiDescription),
    };
  });
  return {rows,checkedAt:new Date(time).toISOString(),failed:number(scan.failed),source:"Oracle stock scan"};
}

export function createOracleStockScans({projectUrl,serviceKey,token,fetcher=fetch}) {
  const table = new URL("/rest/v1/oracle_stock_scans",projectUrl);
  async function request(view, snapshot) {
    const url = new URL(table);
    url.searchParams.set("view_name","eq."+view);
    if (snapshot) url.searchParams.set("checked_at","lt."+snapshot.checkedAt);
    else url.searchParams.set("select","snapshot");
    const response = await fetcher(url,{
      method:snapshot ? "PATCH" : "GET",redirect:"error",signal:AbortSignal.timeout(4500),
      headers:{apikey:serviceKey,"Content-Type":"application/json"},
      body:snapshot ? JSON.stringify({checked_at:snapshot.checkedAt,snapshot}) : undefined,
    });
    if (!response.ok) throw Error("Oracle scan storage unavailable");
    if (!snapshot) return (await response.json())[0]?.snapshot ?? null;
  }
  return async ({view,method,credential,readJson})=>{
    if (!["stocks","ai"].includes(view)) return {status:400,data:{error:"Unknown scan"}};
    if (method === "POST") {
      if (!timingSafeEqual(digest(credential ?? ""),digest(token))) return {status:401,data:{}};
      let snapshot;
      try { snapshot = scanSnapshot(await readJson(65536)); }
      catch { return {status:400,data:{error:"Invalid completed scan"}}; }
      await request(view,snapshot);
      return {status:200,data:{ok:true}};
    }
    if (method !== "GET") return {status:405,data:{}};
    const snapshot = await request(view);
    return {status:snapshot ? 200 : 404,data:snapshot ?? {}};
  };
}
