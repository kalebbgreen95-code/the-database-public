import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { replay } from "./lib/demo.mjs";
import { publicFeedUpdate } from "./lib/economic-news.mjs";

import { dashboardData } from "./lib/dashboard-data.mjs";
const now = new Date();
const data = process.argv.includes("--offline") ? {treasury:null,news:[],sources:[],checkedAt:now.toISOString()} : await publicFeedUpdate(now);
const demo = replay(+now);
const snapshot = dashboardData(demo, data, now.toISOString());
const originalScan = JSON.parse(await readFile(new URL("./lib/original-stock-scan.json",import.meta.url),"utf8"));
snapshot.checklist = {...snapshot.checklist,...originalScan,source:"Original app scan"};
for (const row of originalScan.rows) {
  if (!snapshot.catalog.some(asset => asset.symbol === row.symbol)) {
    snapshot.catalog.push({symbol:row.symbol,name:row.symbol,kind:"Stock"});
    snapshot.details[row.symbol] = {
      price:row.quote?.price,time:row.quote?.time,priceSource:"Original app scan",
      changes:{"1Y":{percent:row.year}},changeSource:"Original app scan",
      technicals:row.technicals,headlines:[],setup:[],screenChecks:row.checks,
    };
  }
}
const dir = new URL("./dist/",import.meta.url);
await mkdir(dir,{recursive:true});
for (const file of ["dashboard.js","style.css","briefing.mjs","public-data.js","account.js","device-alerts.js","notification-worker.js"]) {
  await cp(new URL("./public/"+file,import.meta.url),new URL(file,dir));
}
await cp(new URL("./lib/stock-checklist.mjs",import.meta.url),new URL("stock-checklist.mjs",dir));
const index = await readFile(new URL("./public/index.html",import.meta.url),"utf8");
const { version } = JSON.parse(await readFile(new URL("./package.json",import.meta.url),"utf8"));
const release = now.getTime().toString(36);
await writeFile(new URL("index.html",dir), index.replace("__APP_VERSION__",version).replace(/(\.\/(?:style\.css|dashboard\.js|account\.js))(?:\?v=\w+)?"/g, "$1?v="+release+'"'));
await writeFile(new URL("snapshot.json",dir),JSON.stringify(snapshot));
console.log("Built public demo: "+demo.trades.length+" simulated fills; public Treasury "+(data.treasury?"available":"unavailable")+"; public headlines "+data.news.length+".");
