import assert from "node:assert/strict";
import test from "node:test";
import { createTenantService, openConnectionStore, createHostedConnectionStore } from "./lib/tenant-service.mjs";
import { randomBytes } from "node:crypto";

test("Oracle publishes an exact Robinhood value only to the configured account", async () => {
  const ownerId = "11111111-1111-1111-1111-111111111111";
  const token = "publisher-fixture";
  const snapshot = {asOf:"2026-11-15T23:00:00.000Z",accountValue:12500,positions:[]};
  let saved;
  const handler = createTenantService({
    authUrl:"https://auth.example",publishableKey:"mock-key",appOrigin:"https://app.example",store:{},
    oracleRobinhood:{ownerId,token},
    snapshotStore:{save:async (id,value)=>{ assert.equal(id,ownerId); saved=value; return true; }},
  });
  const upload = (credential,body) => handler({
    path:"/account-api/robinhood-publish",method:"POST",
    headers:new Headers({"x-robinhood-publisher-token":credential}),readJson:async()=>body,
  });
  assert.equal((await upload("wrong",snapshot)).status,401);
  assert.equal(saved,undefined);
  assert.equal((await upload(token,snapshot)).status,200);
  assert.deepEqual(saved,{...snapshot,valueScope:"robinhood"});
});

test("Robinhood refresh only imports newer snapshots for the configured owner", async () => {
  const owner = "11111111-1111-1111-1111-111111111111";
  const other = "22222222-2222-2222-2222-222222222222";
  const origin = "https://demo.example";
  const snapshot = {asOf:"2026-11-15T20:00:00.000Z",accountValue:100,positions:[]};
  let saved;
  let upstreamCalls = 0;
  const handler = createTenantService({
    authUrl:"https://auth.example",publishableKey:"mock-key",appOrigin:origin,store:{},
    robinhoodSource:{ownerId:owner,url:"https://snapshots.example/robinhood.json",token:"relay-key"},
    snapshotStore:{
      get:async id => id === owner ? saved : null,
      save:async (id,value) => { assert.equal(id,owner); saved = value; return true; },
    },
    fetcher:async (url,options) => {
      if (new URL(url).hostname === "auth.example") {
        return Response.json({id:options.headers.authorization.endsWith("owner") ? owner : other});
      }
      upstreamCalls++;
      assert.equal(options.headers.Authorization,"Bearer relay-key");
      assert.equal(options.redirect,"error");
      return Response.json(snapshot);
    },
  });
  const refresh = suffix => handler({
    path:"/account-api/robinhood-snapshot",method:"POST",
    headers:new Headers({origin,authorization:"Bearer "+"x".repeat(24)+suffix}),
  });
  assert.deepEqual((await refresh("other")).data,{snapshot:null,sourceConfigured:false});
  assert.equal(upstreamCalls,0);
  assert.deepEqual((await refresh("owner")).data,{snapshot,updated:true});
  assert.deepEqual((await refresh("owner")).data,{snapshot,updated:false});
  assert.deepEqual(saved,snapshot);
});

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
        if (url.pathname === "/v2/clock") return Response.json({is_open:false});
        if (url.pathname === "/v1beta3/crypto/us/bars") {
          assert.equal(url.hostname,"data.alpaca.markets");
          assert.equal(url.searchParams.get("timeframe"),"5Min");
          return Response.json({bars:{}});
        }
        if (url.pathname === "/v2/positions") return Response.json([{symbol:"SPY",qty:"1",market_value:"250",asset_id:"PRIVATE"}]);
        if (url.pathname === "/v2/orders") return Response.json([{symbol:"SPY",side:"buy",status:"filled",filled_qty:"1",id:"PRIVATE"}]);
        assert.equal(url.href, "https://paper-api.alpaca.markets/v2/account");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers["APCA-API-SECRET-KEY"], credentials.secret);
        return Response.json({account_number:"PRIVATE", status:"ACTIVE", equity:"5000", cash:"5000"});
      },
    });
    const call = (method, suffix = "", requestOrigin = origin, data = credentials, path = "/account-api/alpaca-paper") =>
      handler({path,method,readJson:async()=>data,
        headers:new Headers({origin:requestOrigin,...(suffix ? {authorization:"Bearer "+ "x".repeat(20)+suffix} : {})})});
    assert.equal((await call("GET")).status, 401);
    assert.equal((await call("PUT","a","https://other.example")).status, 403);
    assert.deepEqual((await call("PUT","a",origin,{...credentials,userId:second})).data,
      {connected:true,account:{status:"ACTIVE",equity:5000,cash:5000,buyingPower:null}});
    assert.equal((await call("GET","a")).data.connected, true);
    assert.deepEqual((await call("GET","b")).data,{connected:false});
    const activity = suffix => call("GET",suffix,origin,credentials,"/account-api/paper-activity");
    assert.equal((await activity("")).status,401);
    assert.deepEqual((await activity("b")).data,{connected:false});
    const ownActivity = (await activity("a")).data;
    assert.equal(ownActivity.positions[0].symbol,"SPY");
    assert.equal(ownActivity.orders[0].status,"filled");
    assert.ok(!JSON.stringify(ownActivity).includes("PRIVATE"));
    const preview = suffix => call("GET",suffix,origin,credentials,"/account-api/paper-preview");
    assert.equal((await preview("")).status,401);
    assert.deepEqual((await preview("b")).data,{connected:false});
    const ownPreview=(await preview("a")).data;
    assert.equal(ownPreview.etfs.status,"Stock market closed");
    assert.equal(ownPreview.crypto.rows.length,6);
    assert.ok(ownPreview.crypto.rows.every(row=>row.signal==="Unavailable"));
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
