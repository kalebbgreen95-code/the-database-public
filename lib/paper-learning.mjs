const prefix = "database-paper-";
const strategies = ["stock","intraday","daily"];

export function paperSizeMultipliers(orders) {
  const sizes = Object.fromEntries(strategies.map(strategy=>[strategy,1]));
  const samples = Object.fromEntries(strategies.map(strategy=>[strategy,[]]));
  const positions = new Map();
  const fills = orders.filter(order=>Number(order.filled_qty)>0 &&
    Number(order.filled_avg_price)>0 && Number.isFinite(Date.parse(order.filled_at)))
    .sort((a,b)=>Date.parse(a.filled_at)-Date.parse(b.filled_at));
  for (const fill of fills) {
    const symbol = fill.symbol.replace("/","");
    const owned = fill.client_order_id?.startsWith(prefix);
    const qty = Number(fill.filled_qty);
    const price = Number(fill.filled_avg_price);
    const position = positions.get(symbol);
    if (fill.side === "buy") {
      const strategy = fill.client_order_id?.slice(prefix.length).split("-")[0];
      if (owned && !position && strategies.includes(strategy)) {
        positions.set(symbol,{strategy,quantity:qty,remaining:qty,cost:qty*price,proceeds:0});
      } else positions.set(symbol,{external:true});
      continue;
    }
    if (fill.side !== "sell" || !position) continue;
    if (!owned || position.external || qty>position.remaining+1e-8) {
      positions.delete(symbol);
      continue;
    }
    const digital = position.strategy!=="stock";
    position.remaining -= qty;
    position.proceeds += qty*price;
    if (position.remaining > (digital ? position.quantity*.003 : 1e-8)) continue;
    positions.delete(symbol);
    const sample = samples[position.strategy];
    sample.push({day:new Date(fill.filled_at).toISOString().slice(0,10),
      net:position.proceeds/position.cost-1-(digital ? .006 : .002)});
    if (sample.length>20) sample.shift();
    if (sample.length<20) continue;
    const halves = [sample.slice(0,10),sample.slice(10)];
    if (halves.some(batch=>new Set(batch.map(trade=>trade.day)).size<3)) continue;
    const totals = halves.map(batch=>batch.reduce((sum,trade)=>sum+trade.net,0));
    if (totals.every(total=>total<0)) sizes[position.strategy] = .5;
    if (totals.every(total=>total>0)) sizes[position.strategy] = 1;
  }
  return sizes;
}
