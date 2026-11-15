const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const pct = n => Number.isFinite(n) ? n.toFixed(2)+"%" : "—";
const quantity = n => n.toLocaleString("en-US",{maximumFractionDigits:6});
const simple = (tag,value)=>{const n = document.createElement(tag);n.textContent=value;return n;};
function link(title,href) { const a=simple("a",title);a.href=href;return a; }
function table(target,columns,rows) {
  const wrapper = simple("div",""); wrapper.className="public-scroll";
  const t = simple("table",""), head=t.createTHead().insertRow();
  columns.forEach(label=>{const h=simple("th",label);h.scope="col";head.append(h);});
  const body=t.createTBody();
  for (const row of rows) {
    const tr=body.insertRow();
    for (const v of row) {const td=tr.insertCell(); if(v instanceof Node)td.append(v);else td.textContent=v;}
  }
  if(!rows.length){target.replaceChildren(simple("p","No rows available."));return;}
  wrapper.append(t);target.replaceChildren(wrapper);
}
function chart(target,series,label) {
  const ns="http://www.w3.org/2000/svg", svg=document.createElementNS(ns,"svg"), path=document.createElementNS(ns,"path");
  const low=Math.min(...series), high=Math.max(...series);
  svg.setAttribute("viewBox","0 0 500 110");
  svg.setAttribute("role","img");svg.setAttribute("aria-label",label+"; range "+money(low)+" to "+money(high));
  svg.classList.add("public-chart");
  path.setAttribute("d",series.map((v,i)=>(i?"L":"M")+(6+488*i/(series.length-1))+" "+(102-94*(v-low)/(high-low||1))).join(" "));
  svg.append(path);target.replaceChildren(svg);
}
const assetLink = a=>link(a.symbol,"#asset?symbol="+encodeURIComponent(a.symbol));
const moves = a => pct(100*(a.close/a.history.at(-2).close-1));
const showRows = (id,rows) => table($(id),["Symbol","Asset","Synthetic close","Change"],rows.map(a=>[assetLink(a),a.name,money(a.close),moves(a)]));
let snapshot;
let originPage="search";
function showCandidates(){
  const {assets,ranked}=snapshot.demo;
  const kind=$("buy-asset-class").value;
  if(kind==="Stock"){
    table($("candidates"),["Symbol","Checklist passes","Sample trailing P/E"],ranked.map(symbol=>{
      const a=assets.find(x=>x.symbol===symbol);
      return [assetLink(a),a.checks.filter(x=>x[1]).length+"/"+a.checks.length,a.trailingPe+"×"];
    }));
  }else if(kind==="Crypto"){cryptoTable("candidates");}
  else showRows("candidates",assets.filter(a=>a.kind==="ETF"));
}
function cryptoTable(id){
  const rows=snapshot.demo.assets.filter(a=>a.kind==="Crypto");
  table($(id),["Symbol","Synthetic close","28-day change","Demo signal"],rows.map(a=>[assetLink(a),money(a.close),pct(a.momentum?.score*100),a.momentum?.action ?? "Unavailable"]));
}
function route(){
  let [page,query] = location.hash.slice(1).split("?");
  let a = page==="asset" && snapshot?.demo.assets.find(row=>row.symbol===new URLSearchParams(query).get("symbol"));
  if(![...document.querySelectorAll("[data-page]")].some(section=>section.id===page) || (page==="asset"&&!a)) page="overview";
  if(page==="asset") {
    $("asset-back").href="#"+originPage;
    $("asset-back").textContent="← Back";
    $("asset-title").textContent=a.symbol+" · "+a.name;
    const heading=simple("p","Synthetic close "+money(a.close)+" · "+a.technicals.date);
    const c=simple("div","");
    chart(c,a.history.map(b=>b.close),"Synthetic daily closing price");
    const list=simple("ul","");
    const stats=a.technicals;
    for(const item of ["RSI "+stats.rsi.toFixed(1),"MACD "+stats.macd.histogram.toFixed(3),"50-day average "+money(stats.trend.sma50),"200-day average "+money(stats.trend.sma200),"Relative volume "+stats.volume.relative.toFixed(2)+"×"]) list.append(simple("li",item));
    for(const [label,passed,detail] of a.checks??[]) list.append(simple("li",(passed?"Pass":passed===null?"Unavailable":"Miss")+" · "+label+" · "+detail));
    $("asset-info").replaceChildren(heading,c,list);
  } else originPage=page;
  for(const section of document.querySelectorAll("[data-page]")) section.hidden=section.id!==page;
  $("dashboard-page").value=page==="asset"?originPage:page;
}
function render(){
  const {generated,demo,market}=snapshot;
  const old = Date.now()-Date.parse(generated)>2*86400000;
  $("status").textContent="Snapshot "+generated.slice(0,16).replace("T"," ")+" UTC"+(old?" · refresh delayed":"");
  $("overview-equity").textContent=money(demo.equity)+" simulated equity";
  chart($("equity-chart"),demo.moves.map(row=>row.equity),"Simulated equity");
  $("rates").textContent=market.treasury ? market.treasury.date+" · "+market.treasury.rates.map((n,i)=>["3M","2Y","10Y","30Y"][i]+" "+pct(n)).join(" · ") : "Feed unavailable in this snapshot.";
  const headlines=market.headlines.map(row=>{const li=simple("li",row.date+" · ");li.append(link(row.title,row.url));return li;});
  if(!headlines.length) headlines.push(simple("li","Feed unavailable in this snapshot."));
  $("headlines").replaceChildren(...headlines);
  $("balance").textContent=money(demo.equity)+" simulated equity · "+money(demo.cash)+" demo cash";
  table($("positions"),["Symbol","Quantity","Simulated entry"],demo.positions.map(p=>[assetLink(p),quantity(p.quantity),money(p.price)]));
  table($("trades"),["Symbol","Simulated side","UTC timestamp","Price","Amount","Reason"],demo.trades.map(t=>[assetLink(t),t.side,t.at.slice(0,16).replace("T"," "),money(t.price),money(t.amount),t.reason]));
  table($("ai-results"),["Symbol","Theme","Description"],demo.assets.filter(a=>a.ai).map(a=>[assetLink(a),a.ai.theme,a.ai.description]));
  const search=()=>{const q=$("query").value.trim().toLowerCase();showRows("watchlist-results",demo.assets.filter(a=>(a.symbol+" "+a.name).toLowerCase().includes(q)));};
  $("query").addEventListener("input",search); search();
  $("buy-asset-class").addEventListener("change",showCandidates);showCandidates();
  cryptoTable("crypto-results");
  route();
}
$("dashboard-page").addEventListener("change",e=>location.hash=e.target.value);
addEventListener("hashchange",()=>{ route(); window.scrollTo(0,0); });
try {
  const response=await fetch("./snapshot.json",{signal:AbortSignal.timeout(10000),cache:"no-cache"});
  if(!response.ok) throw Error("Unavailable");
  snapshot=await response.json();
  render();
} catch {
  $("status").textContent="Demo snapshot unavailable. Reload to try again.";
  route();
}
