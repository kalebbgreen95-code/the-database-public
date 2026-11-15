const root = new URL("./", import.meta.url);
export function publicRoute(path) {
  const legacy = new URL(path, root.origin);
  const url = new URL(root);
  const page = legacy.pathname.slice(1);
  if (page) url.searchParams.set("screen", page);
  for (const [key, value] of legacy.searchParams) url.searchParams.set(key, value);
  return url.href;
}

let snapshot;
export async function readDemo(path, {signal, refresh = false} = {}) {
  if (signal?.aborted) throw signal.reason;
  if (!snapshot || refresh) {
    const request = fetch(new URL("snapshot.json", root), {cache:refresh ? "reload" : "no-cache", signal:AbortSignal.timeout(10000)})
      .then(response => {
        if (!response.ok) throw Error("Snapshot unavailable");
        return response.json();
      });
    snapshot = request;
    request.catch(() => { if (snapshot === request) snapshot = undefined; });
  }
  const data = await snapshot;
  if (signal?.aborted) throw signal.reason;
  const {pathname, searchParams} = new URL(path, root.origin);
  const symbol = searchParams.get("symbol");
  let result;
  switch (pathname) {
    case "/api/status": result = data.dashboard; break;
    case "/api/details": result = Object.hasOwn(data.details, symbol) ? data.details[symbol] : null; break;
    case "/api/search": {
      const query = (searchParams.get("q") ?? "").toLowerCase().trim();
      result = {assets: data.catalog.filter(asset => (asset.symbol + " " + asset.name).toLowerCase().includes(query))};
      break;
    }
    case "/api/checklist-buys": result = searchParams.get("view") === "ai" ? data.ai : data.checklist; break;
    case "/api/notice": result = data.dashboard.notifications.find(notice => notice.id === searchParams.get("id")); break;
  }
  return {ok: result != null, json: async () => structuredClone(result)};
}
