import { previewPaperSignals } from "./paper-preview.mjs";
import { alpacaChart } from "./alpaca-chart.mjs";
import { runPaperCrypto } from "./paper-run.mjs";
import { pushEndpoint } from "./browser-push.mjs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const paperOrigin = "https://paper-api.alpaca.markets";
const userIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const keyPattern = /^[a-zA-Z0-9_-]{10,128}$/;

class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function connectionCrypto(encryptionKey) {
  if (encryptionKey.length !== 32) throw Error('Expected a 32-byte encryption key');
  return {
    open(userId, sealed) {
      const [iv, tag, content] = sealed.split(".").map(value => Buffer.from(value, "base64url"));
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
      decipher.setAAD(Buffer.from(userId));
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]));
    },
    seal(userId, keys) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      cipher.setAAD(Buffer.from(userId));
      const content = Buffer.concat([cipher.update(JSON.stringify(keys)), cipher.final()]);
      return [iv, cipher.getAuthTag(), content].map(value => value.toString("base64url")).join(".");
    },
  };
}

export function openConnectionStore(path, encryptionKey) {
  const crypto = connectionCrypto(encryptionKey);
  const database = new DatabaseSync(path);
  database.exec(`CREATE TABLE IF NOT EXISTS paper_connections (
    user_id TEXT PRIMARY KEY NOT NULL, encrypted_keys TEXT NOT NULL
  ) STRICT`);
  const lookup = database.prepare("SELECT encrypted_keys FROM paper_connections WHERE user_id = ?");
  const save = database.prepare(`INSERT INTO paper_connections VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET encrypted_keys=excluded.encrypted_keys`);
  const remove = database.prepare("DELETE FROM paper_connections WHERE user_id = ?");
  return {
    get(userId) {
      const row = lookup.get(userId);
      if (!row) return null;
      return crypto.open(userId,row.encrypted_keys);
    },
    set(userId, keys) {
      save.run(userId,crypto.seal(userId,keys));
    },
    delete(userId) { remove.run(userId); },
    close() { database.close(); },
  };
}

async function upstream(fetcher, url, headers) {
  try {
    return await fetcher(url, {headers, redirect:"error", signal:AbortSignal.timeout(6000)});
  } catch {
    throw new ServiceError(502, "The account provider did not respond.");
  }
}

const reply = (status, data) => ({status, data});
function safeAccount(account) {
  const amount = value => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
  return {status:String(account.status ?? "Unknown"), equity:amount(account.equity),
    cash:amount(account.cash), buyingPower:amount(account.buying_power)};
}

export function createTenantService({authUrl, publishableKey, appOrigin, store, browserPush, paperSchedule, snapshotStore, robinhoodSource, usageStore, usageSources, fetcher = fetch}) {
  const auth = new URL(authUrl);
  if (auth.protocol !== "https:" || auth.username || auth.password || auth.pathname !== "/") {
    throw Error("Expected the HTTPS origin of the clone's auth project");
  }
  const accountPath = "/account-api/alpaca-paper";
  async function requireUser(headers) {
    const authorization = headers.get("authorization") ?? "";
    if (!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(authorization)) throw new ServiceError(401, "Sign in first.");
    const response = await upstream(fetcher, new URL("/auth/v1/user", auth), {authorization, apikey:publishableKey});
    if (response.status === 401 || response.status === 403) throw new ServiceError(401, "Sign in again.");
    if (!response.ok) throw new ServiceError(502, "Sign-in verification failed.");
    const user = await response.json();
    if (!userIdPattern.test(user.id ?? "")) throw new ServiceError(401, "Sign-in verification failed.");
    return user.id;
  }
  async function paperAccount(keys) {
    const response = await upstream(fetcher, paperOrigin + "/v2/account", {
      "APCA-API-KEY-ID":keys.keyId, "APCA-API-SECRET-KEY":keys.secret,
    });
    if (response.status === 401 || response.status === 403) {
      throw new ServiceError(422, "Alpaca rejected the paper API keys.");
    }
    if (!response.ok) throw new ServiceError(502, "Alpaca Paper is temporarily unavailable.");
    return safeAccount(await response.json());
  }
  return async ({path, method, headers, readJson, searchParams}) => {
    const activity = path === "/account-api/paper-activity";
    const preview = path === "/account-api/paper-preview";
    const marketChart = path === "/account-api/market-chart";
    const marketNews = path === "/account-api/market-news";
    const marketQuote = marketChart || marketNews || path === "/account-api/market-quote";
    const paperRun = path === "/account-api/paper-run";
    const push = path === "/account-api/browser-push";
    const schedule = path === "/account-api/paper-schedule";
    const robinhood = path === "/account-api/robinhood-snapshot";
    const usage = path === "/account-api/usage-snapshot";
    if (usage && !usageStore) return reply(503,{error:"Usage storage is unavailable."});
    if (usage && !["GET","POST"].includes(method)) return reply(405,{error:"Method unavailable."});
    if (robinhood && !snapshotStore) return reply(503,{error:"Snapshot storage is unavailable."});
    if (robinhood && !["GET","PUT","POST"].includes(method)) return reply(405,{error:"Method unavailable."});
    if (schedule && !paperSchedule) return reply(503,{error:"Paper schedule unavailable."});
    if (push && !browserPush) return reply(503,{error:"Browser push is unavailable."});
    if (paperRun && method !== "POST") return reply(405,{error:"Method unavailable."});
    if ((activity || preview || marketQuote) && method !== "GET") return reply(405, {error:"Method unavailable."});
    if (!activity && !preview && !marketQuote && !paperRun && !push && !schedule && !robinhood && !usage && path !== accountPath) return reply(404, {error:"Unknown account endpoint."});
    if (!paperRun && !["GET","PUT","DELETE"].includes(method) && !((push || usage || robinhood) && method==="POST")) return reply(405, {error:"Method unavailable."});
    if (method !== "GET" && headers.get("origin") !== appOrigin) return reply(403, {error:"Origin not allowed."});
    try {
      const userId = await requireUser(headers);
      if (usage) {
        try {
          const previous = await usageStore.get(userId);
          if (method === "GET") {
            const codex = await usageSources?.cachedCodex(userId).catch(()=>null);
            if (!codex || (previous?.codex?.checkedAt && codex.checkedAt<=previous.codex.checkedAt)) return reply(200,{snapshot:previous});
            return reply(200,{snapshot:validateUsageSnapshot({codex,render:previous?.render})});
          }
          if (!usageSources) return reply(503,{error:"Usage sources are unavailable."});
          const incoming = await usageSources.refresh(userId);
          const newer = (next,prior)=>next && (!prior || next.checkedAt > prior.checkedAt);
          const changed = newer(incoming.codex,previous?.codex) || newer(incoming.render,previous?.render);
          if (!changed) return reply(200,{snapshot:previous,updated:false,missing:incoming.missing});
          const snapshot = validateUsageSnapshot({
            codex:newer(incoming.codex,previous?.codex) ? incoming.codex : previous?.codex,
            render:newer(incoming.render,previous?.render) ? incoming.render : previous?.render,
          });
          if (!await usageStore.save(userId,snapshot)) return reply(200,{snapshot:await usageStore.get(userId),updated:false});
          return reply(200,{snapshot,updated:true,missing:incoming.missing});
        } catch { return reply(502,{error:"Couldn’t get fresh readings from your usage sources."}); }
      }
      if (robinhood) {
        if (method === "GET") return reply(200,{snapshot:await snapshotStore.get(userId)});
        if (method === "POST") {
          if (!robinhoodSource || robinhoodSource.ownerId !== userId) {
            return reply(200,{snapshot:await snapshotStore.get(userId),sourceConfigured:false});
          }
          let fresh;
          try {
            if (robinhoodSource.load) {
              fresh = validateRobinhoodSnapshot(await robinhoodSource.load());
            } else {
              const url = new URL(robinhoodSource.url);
              if (url.protocol !== "https:" || url.username || url.password) throw Error("Invalid source URL");
              const upstream = await fetcher(url,{
                headers:{Accept:"application/json",Authorization:"Bearer "+robinhoodSource.token},
                redirect:"error",signal:AbortSignal.timeout(10000),
              });
              if (!upstream.ok || !upstream.body) throw Error("Snapshot unavailable");
              const chunks = [];
              let bytes = 0;
              for await (const chunk of upstream.body) {
                bytes += chunk.byteLength;
                if (bytes > 65536) throw Error("Snapshot too large");
                chunks.push(chunk);
              }
              fresh = validateRobinhoodSnapshot(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            }
          } catch {
            return reply(502,{error:"Couldn’t download a valid Robinhood snapshot. Your saved snapshot is still available."});
          }
          const previous = await snapshotStore.get(userId);
          if (previous && fresh.asOf <= previous.asOf) return reply(200,{snapshot:previous,updated:false});
          if (!await snapshotStore.save(userId,fresh)) return reply(200,{snapshot:await snapshotStore.get(userId),updated:false});
          return reply(200,{snapshot:fresh,updated:true});
        }
        let snapshot;
        try { snapshot = validateRobinhoodSnapshot(await readJson(65536)); }
        catch { return reply(400,{error:"Choose a valid Robinhood Portfolio JSON snapshot (up to 64 KiB and 250 holdings)."}); }
        if (!await snapshotStore.save(userId,snapshot)) {
          return reply(409,{error:"This file is older than your saved snapshot."});
        }
        return reply(200,{snapshot});
      }
      if (schedule) {
        if (method === "GET") return reply(200,await paperSchedule.status(userId));
        if (method === "PUT" && !await store.get(userId)) return reply(409,{error:"Connect Alpaca Paper first."});
        await paperSchedule.set(userId,method==="PUT");
        return reply(200,await paperSchedule.status(userId));
      }
      if (push) {
        if (method === "GET") return reply(200,{publicKey:browserPush.publicKey});
        const endpoint = pushEndpoint((await readJson())?.endpoint);
        if (!endpoint) return reply(400,{error:"Unsupported browser push endpoint."});
        if (method === "POST") {
          const status = await browserPush.test(userId,endpoint);
          return reply(status,status===200 ? {sent:true} :
            {error:status===429 ? "Wait 15 seconds between tests." : "Push test could not be delivered."});
        }
        if (method === "PUT") await browserPush.subscribe(userId,endpoint);
        else await browserPush.remove(userId,endpoint);
        return reply(200,{enabled:method==="PUT"});
      }
      if (paperRun) {
        const keys = await store.get(userId);
        if (!keys) return reply(409,{error:"Connect an Alpaca Paper account first."});
        try {
          const result = await runPaperCrypto(keys,fetcher);
          if (result.submitted && browserPush) await browserPush.notify(userId).catch(()=>{});
          return reply(200,result);
        }
        catch (error) {
          const message = error.message.startsWith("Order status unconfirmed.") ||
            error.message.startsWith("Alpaca Paper declined the order.") ? error.message : "Alpaca Paper bot data unavailable.";
          return reply(502,{error:message});
        }
      }
      if (method === "DELETE") {
        await store.delete(userId);
        return reply(200, {connected:false});
      }
      if (method === "GET") {
        const keys = await store.get(userId);
        if (!keys) return reply(200, {connected:false});
        if (preview) return reply(200,{connected:true,...await previewPaperSignals({keys,fetcher})});
        if (marketQuote) {
          const symbol = searchParams?.get("symbol") ?? "";
          const crypto = /^[A-Z0-9]{2,12}\/USD$/.test(symbol);
          if (marketNews && !symbol) return reply(200,{rows:await marketHeadlines(keys,"")});
          if (!crypto && !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) return reply(400,{error:"Invalid asset symbol."});
          if (marketNews) return reply(200,{rows:await marketHeadlines(keys,symbol.replace("/",""))});
          if (marketChart) {
            try { return reply(200,await alpacaChart(fetcher,keys,symbol,crypto)); }
            catch { return reply(502,{error:"Alpaca chart data unavailable."}); }
          }
          const endpoint = crypto ? "/v1beta3/crypto/us/latest/quotes?" + new URLSearchParams({symbols:symbol})
            : "/v2/stocks/" + encodeURIComponent(symbol) + "/quotes/latest?feed=iex";
          const response = await upstream(fetcher,"https://data.alpaca.markets" + endpoint,
            {"APCA-API-KEY-ID":keys.keyId,"APCA-API-SECRET-KEY":keys.secret});
          if (!response.ok) return reply(502,{error:"Alpaca quote unavailable."});
          const data = await response.json();
          const quote = crypto ? data.quotes?.[symbol] : data.quote;
          if (!(quote?.bp > 0 && quote?.ap > 0 && Number.isFinite(Date.parse(quote.t)))) {
            return reply(502,{error:"Alpaca returned no usable quote."});
          }
          return reply(200,{bid:quote.bp,ask:quote.ap,at:quote.t,source:crypto ? "Alpaca Crypto US" : "Alpaca IEX"});
        }
        if (!activity) return reply(200, {connected:true,account:await paperAccount(keys)});
        const headers = {"APCA-API-KEY-ID":keys.keyId,"APCA-API-SECRET-KEY":keys.secret};
        async function loadPaper(path) {
          const response = await upstream(fetcher,paperOrigin + path,headers);
          if (!response.ok) throw new ServiceError(502,"Alpaca Paper activity could not be refreshed.");
          const rows = await response.json();
          if (!Array.isArray(rows)) throw new ServiceError(502,"Alpaca Paper returned unexpected activity data.");
          return rows;
        }
        const [account,positions,orders] = await Promise.all([
          paperAccount(keys),loadPaper("/v2/positions"),searchParams?.get("view") === "positions"
            ? [] : loadPaper("/v2/orders?status=all&limit=20&direction=desc"),
        ]);
        return reply(200,{connected:true,account,
          positions:positions.map(({symbol,qty,market_value,asset_class,unrealized_pl})=>
            ({symbol,quantity:qty,marketValue:market_value,assetClass:asset_class,unrealized:unrealized_pl})),
          orders:orders.map(({symbol,side,status,filled_qty,filled_avg_price,submitted_at,filled_at})=>
            ({symbol,side,status,quantity:filled_qty,averagePrice:filled_avg_price,at:filled_at??submitted_at})),
        });
      }
      const {keyId, secret} = await readJson() ?? {};
      if (typeof keyId !== "string" || typeof secret !== "string" ||
          !keyPattern.test(keyId) || !keyPattern.test(secret)) {
        return reply(400, {error:"Enter a valid Alpaca Paper API key and secret."});
      }
      const account = await paperAccount({keyId, secret});
      await store.set(userId, {keyId, secret});
      return reply(200, {connected:true, account});
    } catch (error) {
      return error instanceof ServiceError
        ? reply(error.status, {error:error.message})
        : reply(500, {error:"The account action could not be completed."});
    }
  };

  async function marketHeadlines(keys,symbol) {
    const url = new URL("https://data.alpaca.markets/v1beta1/news");
    url.search = new URLSearchParams({limit:"20",include_content:"false",
      start:new Date(Date.now()-7*86400000).toISOString()});
    if (symbol) url.searchParams.set("symbols",symbol);
    const response = await upstream(fetcher,url,{"APCA-API-KEY-ID":keys.keyId,"APCA-API-SECRET-KEY":keys.secret});
    if (!response.ok) throw new ServiceError(502,"Alpaca news unavailable.");
    const result = await response.json();
    return (result.news ?? []).flatMap(row=>{
      let article;
      try { article = new URL(row.url); } catch { return []; }
      const timestamp = Date.parse(row.created_at);
      if (article.protocol !== "https:" || article.username || article.password ||
          typeof row.headline !== "string" || !row.headline.trim() || !Number.isFinite(timestamp)) return [];
      return [{headline:row.headline.slice(0,240),url:article.href,timestamp,
        filingDate:new Date(timestamp).toISOString().slice(0,10),
        source:row.source?.toLowerCase() === "benzinga" ? "Benzinga" : article.hostname,symbols:[]}];
    });
  }
}

export function validateRobinhoodSnapshot(input) {
  const {asOf,positions,accountValue,valueScope} = input ?? {};
  if (typeof asOf !== "string" || !Number.isFinite(Date.parse(asOf)) ||
      !Array.isArray(positions) || positions.length > 250 ||
      (accountValue != null && !Number.isFinite(accountValue))) throw Error("Invalid snapshot");
  const symbols = new Set();
  const rows = positions.map(row=>{
    const {type,symbol,quantity,averageCost,price,quoteAt} = row ?? {};
    if (!["stock","crypto"].includes(type) || typeof symbol !== "string" ||
        !(type === "crypto" ? /^[A-Z0-9]{1,16}\/USD$/ : /^[A-Z][A-Z0-9.-]{0,14}$/).test(symbol) ||
        symbols.has(symbol) || !Number.isFinite(quantity) || quantity === 0 ||
        ![averageCost,price].every(value=>value == null || (Number.isFinite(value) && value > 0)) ||
        (quoteAt != null && (typeof quoteAt !== "string" || !Number.isFinite(Date.parse(quoteAt))))) throw Error("Invalid holding");
    symbols.add(symbol);
    return {type,symbol,quantity,averageCost:averageCost??null,price:price??null,quoteAt:quoteAt??null};
  });
  return {asOf:new Date(asOf).toISOString(),accountValue:accountValue??null,positions:rows,
    ...(["brokerage","combined-estimate"].includes(valueScope) ? {valueScope} : {})};
}

export function validateUsageSnapshot(input) {
  const iso = value=>{
    const time = typeof value === "number" ? (value < 1e12 ? value*1000 : value) : Date.parse(value);
    if (!Number.isFinite(time)) throw Error("Invalid usage timestamp");
    return new Date(time).toISOString();
  };
  const codex = input?.codex ?? (input?.windows ? input : null);
  const render = input?.render;
  if (!codex && !render) throw Error("Usage missing");
  let codexUsage,renderUsage;
  if (codex) {
    if (!Array.isArray(codex.windows) || codex.windows.length<1 || codex.windows.length>10) throw Error("Invalid Codex windows");
    codexUsage = {checkedAt:iso(codex.checkedAt),windows:codex.windows.map(row=>{
      if (!Number.isFinite(row.minutes) || row.minutes <= 0 || !Number.isFinite(row.remaining) ||
          row.remaining<0 || row.remaining>100) throw Error("Invalid Codex window");
      return {minutes:row.minutes,remaining:row.remaining,resetsAt:iso(row.resetsAt)};
    })};
  }
  if (render) {
    if (!Number.isFinite(render.usedMB) || render.usedMB<0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(render.month) ||
        (render.scope!=="service" && (!Number.isFinite(render.includedGB) || render.includedGB<=0))) throw Error("Invalid bandwidth");
    renderUsage = {checkedAt:iso(render.checkedAt),usedMB:render.usedMB,month:render.month,
      ...(render.scope==="service" ? {scope:"service"} : {includedGB:render.includedGB})};
  }
  const asOf = [codexUsage?.checkedAt,renderUsage?.checkedAt].filter(Boolean).sort().at(-1);
  return {asOf,codex:codexUsage??null,render:renderUsage??null};
}

export function createHostedSnapshotStore({projectUrl,serviceKey,encryptionKey,fetcher=fetch,kind="robinhood"}) {
  const crypto = connectionCrypto(encryptionKey);
  const context = userId=>kind+"-snapshot:"+userId;
  const resource = new URL("/rest/v1/"+kind+"_snapshots",projectUrl);
  const rpc = new URL("/rest/v1/rpc/save_"+kind+"_snapshot",projectUrl);
  async function request(url,method,body) {
    const response = await fetcher(url,{method,redirect:"error",signal:AbortSignal.timeout(5000),
      headers:{apikey:serviceKey,...(body ? {"Content-Type":"application/json"} : {})},
      body:body ? JSON.stringify(body) : undefined});
    if (!response.ok) throw Error("Snapshot storage unavailable");
    return response;
  }
  function ownerUrl(userId) {
    const url = new URL(resource);
    url.searchParams.set("user_id","eq."+userId);
    return url;
  }
  return {
    async get(userId) {
      const url = ownerUrl(userId);
      url.searchParams.set("select","encrypted_snapshot");
      const [row] = await (await request(url,"GET")).json();
      return row ? crypto.open(context(userId),row.encrypted_snapshot) : null;
    },
    async save(userId,snapshot) {
      return await (await request(rpc,"POST",{p_user_id:userId,p_as_of:snapshot.asOf,
        p_encrypted_snapshot:crypto.seal(context(userId),snapshot)})).json() === true;
    },
  };
}

export function createHostedConnectionStore({projectUrl, serviceKey, encryptionKey, fetcher = fetch}) {
  if (!serviceKey.startsWith("sb_secret_")) throw Error("Expected a Supabase server secret key.");
  const crypto = connectionCrypto(encryptionKey);
  const endpoint = new URL("/rest/v1/paper_connections", projectUrl);
  async function call(method, userId, options = {}) {
    const url = new URL(endpoint);
    if (method !== "POST") url.searchParams.set("user_id","eq."+userId);
    if (method === "GET") url.searchParams.set("select","encrypted_keys");
    if (method === "POST") url.searchParams.set("on_conflict","user_id");
    const response = await fetcher(url,{method,signal:AbortSignal.timeout(5000),redirect:"error",
      ...options,headers:{apikey:serviceKey,...options.headers}});
    if (!response.ok) throw Error("Persistent account storage is unavailable.");
    return response;
  }
  return {
    async get(userId) {
      const rows = await (await call("GET",userId)).json();
      return rows.length ? crypto.open(userId,rows[0].encrypted_keys) : null;
    },
    async set(userId, keys) {
      await call("POST",userId,{headers:{"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},
        body:JSON.stringify({user_id:userId,encrypted_keys:crypto.seal(userId,keys)})});
    },
    async delete(userId) { await call("DELETE",userId); },
  };
}
