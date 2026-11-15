import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {setTimeout as delay} from "node:timers/promises";

async function readCodexUsage() {
  const child = spawn(process.env.DATABASE_CODEX_EXE || "codex",["app-server"],{
    windowsHide:true,stdio:["pipe","pipe","ignore"],
  });
  const lines = createInterface({input:child.stdout});
  const send = message=>child.stdin.write(JSON.stringify(message)+"\n");
  const deadline = setTimeout(()=>child.kill(),15000);
  try {
    child.stdin.on("error",()=>{});
    child.on("error",()=>lines.close());
    send({id:1,method:"initialize",params:{clientInfo:{name:"database-usage",version:"1.0.0"}}});
    for await (const line of lines) {
      let message;
      try {message = JSON.parse(line);} catch {continue;}
      if (message.id === 1 && message.result) {
        send({method:"initialized"});
        send({id:2,method:"account/rateLimits/read"});
      }
      if (message.id !== 2) continue;
      const result = message.result;
      const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
      const windows = [limits?.primary,limits?.secondary].filter(row=>
        Number.isFinite(row?.usedPercent) && row.windowDurationMins>0 && Number.isFinite(row.resetsAt))
        .map(row=>({minutes:row.windowDurationMins,remaining:Math.max(0,Math.min(100,100-row.usedPercent)),resetsAt:row.resetsAt}));
      if (windows.length) return {checkedAt:new Date().toISOString(),windows};
      break;
    }
    throw Error("Codex quota is unavailable. Check the local ChatGPT sign-in.");
  } finally {
    clearTimeout(deadline);
    lines.close();
    child.kill();
  }
}

if (process.argv.includes("--check")) {
  const usage = await readCodexUsage();
  console.log("Signed-in Codex returned " + usage.windows.length + " quota window(s).");
} else {
  const {DATABASE_USAGE_SUPABASE_URL, DATABASE_USAGE_PUBLISHABLE_KEY, DATABASE_USAGE_PUBLISHER_TOKEN} = process.env;
  const url = new URL("/rest/v1/codex_usage_publishers",DATABASE_USAGE_SUPABASE_URL);
  if (url.protocol !== "https:" || !DATABASE_USAGE_PUBLISHABLE_KEY || !DATABASE_USAGE_PUBLISHER_TOKEN) throw Error("Publisher configuration is missing.");
  const headers = {apikey:DATABASE_USAGE_PUBLISHABLE_KEY,"X-Database-Usage-Token":DATABASE_USAGE_PUBLISHER_TOKEN};
  async function sync(force) {
    const read = new URL(url);
    read.searchParams.set("select","requested_at,snapshot_at");
    const response = await fetch(read,{headers,signal:AbortSignal.timeout(7000),redirect:"error"});
    if (!response.ok) throw Error("Unable to read the Supabase usage queue.");
    const [row] = await response.json();
    if (!row) throw Error("The local usage publisher is not paired.");
    if (force || !row.snapshot_at || Date.parse(row.requested_at)>Date.parse(row.snapshot_at)) {
      const snapshot = await readCodexUsage();
      const write = new URL(url);
      const match = row.snapshot_at ? "eq."+row.snapshot_at : "is.null";
      write.searchParams.set("snapshot_at",match);
      const updated = await fetch(write,{method:"PATCH",redirect:"error",signal:AbortSignal.timeout(7000),
        headers:{...headers,"Content-Type":"application/json"},
        body:JSON.stringify({snapshot,snapshot_at:snapshot.checkedAt})});
      if (!updated.ok) throw Error("Unable to save the Codex quota snapshot.");
    }
  }
  if (process.argv.includes("--once")) await sync(true);
  else {
    for (;;) {
      try { await sync(false); } catch { await delay(15000); }
      await delay(10000);
    }
  }
}
