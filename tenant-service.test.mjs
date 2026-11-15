import assert from "node:assert/strict";
import test from "node:test";
import { createTenantService, openConnectionStore, createHostedConnectionStore } from "./lib/tenant-service.mjs";
import { randomBytes } from "node:crypto";

test("a paper connection is accessible only to its authenticated owner", async () => {
  const store = openConnectionStore(":memory:", randomBytes(32));
  try {
    const first = "11111111-1111-1111-1111-111111111111";
    const second = "22222222-2222-2222-2222-222222222222";
    const origin = "https://demo.example";
    const credentials = {keyId:"paper-test-key", secret:"paper-test-secret"};
    const handler = createTenantService({
      authUrl:"https://auth.example", publishableKey:"mock-publishable-key", appOrigin:origin, store,
      fetcher:async (url, options) => {
        url = new URL(url);
        if (url.hostname === "auth.example") {
          const token = options.headers.authorization;
          const id = token.endsWith("a") ? first : token.endsWith("b") ? second : null;
          return Response.json({id}, {status:id ? 200 : 401});
        }
        assert.equal(url.href, "https://paper-api.alpaca.markets/v2/account");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers["APCA-API-SECRET-KEY"], credentials.secret);
        return Response.json({account_number:"PRIVATE", status:"ACTIVE", equity:"5000", cash:"5000"});
      },
    });
    const call = (method, suffix = "", requestOrigin = origin, data = credentials) =>
      handler({path:"/account-api/alpaca-paper",method,readJson:async()=>data,
        headers:new Headers({origin:requestOrigin,...(suffix ? {authorization:"Bearer "+ "x".repeat(20)+suffix} : {})})});
    assert.equal((await call("GET")).status, 401);
    assert.equal((await call("PUT","a","https://other.example")).status, 403);
    assert.deepEqual((await call("PUT","a",origin,{...credentials,userId:second})).data,
      {connected:true,account:{status:"ACTIVE",equity:5000,cash:5000,buyingPower:null}});
    assert.equal((await call("GET","a")).data.connected, true);
    assert.deepEqual((await call("GET","b")).data,{connected:false});
    await call("DELETE","b");
    assert.equal((await call("GET","a")).data.connected, true);
    await call("DELETE","a");
    assert.equal(store.get(first), null);
  } finally {store.close();}
});

test("hosted credentials are encrypted before storage and bound to the owner", async () => {
  const first = "11111111-1111-1111-1111-111111111111";
  const second = "22222222-2222-2222-2222-222222222222";
  const credentials = {keyId:"paper-test-key",secret:"paper-test-secret"};
  let record;
  const store = createHostedConnectionStore({
    projectUrl:"https://auth.example",serviceKey:"sb_secret_test",encryptionKey:randomBytes(32),
    async fetcher(url, options) {
      assert.equal(url.pathname,"/rest/v1/paper_connections");
      assert.equal(options.headers.apikey,"sb_secret_test");
      assert.equal(options.redirect,"error");
      if (options.method==="POST") {
        assert.ok(!options.body.includes(credentials.secret));
        record=JSON.parse(options.body);
        assert.equal(record.user_id,first);
        return new Response(null,{status:201});
      }
      assert.match(url.searchParams.get("user_id"),/^eq\.[\da-f-]+$/);
      return Response.json([{encrypted_keys:record.encrypted_keys}]);
    },
  });
  await store.set(first,credentials);
  assert.deepEqual(await store.get(first),credentials);
  await assert.rejects(store.get(second));
});
