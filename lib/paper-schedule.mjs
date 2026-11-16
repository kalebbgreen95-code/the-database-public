import { timingSafeEqual } from "node:crypto";
import { runPaperCrypto } from "./paper-run.mjs";

export function createPaperSchedule({projectUrl,serviceKey,store,browserPush,loadStockScan,fetcher=fetch}) {
  async function query(table,method,filters,body) {
    const url = new URL("/rest/v1/"+table,projectUrl);
    url.search = new URLSearchParams(filters);
    const response = await fetcher(url,{method,redirect:"error",signal:AbortSignal.timeout(6000),
      headers:{apikey:serviceKey,"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates"},
      body:body ? JSON.stringify(body) : undefined});
    if (!response.ok) throw Error("Paper schedule storage unavailable.");
    return method === "GET" ? response.json() : undefined;
  }
  const table = "paper_bot_schedule";
  const user = userId=>({user_id:"eq."+userId});
  async function status(userId) {
    const [row] = await query(table,"GET",{...user(userId),select:"checked_at,outcome"});
    return row ? {enabled:true,checkedAt:row.checked_at,outcome:row.outcome} : {enabled:false};
  }
  let busy = false;
  let schedulerKey;
  return {
    status,
    async set(userId,enabled) {
      if (enabled) await query(table,"POST",{}, {user_id:userId});
      else await query(table,"DELETE",user(userId));
    },
    async tick(supplied) {
      if (!/^[0-9a-f]{64}$/.test(supplied ?? "")) return 404;
      schedulerKey ??= (await query("paper_bot_scheduler_key","GET",{select:"token"}))[0]?.token;
      if (!schedulerKey || !timingSafeEqual(Buffer.from(supplied),Buffer.from(schedulerKey))) return 404;
      if (busy) return 204;
      busy = true;
      try {
        const jobs = await query(table,"GET",{select:"user_id",order:"checked_at.asc.nullsfirst",limit:"8"});
        await Promise.allSettled(jobs.map(async({user_id:userId})=>{
          let outcome = "Alpaca Paper bot data unavailable.";
          try {
            const keys = await store.get(userId);
            if (!keys || !(await status(userId)).enabled) return;
            const result = await runPaperCrypto(keys,fetcher,Date.now,loadStockScan);
            outcome = result.message;
            if (result.submitted && browserPush) await browserPush.notify(userId).catch(()=>{});
          } catch {}
          await query(table,"PATCH",user(userId),{checked_at:new Date().toISOString(),outcome});
        }));
        return 204;
      } finally {
        busy = false;
      }
    },
  };
}
