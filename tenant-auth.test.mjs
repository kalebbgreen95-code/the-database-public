import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTenantAuth } from "./lib/tenant-auth.mjs";

test("a GitHub sign-in code requires the originating browser's PKCE verifier",async()=>{
  const appOrigin = "https://app.example";
  const accessToken = "example.mock."+"a".repeat(28);
  let expected;
  let exchanges = 0;
  let renewals = 0;
  const refreshToken = "initial-refresh-token";
  const rotatedToken = "rotated-refresh-token";
  const auth = createTenantAuth({appOrigin,authUrl:"https://auth.example",publishableKey:"test-key",
    fetcher:async (url,options)=>{
      if (url.pathname.endsWith("/logout")) {
        assert.equal(options.headers.authorization,"Bearer "+accessToken);
        return new Response(null,{status:204});
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        renewals++;
        const token = JSON.parse(options.body).refresh_token;
        if (token === "revoked-refresh-token") return new Response(null,{status:400});
        assert.equal(token,refreshToken);
        return Response.json({access_token:accessToken,refresh_token:rotatedToken,expires_in:900});
      }
      exchanges++;
      assert.equal(url.href,"https://auth.example/auth/v1/token?grant_type=pkce");
      assert.deepEqual(JSON.parse(options.body),{auth_code:"test-auth-code",code_verifier:expected});
      return Response.json({access_token:accessToken,refresh_token:refreshToken,expires_in:900});
    }});
  const call=async(url,method,headers={},service=()=>assert.fail("Unexpected account request"))=>{
    const response={headers:{},setHeader(name,value){this.headers[name]=value;},
      writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);return this;},
      end(body){this.body=body;}};
    await auth({url,method,headers},response,service);
    return response;
  };
  assert.equal((await call("/account-api/sign-in","POST",{origin:"https://other.example"})).status,403);
  const start=await call("/account-api/sign-in","POST",{origin:appOrigin});
  assert.equal(start.status,200);
  const verifier=start.headers["Set-Cookie"].split(";")[0];
  expected=verifier.slice(verifier.indexOf("=")+1);
  const target=new URL(JSON.parse(start.body).authorize);
  assert.equal(target.searchParams.get("redirect_to"),appOrigin+"/account-api/callback");
  assert.equal(target.searchParams.get("code_challenge"),createHash("sha256").update(expected).digest("base64url"));
  const path="/account-api/callback?code=test-auth-code";
  assert.equal((await call(path,"GET")).headers.Location,"/?account=failed");
  assert.equal(exchanges,0);
  const success=await call(path,"GET",{cookie:verifier});
  assert.equal(success.headers.Location,"/?account=ready");
  const session=success.headers["Set-Cookie"][1];
  assert.match(session,/Secure; HttpOnly; SameSite=Lax; Max-Age=895$/);
  const refresh = success.headers["Set-Cookie"][2];
  assert.match(refresh,/Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  assert.ok(!JSON.stringify(success.body ?? "").includes(accessToken));
  await call("/account-api/alpaca-paper","GET",{cookie:session.split(";")[0]},token=>assert.equal(token,accessToken));
  const headers = {cookie:refresh.split(";")[0]};
  const [config, account] = await Promise.all([
    call("/account-api/config","GET",headers),
    call("/account-api/alpaca-paper","GET",headers,token=>assert.equal(token,accessToken)),
  ]);
  assert.equal(renewals,1);
  assert.equal(JSON.parse(config.body).signedIn,true);
  assert.deepEqual(config.headers["Set-Cookie"],account.headers["Set-Cookie"]);
  assert.match(config.headers["Set-Cookie"][1],new RegExp(rotatedToken));
  const signedOut = await call("/account-api/sign-out","POST",{origin:appOrigin,cookie:session.split(";")[0]});
  assert.ok(signedOut.headers["Set-Cookie"].every(value=>value.endsWith("Max-Age=0")));
  const revoked = await call("/account-api/config","GET",{cookie:"__Host-db-refresh=revoked-refresh-token"});
  assert.equal(JSON.parse(revoked.body).signedIn,false);
  assert.ok(revoked.headers["Set-Cookie"].every(value=>value.endsWith("Max-Age=0")));
});
