import { disableDevicePush, setDeviceSignIn } from "./device-alerts.js?v=209";
import { publicRoute } from "./public-data.js";

const config = await fetch("./account-api/config", {cache:"no-store"}).then(response =>
  response.ok ? response.json() : null).catch(() => null);

if (config?.accountMode) {
  setDeviceSignIn(config.signedIn);
  const pagePicker = document.getElementById("dashboard-page");
  const dialog = document.getElementById("account-dialog");
  const status = document.getElementById("account-status");
  const signIn = document.getElementById("account-sign-in");
  const signOut = document.getElementById("account-sign-out");
  const form = document.getElementById("account-paper-form");
  const balance = document.getElementById("account-paper-balance");
  const disconnect = document.getElementById("account-disconnect");
  const controls = [signIn,signOut,disconnect,...form.elements];
  const money = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"});
  const call = (path,method = "GET",body) => fetch("./account-api/"+path,{
    method,cache:"no-store",credentials:"same-origin",
    ...(body ? {headers:{"Content-Type":"application/json"},body:JSON.stringify(body)} : {}),
  });
  const livePaper = document.getElementById("connected-paper");
  const liveStatus = document.getElementById("connected-paper-status");
  const liveEquity = document.getElementById("connected-paper-equity");
  const liveCash = document.getElementById("connected-paper-cash");
  const livePnl = document.getElementById("connected-paper-pnl");
  const liveDrawdown = document.getElementById("connected-paper-drawdown");
  const liveHistory = document.getElementById("connected-paper-history");
  const liveChart = document.getElementById("connected-paper-chart");
  const livePositions = document.getElementById("connected-paper-positions");
  const livePending = document.getElementById("connected-paper-pending");
  const liveOrders = document.getElementById("connected-paper-orders");
  const liveChecked = document.getElementById("connected-paper-checked");
  const paramsForScreen = new URLSearchParams(location.search);
  const onUsage = paramsForScreen.get("screen") === "usage" || location.hash === "#usage";
  const usageAccount = document.getElementById("usage-account-open");
  const usageStatus = document.getElementById("usage-account-status");
  const renderMeter = document.getElementById("render-usage-meter");
  const et = value=>new Date(value).toLocaleString("en-US",{timeZone:"America/New_York"}) + " ET";
  let usageRequest = 0;
  function showUsage(snapshot) {
    const codex = snapshot?.codex;
    const bandwidth = snapshot?.render;
    document.getElementById("codex-usage-checked").textContent =
      codex ? "Last checked " + et(codex.checkedAt) : "No Codex usage snapshot.";
    document.getElementById("codex-usage-windows").replaceChildren(...(codex?.windows ?? []).map(row=>{
      const item = document.createElement("li");
      const windowLabel = row.minutes%1440 === 0 ? row.minutes/1440 + "-day"
        : row.minutes%60 === 0 ? row.minutes/60 + "-hour" : row.minutes + "-minute";
      item.textContent = windowLabel + " limit · " + row.remaining + "% remaining · Resets " + et(row.resetsAt);
      return item;
    }));
    document.getElementById("render-usage-summary").textContent = bandwidth
      ? bandwidth.usedMB + (bandwidth.scope === "service" ? " MB · The Database service" :
        " MB of " + bandwidth.includedGB + " GB used · Workspace total") + " · " + bandwidth.month +
        " · Last checked " + et(bandwidth.checkedAt)
      : "No Render bandwidth snapshot.";
    renderMeter.hidden = !bandwidth || bandwidth.scope === "service";
    if (bandwidth && bandwidth.scope !== "service") {
      renderMeter.max = bandwidth.includedGB*1000;
      renderMeter.value = bandwidth.usedMB;
    }
  }
  function showUsageSignIn() {
    ++usageRequest;
    showUsage(null);
    usageAccount.hidden = false;
    usageStatus.textContent = "Sign in to view your saved usage.";
  }
  async function fetchUsage(method="GET") {
    const request = ++usageRequest;
    try {
      const response = await call("usage-snapshot",method);
      const result = await response.json();
      if (request !== usageRequest) return;
      if (response.status === 401) return showUsageSignIn();
      if (!response.ok) throw Error(result.error ?? "Usage data unavailable.");
      showUsage(result.snapshot);
      usageAccount.hidden = true;
      usageStatus.textContent = method === "POST" ? [result.updated ? "Usage updated." : "",
        ...(result.missing ?? [])].filter(Boolean).join(" · ") || "Usage is current." : "";
    } catch (error) {
      if (request === usageRequest) usageStatus.textContent = error.message;
      return false;
    }
  }
  if (onUsage) {
    showUsage(null);
    void fetchUsage();
    usageAccount.addEventListener("click",openAccount);
    document.addEventListener("refresh-account-section",event=>{event.detail.push(fetchUsage("POST"));});
  }
  const onPaperScreen = paramsForScreen.get("screen") === "activity" || location.hash === "#activity";
  if (!document.getElementById("overview").hidden) {
    let overviewRequest = 0;
    const publishOverview = detail => document.dispatchEvent(new CustomEvent("overview-paper-balance",{detail}));
    async function refreshOverviewPaper() {
      const request = ++overviewRequest;
      try {
        const response = await call("alpaca-paper");
        if (request !== overviewRequest) return;
        if (response.status === 401) return publishOverview({status:"signed-out"});
        if (!response.ok) throw Error("Paper balance unavailable");
        const data = await response.json();
        if (request === overviewRequest) publishOverview(data.connected
          ? {account:data.account,equityTone:paperEquityTone(data.account.equity)} : {status:"disconnected"});
      } catch {
        if (request === overviewRequest) publishOverview({status:"unavailable"});
        return false;
      }
    }
    publishOverview({status:"loading"});
    void refreshOverviewPaper();
    document.addEventListener("refresh-account-section",event=>{event.detail.push(refreshOverviewPaper());});
    document.addEventListener("paper-connection-changed",()=>{
      publishOverview({status:"loading"});
      void refreshOverviewPaper();
    });
    addEventListener("pageshow",event=>{
      if (event.persisted) {
        publishOverview({status:"loading"});
        void refreshOverviewPaper();
      }
    });
  }
  const onPortfolio = paramsForScreen.get("screen") === "robinhood-portfolio" || location.hash === "#robinhood-portfolio";
  const amount = value => value != null && Number.isFinite(Number(value)) ? money.format(Number(value)) : "unavailable";
  function paperEquityTone(value) {
    return value == null || !Number.isFinite(Number(value)) ? "" : Number(value) < 10000 ? "loss" : "gain";
  }
  function showPaperBalance(element,account) {
    const equity = document.createElement("span");
    equity.className = paperEquityTone(account.equity);
    equity.textContent = amount(account.equity);
    element.replaceChildren("Paper equity ",equity," · Cash " + amount(account.cash));
  }
  function renderPaperScore({account,positions,history}) {
    liveEquity.textContent = amount(account.equity);
    liveEquity.className = paperEquityTone(account.equity);
    liveCash.textContent = amount(account.cash);
    const pnl = positions.every(position=>position.unrealized != null && Number.isFinite(Number(position.unrealized)))
      ? positions.reduce((sum,position)=>sum + Number(position.unrealized),0) : null;
    livePnl.textContent = amount(pnl);

    const points = (history ?? []).filter(point=>point.equity>0).sort((first,second)=>first.at-second.at);
    if (points.length && Number.isFinite(account.equity) && points.at(-1).at < Date.now()) {
      points.push({at:Date.now(),equity:account.equity});
    }
    liveChart.hidden = points.length < 2;
    liveDrawdown.textContent = "Unavailable";
    liveDrawdown.className = "";
    liveHistory.textContent = "Alpaca equity history is unavailable.";
    if (liveChart.hidden) return;

    let peak = points[0].equity;
    let drawdown = 0;
    for (const point of points) {
      peak = Math.max(peak,point.equity);
      drawdown = Math.min(drawdown,point.equity/peak-1);
    }
    const first = points[0], last = points.at(-1);
    liveDrawdown.textContent = (drawdown*100).toFixed(2) + "%";
    liveDrawdown.className = drawdown < 0 ? "loss" : "";
    liveHistory.textContent = "Alpaca equity history · " + et(first.at) + " to " + et(last.at);
    const ctx = liveChart.getContext("2d");
    if (!ctx) return;
    const low = Math.min(...points.map(point=>point.equity));
    const range = peak-low;
    ctx.clearRect(0,0,liveChart.width,liveChart.height);
    ctx.strokeStyle = last.equity < first.equity ? "#ffa3a3" : last.equity > first.equity ? "#8cf0b4" : "#afc0b7";
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((point,index)=>ctx.lineTo(4+index*(liveChart.width-8)/(points.length-1),
      range ? liveChart.height-8-(point.equity-low)/range*(liveChart.height-16) : liveChart.height/2));
    ctx.stroke();
  }
  const snapshotPanel = document.getElementById("robinhood-snapshot-panel");
  const snapshotStatus = document.getElementById("robinhood-snapshot-status");
  const snapshotAccount = document.getElementById("robinhood-snapshot-account");
  const snapshotHoldings = document.getElementById("robinhood-snapshot-holdings");
  let snapshotRequest = 0;
  let snapshotNoticeTimer;
  let snapshotNoticeFade;
  function showSnapshotStatus(message,temporary = false) {
    clearTimeout(snapshotNoticeTimer);
    snapshotNoticeFade?.cancel();
    snapshotStatus.textContent = message;
    if (!temporary) return;
    snapshotNoticeTimer = setTimeout(()=>{
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        snapshotStatus.textContent = "";
        return;
      }
      snapshotNoticeFade = snapshotStatus.animate([{opacity:1},{opacity:0}],{duration:250});
      snapshotNoticeFade.onfinish = ()=>{ snapshotStatus.textContent = ""; };
    },3000);
  }
  function showSnapshot(snapshot) {
    snapshotHoldings.hidden = !snapshot;
    document.dispatchEvent(new CustomEvent("robinhood-snapshot",{detail:snapshot}));
  }
  function showSnapshotSignIn() {
    ++snapshotRequest;
    showSnapshot(null);
    snapshotAccount.hidden = false;
    showSnapshotStatus("Sign in to view your Robinhood Portfolio.");
  }
  async function getSnapshot(method = "GET") {
    const request = ++snapshotRequest;
    try {
      const response = await call("robinhood-snapshot",method);
      if (request !== snapshotRequest) return;
      if (response.status === 401) return showSnapshotSignIn();
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Couldn’t load your Robinhood snapshot.");
      const {snapshot,updated,sourceConfigured,pending} = data;
      if (request !== snapshotRequest) return;
      snapshotAccount.hidden = true;
      showSnapshot(snapshot);
      showSnapshotStatus(method === "POST"
        ? (pending ? "Robinhood sync requested. Showing the last saved snapshot."
          : sourceConfigured === false ? "Live snapshot source is unavailable."
          : updated ? "New Robinhood snapshot imported." : "No newer Robinhood snapshot is available.")
        : (snapshot ? "" : "No Robinhood snapshot is available."), method === "POST" && updated);
    } catch (error) {
      if (request === snapshotRequest) showSnapshotStatus(error.message);
      return false;
    }
  }
  if (onPortfolio) {
    snapshotPanel.hidden = false;
    snapshotAccount.addEventListener("click",openAccount);
    void getSnapshot();
    document.addEventListener("refresh-account-section",event=>{event.detail.push(getSnapshot("POST"));});
    addEventListener("pageshow",event=>{
      if (event.persisted) {
        showSnapshot(null);
        void getSnapshot();
      }
    });
  }
  const previewButton = document.getElementById("paper-preview-check");
  const previewStatus = document.getElementById("paper-preview-status");
  const previewRows = document.getElementById("paper-preview-rows");
  let activityVersion = 0;
  let previewVersion = 0;
  let previewRunning = false;
  const runButton = document.getElementById("paper-run");
  const runStatus = document.getElementById("paper-run-status");
  const scheduleButton = document.getElementById("paper-schedule");
  const scheduleStatus = document.getElementById("paper-schedule-status");
  let scheduled = false;
  function renderSchedule(data) {
    scheduled = data.enabled;
    scheduleButton.textContent = scheduled ? "Disable scheduled paper trading" : "Enable scheduled paper trading";
    scheduleStatus.textContent = scheduled
      ? ["Paper entries on",data.checkedAt ? "Last evaluated " + et(data.checkedAt) : "Waiting for the first scheduled check",
        data.outcome].filter(Boolean).join(" · ")
      : "Scheduled crypto checks are off.";
  }
  async function updateSchedule(method="GET") {
    scheduleButton.disabled = true;
    try {
      const response = await call("paper-schedule",method);
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Paper schedule unavailable.");
      renderSchedule(data);
      scheduleButton.hidden = false;
    } catch (error) {
      scheduleStatus.textContent = error.message;
      return false;
    } finally {
      scheduleButton.disabled = false;
    }
  }
  if (onPaperScreen) {
    void updateSchedule();
    scheduleButton.addEventListener("click",()=>void updateSchedule(scheduled ? "DELETE" : "PUT"));
  }
  runButton.addEventListener("click",async()=>{
    runButton.disabled = true;
    runStatus.textContent = "Checking Alpaca Paper for a qualifying crypto order…";
    try {
      const response = await call("paper-run","POST");
      const data = await response.json();
      runStatus.textContent = response.ok ? data.message : data.error ?? "Paper run unavailable.";
      if (response.ok) void refreshActivity();
    } catch {
      runStatus.textContent = "Paper run unavailable. Check Alpaca Paper activity before retrying.";
    } finally {
      runButton.disabled = false;
    }
  });
  async function refreshPaperSignals() {
    if (previewRunning) return;
    previewRunning = true;
    const version = ++previewVersion;
    previewButton.disabled = true;
    previewStatus.textContent = "Checking Alpaca candles…";
    previewRows.replaceChildren();
    try {
      const response = await call("paper-preview");
      if (!response.ok) throw Error("Signal check unavailable.");
      const preview = await response.json();
      if (version !== previewVersion) return;
      if (!preview.connected) throw Error("Connect an Alpaca Paper account first.");
      previewStatus.textContent = [preview.etfs.status,preview.crypto.status].join(" · ");
      fillList(previewRows,[...preview.etfs.rows,...preview.crypto.rows].map(row=>
        [paperAssetLink(row.symbol)," · " + [row.signal,...row.evidence].join(" · ")]),"No signals available.");
    } catch (error) {
      if (version === previewVersion) previewStatus.textContent = error.message;
    } finally {
      previewButton.disabled = false;
      previewRunning = false;
    }
  }
  previewButton.addEventListener("click",()=>void refreshPaperSignals());
  function paperAssetLink(symbol,assetClass) {
    const ticker = assetClass === "crypto" ? symbol.replace(/\/?USD$/,"/USD") : symbol;
    const link = document.createElement("a");
    link.className = "ticker-link";
    link.href = publicRoute("/asset?" + new URLSearchParams({symbol:ticker}));
    link.textContent = ticker;
    return link;
  }
  function fillList(list, rows, empty) {
    list.replaceChildren(...(rows.length ? rows : [empty]).map(contents=>{
      const item = document.createElement("li");
      item.append(...(Array.isArray(contents) ? contents : [contents]));
      return item;
    }));
  }
  function renderPaperOrders(orders) {
    const columns = ["Symbol","Side","Source","Status","Filled quantity","Gross fill (USD)","Average fill","Time (ET)"];
    if (!orders.length) {
      const row = liveOrders.insertRow();
      const cell = row.insertCell();
      cell.colSpan = columns.length;
      cell.textContent = "No Alpaca orders.";
      return;
    }
    for (const order of orders) {
      const row = liveOrders.insertRow();
      const filled = Number(order.quantity)>0 && Number(order.averagePrice)>0;
      const values = [paperAssetLink(order.symbol),order.side,order.automated ? "Bot" : "Other",order.status,
        order.quantity??"—",filled ? amount(Number(order.quantity)*Number(order.averagePrice)) : "—",
        filled ? amount(order.averagePrice) : "—",order.at ? et(order.at) : "—"];
      values.forEach((value,index)=>{
        const cell = row.insertCell();
        const label = document.createElement("span");
        label.className = "paper-cell-label";
        label.setAttribute("aria-hidden","true");
        label.textContent = columns[index];
        const content = document.createElement("span");
        content.append(value);
        cell.append(label,content);
      });
    }
  }
  function clearActivity() {
    activityVersion++;
    previewVersion++;
    previewRows.replaceChildren();
    previewStatus.textContent = "";
    livePaper.hidden = true;
    liveEquity.textContent = "";
    liveCash.textContent = "";
    livePnl.textContent = "";
    liveDrawdown.textContent = "";
    liveHistory.textContent = "";
    liveChart.hidden = true;
    livePositions.replaceChildren();
    livePending.replaceChildren();
    liveOrders.replaceChildren();
    liveChecked.textContent = "";
  }
  async function refreshActivity() {
    if (!onPaperScreen) return;
    const version = ++activityVersion;
    try {
      const response = await call("paper-activity?view=dashboard");
      if (version !== activityVersion) return;
      if (response.status === 401) {
        setDeviceSignIn(false);
        return clearActivity();
      }
      if (!response.ok) throw Error("Alpaca Paper activity is temporarily unavailable.");
      setDeviceSignIn(true);
      const data = await response.json();
      if (version !== activityVersion) return;
      if (!data.connected) return clearActivity();
      livePaper.hidden = false;
      liveStatus.textContent = "";
      renderPaperScore(data);
      fillList(livePending,(data.pending??[]).map(row=>[paperAssetLink(row.symbol)," · " + row.side + " · " + row.status]),
        data.pending ? "No pending orders." : "Pending orders unavailable.");
      fillList(livePositions,data.positions.map(row=>[paperAssetLink(row.symbol,row.assetClass)," · " + row.quantity +
        " @ " + amount(row.entryPrice) + " · " + amount(row.costBasis) + " entry cost · " + amount(row.marketValue) + " market value"]),
        "No open positions.");
      liveOrders.replaceChildren();
      renderPaperOrders(data.orders);
      liveChecked.textContent = data.checkedAt ? "Last checked " + et(data.checkedAt) : "";
    } catch {
      if (version !== activityVersion) return;
      liveStatus.textContent = "Alpaca Paper activity could not be refreshed.";
      livePaper.hidden = false;
      return false;
    }
  }
  if (onPaperScreen) {
    void refreshActivity().then(()=>{if (!livePaper.hidden) void refreshPaperSignals();});
    document.addEventListener("refresh-account-section",event=>{event.detail.push(refreshActivity(),updateSchedule(),refreshPaperSignals());});
    addEventListener("pageshow", event => { if (event.persisted) void refreshActivity(); });
  }
  function renderAccount(data) {
    if (data.connected) showPaperBalance(balance,data.account);
    else balance.textContent = "Connect an Alpaca Paper account to view its balance here.";
    disconnect.hidden = !data.connected;
  }
  async function update() {
    const response = await call("alpaca-paper");
    if (response.status === 401) {
      setDeviceSignIn(false);
      signIn.hidden = false;
      signOut.hidden = true;
      form.hidden = true;
      disconnect.hidden = true;
      balance.textContent = "";
      return;
    }
    signIn.hidden = true;
    signOut.hidden = false;
    form.hidden = false;
    if (!response.ok) throw Error("Could not read the paper account.");
    setDeviceSignIn(true);
    renderAccount(await response.json());
  }
  async function run(action) {
    controls.forEach(control => {control.disabled = true;});
    try { await action(); }
    catch (error) { status.textContent = error.message || "The account action failed."; }
    finally { controls.forEach(control => {control.disabled = false;}); }
  }
  const params = new URLSearchParams(location.search);
  const result = params.get("account");
  if (result) {
    params.delete("account");
    const url = new URL(location.href);
    url.search = params.toString();
    history.replaceState(history.state,"",url);
  }
  const configure = document.getElementById("configure-button");
  const configureControl = document.getElementById("configure-control");
  configureControl.hidden = false;
  configure.addEventListener("click",openAccount);
  const threadLink = document.getElementById("configure-thread-link");
  let threadLinkRequest = 0;
  function openAccount() {
    if (!dialog.open) dialog.showModal();
    void run(update);
    const request = ++threadLinkRequest;
    threadLink.hidden = true;
    threadLink.removeAttribute("href");
    void call("thread-link").then(response=>response.ok ? response.json() : null).then(data=>{
      if (request !== threadLinkRequest || !dialog.open || !/^codex:\/\/threads\/[a-f0-9-]{36}$/i.test(data?.url??"")) return;
      threadLink.href = data.url;
      threadLink.hidden = false;
    }).catch(()=>{});
  }
  pagePicker.addEventListener("open-account",openAccount);
  const assetSymbol = paramsForScreen.get("symbol") ?? "";
  if (assetSymbol) {
    const button = document.getElementById("asset-live-news");
    const status = document.getElementById("live-news-status");
    const list = document.getElementById("live-news-list");
    button.hidden = false;
    button.addEventListener("click",async()=>{
      button.disabled = true;
      status.textContent = "Loading Alpaca headlines…";
      try {
        const response = await call("market-news?" + new URLSearchParams({symbol:assetSymbol}));
        const data = await response.json();
        if (response.status === 401 || data.connected === false) {
          status.textContent = "Sign in and connect Alpaca Paper from Account to load headlines.";
        } else if (!response.ok) {
          status.textContent = data.error ?? "Alpaca headlines unavailable.";
        } else {
          list.replaceChildren(...data.rows.map(row=>{
            const item = document.createElement("li");
            const link = document.createElement("a");
            Object.assign(link,{href:row.url,textContent:row.headline,target:"_blank",rel:"noopener noreferrer"});
            item.append(link," · " + row.source + " · " + row.filingDate);
            return item;
          }));
          list.hidden = !data.rows.length;
          status.textContent = data.rows.length ? "" : "No recent Alpaca headlines.";
        }
      } catch {
        status.textContent = "Alpaca headlines unavailable.";
      } finally {
        button.disabled = false;
      }
    });
  }
  if (assetSymbol && (paramsForScreen.get("screen") === "asset" || location.pathname.endsWith("/asset"))) {
    const chartButton = document.getElementById("asset-live-chart");
    const chartStatus = document.getElementById("asset-live-chart-status");
    chartButton.hidden = false;
    chartButton.addEventListener("click",async()=>{
      chartButton.disabled = true;
      chartStatus.textContent = "Loading Alpaca history…";
      try {
        const response = await call("market-chart?" + new URLSearchParams({symbol:assetSymbol}));
        const data = await response.json();
        if (response.status === 401 || data.connected === false) {
          chartStatus.textContent = "Sign in and connect Alpaca Paper from Account to load this chart.";
        } else if (!response.ok) {
          chartStatus.textContent = data.error ?? "Alpaca chart unavailable.";
        } else {
          chartButton.dataset.loaded = "true";
          document.dispatchEvent(new CustomEvent("alpaca-chart",{detail:data}));
          chartStatus.textContent = "Chart loaded from " + data.source + ".";
        }
      } catch {
        chartStatus.textContent = "Alpaca chart unavailable.";
      } finally {
        chartButton.disabled = false;
      }
    });
    const quoteButton = document.getElementById("asset-alpaca-quote");
    const quoteStatus = document.getElementById("asset-alpaca-status");
    quoteButton.hidden = false;
    quoteButton.addEventListener("click",()=>void run(async()=>{
      quoteButton.disabled = true;
      quoteStatus.hidden = false;
      quoteStatus.textContent = "Checking Alpaca quote…";
      try {
        const response = await call("market-quote?" + new URLSearchParams({symbol:assetSymbol}));
        const data = await response.json();
        if (response.status === 401 || data.connected === false) {
          quoteStatus.textContent = "Sign in and connect Alpaca Paper from Account to check a quote.";
        } else if (!response.ok) {
          quoteStatus.textContent = data.error ?? "Alpaca quote unavailable.";
        } else {
          quoteStatus.textContent = "Bid " + money.format(data.bid) + " · Ask " + money.format(data.ask) +
            " · " + data.source + " · " + new Date(data.at).toLocaleString("en-US",{timeZone:"America/New_York"}) + " ET";
        }
      } catch {
        quoteStatus.textContent = "Alpaca quote unavailable.";
      } finally {
        quoteButton.disabled = false;
      }
    }));
  }
  document.getElementById("account-close").addEventListener("click",()=>dialog.close());
  signIn.addEventListener("click",()=>void run(async()=>{
    const response = await call("sign-in","POST");
    if (!response.ok) throw Error("Sign-in could not be started.");
    const data = await response.json();
    location.assign(data.authorize);
  }));
  signOut.addEventListener("click",()=>void run(async()=>{
    await disableDevicePush().catch(()=>{});
    const response = await call("sign-out","POST");
    if (!response.ok) throw Error("Sign-out failed.");
    status.textContent = "Signed out.";
    threadLinkRequest++;
    threadLink.hidden = true;
    threadLink.removeAttribute("href");
    if (onUsage) showUsageSignIn();
    if (onPortfolio) showSnapshotSignIn();
    document.dispatchEvent(new Event("paper-connection-changed"));
    clearActivity();
    await update();
  }));
  form.addEventListener("submit",event=>{
    event.preventDefault();
    void run(async()=>{
      const keyId = form.elements.keyId.value.trim();
      const secret = form.elements.secret.value.trim();
      form.reset();
      const response = await call("alpaca-paper","PUT",{keyId,secret});
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "The paper connection could not be saved.");
      void refreshActivity();
      status.textContent = "Alpaca Paper connected.";
      document.dispatchEvent(new Event("paper-connection-changed"));
      renderAccount(data);
    });
  });
  disconnect.addEventListener("click",()=>void run(async()=>{
    const response = await call("alpaca-paper","DELETE");
    if (!response.ok) throw Error("Could not remove the paper connection.");
    clearActivity();
    status.textContent = "Alpaca Paper disconnected.";
    document.dispatchEvent(new Event("paper-connection-changed"));
    renderAccount(await response.json());
  }));
  if (result === "ready" || result === "failed") {
    if (result === "failed") status.textContent = "Sign-in could not be completed.";
    openAccount();
  }
}
