export function createUsageSources({renderKey,renderServiceId,fetcher=fetch}) {
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
    async refresh() {
      const renderReading = await render().catch(()=>null);
      return {render:renderReading,missing:[
        ...(!renderReading ? [renderKey ? "Render bandwidth could not be fetched" : "Render API key hasn’t been connected"] : []),
      ]};
    },
  };
}
