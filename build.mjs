import { cp, mkdir, writeFile } from "node:fs/promises";
import { replay } from "./lib/demo.mjs";
import { openData } from "./lib/providers.mjs";

import { dashboardData } from "./lib/dashboard-data.mjs";
const now = new Date();
const data = process.argv.includes("--offline") ? {treasury:null,headlines:[]} : await openData(now);
const demo = replay(+now);
const snapshot = dashboardData(demo, data, now.toISOString());
const dir = new URL("./dist/",import.meta.url);
await mkdir(dir,{recursive:true});
for (const file of ["index.html","dashboard.js","style.css","briefing.mjs","public-data.js","account.js"]) {
  await cp(new URL("./public/"+file,import.meta.url),new URL(file,dir));
}
await cp(new URL("./lib/stock-checklist.mjs",import.meta.url),new URL("stock-checklist.mjs",dir));
await writeFile(new URL("snapshot.json",dir),JSON.stringify(snapshot));
console.log("Built public demo: "+demo.trades.length+" simulated fills; public Treasury "+(data.treasury?"available":"unavailable")+"; Fed headlines "+data.headlines.length+".");
