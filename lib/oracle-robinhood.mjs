import {setTimeout as delay} from "node:timers/promises";

export function createOracleRobinhood({projectUrl,serviceKey,ownerId,token,fetcher=fetch}) {
  const url = new URL("/rest/v1/robinhood_refresh_requests",projectUrl);
  url.searchParams.set("user_id","eq."+ownerId);
  url.searchParams.set("select","requested_at");
  async function request(method,body) {
    const response = await fetcher(url,{method,redirect:"error",signal:AbortSignal.timeout(4000),
      headers:{apikey:serviceKey,...(body ? {"Content-Type":"application/json",Prefer:"return=representation"} : {})},
      body:body && JSON.stringify(body),
    });
    if (!response.ok) throw Error("Robinhood request queue unavailable");
    return (await response.json())[0];
  }
  return {
    ownerId,token,
    async refresh(readSnapshot,previous) {
      const now = Date.now();
      const queued = await request("GET");
      const requestedAt = now-Date.parse(queued?.requested_at) < 25000
        ? queued.requested_at : (await request("PATCH",{requested_at:new Date(now).toISOString()}))?.requested_at;
      if (!requestedAt) throw Error("Robinhood request could not be queued");
      for (let attempt=0;attempt<11;attempt++) {
        const snapshot = await readSnapshot();
        if (snapshot?.valueScope === "robinhood" && Date.parse(snapshot.asOf) >= Date.parse(requestedAt) &&
            snapshot.asOf > (previous?.asOf ?? "")) return snapshot;
        await delay(2000);
      }
      return null;
    },
  };
}
