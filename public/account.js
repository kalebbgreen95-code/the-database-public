import { disableDevicePush } from "./device-alerts.js?v=206";
import { publicRoute } from "./public-data.js";

const config = await fetch("./account-api/config", {cache:"no-store"}).then(response =>
  response.ok ? response.json() : null).catch(() => null);

if (config?.accountMode) {
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
  const livePositions = document.getElementById("connected-paper-positions");
  const liveOrders = document.getElementById("connected-paper-orders");
  const paramsForScreen = new URLSearchParams(location.search);
  const onPaperScreen = paramsForScreen.get("screen") === "activity" || location.hash === "#activity";
  const onPortfolio = paramsForScreen.get("screen") === "robinhood-portfolio" || location.hash === "#robinhood-portfolio";
  const portfolio = document.getElementById("alpaca-portfolio");
  const portfolioStatus = document.getElementById("alpaca-portfolio-status");
  const portfolioPositions = document.getElementById("alpaca-portfolio-positions");
  const amount = value => value != null && Number.isFinite(Number(value)) ? money.format(Number(value)) : "unavailable";
  let portfolioVersion = 0;
  function clearPortfolio() {
    portfolioVersion++;
    portfolio.hidden = true;
    portfolioStatus.textContent = "";
    portfolioPositions.replaceChildren();
  }
  async function refreshPortfolio() {
    if (!onPortfolio) return;
    const request = ++portfolioVersion;
    try {
      const response = await call("paper-activity?view=positions");
      if (request !== portfolioVersion) return;
      if (response.status === 401) {
        clearPortfolio();
        return;
      }
      if (!response.ok) throw Error("Alpaca Paper holdings could not be refreshed.");
      const data = await response.json();
      if (request !== portfolioVersion) return;
      if (!data.connected) return clearPortfolio();
      portfolio.hidden = false;
      portfolioStatus.textContent = "Paper equity " + amount(data.account.equity) + " · Cash " + amount(data.account.cash);
      const rows = data.positions.map(row=>{
        const item = document.createElement("li");
        const symbol = row.assetClass === "crypto" ? row.symbol.replace(/(?<!\/)USD$/,"/USD") : row.symbol;
        const link = document.createElement("a");
        link.href = publicRoute("/asset?" + new URLSearchParams({symbol}));
        link.textContent = symbol;
        item.append(link," · " + row.quantity + " · " + amount(row.marketValue),
          " · Unrealized P/L " + amount(row.unrealized));
        return item;
      });
      portfolioPositions.replaceChildren(...rows);
      if (!rows.length) fillList(portfolioPositions,[],"No open positions.");
    } catch (error) {
      if (request !== portfolioVersion) return;
      portfolio.hidden = false;
      portfolioStatus.textContent = error.message;
      portfolioPositions.replaceChildren();
    }
  }
  if (onPortfolio) {
    void refreshPortfolio();
    document.getElementById("refresh-robinhood-portfolio").addEventListener("click",()=>void refreshPortfolio());
    addEventListener("pageshow",event=>{ if (event.persisted) void refreshPortfolio(); });
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
      ? "Checks about every 20 minutes. " + (data.outcome ?? "Waiting for the first scheduled check.")
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
    } finally {
      scheduleButton.disabled = false;
    }
  }
  if (onPaperScreen) {
    void updateSchedule();
    scheduleButton.addEventListener("click",()=>void updateSchedule(scheduled ? "DELETE" : "PUT"));
    document.getElementById("refresh-activity").addEventListener("click",()=>void updateSchedule());
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
  previewButton.addEventListener("click",async()=>{
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
        [row.symbol,row.signal,...row.evidence].join(" · ")),"No signals available.");
    } catch (error) {
      if (version === previewVersion) previewStatus.textContent = error.message;
    } finally {
      previewButton.disabled = false;
      previewRunning = false;
    }
  });
  function fillList(list, rows, empty) {
    list.replaceChildren(...(rows.length ? rows : [empty]).map(text=>{
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
  }
  function clearActivity() {
    activityVersion++;
    previewVersion++;
    previewRows.replaceChildren();
    previewStatus.textContent = "";
    livePaper.hidden = true;
    liveEquity.textContent = "";
    livePositions.replaceChildren();
    liveOrders.replaceChildren();
  }
  async function refreshActivity() {
    if (!onPaperScreen) return;
    const version = ++activityVersion;
    try {
      const response = await call("paper-activity");
      if (version !== activityVersion) return;
      if (response.status === 401) return clearActivity();
      if (!response.ok) throw Error("Alpaca Paper activity is temporarily unavailable.");
      const data = await response.json();
      if (version !== activityVersion) return;
      if (!data.connected) return clearActivity();
      livePaper.hidden = false;
      liveStatus.textContent = "";
      liveEquity.textContent = "Paper equity " + amount(data.account.equity) + " · Cash " + amount(data.account.cash);
      fillList(livePositions,data.positions.map(row=>row.symbol + " · " + row.quantity + " · " + amount(row.marketValue)),"No open positions.");
      fillList(liveOrders,data.orders.map(row=>[row.symbol,row.side,row.status,
        Number(row.quantity)>0 ? row.quantity + " filled at " + amount(row.averagePrice) : "",
        row.at ? new Date(row.at).toLocaleString() : ""].filter(Boolean).join(" · ")),"No recent orders.");
    } catch {
      if (version !== activityVersion) return;
      liveStatus.textContent = "Alpaca Paper activity could not be refreshed.";
      livePaper.hidden = false;
    }
  }
  if (onPaperScreen) {
    void refreshActivity();
    document.getElementById("refresh-activity").addEventListener("click",()=>void refreshActivity());
    addEventListener("pageshow", event => { if (event.persisted) void refreshActivity(); });
  }
  function renderAccount(data) {
    balance.textContent = data.connected
      ? "Paper equity " + (data.account.equity == null ? "unavailable" : money.format(data.account.equity)) +
        " · Cash " + (data.account.cash == null ? "unavailable" : money.format(data.account.cash))
      : "Connect an Alpaca Paper account to view its balance here.";
    disconnect.hidden = !data.connected;
  }
  async function update() {
    const response = await call("alpaca-paper");
    if (response.status === 401) {
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
  pagePicker.add(new Option("Account", "/account"));
  const configure = document.getElementById("configure-button");
  const configureControl = document.getElementById("configure-control");
  const configureLinks = document.getElementById("configure-links");
  configureControl.hidden = false;
  function showConfigure(open) {
    configureLinks.hidden = !open;
    configure.setAttribute("aria-expanded",String(open));
  }
  configure.addEventListener("click",()=>showConfigure(configureLinks.hidden));
  configureControl.addEventListener("keydown",event=>{
    if (event.key !== "Escape" || configureLinks.hidden) return;
    showConfigure(false);
    configure.focus();
  });
  document.addEventListener("click",event=>{
    if (!configureControl.contains(event.target)) showConfigure(false);
  });
  document.getElementById("configure-account").addEventListener("click",()=>{
    showConfigure(false);
    openAccount();
  });
  function openAccount() {
    if (!dialog.open) dialog.showModal();
    void run(update);
  }
  pagePicker.addEventListener("open-account",openAccount);
  const assetSymbol = paramsForScreen.get("symbol") ?? "";
  const newsPage = paramsForScreen.get("screen") === "news";
  if (newsPage || assetSymbol) {
    const button = document.getElementById(newsPage ? "market-live-news" : "asset-live-news");
    const status = document.getElementById("live-news-status");
    const list = document.getElementById("live-news-list");
    if (newsPage) document.getElementById("news-coverage").after(button,status,list);
    button.hidden = false;
    button.addEventListener("click",async()=>{
      button.disabled = true;
      status.textContent = "Loading Alpaca headlines…";
      try {
        const response = await call("market-news?" + new URLSearchParams({symbol:newsPage ? "" : assetSymbol}));
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
  dialog.addEventListener("close",()=>pagePicker.focus());
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
    clearActivity();
    clearPortfolio();
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
      void refreshPortfolio();
      status.textContent = "Alpaca Paper connected.";
      renderAccount(data);
    });
  });
  disconnect.addEventListener("click",()=>void run(async()=>{
    const response = await call("alpaca-paper","DELETE");
    if (!response.ok) throw Error("Could not remove the paper connection.");
    clearActivity();
    clearPortfolio();
    status.textContent = "Alpaca Paper disconnected.";
    renderAccount(await response.json());
  }));
  if (result === "ready" || result === "failed") {
    if (result === "failed") status.textContent = "Sign-in could not be completed.";
    openAccount();
  }
}
