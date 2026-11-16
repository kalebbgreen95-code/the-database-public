import { createHash, randomBytes } from "node:crypto";

const cookieOptions = "Path=/; Secure; HttpOnly; SameSite=Lax";
const cookie = (name, value, seconds) => `${name}=${value}; ${cookieOptions}; Max-Age=${seconds}`;
const verifierCookie = "__Host-db-verifier";
const sessionCookie = "__Host-db-session";
const refreshCookie = "__Host-db-refresh";
const sessionPattern = /^[A-Za-z0-9._-]{20,3500}$/;
const refreshPattern = /^[A-Za-z0-9._-]{8,512}$/;
const rememberSeconds = 30 * 24 * 3600;

function cookies(value = "") {
  return new Map(value.split(";").map(entry => {
    const [name, ...parts] = entry.trim().split("=");
    return [name, parts.join("=")];
  }));
}

export function createTenantAuth({authUrl, publishableKey, appOrigin, fetcher = fetch}) {
  const auth = new URL(authUrl);
  const origin = new URL(appOrigin);
  if (auth.protocol !== "https:" || origin.protocol !== "https:" ||
      auth.href !== auth.origin + "/" || origin.href !== origin.origin + "/") {
    throw Error("Account mode requires HTTPS origins.");
  }
  const callback = new URL("/account-api/callback", origin);
  const backToAccount = status => "/?account=" + status;
  const refreshing = new Map();
  const expiredSession = [cookie(sessionCookie,"",0),cookie(refreshCookie,"",0)];
  const validAccess = data => sessionPattern.test(data.access_token ?? "") &&
    Number.isFinite(data.expires_in) && data.expires_in > 5;
  function sessionCookies(data) {
    return [
      cookie(sessionCookie,data.access_token,Math.floor(Math.min(3600,data.expires_in)-5)),
      refreshPattern.test(data.refresh_token ?? "")
        ? cookie(refreshCookie,data.refresh_token,rememberSeconds) : expiredSession[1],
    ];
  }
  function refreshSession(token) {
    if (refreshing.has(token)) return refreshing.get(token);
    const request = (async () => {
      const response = await fetcher(new URL("/auth/v1/token?grant_type=refresh_token",auth),{
        method:"POST",redirect:"error",signal:AbortSignal.timeout(6000),
        headers:{apikey:publishableKey,"Content-Type":"application/json"},
        body:JSON.stringify({refresh_token:token}),
      });
      if ([400,401,403].includes(response.status)) return null;
      if (!response.ok) throw Error("Session renewal unavailable.");
      const data = await response.json();
      if (!validAccess(data) || !refreshPattern.test(data.refresh_token ?? "")) {
        throw Error("Unexpected session response.");
      }
      return data;
    })().finally(() => refreshing.delete(token));
    refreshing.set(token,request);
    return request;
  }

  return async function handleAuth(req, res, service) {
    const requestUrl = new URL(req.url, origin);
    const jar = cookies(req.headers.cookie);
    const session = jar.get(sessionCookie) ?? "";
    const refresh = jar.get(refreshCookie) ?? "";
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    const json = (status, body) => res.writeHead(status,{"Content-Type":"application/json"}).end(JSON.stringify(body));
    const redirect = (target, values = []) => res.writeHead(303, {
      Location:String(target), ...(values.length ? {"Set-Cookie":values} : {}),
    }).end();
    async function accessToken() {
      if (sessionPattern.test(session)) return session;
      if (!refreshPattern.test(refresh)) return undefined;
      const data = await refreshSession(refresh);
      res.setHeader("Set-Cookie",data ? sessionCookies(data) : expiredSession);
      return data?.access_token;
    }
    switch (requestUrl.pathname) {
      case "/account-api/config":
        if (req.method !== "GET") return json(405,{});
        try { return json(200,{accountMode:true,signedIn:Boolean(await accessToken())}); }
        catch { return json(200,{accountMode:true,signedIn:true}); }
      case "/account-api/sign-in": {
        if (req.method !== "POST" || req.headers.origin !== origin.origin) return json(403,{});
        const verifier = randomBytes(48).toString("base64url");
        const target = new URL("/auth/v1/authorize", auth);
        target.search = new URLSearchParams({
          provider:"github", redirect_to:callback.href,
          code_challenge:createHash("sha256").update(verifier).digest("base64url"),
          code_challenge_method:"s256",
        }).toString();
        res.setHeader("Set-Cookie",cookie(verifierCookie,verifier,600));
        return json(200,{authorize:target.href});
      }
      case "/account-api/callback": {
        const code = requestUrl.searchParams.get("code") ?? "";
        const verifier = jar.get(verifierCookie) ?? "";
        const expired = cookie(verifierCookie,"",0);
        if (req.method !== "GET" || !/^[A-Za-z0-9_-]{10,250}$/.test(code) ||
            !/^[A-Za-z0-9_-]{64}$/.test(verifier)) return redirect(backToAccount("failed"),[expired]);
        try {
          const tokenUrl = new URL("/auth/v1/token?grant_type=pkce", auth);
          const response = await fetcher(tokenUrl,{method:"POST",redirect:"error",signal:AbortSignal.timeout(6000),
            headers:{apikey:publishableKey,"Content-Type":"application/json"},
            body:JSON.stringify({auth_code:code,code_verifier:verifier})});
          if (!response.ok) return redirect(backToAccount("failed"),[expired]);
          const data = await response.json();
          if (!validAccess(data)) {
            return redirect(backToAccount("failed"),[expired]);
          }
          return redirect(backToAccount("ready"),[expired,...sessionCookies(data)]);
        } catch {
          return redirect(backToAccount("failed"),[expired]);
        }
      }
      case "/account-api/sign-out":
        if (req.method !== "POST" || req.headers.origin !== origin.origin) return json(403,{});
        try {
          const token = await accessToken();
          if (token) {
            await fetcher(new URL("/auth/v1/logout?scope=local", auth),{method:"POST",redirect:"error",
              signal:AbortSignal.timeout(3000),headers:{apikey:publishableKey,authorization:"Bearer "+token}});
          }
        } catch {}
        res.setHeader("Set-Cookie",expiredSession);
        return json(200,{});
      default:
        let token;
        try { token = await accessToken(); }
        catch { return json(503,{error:"Session renewal is temporarily unavailable."}); }
        return service(token);
    }
  };
}
