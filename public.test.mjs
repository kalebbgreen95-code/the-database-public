import test from "node:test";
import assert from "node:assert/strict";
import { replay } from "./lib/demo.mjs";
import { openData, parseFed } from "./lib/providers.mjs";

test("replay starts with demo cash, is reproducible and cannot sell an unowned asset",()=>{
  const now=Date.UTC(2026,10,15);
  const demo=replay(now);
  assert.deepEqual(demo,replay(now+60000));
  assert.ok(demo.trades.some(row=>row.side==="Buy"));
  assert.ok(demo.trades.some(row=>row.side==="Sell"));
  assert.ok(demo.trades.some(row=>row.symbol.endsWith("/USD")));
  assert.equal(demo.moves.length,30);
  const held=new Set();
  let cash=500000;
  for(const trade of [...demo.trades].reverse()) {
    assert.ok(Date.parse(trade.at)<now);
    assert.ok(trade.reason && trade.price>0 && trade.quantity>0);
    if(trade.side==="Buy"){
      assert.equal(held.has(trade.symbol),false);
      held.add(trade.symbol);
      cash-=Math.round(trade.amount*100);
    }else{
      assert.equal(held.delete(trade.symbol),true);
      cash+=Math.round(trade.amount*100);
    }
    assert.ok(cash>=0);
  }
  assert.equal(demo.cash,cash/100);
  assert.deepEqual(demo.positions.map(p=>p.symbol).sort(),[...held].sort());
});

test("public provider falls back to prior month and publishes only selected fields",async()=>{
  const sample=`<m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-30T00:00:00</d:NEW_DATE><d:BC_3MONTH>3.7</d:BC_3MONTH><d:BC_2YEAR>3.8</d:BC_2YEAR><d:BC_10YEAR>4.2</d:BC_10YEAR><d:BC_30YEAR>4.5</d:BC_30YEAR><d:UNKNOWN>Never publish this</d:UNKNOWN></m:properties>`;
  const rss=`<item><title>Rates &amp; policy</title><pubDate>Sat, 14 Nov 2026 15:30:00 GMT</pubDate><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261114a.htm</link></item>`;
  const data=await openData(new Date("2026-11-01"),async url=>new Response(url.includes("federalreserve")?rss:url.endsWith("202610")?sample:""));
  assert.deepEqual(data.treasury,{date:"2026-10-30",rates:[3.7,3.8,4.2,4.5]});
  assert.equal(data.headlines[0]?.title,"Rates & policy");
  assert.deepEqual(parseFed(rss.replace("https://www.federalreserve.gov","https://untrusted.example")),[]);
  assert.deepEqual(await openData(new Date("2026-11-01"),async()=>{throw Error("provider down");}),{treasury:null,headlines:[]});
});
