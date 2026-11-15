import { cp, mkdir, writeFile } from "node:fs/promises";
import { replay } from "./lib/demo.mjs";
import { openData } from "./lib/providers.mjs";

import { dashboardData } from "./lib/dashboard-data.mjs";
const now = new Date();
const data = process.argv.includes("--offline") ? {treasury:null,headlines:[]} : await openData(now);
const snapshot = {generated:now.toISOString(), demo:replay(+now), market:{treasury:data.treasury,headlines:data.headlines}};
Object.assign(snapshot, dashboardData(snapshot.demo, data, snapshot.generated));
const dir = new URL("./dist/",import.meta.url);
await mkdir(dir,{recursive:true});
for (const file of ["index.html","dashboard.js","style.css","briefing.mjs","public-data.js","account.js"]) {
  await cp(new URL("./public/"+file,import.meta.url),new URL(file,dir));
}
await cp(new URL("./lib/stock-checklist.mjs",import.meta.url),new URL("stock-checklist.mjs",dir));
await writeFile(new URL("snapshot.json",dir),JSON.stringify(snapshot));
console.log("Built public demo: "+snapshot.demo.trades.length+" simulated fills; public Treasury "+(data.treasury?"available":"unavailable")+"; Fed headlines "+data.headlines.length+".");
