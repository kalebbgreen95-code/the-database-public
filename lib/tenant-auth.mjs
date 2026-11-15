import { createHash, randomBytes } from "node:crypto";

const cookieOptions = "Path=/; Secure; HttpOnly; SameSite=Lax";
const cookie = (name, value, seconds) => `${name}=${value}; ${cookieOptions}; Max-Age=${seconds}`;
const verifierCookie = "__Host-db-verifier";
const sessionCookie = "__Host-db-session";
const sessionPattern = /^[A-Za-z0-9._-]{20,3500}$/;

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

  return async function handleAuth(req, res, service) {
    const requestUrl = new URL(req.url, origin);
    const jar = cookies(req.headers.cookie);
    const session = jar.get(sessionCookie) ?? "";
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Referrer-Policy","no-referrer");
    const json = (status, body) => res.writeHead(status,{"Content-Type":"application/json"}).end(JSON.stringify(body));
    const redirect = (target, values = []) => res.writeHead(303, {
      Location:String(target), ...(values.length ? {"Set-Cookie":values} : {}),
    }).end();
    switch (requestUrl.pathname) {
      case "/account-api/config":
        return req.method === "GET" ? json(200,{accountMode:true}) : json(405,{});
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
          if (!sessionPattern.test(data.access_token ?? "") || !Number.isFinite(data.expires_in) || data.expires_in < 1) {
            return redirect(backToAccount("failed"),[expired]);
          }
          return redirect(backToAccount("ready"),[expired,cookie(sessionCookie,data.access_token,Math.min(3600,data.expires_in))]);
        } catch {
          return redirect(backToAccount("failed"),[expired]);
        }
      }
      case "/account-api/sign-out":
        if (req.method !== "POST" || req.headers.origin !== origin.origin) return json(403,{});
        if (sessionPattern.test(session)) {
          try {
            await fetcher(new URL("/auth/v1/logout?scope=local", auth),{method:"POST",redirect:"error",
              signal:AbortSignal.timeout(3000),headers:{apikey:publishableKey,authorization:"Bearer "+session}});
          } catch {}
        }
        res.setHeader("Set-Cookie",cookie(sessionCookie,"",0));
        return json(200,{});
      default:
        return service(sessionPattern.test(session) ? session : undefined);
    }
  };
}
