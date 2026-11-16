import {setTimeout as delay} from "node:timers/promises";

export function createUsageSources({projectUrl,serviceKey,renderKey,renderServiceId,fetcher=fetch}) {
  const table = new URL("/rest/v1/codex_usage_publishers",projectUrl);
  async function publisher(userId,requestedAt) {
    const url = new URL(table);
    url.searchParams.set("user_id","eq."+userId);
    url.searchParams.set("select","requested_at,snapshot_at,snapshot");
    const response = await fetcher(url,{
      method:requestedAt ? "PATCH" : "GET",redirect:"error",signal:AbortSignal.timeout(4000),
      headers:{apikey:serviceKey,...(requestedAt ? {"Content-Type":"application/json",Prefer:"return=representation"} : {})},
      body:requestedAt ? JSON.stringify({requested_at:requestedAt}) : undefined,
    });
    if (!response.ok) throw Error("Codex publisher is unavailable");
    return (await response.json())[0];
  }
  const render = async () => {
    if (!renderKey || !renderServiceId) return null;
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
    const url = new URL("https://api.render.com/v1/metrics/bandwidth");
    url.search = new URLSearchParams({resource:renderServiceId,startTime:start.toISOString(),endTime:now.toISOString()});
    const response = await fetcher(url,{headers:{Authorization:"Bearer "+renderKey},
      redirect:"error",signal:AbortSignal.timeout(7500)});
    if (!response.ok) throw Error("Render bandwidth is unavailable");
    const series = await response.json();
    if (!Array.isArray(series) || !series.length) throw Error("Render returned no bandwidth metrics");
    const scale = {bytes:.000001,b:.000001,kb:.001,mb:1,gb:1000};
    let usedMB = 0;
    for (const row of series) {
      const units = scale[String(row.unit).toLowerCase()];
      if (!units || !Array.isArray(row.values)) throw Error("Unexpected bandwidth metrics");
      for (const point of row.values) {
        if (!Number.isFinite(point.value) || point.value<0) throw Error("Invalid bandwidth value");
        usedMB += point.value*units;
      }
    }
    return {checkedAt:new Date().toISOString(),usedMB:Math.round(usedMB*100)/100,month:start.toISOString().slice(0,7),scope:"service"};
  };
  return {
    async cachedCodex(userId) { return (await publisher(userId))?.snapshot; },
    async refresh(userId) {
      const row = await publisher(userId);
      if (!row) return {codex:null,render:null,missing:["Codex publisher is not connected"]};
      const at = Date.now();
      const requestedAt = row.requested_at && at-Date.parse(row.requested_at)<17000
        ? row.requested_at : new Date(at).toISOString();
      const codex = async()=>{
        let latest = row.requested_at === requestedAt ? row : await publisher(userId,requestedAt);
        for (let attempt=0;attempt<8;attempt++) {
          if (Date.parse(latest?.snapshot_at)>=Date.parse(requestedAt)) return latest.snapshot;
          await delay(1700);
          latest = await publisher(userId);
        }
        return null;
      };
      const [quota,bandwidth] = await Promise.allSettled([codex(),render()]);
      const codexReading = quota.status==="fulfilled" ? quota.value : null;
      const renderReading = bandwidth.status==="fulfilled" ? bandwidth.value : null;
      return {codex:codexReading,render:renderReading,missing:[
        ...(!codexReading ? ["Codex publisher hasn’t returned a fresh reading"] : []),
        ...(!renderReading ? [renderKey ? "Render bandwidth could not be fetched" : "Render API key hasn’t been connected"] : []),
      ]};
    },
  };
}
