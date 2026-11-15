import { previewPaperSignals } from "./paper-preview.mjs";
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

export function createTenantService({authUrl, publishableKey, appOrigin, store, fetcher = fetch}) {
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
  return async ({path, method, headers, readJson}) => {
    const activity = path === "/account-api/paper-activity";
    const preview = path === "/account-api/paper-preview";
    if ((activity || preview) && method !== "GET") return reply(405, {error:"Method unavailable."});
    if (!activity && !preview && path !== accountPath) return reply(404, {error:"Unknown account endpoint."});
    if (!["GET","PUT","DELETE"].includes(method)) return reply(405, {error:"Method unavailable."});
    if (method !== "GET" && headers.get("origin") !== appOrigin) return reply(403, {error:"Origin not allowed."});
    try {
      const userId = await requireUser(headers);
      if (method === "DELETE") {
        await store.delete(userId);
        return reply(200, {connected:false});
      }
      if (method === "GET") {
        const keys = await store.get(userId);
        if (!keys) return reply(200, {connected:false});
        if (preview) return reply(200,{connected:true,...await previewPaperSignals({keys,fetcher})});
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
          paperAccount(keys),loadPaper("/v2/positions"),loadPaper("/v2/orders?status=all&limit=20&direction=desc"),
        ]);
        return reply(200,{connected:true,account,
          positions:positions.map(({symbol,qty,market_value})=>({symbol,quantity:qty,marketValue:market_value})),
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
