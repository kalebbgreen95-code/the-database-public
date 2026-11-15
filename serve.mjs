import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const files = new Map([["/","text/html"],["/index.html","text/html"],["/dashboard.js","text/javascript"],["/style.css","text/css"],["/briefing.mjs","text/javascript"],["/stock-checklist.mjs","text/javascript"],["/public-data.js","text/javascript"],["/account.js","text/javascript"],["/snapshot.json","application/json"]]);
export async function handle(req,res,dir=new URL("./dist/",import.meta.url),tenantService,handleAuth) {
  res.setHeader("X-Content-Type-Options","nosniff");
  const path = req.url?.split("?")[0];
  if (path?.startsWith("/account-api/")) {
    if (handleAuth) return handleAuth(req,res,handleAccount);
    return handleAccount();
  }
  async function handleAccount(session) {
    const headers = new Headers(req.headers);
    headers.delete("authorization");
    if (session) headers.set("authorization","Bearer "+session);
    const reply = tenantService ? await tenantService({
      path, method:req.method, headers,
      async readJson() {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2048) {
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
    const body = await readFile(new URL(path === "/" ? "index.html" : path.slice(1),dir));
    res.writeHead(200,{"Content-Type":files.get(path)+"; charset=utf-8"}).end(req.method==="HEAD"?undefined:body);
  } catch {res.writeHead(503).end("Build the demo first.");}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let tenantService;
  let handleAuth;
  if (process.env.DEMO_ACCOUNT_ORIGIN) {
    const { createTenantService, openConnectionStore, createHostedConnectionStore } = await import("./lib/tenant-service.mjs");
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => name.startsWith("DEMO_"))
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
    tenantService = createTenantService({authUrl:DEMO_AUTH_URL,publishableKey:DEMO_AUTH_PUBLISHABLE_KEY,
      appOrigin:new URL(DEMO_ACCOUNT_ORIGIN).origin,store});
    handleAuth = createTenantAuth({authUrl:DEMO_AUTH_URL,publishableKey:DEMO_AUTH_PUBLISHABLE_KEY,appOrigin:DEMO_ACCOUNT_ORIGIN});
  }
  const server = createServer((req,res)=>handle(req,res,undefined,tenantService,handleAuth));
  server.listen(Number(process.env.PORT ?? 4173),process.env.HOST || "127.0.0.1",()=>console.log("Preview: http://127.0.0.1:"+server.address().port));
}
