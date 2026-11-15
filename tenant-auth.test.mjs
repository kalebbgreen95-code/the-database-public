import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTenantAuth } from "./lib/tenant-auth.mjs";

test("a GitHub sign-in code requires the originating browser's PKCE verifier",async()=>{
  const appOrigin = "https://app.example";
  const accessToken = "example.mock."+"a".repeat(28);
  let expected;
  let exchanges = 0;
  const auth = createTenantAuth({appOrigin,authUrl:"https://auth.example",publishableKey:"test-key",
    fetcher:async (url,options)=>{
      exchanges++;
      assert.equal(url.href,"https://auth.example/auth/v1/token?grant_type=pkce");
      assert.deepEqual(JSON.parse(options.body),{auth_code:"test-auth-code",code_verifier:expected});
      return Response.json({access_token:accessToken,expires_in:900});
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
  assert.match(session,/Secure; HttpOnly; SameSite=Lax; Max-Age=900$/);
  assert.ok(!JSON.stringify(success.body ?? "").includes(accessToken));
  await call("/account-api/alpaca-paper","GET",{cookie:session.split(";")[0]},token=>assert.equal(token,accessToken));
});
