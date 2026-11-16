import { publicFeedUpdate } from "./lib/economic-news.mjs";
import { refreshPublicCrypto } from "./lib/public-crypto.mjs";
import { createBrowserPush } from "./lib/browser-push.mjs";
import { createPaperSchedule } from "./lib/paper-schedule.mjs";
import manifest from "./package.json" with { type: "json" };
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const files = new Map([["/","text/html"],["/index.html","text/html"],["/dashboard.js","text/javascript"],["/style.css","text/css"],["/briefing.mjs","text/javascript"],["/stock-checklist.mjs","text/javascript"],["/public-data.js","text/javascript"],["/account.js","text/javascript"],["/snapshot.json","application/json"]]);
files.set("/device-alerts.js","text/javascript");
files.set("/notification-worker.js","text/javascript");
const assets = new Map();
function staticAsset(url) {
  let entry = assets.get(url.href);
  if (!entry) {
    entry = readFile(url).then(body => ({
      body,
      gzip: gzipSync(body),
      etag: createHash("sha256").update(body).digest("base64url"),
    })).catch(error => {
      assets.delete(url.href);
      throw error;
    });
    assets.set(url.href,entry);
  }
  return entry;
}

function acceptsGzip(value = "") {
  const choices = new Map(value.toLowerCase().split(",").map(entry => {
    const [encoding, ...parameters] = entry.trim().split(";");
    const q = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith("q="));
    return [encoding.trim(),q ? Number(q.slice(2)) : 1];
  }));
  return (choices.get("gzip") ?? choices.get("*") ?? 0) > 0;
}
let publicUpdate;
function sharedPublicUpdate(manual) {
  const now = Date.now();
  if (!publicUpdate || now-publicUpdate.started >= (manual ? 60000 : 10*60000)) {
    const date = new Date(now);
    publicUpdate = {started:now,result:Promise.all([publicFeedUpdate(date),refreshPublicCrypto(date)])
      .then(([feeds,cryptoMarket])=>({...feeds,cryptoMarket})).catch(()=>null)};
  }
  return publicUpdate.result;
}
export async function handle(req,res,dir=new URL("./dist/",import.meta.url),tenantService,handleAuth,paperSchedule) {
  res.setHeader("X-Content-Type-Options","nosniff");
  const path = req.url?.split("?")[0];
  if (path === "/internal/paper-schedule") {
    const status = req.method === "POST" && paperSchedule
      ? await paperSchedule.tick(req.headers["x-paper-scheduler"]).catch(()=>503) : 404;
    res.writeHead(status,{"Cache-Control":"no-store"}).end();
    return;
  }
  if (path === "/api/public-update" && ["GET","POST"].includes(req.method)) {
    const manual = req.method === "POST";
    if (manual && req.headers["sec-fetch-site"] === "cross-site") {
      res.writeHead(403).end();
      return;
    }
    const result = await sharedPublicUpdate(manual);
    res.writeHead(result ? 200 : 503,{"Content-Type":"application/json","Cache-Control":manual ? "no-store" : "public, max-age=60"});
    res.end(JSON.stringify({version:manifest.version,...result}));
    return;
  }
  if (path?.startsWith("/account-api/")) {
    if (handleAuth) return handleAuth(req,res,handleAccount);
    return handleAccount();
  }
  async function handleAccount(session) {
    const headers = new Headers(req.headers);
    headers.delete("authorization");
    if (session) headers.set("authorization","Bearer "+session);
    const reply = tenantService ? await tenantService({
      path, method:req.method, headers, searchParams:new URL(req.url,"http://localhost").searchParams,
      async readJson(limit=2048) {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > limit) {
            req.resume();
            return null;
          }
          chunks.push(chunk);
        }
        try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return null; }
      },
    }) : {status:404,data:{error:"Account access is unavailable."}};
    res.writeHead(reply.status,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(reply.data));
    return;
  }
  if (!["GET","HEAD"].includes(req.method) || !files.has(path)) {
    res.writeHead(404).end(); return;
  }
  try {
    const asset = await staticAsset(new URL(path === "/" ? "index.html" : path.slice(1),dir));
    const compressed = acceptsGzip(req.headers["accept-encoding"]);
    const body = compressed ? asset.gzip : asset.body;
    const etag = '"' + asset.etag + (compressed ? "-gzip" : "") + '"';
    const headers = {
      "Cache-Control":files.get(path) === "text/html" ? "no-cache" : "public, max-age=300",
      "Content-Type":files.get(path)+"; charset=utf-8",
      Vary:"Accept-Encoding",
      ETag:etag,
    };
    if (compressed) headers["Content-Encoding"] = "gzip";
    const validators = (req.headers["if-none-match"] ?? "").split(",").map(value => value.trim().replace(/^W\//,""));
    if (validators.includes(etag) || validators.includes("*")) return res.writeHead(304,headers).end();
    headers["Content-Length"] = body.length;
    res.writeHead(200,headers).end(req.method==="HEAD"?undefined:body);
  } catch {res.writeHead(503).end("Build the demo first.");}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let tenantService;
  let paperSchedule;
  let handleAuth;
  if (process.env.DEMO_ACCOUNT_ORIGIN) {
    const { createTenantService, openConnectionStore, createHostedConnectionStore, createHostedSnapshotStore } = await import("./lib/tenant-service.mjs");
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => /^(?:DEMO_|USAGE_RENDER_|ROBINHOOD_SNAPSHOT_|ROBINHOOD_CRYPTO_|SNAPTRADE_)/.test(name) || name === "RENDER_SERVICE_ID")
      .map(([name, value]) => [name, value.trim()]));
    const { DEMO_ACCOUNT_ORIGIN, DEMO_ACCOUNT_DB, DEMO_ACCOUNT_ENCRYPTION_KEY,
      DEMO_AUTH_URL, DEMO_AUTH_PUBLISHABLE_KEY, DEMO_SUPABASE_SECRET_KEY } = env;
    const issues = [];
    if (!DEMO_AUTH_URL) issues.push("DEMO_AUTH_URL is missing");
    if (!DEMO_AUTH_PUBLISHABLE_KEY) issues.push("DEMO_AUTH_PUBLISHABLE_KEY is missing");
    if (!DEMO_ACCOUNT_DB && !DEMO_SUPABASE_SECRET_KEY) issues.push("DEMO_SUPABASE_SECRET_KEY is missing (required on Render)");
    if (DEMO_SUPABASE_SECRET_KEY && !/^sb_secret_[A-Za-z0-9_-]+$/.test(DEMO_SUPABASE_SECRET_KEY)) {
      issues.push("DEMO_SUPABASE_SECRET_KEY must be a Supabase key beginning with sb_secret_");
    }
    if (!/^[a-f0-9]{64}$/i.test(DEMO_ACCOUNT_ENCRYPTION_KEY ?? "")) {
      issues.push("DEMO_ACCOUNT_ENCRYPTION_KEY must have exactly 64 hexadecimal characters");
    }
    if (issues.length) throw Error("Invalid account settings: " + issues.join("; "));
    const { createTenantAuth } = await import("./lib/tenant-auth.mjs");
    const encryptionKey = Buffer.from(DEMO_ACCOUNT_ENCRYPTION_KEY,"hex");
    const store = DEMO_SUPABASE_SECRET_KEY ? createHostedConnectionStore({projectUrl:DEMO_AUTH_URL,serviceKey:DEMO_SUPABASE_SECRET_KEY,encryptionKey}) : openConnectionStore(DEMO_ACCOUNT_DB,encryptionKey);
    const snapshotStore = DEMO_SUPABASE_SECRET_KEY && createHostedSnapshotStore({projectUrl:DEMO_AUTH_URL,
      serviceKey:DEMO_SUPABASE_SECRET_KEY,encryptionKey});
    const usageStore = DEMO_SUPABASE_SECRET_KEY && createHostedSnapshotStore({projectUrl:DEMO_AUTH_URL,
      serviceKey:DEMO_SUPABASE_SECRET_KEY,encryptionKey,kind:"usage"});
    const usageSources = usageStore && createUsageSources({projectUrl:DEMO_AUTH_URL,serviceKey:DEMO_SUPABASE_SECRET_KEY,
      renderKey:env.USAGE_RENDER_API_KEY,renderServiceId:env.RENDER_SERVICE_ID || env.USAGE_RENDER_SERVICE_ID});
    const browserPush = DEMO_SUPABASE_SECRET_KEY && createBrowserPush({projectUrl:DEMO_AUTH_URL,
      serviceKey:DEMO_SUPABASE_SECRET_KEY,encryptionKey,appOrigin:DEMO_ACCOUNT_ORIGIN});
    if (DEMO_SUPABASE_SECRET_KEY) paperSchedule = createPaperSchedule({projectUrl:DEMO_AUTH_URL,
      serviceKey:DEMO_SUPABASE_SECRET_KEY,store,browserPush});
    let robinhoodSource = env.ROBINHOOD_SNAPSHOT_URL && env.ROBINHOOD_SNAPSHOT_TOKEN && env.ROBINHOOD_SNAPSHOT_OWNER_ID
      ? {url:env.ROBINHOOD_SNAPSHOT_URL,token:env.ROBINHOOD_SNAPSHOT_TOKEN,ownerId:env.ROBINHOOD_SNAPSHOT_OWNER_ID}
      : undefined;
    if (env.SNAPTRADE_CLIENT_ID && env.SNAPTRADE_CONSUMER_KEY && env.SNAPTRADE_ROBINHOOD_LAST4 && env.ROBINHOOD_SNAPSHOT_OWNER_ID) {
      const {createSnapTradeSource} = await import("./lib/snaptrade.mjs");
      const {createRobinhoodCryptoSource} = await import("./lib/robinhood-crypto.mjs");
      const cryptoSource = env.ROBINHOOD_CRYPTO_API_KEY && env.ROBINHOOD_CRYPTO_PRIVATE_KEY && env.ROBINHOOD_CRYPTO_LAST4
        ? createRobinhoodCryptoSource({apiKey:env.ROBINHOOD_CRYPTO_API_KEY,
          privateKey:env.ROBINHOOD_CRYPTO_PRIVATE_KEY,publicKey:env.ROBINHOOD_CRYPTO_PUBLIC_KEY,
          accountLast4:env.ROBINHOOD_CRYPTO_LAST4}) : undefined;
      robinhoodSource = {ownerId:env.ROBINHOOD_SNAPSHOT_OWNER_ID,load:createSnapTradeSource({
        clientId:env.SNAPTRADE_CLIENT_ID,consumerKey:env.SNAPTRADE_CONSUMER_KEY,accountLast4:env.SNAPTRADE_ROBINHOOD_LAST4,
        cryptoSource,
      })};
    }
    const {createOracleRobinhood} = await import("./lib/oracle-robinhood.mjs");
    const oracleRobinhood = snapshotStore && env.ROBINHOOD_SNAPSHOT_OWNER_ID && env.ROBINHOOD_SNAPSHOT_PUBLISH_TOKEN
      ? createOracleRobinhood({projectUrl:DEMO_AUTH_URL,serviceKey:DEMO_SUPABASE_SECRET_KEY,
        ownerId:env.ROBINHOOD_SNAPSHOT_OWNER_ID,token:env.ROBINHOOD_SNAPSHOT_PUBLISH_TOKEN})
      : undefined;
    tenantService = createTenantService({authUrl:DEMO_AUTH_URL,publishableKey:DEMO_AUTH_PUBLISHABLE_KEY,robinhoodSource,oracleRobinhood,
      appOrigin:new URL(DEMO_ACCOUNT_ORIGIN).origin,store,browserPush,paperSchedule,snapshotStore,usageStore,usageSources});
    handleAuth = createTenantAuth({authUrl:DEMO_AUTH_URL,publishableKey:DEMO_AUTH_PUBLISHABLE_KEY,appOrigin:DEMO_ACCOUNT_ORIGIN});
  }
  const server = createServer((req,res)=>handle(req,res,undefined,tenantService,handleAuth,paperSchedule));
  server.listen(Number(process.env.PORT ?? 4173),process.env.HOST || "127.0.0.1",()=>console.log("Preview: http://127.0.0.1:"+server.address().port));
}
import {createUsageSources} from "./lib/usage-sources.mjs";
