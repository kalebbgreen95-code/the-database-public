import { createECDH, createHmac, createPrivateKey, sign } from "node:crypto";

const networks = new Set(["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com","push.services.mozilla.com"]);

export function pushEndpoint(input) {
  if (typeof input !== "string" || input.length < 16 || input.length > 1024) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
      !(networks.has(url.hostname) || url.hostname.endsWith(".notify.windows.com"))) return null;
  return url.href;
}

export function createBrowserPush({projectUrl,serviceKey,encryptionKey,appOrigin,fetcher=fetch}) {
  const curve = createECDH("prime256v1");
  const secret = createHmac("sha256",encryptionKey).update("the-database/web-push/v1").digest();
  curve.setPrivateKey(secret);
  const publicBytes = curve.getPublicKey();
  const publicKey = publicBytes.toString("base64url");
  const privateKey = createPrivateKey({format:"jwk",key:{kty:"EC",crv:"P-256",
    d:secret.toString("base64url"),x:publicBytes.subarray(1,33).toString("base64url"),
    y:publicBytes.subarray(33).toString("base64url")}});
  const resource = new URL("/rest/v1/paper_push_devices",projectUrl);
  async function db(userId,method,endpoint) {
    const url = new URL(resource);
    const headers = {apikey:serviceKey};
    const options = {method,headers,redirect:"error",signal:AbortSignal.timeout(5000)};
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers.Prefer = "resolution=ignore-duplicates";
      options.body = JSON.stringify({user_id:userId,endpoint});
    } else {
      url.searchParams.set("user_id","eq."+userId);
      if (endpoint) url.searchParams.set("endpoint","eq."+endpoint);
      if (method === "GET") url.searchParams.set("select","endpoint");
    }
    const response = await fetcher(url,options);
    if (!response.ok) throw Error("Push subscription storage unavailable.");
    return method === "GET" ? response.json() : undefined;
  }
  async function send(userId,endpoint) {
    const checked = pushEndpoint(endpoint);
    if (!checked) return false;
    const url = new URL(checked);
    const encode = value=>Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = encode({typ:"JWT",alg:"ES256"}) + "." +
      encode({aud:url.origin,exp:Math.floor(Date.now()/1000)+3600,sub:appOrigin});
    const signature = sign("sha256",Buffer.from(token),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
    const response = await fetcher(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(5000),
      headers:{Authorization:"vapid t="+token+"."+signature+", k="+publicKey,TTL:"900",Urgency:"normal"}});
    if (response.status === 404 || response.status === 410) await db(userId,"DELETE",endpoint);
    return response.ok;
  }
  const testTimes = new Map();
  return {
    publicKey,
    async subscribe(userId,endpoint) {
      const devices = await db(userId,"GET");
      if (devices.some(device=>device.endpoint===endpoint)) return;
      if (devices.length >= 8) throw Error("Device limit reached.");
      await db(userId,"POST",endpoint);
    },
    remove:(userId,endpoint)=>db(userId,"DELETE",endpoint),
    async test(userId,endpoint) {
      const now = Date.now();
      for (const [id,at] of testTimes) if (now-at > 15000) testTimes.delete(id);
      if (testTimes.has(userId)) return 429;
      testTimes.set(userId,now);
      if (!(await db(userId,"GET",endpoint)).length) return 404;
      return await send(userId,endpoint) ? 200 : 502;
    },
    async notify(userId) {
      const devices = await db(userId,"GET");
      await Promise.allSettled(devices.slice(0,8).map(({endpoint})=>send(userId,endpoint)));
    },
  };
}
