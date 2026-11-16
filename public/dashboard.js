import { stockChecklist } from "./stock-checklist.mjs";
import { criticalNewsReason, governmentRiskReason, groupNewsEvents, isMajorMarketNews, newsPercentageTone, related, topStories, uniqueHeadlines } from "./briefing.mjs";
const $ = id => document.getElementById(id);
import { readDemo, publicRoute } from "./public-data.js";
const appRoot = new URL("./", import.meta.url);
const currentUrl = new URL(location.href);
const screen = url => url.searchParams.get("screen") ?? "";
const onDashboard = url => url.origin === appRoot.origin && url.pathname === appRoot.pathname;
const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 6 : 2 }).format(value);
const percent = value => value == null ? "—" : (100 * value).toFixed(1) + "%";
const timezone = "America/New_York";
const date = value => value ? new Date(value).toLocaleString("en-US", { timeZone: timezone }) : "—";
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" });
let current;
const pages = ["ai-watchlist", "search", "asset", "crypto", "news", "opportunities", "activity", "robinhood", "robinhood-portfolio", "usage", "notifications"];
const requested = screen(currentUrl) || location.hash.slice(1);
const page = pages.includes(requested) ? requested : "";
history.scrollRestoration = "manual";
if (!screen(currentUrl) && page) {
  currentUrl.searchParams.set("screen", page);
  currentUrl.hash = "";
  history.replaceState(null, "", currentUrl);
}

for (const name of pages) $(name).hidden = name !== page;
const navigationContent = $(page || "overview");
const reduceNavigationMotion = matchMedia("(prefers-reduced-motion: reduce)");
let backFade;
let topScrollFrame;
let returnFadeTimer;

function fadeReturnedPage() {
  clearTimeout(returnFadeTimer);
  if (navigationContent.classList.contains("navigation-returning")) {
    navigationContent.classList.remove("navigation-returning");
    if (!reduceNavigationMotion.matches) {
      navigationContent.animate?.([{opacity: .72}, {opacity: 1}], {
        duration: 105, easing: "cubic-bezier(.22, 1, .36, 1)",
      });
    }
  }
}

function preparePageReturn() {
  if (restorePosition == null || reduceNavigationMotion.matches) return;
  navigationContent.classList.add("navigation-returning");
  clearTimeout(returnFadeTimer);
  returnFadeTimer = setTimeout(fadeReturnedPage, 1500);
}

const backButton = $("back-to-overview");
backButton.hidden = true;
const navigationParams = new URLSearchParams(location.search);
const sourcePath = navigationParams.get("from");
const previousPage = sourcePath?.startsWith("/") ? new URL(sourcePath, location.origin)
  : document.referrer ? new URL(document.referrer) : null;
const returnPositionKey = "database-return-scroll";
if (previousPage && onDashboard(previousPage) &&
    previousPage.href !== location.href &&
    (!screen(previousPage) || pages.includes(screen(previousPage)))) {
  backButton.hidden = false;
  backButton.href = previousPage.href;
  if (sourcePath && navigationParams.has("fromScroll")) {
    const fallback = new URL(previousPage);
    fallback.searchParams.set("resumeScroll", navigationParams.get("fromScroll"));
    backButton.href = fallback.href;
  }
  backButton.addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (backFade) return;
    if (sourcePath && navigationParams.has("fromScroll")) {
      try {
        sessionStorage.setItem(returnPositionKey, JSON.stringify({
          path: previousPage.pathname + previousPage.search,
          top: Number(navigationParams.get("fromScroll")),
        }));
      } catch {}
    }
    const goBack = () => history.length > 1 ? history.back() : location.assign(backButton.href);
    if (reduceNavigationMotion.matches || !navigationContent.animate) {
      goBack();
      return;
    }
    backFade = navigationContent.animate([{opacity: 1}, {opacity: .72}], {
      duration: 55, easing: "ease-out", fill: "forwards",
    });
    backFade.onfinish = goBack;
  });
}
const resumeScroll = navigationParams.get("resumeScroll");
const fallbackScroll = resumeScroll !== null && /^\d+$/.test(resumeScroll) ? Number(resumeScroll) : null;
let restorePosition = fallbackScroll ?? history.state?.returnScrollY ??
  (performance.getEntriesByType("navigation")[0]?.type === "back_forward" ? history.state?.scrollY : null);
if (resumeScroll !== null) {
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("resumeScroll");
  history.replaceState(history.state, "", cleanUrl);
}
function readReturnPosition() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(returnPositionKey));
    if (saved?.path === location.pathname + location.search && Number.isFinite(saved.top) && saved.top >= 0) {
      sessionStorage.removeItem(returnPositionKey);
      return saved.top;
    }
  } catch {}
  return null;
}
restorePosition = readReturnPosition() ?? restorePosition;
preparePageReturn();
function restorePagePosition() {
  if (restorePosition == null) return;
  const top = restorePosition;
  if (top > document.documentElement.scrollHeight - innerHeight + 1) return;
  requestAnimationFrame(() => {
    if (restorePosition !== top) return;
    if (top > document.documentElement.scrollHeight - innerHeight + 1) return;
    restorePosition = null;
    const state = { ...history.state };
    delete state.returnScrollY;
    history.replaceState(state, "");
    window.scrollTo({top, behavior: "instant"});
    fadeReturnedPage();
  });
}
function stopTopScroll() {
  cancelAnimationFrame(topScrollFrame);
}
for (const event of ["pointerdown", "touchstart", "wheel", "keydown"]) {
  window.addEventListener(event, stopTopScroll, {passive: true});
}
$("scroll-to-top").addEventListener("click", () => {
  restorePosition = null;
  const state = { ...history.state };
  delete state.returnScrollY;
  delete state.scrollY;
  history.replaceState(state, "");
  stopTopScroll();
  const start = window.scrollY;
  if (reduceNavigationMotion.matches || start <= 0) {
    window.scrollTo({top: 0, behavior: "instant"});
    return;
  }
  const started = performance.now();
  function scrollFrame(time) {
    const progress = Math.min(1, Math.max(0, (time - started) / 175));
    const eased = progress * progress * (3 - 2 * progress);
    window.scrollTo({top: start * (1 - eased), behavior: "instant"});
    if (progress < 1) topScrollFrame = requestAnimationFrame(scrollFrame);
  }
  topScrollFrame = requestAnimationFrame(scrollFrame);
});
let floatingNavigationTimer;
let dashboardPress;
let dashboardPressTimer;
function finishDashboardPress() {
  clearTimeout(dashboardPressTimer);
  dashboardPress?.resolve();
  dashboardPress = null;
}

async function waitForDashboardPress() {
  while (dashboardPress) await dashboardPress.promise;
}

window.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !event.target.closest?.("a[href], button, select, summary, input, label")) return;
  finishDashboardPress();
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  dashboardPress = {promise, resolve};
  dashboardPressTimer = setTimeout(finishDashboardPress, 2000);
}, {capture: true, passive: true});
window.addEventListener("pointerup", () => {
  if (!dashboardPress) return;
  clearTimeout(dashboardPressTimer);
  dashboardPressTimer = setTimeout(finishDashboardPress, 350);
}, {passive: true});
window.addEventListener("pointercancel", finishDashboardPress, {passive: true});
window.addEventListener("blur", finishDashboardPress);
window.addEventListener("click", () => {
  if (!dashboardPress) return;
  clearTimeout(dashboardPressTimer);
  dashboardPressTimer = setTimeout(finishDashboardPress, 0);
});

function showFloatingNavigation() {
  document.documentElement.classList.remove("floating-navigation-idle");
  clearTimeout(floatingNavigationTimer);
  floatingNavigationTimer = setTimeout(() => {
    if (!document.activeElement?.matches("#back-to-overview:focus-visible,#scroll-to-top:focus-visible")) {
      document.documentElement.classList.add("floating-navigation-idle");
    }
  }, 1000);
}
for (const button of [backButton,$("scroll-to-top")]) {
  button.addEventListener("focus",showFloatingNavigation);
  button.addEventListener("blur",showFloatingNavigation);
}
for (const event of ["scroll", "keydown", "click"]) {
  window.addEventListener(event, showFloatingNavigation, { passive: true, capture: true });
}
// A touch should finish on its original target before faded arrows can cover it.
window.addEventListener("pointermove", event => {
  if (event.pointerType === "mouse") showFloatingNavigation();
}, {passive: true});
window.addEventListener("pointerdown", () => clearTimeout(floatingNavigationTimer), {passive: true});
for (const event of ["pointerup", "pointercancel"]) {
  window.addEventListener(event, () => {
    if (!document.documentElement.classList.contains("floating-navigation-idle")) showFloatingNavigation();
  }, {passive: true});
}
window.addEventListener("pageshow", showFloatingNavigation);
showFloatingNavigation();

function navigationTarget(destination) {
  const top = Math.max(0, window.scrollY);
  history.replaceState({ ...history.state, returnScrollY: top }, "");
  const source = new URL(location.href);
  for (const key of ["from","fromScroll","resumeScroll"]) source.searchParams.delete(key);
  destination.searchParams.set("from", source.pathname + source.search);
  destination.searchParams.set("fromScroll", String(Math.round(top)));
  return destination.href;
}
window.addEventListener("pageshow", event => {
  backFade?.cancel();
  backFade = null;
  if (event.persisted) {
    restorePosition = readReturnPosition() ?? history.state?.returnScrollY ?? history.state?.scrollY ?? restorePosition;
    preparePageReturn();
  }
  restorePagePosition();
});

document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
      event.metaKey || event.shiftKey || event.altKey || (link.target && link.target !== "_self")) return;
  const destination = new URL(link.href);
  if (!onDashboard(destination) || destination.href === location.href ||
      (screen(destination) && !pages.includes(screen(destination)))) return;
  event.preventDefault();
  location.assign(navigationTarget(destination));
});

const pageSelect = $("dashboard-page");
const selectedPage = page === "asset" ? "" : "/" + page;
pageSelect.value = selectedPage;
window.addEventListener("pageshow", () => { pageSelect.value = selectedPage; });
pageSelect.addEventListener("change", () => {
  location.assign(navigationTarget(new URL(publicRoute(pageSelect.value), appRoot)));
});
$("overview").hidden = Boolean(page);

function percentageText(value, tone = "signed") {
  if (tone === "neutral" || typeof value !== "string" || !value.includes("%")) return [value];
  const parts = [];
  let end = 0;
  for (const match of value.matchAll(/(?<![\w.,])([+−-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*%/g)) {
    const number = Number(match[1].replaceAll(",", "").replace("−", "-"));
    const color = tone === "news" ? newsPercentageTone(value, match.index, match[0].length)
      : tone === "signed" ? (number > 0 ? "gain" : number < 0 ? "loss" : "neutral") : tone;
    if (color === "neutral") continue;
    const span = document.createElement("span");
    span.className = color;
    span.textContent = match[0];
    parts.push(value.slice(end, match.index), span);
    end = match.index + match[0].length;
  }
  parts.push(value.slice(end));
  return parts;
}

function el(tag, value, tone) {
  const node = document.createElement(tag);
  if (value != null) node.append(...percentageText(value, tone));
  return node;
}
function assetLink(symbol, label = symbol) {
  const match = current?.market.find(row => row.symbol.replace("/", "") === symbol);
  const link = el("a", label);
  link.className = "ticker-link";
  link.href = publicRoute("/asset?" + new URLSearchParams({ symbol: match?.symbol ?? symbol }));
  return link;
}

function showMetrics(id, entries) {
  $(id).replaceChildren(...entries.flatMap(([label, value, tone = "neutral"]) => {
    const detail = el("dd", "");
    detail.append(...percentageText(value ?? "Unavailable", tone));
    return [el("dt", label, "neutral"), detail];
  }));
}

function checklistJudgment(passed, measurement) {
  const detail = el("span", "");
  const tone = passed === true ? "gain" : passed === false ? "loss" : "neutral";
  const status = el("span", passed == null ? "Not scored" : passed ? "Pass" : "Fail");
  if (tone !== "neutral") status.className = tone;
  detail.append(status, ...percentageText(measurement ? " · " + measurement : "", tone));
  return detail;
}

function renderStockChecklist(fundamentals, trailingPe, forwardPe) {
  const checks = stockChecklist(fundamentals, trailingPe, forwardPe);
  showMetrics("asset-checklist", checks.map(([label, passed, measurement]) =>
    [label, checklistJudgment(passed, measurement || (passed == null ? "Insufficient reported figures" : ""))]));
}

const searchHistoryKey = "database-search-history";
let recentSearches = [];
try {
  const saved = JSON.parse(localStorage.getItem(searchHistoryKey));
  if (Array.isArray(saved)) recentSearches = saved.filter(query => typeof query === "string").slice(0, 20);
} catch {}
function renderSearchHistory() {
  $("recent-searches").hidden = !recentSearches.length;
  $("search-history").replaceChildren(...recentSearches.map(query => {
    const item = el("li", "");
    const button = el("button", query);
    button.type = "button";
    button.addEventListener("click", () => {
      $("asset-query").value = query;
      $("asset-search").requestSubmit();
    });
    item.append(button);
    return item;
  }));
}
function saveSearchHistory() {
  try { localStorage.setItem(searchHistoryKey, JSON.stringify(recentSearches)); } catch {}
  renderSearchHistory();
}
$("clear-searches").addEventListener("click", () => {
  recentSearches = [];
  saveSearchHistory();
  $("asset-query").focus();
});
renderSearchHistory();

let activeSearch;
$("asset-search").addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("asset-query").value.trim();
  if (!query) return;
  if (event.submitter) {
    recentSearches = [query, ...recentSearches.filter(value => value.toUpperCase() !== query.toUpperCase())].slice(0, 20);
    saveSearchHistory();
  }
  const button = event.currentTarget.querySelector("button");
  const status = $("search-status");
  const results = $("search-results");
  activeSearch?.abort();
  const search = new AbortController();
  activeSearch = search;
  button.disabled = true;
  results.replaceChildren();
  status.textContent = "Searching…";
  try {
    const response = await readDemo("/api/search?" + new URLSearchParams({ q: query }), {
      signal: AbortSignal.any([search.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) throw Error("Search failed");
    const { assets, partial } = await response.json();
    if (activeSearch !== search) return;
    history.replaceState({...history.state, searchQuery: query}, "");
    results.replaceChildren(...assets.map(asset => {
      const item = el("li", "");
      const link = el("a", asset.symbol + " · " + asset.name);
      link.href = publicRoute("/asset?" + new URLSearchParams({ symbol: asset.symbol }));
      item.append(link);
      return item;
    }));
    status.textContent = partial ? "Some markets could not be searched. Try again shortly."
      : assets.length ? "" : "No matching assets found.";
  } catch {
    if (activeSearch === search) status.textContent = "Search couldn’t be completed. Try again shortly.";
  } finally {
    if (activeSearch === search) {
      activeSearch = null;
      button.disabled = false;
      restorePagePosition();
    }
  }
});
if (page === "search" && history.state?.searchQuery) {
  $("asset-query").value = history.state.searchQuery;
  $("asset-search").requestSubmit();
}

document.addEventListener("alpaca-chart",event=>{
  renderAssetChart(event.detail.rows,event.detail.source);
});
function renderAssetChart(history,source) {
  const panel = $("asset-chart-panel");
  panel.hidden = !history?.length;
  if (panel.hidden) return;
  const canvas = $("asset-chart");
  const interval = $("asset-chart-interval");
  const readout = $("asset-chart-readout");
  const ranges = [...panel.querySelectorAll("[data-chart-months]")];
  const ctx = canvas.getContext("2d");
  let months = Number(ranges.find(button=>button.getAttribute("aria-pressed") === "true")?.dataset.chartMonths ?? 3);
  let selected = null;
  let rows = [];
  const left = 72;
  const right = canvas.width - 18;
  function draw() {
    const weekly = interval.value === "weekly";
    const start = new Date(history.at(-1).date + "T00:00:00Z");
    const endDay = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(endDay, lastDay));
    const cutoff = start.toISOString().slice(0, 10);
    const visible = history.filter(row => row.date >= cutoff);
    const weeks = new Map();
    if (weekly) {
      for (const row of visible) {
        const monday = new Date(row.date + "T00:00:00Z");
        monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
        const key = monday.toISOString().slice(0, 10);
        const prior = weeks.get(key);
        const volume = prior?.volume === null || !Number.isFinite(row.volume)
          ? null : (prior?.volume ?? 0) + row.volume;
        weeks.set(key, { ...row, volume });
      }
    }
    rows = weekly ? [...weeks.values()] : visible;
    const series = [["close", "#edf3ef"], ["sma50", "#6fdc9f"], ["sma200", "#eac879"]];
    const prices = rows.flatMap(row => series.map(([key]) => row[key])).filter(value => Number.isFinite(value) && value > 0);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const x = i => left + (right - left) * i / Math.max(1, rows.length - 1);
    const y = price => high === low ? 127 : 238 - (price - low) * 222 / (high - low);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "14px system-ui";
    ctx.fillStyle = "#afc0b7";
    if (prices.length) {
      ctx.fillText(money(high), 7, 18, left - 12);
      ctx.fillText(money(low), 7, 242, left - 12);
    }
    for (const [key, color] of series) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let drawing = false;
      rows.forEach((row, i) => {
        if (!(row[key] > 0)) { drawing = false; return; }
        if (drawing) ctx.lineTo(x(i), y(row[key]));
        else ctx.moveTo(x(i), y(row[key]));
        drawing = true;
      });
      ctx.stroke();
      if (rows.length === 1 && rows[0][key] > 0) ctx.fillRect(left - 2, y(rows[0][key]) - 2, 4, 4);
    }
    const maxVolume = Math.max(0, ...rows.map(row => row.volume ?? 0));
    ctx.fillStyle = "#507a69";
    if (maxVolume > 0) rows.forEach((row, i) => {
      if (!(row.volume > 0)) return;
      const height = 63 * row.volume / maxVolume;
      ctx.fillRect(x(i) - 2, 327 - height, 4, height);
    });
    const index = selected ?? rows.length - 1;
    const point = rows[index];
    if (point?.close > 0) {
      const px = x(index);
      const py = y(point.close);
      ctx.strokeStyle = "#8ea7a0";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(px, 14);
      ctx.lineTo(px, 327);
      ctx.moveTo(left, py);
      ctx.lineTo(right, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#edf3ef";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      const volumeLabel = Number.isFinite(point.volume)
        ? " · Volume " + point.volume.toLocaleString("en-US", {maximumFractionDigits: 2}) : "";
      const text = point.date + " · " + money(point.close) + volumeLabel;
      if (readout.textContent !== text) readout.textContent = text;
    }
    const dates = rows[0].date + " to " + rows.at(-1).date;
    $("asset-chart-caption").textContent = source + " · " + dates + " · Close (white) · 50-day SMA (green) · 200-day SMA (gold) · Volume bars" +
      (weekly ? " · Current week shown through the latest daily bar" : "");
    canvas.setAttribute("aria-label", (weekly ? "Weekly" : "Daily") + " price and volume from " + dates);
  }
  function reset() {
    selected = null;
    draw();
  }
  interval.onchange = reset;
  for (const button of ranges) button.onclick = () => {
    months = Number(button.dataset.chartMonths);
    for (const control of ranges) control.setAttribute("aria-pressed", String(control === button));
    reset();
  };
  function selectPoint(event) {
    if (!rows.length) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width) return;
    const px = (event.clientX - bounds.left) * canvas.width / bounds.width;
    const index = Math.round((px - left) / (right - left) * (rows.length - 1));
    const next = Math.max(0, Math.min(rows.length - 1, index));
    if (next === selected) return;
    selected = next;
    draw();
  }
  canvas.onclick = selectPoint;
  canvas.onpointermove = event => { if (event.pointerType === "mouse") selectPoint(event); };
  canvas.onkeydown = event => {
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!step || !rows.length) return;
    event.preventDefault();
    selected = Math.max(0, Math.min(rows.length - 1, (selected ?? rows.length - 1) + step));
    draw();
  };
  draw();
}

async function loadAssetDetails() {
  const symbol = new URLSearchParams(location.search).get("symbol") ?? "";
  $("asset-title").textContent = symbol || "Asset details";
  $("asset-profile").hidden = true;
  $("asset-status").textContent = "Loading asset details…";
  try {
    const response = await readDemo("/api/details?" + new URLSearchParams({ symbol }), { signal: AbortSignal.timeout(16000) });
    if (!response.ok) throw new Error("Asset details unavailable");
    const data = await response.json();
    const profile = $("asset-profile");
    if (data.profile?.text) {
      profile.textContent = data.profile.text + " ";
      const source = el(data.profile.url ? "a" : "small", data.profile.source);
      if (data.profile.url) Object.assign(source, { href: data.profile.url, target: "_blank", rel: "noopener noreferrer" });
      profile.append(source);
      profile.hidden = false;
    }
    const crypto = symbol.includes("/");
    const setup = data.setup ?? [];
    $("asset-setup").hidden = !setup.length;
    showMetrics("asset-setup-metrics", setup.flatMap(rule => [[rule.label, rule.evidence], ["Rule changes when", rule.invalidation]]));
    const quoteAge = Date.now() - data.time;
    const quoteState = /daily close/.test(data.priceSource ?? "") ? "Completed close"
      : quoteAge >= -5000 && quoteAge < 90000 ? "Recent quote" : "Last available";
    showMetrics("asset-market", [
      ["Latest price", data.price > 0 ? money(data.price) + " · " + quoteState + " · " + date(data.time) + " ET · " + data.priceSource : null],
      ["Daily volume", Number.isFinite(data.volume)
        ? data.volume.toLocaleString("en-US", { maximumFractionDigits: 4 }) + (crypto ? " " + symbol.split("/")[0] : " shares") + " · " + data.volumeDate + " · " + data.volumeSource : null],
    ]);
    showMetrics("asset-changes", ["1D", "1W", "1M", "11M", "1Y"].map(period =>
      [period, changeLabel(data.changes?.[period])]));
    $("asset-change-source").textContent = data.changeSource && Object.values(data.changes ?? {}).some(Boolean)
      ? "Historical prices · " + data.changeSource : "";
    const { rsi, previousRsi, macd, volume, trend, atr, atrPercent, chart, date: technicalDate } = data.technicals ?? {};
    const volumeUnit = crypto ? " " + symbol.split("/")[0] : " shares";
    const formatVolume = value => Number.isFinite(value)
      ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) + volumeUnit : null;
    const formatMacd = value => value.toLocaleString("en-US", { maximumSignificantDigits: 5, signDisplay: "exceptZero" });
    const trendLabel = average => average > 0 && trend?.close > 0
      ? money(average) + " · " + percent(trend.close / average - 1) + " vs. average"
      : null;
    const rsiRange = rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : "Neutral range";
    const rsiRecovery = rsi != null && rsi >= 30 && rsi <= 70 && previousRsi != null
      ? previousRsi < 30 ? " · Back above 30" : previousRsi > 70 ? " · Back below 70" : "" : "";
    const histogramTrend = macd?.previousHistogram == null ? "" : macd.histogram > macd.previousHistogram
      ? "Histogram rising" : macd.histogram < macd.previousHistogram ? "Histogram falling" : "Histogram steady";
    $("asset-technicals-summary").textContent = [
      trend?.sma200 > 0 && trend.close > 0 ? (trend.close > trend.sma200 ? "Above" :
        trend.close < trend.sma200 ? "Below" : "At") + " the 200-day average" : "",
      rsi == null ? "" : "RSI " + rsi.toFixed(1) + " · " + rsiRange + rsiRecovery,
      histogramTrend,
      volume?.relative == null ? "" : "Volume " + volume.relative.toFixed(2) + "× average",
    ].filter(Boolean).join(" · ");
    if (!$("asset-live-chart").dataset.loaded) renderAssetChart(chart,"Simulated chart");
    $("asset-technicals-date").textContent = technicalDate
      ? "Daily bars through " + technicalDate + " · " + data.changeSource
      : "Completed daily history is unavailable.";
    showMetrics("asset-technicals", [
      ["RSI (14)", rsi == null ? null : rsi.toFixed(1) + " · " + rsiRange + rsiRecovery],
      ["50-day SMA", trendLabel(trend?.sma50), "signed"],
      ["200-day SMA", trendLabel(trend?.sma200), "signed"],
      ["14-day ATR", atrPercent == null ? null : money(atr) + " · " + percent(atrPercent) + " of close"],
      ["Completed daily volume", formatVolume(volume?.latest)],
      ["Prior 20-day average volume", formatVolume(volume?.average)],
      ["Relative volume", volume?.relative == null ? null : volume.relative.toFixed(2) + "× average"],
      ["MACD (12, 26, 9)", macd ? formatMacd(macd.line) : null],
      ["Signal line", macd ? formatMacd(macd.signal) : null],
      ["MACD histogram", macd ? formatMacd(macd.histogram) + " · " +
        (macd.histogram > 0 ? "Above signal" : macd.histogram < 0 ? "Below signal" : "At signal") : null],
      ["Histogram vs. previous bar", histogramTrend || null],
    ]);
    $("company-metrics").hidden = crypto || Boolean(data.fund);
    $("fund-metrics").hidden = !data.fund;
    if (data.fund) {
      const issuer = data.fund.issuer;
      const issuerLink = issuer ? el("a", "Vanguard fund profile") : null;
      if (issuerLink) Object.assign(issuerLink, {href: issuer.url, target: "_blank", rel: "noopener noreferrer"});
      showMetrics("asset-fund", [
        ...(issuer ? [
          ["Benchmark", issuer.benchmark],
          ["Holdings", issuer.holdings.toLocaleString("en-US") + " · " + issuer.holdingsDate + " · Vanguard"],
          ["Issuer", issuerLink],
        ] : []),
        ["Gross expense ratio", Number.isFinite(data.fund.expenseRatio) ? data.fund.expenseRatio.toFixed(2) + "% · Robinhood" : "Unavailable"],
        ["Portfolio P/E", data.robinhoodPe?.ratio > 0 ? data.robinhoodPe.ratio.toFixed(2) + "× · Robinhood" : "Unavailable"],
        ["1Y price change", changeLabel(data.changes?.["1Y"])],
      ]);
    }
    if (!crypto && !data.fund) {
      const f = data.fundamentals;
      const robinhood = data.robinhoodPe;
      const forwardPe = data.forwardEstimate?.epsAvg > 0 && data.price > 0 ? data.price / data.forwardEstimate.epsAvg : null;
      renderStockChecklist(f, data.simulatedTrailingPe, forwardPe);
      const pe = robinhood ? el("a", robinhood.ratio.toFixed(2) + "× · Robinhood") : null;
      if (pe) Object.assign(pe, { href: robinhood.url, target: "_blank", rel: "noopener noreferrer" });
      const reportedCap = data.robinhoodStats?.marketCap;
      const marketValue = data.price > 0 && f?.shares > 0 ? data.price * f.shares : reportedCap;
      const capSource = data.price > 0 && f?.shares > 0 ? "SEC shares" : "Robinhood market cap + SEC";
      const multiple = (denominator, asOf) => marketValue > 0 && denominator > 0
        ? (marketValue / denominator).toFixed(2) + "× · " + asOf + " · " + capSource
        : denominator <= 0 && denominator != null ? "Nonpositive denominator" : "Requires SEC figures and a price";
      const estimate = data.forwardEstimate;
      const growth = estimate?.growth;
      showMetrics("asset-valuation", [
        ["Price-to-book (P/B)", marketValue > 0 && f?.bookEquity > 0 ? multiple(f.bookEquity, f.equityDate)
          : data.robinhoodStats?.priceToBook > 0 ? data.robinhoodStats.priceToBook.toFixed(2) + "× · Robinhood" : multiple(f?.bookEquity, f?.equityDate)],
        ["Price-to-sales (last fiscal year)", multiple(f?.annualRevenue, f?.annualRevenueDate)],
        ["Price-to-operating cash flow (last fiscal year)", multiple(f?.operatingCashFlow, f?.cashDate)],
        ["PEG (Robinhood P/E)", robinhood?.ratio > 0 && growth > 0
          ? (robinhood.ratio / (growth * 100)).toFixed(2) + " · " + percent(growth) +
            " projected EPS growth · " + estimate.date + " to " + estimate.growthEnd + " · " + estimate.source
          : growth != null && growth <= 0 ? "Projected EPS growth is zero or negative" : "Requires trailing P/E and two annual EPS forecasts"],
      ]);
      showMetrics("asset-fundamentals", [
        [robinhood ? "P/E (provider-reported)" : "P/E (last fiscal year)", data.simulatedTrailingPe > 0 ? data.simulatedTrailingPe.toFixed(2) + "× · Synthetic scenario" : pe ?? (f?.eps > 0 && data.price > 0 ? (data.price / f.eps).toFixed(2) + "× · " + f.epsDate + " · SEC EPS" : null)],
        ["Forward P/E", data.forwardEstimate?.epsAvg > 0 && data.price > 0 ? (data.price / data.forwardEstimate.epsAvg).toFixed(2) + "× · FY ending " + data.forwardEstimate.date + " · " + data.forwardEstimate.source : data.estimatesIssue ? data.estimatesIssue : data.forwardEstimate?.epsAvg <= 0 ? "Consensus EPS is zero or negative" : data.forwardEstimate ? "A current price is required" : "No consensus EPS from configured sources"],
        ["Free cash flow (last fiscal year)", Number.isFinite(f?.freeCashFlow) ? money(f.freeCashFlow) + " · " + f.cashDate + " · " + (f.cashSource ?? "SEC") : f?.fmpIssues?.freeCashFlow],
        ...(f?.cashSourceWarning ? [["Cash-flow source check", f.cashSourceWarning]] : []),
        ...(Number.isFinite(f?.interimFreeCashFlow) ? [["Free cash flow (interim)", money(f.interimFreeCashFlow) + " · " + f.interimCashPeriod.start + " to " + f.interimCashPeriod.end + " · SEC"]] : []),
        ["Debt to equity", Number.isFinite(f?.debtToEquity) ? f.debtToEquity.toFixed(2) + "× · " + f.equityDate + " · " + (f.debtSource ?? "SEC") : f?.fmpIssues?.debtToEquity],
      ]);
      $("asset-filings").hidden = !f?.source;
      if (f?.source) $("asset-filings").href = f.source;
    }
    const seen = new Set();
    const stories = data.headlines.sort((a, b) => b.timestamp - a.timestamp).filter(story => {
      if (seen.has(story.headline)) return false;
      seen.add(story.headline);
      return true;
    }).slice(0, 12);
    $("asset-articles").replaceChildren(...(stories.length ? stories.map(story => newsItem(story, true))
      : [el("li", data.newsFeedFailed ? "Related news could not be refreshed." : "No recent related articles found.")]));
    $("asset-status").textContent = "";
  } catch {
    $("asset-status").textContent = "Asset details are unavailable. Reload the page to try again.";
  }
}

function paperUsdAmount(quantity, unitPrice) {
  const qty = Number(quantity);
  const price = Number(unitPrice);
  const amount = qty * price;
  return qty > 0 && price > 0 && Number.isFinite(amount) ? money(amount) : null;
}

function table(id, rows) {
  const body = $(id);
  const headers = body.closest(".paper-panel") ? [...body.closest("table").tHead.rows[0].cells] : [];
  if (headers.length) body.setAttribute("role", "rowgroup");
  body.replaceChildren(...rows.map(row => {
    const tr = el("tr", "");
    if (headers.length) tr.setAttribute("role", "row");
    tr.append(...row.map((value, index) => {
      const cell = el("td", "");
      if (headers[index]) {
        cell.setAttribute("role", "cell");
        const label = el("span", headers[index].textContent);
        label.className = "paper-cell-label";
        label.setAttribute("aria-hidden", "true");
        const content = el("span", "");
        content.append(...percentageText(value));
        cell.append(label, content);
        return cell;
      }
      cell.append(...percentageText(value));
      return cell;
    }));
    return tr;
  }));
}
function list(id, values, empty) {
  $(id).replaceChildren(...(values.length ? values : [empty]).map(value => {
    const item = el("li", "");
    if (Array.isArray(value)) item.append(assetLink(value[0]), ...percentageText(value[1], value[2]));
    else item.append(...percentageText(value));
    return item;
  }));
}
function setup(row) {
  if (!row) return "—";
  return `${row.action === "Buy" ? "Invest" : "Cash"} · ${row.asOf}`;
}
function changeLabel(change) {
  const item = el("span", "—");
  if (!change) return item;
  const sign = change.dollars > 0 ? "+" : change.dollars < 0 ? "−" : "";
  item.textContent = sign + money(Math.abs(change.dollars)) + " (" + sign + percent(Math.abs(change.percent)) + ")";
  item.className = change.dollars > 0 ? "gain" : change.dollars < 0 ? "loss" : "";
  if (change.referenceDate) item.title = "Compared with " + change.referenceDate;
  return item;
}
function watchlistSparkline(closes) {
  const points = (closes ?? []).filter(price => Number.isFinite(price) && price > 0);
  if (points.length < 2) return el("span", "—");
  const chart = el("canvas", "");
  chart.className = "watchlist-chart";
  chart.width = 240;
  chart.height = 72;
  chart.setAttribute("role", "img");
  const trend = Math.sign(points.at(-1) - points[0]);
  chart.setAttribute("aria-label", "Daily closes, trending " + (trend > 0 ? "up" : trend < 0 ? "down" : "flat"));
  const ctx = chart.getContext("2d");
  const low = Math.min(...points);
  const range = Math.max(...points) - low;
  const y = price => range ? 66 - 60 * (price - low) / range : 36;
  ctx.strokeStyle = "#52615b";
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(0, y(points[0]));
  ctx.lineTo(240, y(points[0]));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = trend > 0 ? "#8cf0b4" : trend < 0 ? "#ffa3a3" : "#afc0b7";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((price, index) => ctx.lineTo(2 + 236 * index / (points.length - 1), y(price)));
  ctx.stroke();
  return chart;
}

const watchlistQuote = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 8,
});

document.addEventListener("robinhood-snapshot",event=>{
  if (event.detail) renderRobinhood(null,true,event.detail);
  else for (const id of ["imported","value","return","crypto","stocks"]) {
    const target = $("robinhood-"+id);
    target.replaceChildren();
    delete target.dataset.rendered;
  }
});
function renderRobinhood(data, portfolioOnly = false, imported = null) {
  const listPrefix = imported ? "robinhood-" : portfolioOnly ? "portfolio-" : "watchlist-";
  const synced = imported ?? (portfolioOnly ? data.robinhoodPortfolio : null);
  const asOf = synced?.asOf ?? data?.robinhood.asOf;
  const importLabel = imported ? "Robinhood sync" : synced ? "Demo portfolio" : "Demo snapshot";
  $(portfolioOnly ? listPrefix + "imported" : "imported").textContent = asOf
    ? importLabel + " · " + date(asOf) + " ET" : "No demo snapshot";
  const marketBySymbol = new Map((data?.market ?? []).map(row => [row.symbol, row]));
  const holdings = (synced?.positions ?? []).map(item => {
    const market = data?.portfolioQuotes?.[item.symbol] ?? marketBySymbol.get(item.symbol);
    if ((Number.isFinite(item.price) && item.price > 0) ||
        !Number.isFinite(market?.time) || market.time > Date.now() + 5000 ||
        !Number.isFinite(market.price) || market.price <= 0) {
      return {...item, quoteSource: imported ? "Robinhood snapshot" : "Demo snapshot"};
    }
    return {...item, price: market.price, quoteAt: market.time,
      quoteSource: market.delivery === "Coinbase Exchange" ? market.delivery : "Simulated"};
  });
  const pnl = item => Number.isFinite(item.price) && item.price > 0 &&
    Number.isFinite(item.averageCost) && item.averageCost > 0 && Number.isFinite(item.quantity) && item.quantity !== 0
    ? (item.price / item.averageCost - 1) * Math.sign(item.quantity) : null;
  if (portfolioOnly) {
    const hasPrices = synced && holdings.every(({ price, quantity }) =>
      Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity !== 0);
    const marketValue = hasPrices ? holdings.reduce((sum, { price, quantity }) => sum + price * quantity, 0) : null;
    const hasAccountValue = Number.isFinite(synced?.accountValue);
    const usesMarketQuotes = !imported && holdings.some(item => item.quoteSource !== "Demo snapshot");
    const valueLabel = synced?.valueScope === "robinhood" ? "Robinhood account value"
      : synced?.valueScope === "combined-estimate" ? "Estimated Robinhood account value"
      : synced?.valueScope === "brokerage" ? "Brokerage value excluding crypto"
      : imported ? (holdings.some(item=>item.type === "crypto") ? "Robinhood account value" : "Reported brokerage value")
      : "Demo portfolio value";
    $(listPrefix + "value").textContent = hasAccountValue ? valueLabel + " · " + money(synced.accountValue)
      : (usesMarketQuotes ? "Estimated holdings value · " : "Holdings value · ") +
        (Number.isFinite(marketValue) ? money(marketValue) : "Unavailable");
    const totalBasis = holdings.reduce((sum, item) => sum + Math.abs(item.quantity) * item.averageCost, 0);
    const complete = holdings.length && holdings.every(item => pnl(item) !== null);
    const total = complete ? holdings.reduce((sum, item) => sum + pnl(item) * Math.abs(item.quantity) * item.averageCost, 0) / totalBasis : null;
    const summary = $(listPrefix + "return");
    summary.replaceChildren(...percentageText(total === null ? "Holdings gain/loss unavailable" : "Holdings gain/loss vs. cost · " + (total > 0 ? "+" : "") + percent(total)));
  }
  const seen = new Set();
  const groups = { crypto: [], stocks: [] };
  const items = portfolioOnly ? (synced ? holdings : data.robinhood.positions)
    : [...data.robinhood.positions, ...data.robinhood.lists.flatMap(list => list.items)];
  for (const item of items) {
    if (typeof item.symbol !== "string" || item.type === "index") continue;
    const raw = item.symbol.trim().toUpperCase();
    if (!raw) continue;
    const isCrypto = raw.includes("/") || ["crypto", "currency_pair"].includes(item.type);
    const symbol = isCrypto && !raw.includes("/") ? raw.replace(/[-_]USD$/, "") + "/USD" : raw;
    if (seen.has(symbol)) continue;
    const market = marketBySymbol.get(symbol);
    const entry = { symbol, quantity: item.quantity, market, closes: item.recentCloses ?? market?.recentCloses,
      snapshotPrice: synced ? item.price : null, quoteAt: synced ? item.quoteAt : null, quoteSource: item.quoteSource, gain: synced ? pnl(item) : null };
    seen.add(symbol);
    groups[isCrypto ? "crypto" : "stocks"].push(entry);
  }
  for (const [group, entries] of Object.entries(groups)) {
    const list = $(listPrefix + group);
    const signature = JSON.stringify(entries.map(({ symbol, quantity, market, snapshotPrice, quoteAt, quoteSource, gain, closes }) =>
      [symbol, quantity, snapshotPrice, quoteAt, quoteSource, gain, market?.price, market?.fresh, market?.changes?.["1D"]?.percent, closes]));
    if (list.dataset.rendered === signature) continue;
    list.dataset.rendered = signature;
    list.replaceChildren(...(entries.length ? entries.map(({ symbol, quantity, market, snapshotPrice, quoteAt, quoteSource, gain, closes }) => {
      const row = el("li", "");
      const name = el("span", "");
      const ticker = group === "crypto" ? symbol.replace(/\/USD$/, "") : symbol;
      const shares = Number(quantity) === 1 ? " share" : " shares";
      const link = assetLink(symbol, ticker);
      name.append(link, el("small", quantity == null ? (portfolioOnly ? "Quantity unavailable" : "Watching") : quantity + (group === "stocks" ? shares : "")));
      const change = portfolioOnly ? gain : market?.changes?.["1D"]?.percent;
      const direction = change > 0 ? "gain" : change < 0 ? "loss" : "";
      const quote = el("span", "");
      const shownPrice = synced ? snapshotPrice : market?.price;
      const price = el("span", shownPrice > 0 ? watchlistQuote.format(shownPrice) : "—");
      price.className = "watchlist-price " + direction;
      quote.append(price);
      if (portfolioOnly) {
        const cost = el("small", gain === null ? "Gain/loss unavailable" : "");
        if (gain !== null) cost.append(el("span",percent(gain),direction)," vs. cost");
        quote.append(cost);
      }
      const quoteDetails = synced && shownPrice > 0
        ? el("small", quoteSource + (quoteAt ? " · " + date(quoteAt) + " ET" : "")) : null;
      if (!synced && market?.delivery === "Coinbase Exchange") quote.append(el("small", market.delivery));
      if (!synced && market?.price > 0 && !market.fresh) quote.append(el("small", "Last quote"));
      const content = el("span", "");
      content.className = portfolioOnly ? "watchlist-row portfolio-row" : "watchlist-row";
      const chart = watchlistSparkline(closes);
      if (imported && chart.tagName !== "CANVAS") chart.hidden = true;
      content.append(name, chart, quote);
      if (quoteDetails) {
        quoteDetails.className = "portfolio-quote-details";
        content.append(quoteDetails);
      }
      row.append(content);
      return row;
    }) : [el("li", portfolioOnly ? "No holdings in this category." : "No assets in the demo watchlist.")]));
  }
}
const notificationReadKey = "the-database-read-notifications";
const notificationsLink = $("notifications-link");
let readNotificationIds = new Set();
const clearedNotificationKey = "the-database-cleared-notifications";
let clearedNotificationIds = new Set();

if (page === "notifications") {
  notificationsLink.href = sourcePath && !backButton.hidden ? backButton.href : publicRoute("/");
  notificationsLink.setAttribute("aria-label", "Close notifications");
}
notificationsLink.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
      event.metaKey || event.shiftKey || event.altKey) return;
  if (page !== "notifications") {
    event.preventDefault();
    location.assign(navigationTarget(new URL(notificationsLink.href, location.origin)));
  } else if (sourcePath && !backButton.hidden && history.length > 1) {
    event.preventDefault();
    backButton.click();
  }
});

function syncReadNotifications() {
  try {
    const saved = JSON.parse(localStorage.getItem(notificationReadKey));
    if (Array.isArray(saved)) readNotificationIds = new Set(saved);
  } catch {}
}

function updateUnreadNotifications(notifications) {
  const unread = notifications.some(notice => !readNotificationIds.has(notice.id));
  $("notifications-unread").hidden = !unread;
  if (page !== "notifications") {
    notificationsLink.setAttribute("aria-label", unread ? "Notifications, unread alerts" : "Notifications");
  }
}

function syncClearedNotifications() {
  try {
    const saved = JSON.parse(localStorage.getItem(clearedNotificationKey));
    if (Array.isArray(saved)) clearedNotificationIds = new Set(saved);
  } catch {}
}

function renderNotifications(notifications) {
  const visible = notifications.filter(notice => !clearedNotificationIds.has(notice.id));
  updateUnreadNotifications(visible);
  $("clear-notifications").disabled = !visible.length;
  $("notice-count").textContent = visible.length ? "(" + visible.length + ")" : "";
  $("notice-list").replaceChildren(...(visible.length ? visible.map(notice => {
    const item = el("li", "");
    const link = el("a", "");
    link.className = "notice-link";
    link.href = notice.target;
    link.append(el("strong", notice.title, "neutral"), el("p", notice.body, "neutral"), el("time", date(notice.created) + " ET"));
    item.append(link);
    return item;
  }) : [el("li", "No notifications yet.")]));
}

function clearNotifications(ids) {
  syncClearedNotifications();
  for (const id of ids) {
    clearedNotificationIds.delete(id);
    clearedNotificationIds.add(id);
  }
  clearedNotificationIds = new Set([...clearedNotificationIds].slice(-200));
  try { localStorage.setItem(clearedNotificationKey, JSON.stringify([...clearedNotificationIds])); } catch {}
  if (current) renderNotifications(current.notifications);
}

syncReadNotifications();
syncClearedNotifications();
$("clear-notifications").addEventListener("click", () => {
  if (current) clearNotifications(current.notifications.map(notice => notice.id));
});
if (page === "notifications") notificationsLink.setAttribute("aria-current", "page");
window.addEventListener("storage", async event => {
  if (event.key === notificationReadKey) syncReadNotifications();
  else if (event.key === clearedNotificationKey) syncClearedNotifications();
  else return;
  await waitForDashboardPress();
  if (current) renderNotifications(current.notifications);
});
window.addEventListener("pageshow", () => {
  syncClearedNotifications();
  if (current) renderNotifications(current.notifications);
});
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) return;
  await waitForDashboardPress();
  if (!document.hidden && current) renderNotifications(current.notifications);
});

function paperEquityTone(equity) {
  if (equity == null || !Number.isFinite(Number(equity))) return "";
  const amount = Number(equity);
  return amount < 5000 ? "loss" : "gain";
}

let overviewPaper;
function renderOverviewBalances() {
  const overviewEquity = $("overview-equity");
  const overviewCash = $("overview-cash");
  overviewEquity.replaceChildren();
  overviewCash.textContent = "";
  if (overviewPaper?.status === "loading") return;
  if (overviewPaper?.status === "unavailable") {
    overviewEquity.textContent = "Alpaca Paper balance unavailable";
    return;
  }
  const account = overviewPaper?.account;
  if (!account) {
    overviewEquity.textContent = overviewPaper?.status === "signed-out"
      ? "Sign in to view Alpaca Paper balances"
      : overviewPaper?.status === "disconnected" ? "Connect Alpaca Paper to view balances" : "";
    return;
  }
  const amount = value => value != null && Number.isFinite(Number(value)) ? money(Number(value)) : "unavailable";
  overviewEquity.textContent = "Alpaca Paper equity " + amount(account.equity);
  overviewCash.textContent = "Paper cash " + amount(account.cash);
}
document.addEventListener("overview-paper-balance",event => {
  overviewPaper = event.detail;
  renderOverviewBalances();
});

function render(data) {
  if (page === "robinhood-portfolio" && current?.robinhoodPortfolio &&
      !(Date.parse(data.robinhoodPortfolio?.asOf) >= Date.parse(current.robinhoodPortfolio.asOf))) {
    data.robinhoodPortfolio = current.robinhoodPortfolio;
  }
  current = data;
  $("status").hidden = true;
  renderOverviewBalances();
  setConnection(true);
  const activity = data.activity;
  $("orders-status").textContent = activity.error
    ? "Demo order refresh failed. Showing last available records."
    : activity.updatedAt ? "Last checked " + date(activity.updatedAt) + " ET" : "Waiting for simulated order history";
  table("orders", activity.orders.length ? activity.orders.map(row => [
    assetLink(row.symbol), row.side, row.automated ? "Bot" : "Other", row.status.replaceAll("_", " "),
    Number(row.quantity) > 0 ? row.quantity : "—", paperUsdAmount(row.quantity, row.price) ?? "—",
    row.price ? money(Number(row.price)) : "—",
    date(row.filledAt || row.submittedAt), row.reason ?? "—",
  ]) : [["—", "—", "—", activity.updatedAt ? "No recent orders" : "Waiting for data", "—", "—", "—", "—", "—"]]);
  table("results", data.paper.results.map(r => [r.strategy + " · " + (r.researchOnly ? "Research only" : r.entryEnabled ? "Simulation enabled" : "Paper entries off"),
    r.asset, r.count, el("span", percent(r.winRate), "neutral"), r.count ? percent(r.return) : "—", r.count ? percent(-r.drawdown) : "—"]));
  list("active", Object.entries(data.paper.active).map(([symbol, row]) => {
    const cost = paperUsdAmount(row.qty, row.price);
    const quote = data.market.find(asset => asset.symbol === symbol);
    const value = paperUsdAmount(row.qty, quote?.price);
    const amounts = (cost ? " · " + cost + " entry cost" : "") +
      (value ? " · " + value + (quote.fresh ? " estimated value" : " at last quote") : "");
    const exit = row.nextExit ? "\nNext exit · " +
      (Date.parse(row.nextExit.eligibleAt) > Date.now() ? "Reversal eligible " + date(row.nextExit.eligibleAt) + " ET" : "Reversal eligible now") +
      ". Early exit levels " + money(row.nextExit.stop) + " stop / " + money(row.nextExit.target) + " target."
      : row.strategy === "cryptoDaily" ? "\nNext exit · Completed daily momentum moves to cash."
      : row.strategy === "stockChecklist" ? "\nNext exit · Confirmed bearish reversal, checklist failure, or price reaches " + money(row.price * .8) + " at the 20% stop." : "";
    return [symbol, ` · ${row.strategy} · ${row.qty} @ ${money(row.price)}` + amounts +
      (row.reason ? "\nEntry · " + row.reason : "") + exit, "neutral"];
  }), "No strategy positions");
  list("pending", data.paper.pending.map(r => [r.symbol, ` · ${r.side} · ${r.status}` +
    (r.reason ? "\n" + r.reason : ""), "neutral"]), "No pending orders");
  list("closed", data.paper.trades.map(r => [r.symbol, ` · ${date(r.at)} · ${r.strategy} · ${percent(r.net)} estimated net` +
    (r.entryReason ? "\nEntry · " + r.entryReason : "") + (r.reason ? "\nExit · " + r.reason : "")]), "No completed trades");
  if (page === "robinhood") renderRobinhood(data);
  renderNews();
  if (!page) renderOverview(data);
  if (page === "activity") renderPaperScorecard(data);
  if (page === "crypto") {
    renderCryptoRecovery(data.cryptoRecovery ?? []);
    renderCryptoResearch(data.cryptoResearch);
    renderCryptoMarket(data);
  }
  renderNotifications(data.notifications);
}
function renderPaperScorecard(data) {
  $("paper-learning-since").textContent = data.paper.learningSince
    ? "Tracking entries since " + date(data.paper.learningSince) + " ET." : "";
  list("paper-learning", Object.values(data.paper.learning ?? {}).map(row => row.label + " · " +
    row.count + "/20 eligible closes · " + row.status + " · " + percent(row.multiplier) + " of base size" +
    (row.averages ? " · Batch average estimated net returns " + row.averages.map(percent).join(" / ") : "")),
    "Waiting for paper learning data.");
  const outcomes = Object.entries(data.paper.intradayOutcomes);
  $("intraday-outcomes").replaceChildren(...(outcomes.length ? outcomes.map(([reason, result]) =>
    el("li", reason + " · " + result.count + " closed · " + result.wins + " net winners · " +
      percent(result.netSum / result.count) + " average net")) : [el("li", "Waiting for the first closed intraday trade.")]));
  const points = data.paper.equityCurve;
  const first = points[0];
  const last = points.at(-1);
  let peak = first?.equity ?? 0;
  let drawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    drawdown = Math.max(drawdown, 1 - point.equity / peak);
  }
  const net = data.paper.realizedNetDollars;
  const open = Object.entries(data.paper.active);
  const marks = new Map(data.market.map(row => [row.symbol, row.price]));
  const openNet = open.length && open.every(([symbol]) => marks.get(symbol) > 0)
    ? open.reduce((sum, [symbol, position]) => sum + position.qty * (marks.get(symbol) - position.price), 0) : null;
  const evidenceCount = Object.values(data.paper.learning ?? {}).reduce((sum, row) => sum + row.count, 0);
  const score = [
    ["Paper equity", data.broker.equity != null && Number.isFinite(Number(data.broker.equity)) ? money(Number(data.broker.equity)) : "—", paperEquityTone(data.broker.equity)],
    ["Demo cash", data.broker.cash != null && Number.isFinite(Number(data.broker.cash)) ? money(Number(data.broker.cash)) : "—", ""],
    ["Closed trades", String(data.paper.closedCount), ""],
    ["Est. realized net P/L", data.paper.closedCount ? money(net) : "—", net > 0 ? "gain" : net < 0 ? "loss" : ""],
    ["Open P/L at last quotes", openNet == null ? "—" : money(openNet), openNet > 0 ? "gain" : openNet < 0 ? "loss" : ""],
    ["Account max drawdown", first ? percent(-drawdown) : "—", drawdown > 0 ? "loss" : ""],
    ["Eligible closes collected", String(evidenceCount), ""],
  ];
  $("paper-score").replaceChildren(...score.map(([label, value, tone]) => {
    const card = el("div", "");
    const reading = el("dd", value, tone || "neutral");
    if (label === "Paper equity") reading.className = tone;
    card.append(el("dt", label), reading);
    return card;
  }));
  $("paper-live-benchmarks").replaceChildren(...(data.paperBenchmarks ?? []).map(row => {
    const item = el("li", "");
    item.append(assetLink(row.symbol), ...percentageText(" " + percent(row.priceReturn) + " · Paper " +
      percent(row.accountReturn) + " · " + row.from + " to " + row.to));
    return item;
  }));
  $("paper-live-comparison").hidden = !data.paperBenchmarks?.length;
  list("paper-strategy-benchmarks", data.paper.results.filter(row => !row.researchOnly).map(row => {
    const match = data.paperStrategyBenchmarks?.[row.key];
    return row.strategy + " · " + row.count + " closes · Average net " + percent(row.averageNet) +
      " · Average win " + percent(row.averageWin) + " · Average loss " + percent(row.averageLoss) +
      (match ? " · " + match.count + " matched against " + match.symbol + " · Paper " + money(match.paperNet) +
        " vs. benchmark " + money(match.benchmarkNet) : " · Waiting for matched benchmark closes");
  }), "Waiting for paper results.");
  const shadow = data.paper.shadowComparison;
  $("paper-shadow-status").textContent = shadow ? shadow.review + " · Since " + date(shadow.since) +
    " ET · " + money(shadow.capital) + " per simulated book, " + money(shadow.stake) +
    " per entry, quote-side prices and " + percent(shadow.fee) + " estimated fee per side. Review requires 20 filter closes, 10 control closes in each BTC regime, positive realized net, higher positive total return, and no higher drawdown."
    : "Waiting for synchronized BTC and altcoin quotes.";
  list("paper-shadow-results", shadow ? [
    ["Unfiltered altcoin rule · Simulation", shadow.baseline], ["BTC bullish filter · Simulation", shadow.btcFilter],
  ].map(([label, row]) => label + " · " + percent(row.netReturn) + " net · " + percent(-row.drawdown) +
    " drawdown · " + row.closed + " closed · " + row.open + " open · " + money(row.cash) +
    " cash · BTC bullish " + row.regimes.bullish.count + " closes (" + money(row.regimes.bullish.net) +
    ") · Other BTC regime " + row.regimes.other.count + " closes (" + money(row.regimes.other.net) + ")") : [], "Collecting observations.");
  const universes = data.cryptoResearch?.universes;
  $("paper-crypto-universe-status").textContent = universes?.days
    ? universes.first + " to " + universes.last + " · " + universes.days +
      " matched days · Daily momentum simulation with 0.30% estimated cost per side. Uses today’s eligible pairs."
    : "Waiting for matched historical crypto candles.";
  $("paper-crypto-universe").replaceChildren(...(universes?.days ? [
    ["BTC and ETH", universes.baseline], [universes.universe.map(symbol => symbol.split("/")[0]).join(", "), universes.expanded],
  ].map(([label, result]) => el("li", label + " · " + percent(result.return) + " net · " +
    percent(-result.drawdown) + " max drawdown · " + result.entries + " entries")) : []));
  $("equity-summary").replaceChildren(...percentageText(first
    ? last.day + " · Equity " + money(last.equity) + " · Cash " + money(last.cash) +
      " · Change since " + first.day + " " + percent(last.equity / first.equity - 1) + " · Drawdown " + percent(-drawdown)
    : "Waiting for the first daily account snapshot."));
  const chart = $("equity-chart");
  chart.hidden = points.length < 2;
  if (!chart.hidden) {
    const ctx = chart.getContext("2d");
    const low = Math.min(...points.map(point => point.equity));
    const range = peak - low || 1;
    ctx.clearRect(0, 0, chart.width, chart.height);
    ctx.strokeStyle = last.equity > first.equity ? "#7ae2af" : last.equity < first.equity ? "#ff9a9a" : "#afc0b7";
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((point, i) => ctx.lineTo(4 + i * (chart.width - 8) / (points.length - 1),
      chart.height - 8 - (point.equity - low) / range * (chart.height - 16)));
    ctx.stroke();
  }
  const cycle = data.paper.latestCycle;
  $("paper-cycle-status").textContent = [data.paper.enabled ? "Simulation enabled" : "Paper entries off",
    data.sourceFreshness?.paperCheck ? "Last evaluated " + date(data.sourceFreshness.paperCheck) + " ET" : "",
    data.broker.status, cycle?.entryBlocked].filter(Boolean).join(" · ");
  $("paper-decisions").replaceChildren(...[
    cycle?.decisions?.stockChecklist && el("li", "Stock checklist · " + cycle.decisions.stockChecklist),
    ...(cycle?.crypto ?? []).map(row => {
      const item = el("li", "");
      item.append(assetLink(row.symbol), " · Intraday: " + row.intradayReason,
        el("small", row.intraday ? "30-minute move " + percent(row.intraday.score) + " · Candle closed " + date(row.intraday.asOf) + " ET" : ""),
        el("small", "Daily: " + row.reason + (row.signalDate ? " · " + row.signalDate + " UTC candle" : "")));
      return item;
    }),
    cycle?.action && el("li", "Order attempted · " + cycle.action.side + " " + cycle.action.symbol + " · " + cycle.action.reason),
  ].filter(Boolean));
  const fee = data.paperFeeStatus;
  $("paper-fee-status").textContent = fee?.available ? "Simulated fees checked " + date(fee.checkedAt) + " ET · " +
    fee.unlinked + " fee records without a matching recent fill ID. Strategy returns still use estimated costs."
    : "Simulated fee records are temporarily unavailable or pending. Strategy returns use estimated costs.";
  list("paper-executions", data.activity.orders.filter(row => row.gross != null).map(row => {
    const requested = row.requested != null ? money(row.requested) : row.requestedQuantity ? row.requestedQuantity + " units" : "Unavailable";
    const reference = row.reference;
    const difference = reference?.price > 0 ? (Number(row.price) / reference.price - 1) * (row.side === "buy" ? 1 : -1) : null;
    return [row.symbol, " · " + row.side + " · Requested " + requested + " · " + row.quantity +
      " filled @ " + money(Number(row.price)) + " · " + money(row.gross) + " gross" +
      (row.unfilledDollars != null ? " · Request minus gross fill " + money(row.unfilledDollars) : "") +
      (row.activityGross != null ? " · Fill activity " + money(row.activityGross) : " · Fill activity unavailable") +
      (difference != null ? " · " + (reference.kind ?? "previous reference") + " " + money(reference.price) +
        " · " + percent(difference) + " execution difference" : "") +
      (row.feeUsd != null ? " · Modeled fee " + money(row.feeUsd) : " · No fee linked to this order"), "neutral"];
  }), "Waiting for simulated fills.");
  const research = data.historicalResearch;
  const comparisons = [
    ["Four ETFs · buy and hold", research?.stocks.buyHold],
    ["Four ETFs · 10-month rule", research?.stocks.sma10month],
    ["SPY · buy and hold", research?.stocks.spyBuyHold],
    ["SPY · 10-month rule", research?.stocks.spySma10month],
    ["BTC and ETH · buy and hold", research?.crypto.buyHold],
    ["BTC and ETH · momentum", research?.crypto.return28day],
    ["BTC and ETH · momentum with half starting capital held in cash", research?.crypto.halfCapitalMomentum],
  ];
  table("paper-benchmarks", comparisons.filter(([, result]) => result).map(([label, result]) => [
    label, percent(result.windows.full.return), percent(-result.windows.full.maxDrawdown),
    percent(result.windows.later.return), percent(result.doubleCost.later.return),
    el("span", percent(result.averageExposure), "neutral"), result.orders,
  ]));
}


function renderCryptoRecovery(rows) {
  $("crypto-recovery-list").replaceChildren(...rows.map(({ symbol, stats, livePrice, quoteAt, news }) => {
    const item = el("li", "");
    const title = el("strong", "");
    title.append(assetLink(symbol));
    item.append(title);
    if (!stats) {
      item.append(el("p", "Waiting for completed daily candles."));
    } else {
      item.append(el("small", "Daily candle · " + stats.date + " UTC"));
      if (livePrice != null) {
        const move = (livePrice / stats.close - 1);
        const display = (move > 0 ? "+" : "") + percent(move);
        const quote = el("p", "");
        quote.append(money(livePrice) + " · ", ...percentageText(display), " since daily close · " + date(quoteAt) + " ET");
        item.append(quote);
      } else {
        item.append(el("p", "No separate intraday mark in this snapshot."));
      }
      const marks = [
        stats.bullishEngulfing && "Bullish engulfing candle",
        stats.higherRange && "Higher daily high and low",
        stats.crossedAbove && "Daily close crossed above EMA 200",
      ].filter(Boolean);
      if (marks.length) {
        const setup = el("p", marks.join(" · "));
        setup.className = "gain";
        item.append(setup);
      }
      const rsi = stats.rsi;
      const rsiLine = el("p", rsi == null ? "RSI 14 unavailable" :
        "RSI 14 · " + rsi.toFixed(1) + (stats.previousRsi == null ? "" : " from " + stats.previousRsi.toFixed(1)));
      if (rsi != null && stats.previousRsi != null) {
        rsiLine.className = rsi > stats.previousRsi ? "gain" : rsi < stats.previousRsi ? "loss" : "";
      }
      const emaLine = el("p", stats.ema200 == null ? "EMA 200 unavailable" : "EMA 200 · " + money(stats.ema200) +
        (stats.close > stats.ema200 ? " · Daily close above" : stats.close < stats.ema200 ? " · Daily close below" : " · Daily close at EMA") +
        (livePrice > stats.ema200 && stats.close < stats.ema200 ? " · Live price above" : ""));
      const volume = [
        stats.relativeVolume == null ? null : stats.relativeVolume.toFixed(2) + "× latest daily volume vs. 20-day average",
        stats.upCandleVolumeShare == null ? null : percent(stats.upCandleVolumeShare) + " of directional candle volume on up days (5 days)",
      ].filter(Boolean);
      item.append(rsiLine, emaLine, el("p", volume.join(" · ") || "Volume comparisons unavailable.", "neutral"));
    }
    if (news.length) {
      const headlines = el("ul", "");
      headlines.append(...news.map(story => newsItem({ ...story, summary: "" })));
      item.append(headlines);
    }
    return item;
  }));
}

function renderCryptoMarket(data) {
  const { coins, checkedAt, unavailable, source, partial } = data.cryptoMarket ?? {};
  $("crypto-market-caption").textContent = source
    ? "Tracked crypto pairs with Coinbase Exchange daily prices and returns."
    : "Tracked crypto pairs with simulated USD closes and returns.";
  $("crypto-market-status").textContent = coins?.length
    ? (source ?? "Simulated snapshot") + " · " + (unavailable ? "Last available data · " : "Checked ") +
      date(checkedAt) + " ET" + (partial ? " · Some quotes unavailable" : "")
    : unavailable ? "Crypto market data is temporarily unavailable." : "Loading crypto market data…";
  $("crypto-market-list").replaceChildren(...(coins ?? []).map(coin => {
    const item = el("li", "");
    const heading = el("div", "");
    heading.className = "crypto-quote";
    heading.append(assetLink(coin.symbol + "/USD", coin.name + " (" + coin.symbol + ")"),
      el("strong", coin.price > 0 ? money(coin.price) : "—"));
    const moves = el("div", "");
    moves.className = "periods";
    for (const period of ["1D", "1W", "1M", "1Y"]) {
      const value = el("span", period + " ");
      value.append(changeLabel(coin.changes[period]));
      moves.append(value);
    }
    const news = el("ul", "");
    const name = coin.name.toLowerCase();
    const aliases = { XRP: ["ripple"], BNB: ["bnb chain"], USDT: ["tether"], TRX: ["tron"] };
    const headlines = data.news.filter(story => {
      const headline = story.headline.toLowerCase();
      const tagged = story.symbols.some(symbol => symbol.toUpperCase().replace(/[-/]USD$/, "") === coin.symbol);
      const cryptoPublisher = /^(?:www\.)?(?:coindesk\.com|cointelegraph\.com|decrypt\.co|theblock\.co)$/i.test(story.source ?? "");
      const cryptoStory = cryptoPublisher ||
        /\b(crypto|blockchain|stablecoin|token|defi)\b/i.test(story.headline);
      const article = cryptoStory ? headline + " " + (story.summary ?? "").toLowerCase() : headline;
      const words = article.replace(/[^a-z0-9]+/g, " ").trim();
      const terms = [name, ...(aliases[coin.symbol] ?? [])];
      if (cryptoStory) terms.push(coin.symbol.toLowerCase());
      const matches = terms.some(term => term !== "near" &&
        (" " + words + " ").includes(" " + term.replace(/[^a-z0-9]+/g, " ").trim() + " "));
      return matches || (tagged && cryptoStory) ||
        (coin.symbol === "NEAR" && /\bNEAR\b/.test(story.headline) && cryptoStory);
    });
    for (const story of headlines.slice(0, 2)) news.append(newsItem({ ...story, summary: "" }));
    item.append(heading, moves);
    if (news.children.length) item.append(news);
    else item.append(el("small", "No related headlines in the latest feeds."));
    return item;
  }));
}

function renderCryptoResearch(research) {
  $("crypto-research-status").textContent = research?.days
    ? research.first + " to " + research.last + " · Synthetic daily bars · " + research.days + " matched evaluation days" +
      (research.unavailable ? " · Showing last successful comparison" : "")
    : research?.unavailable || research?.checkedAt ? "Not enough matched historical candles for comparison." : "Loading historical comparison…";
  const summary = result => result ? [percent(result.return) + " net return", percent(-result.drawdown) + " max drawdown",
    result.entries + " entries"].join(" · ") : "No matching history";
  $("crypto-research-results").replaceChildren(...(research?.comparisons ?? []).map(row => {
    const item = el("li", row.rule === "momentum" ? "Daily 28-day momentum" : "BTC-led recovery");
    item.append(el("p", "Full period · " + summary(row.full)),
      ...(research.downturnDays ? [el("p", "Downturn (" + research.downturnDays + " days) · " + summary(row.downturn))] : []));
    return item;
  }));
  $("crypto-research-decisions").replaceChildren(...(research?.evaluations ?? []).flatMap(day => day.rows.map(row => el("li",
    day.date + " · " + row.symbol + " · Momentum " + (row.momentum ? "Invested" : "Cash") +
    " · Recovery " + (row.recovery ? "Invested" : "Cash") + " · BTC trend " + (row.btcTrend ? "above EMA" : "below EMA") +
    " · RSI " + (row.stats.rsi?.toFixed(1) ?? "—") + (row.improvingRsi ? " improving" : "") +
    " · Volume " + (row.stats.relativeVolume?.toFixed(2) ?? "—") + "× · " +
    (row.bullishCandle ? "Bullish candle · " : "") + (row.stats.crossedAbove ? "Crossed EMA · " : "") +
    "200-day EMA " + money(row.stats.ema200)))));
}

function overviewPriceRow(item, row) {
  item.append(assetLink(row.symbol));
  if (Number.isFinite(row.price) && row.price > 0) item.append(" · " + money(row.price));
  if (row.changes?.["1D"]) item.append(" · ", changeLabel(row.changes["1D"]));
}

function renderOverview(data) {
  const fill = data.activity.orders.find(row => row.status === "filled" && row.automated);
  const intervention = data.broker.reconciliation?.length || /reconcil|trading blocked/i.test(data.broker.status ?? "");
  $("overview-bot-activity").textContent = [
    intervention ? "Paper account needs attention" : data.paper.enabled ? "Simulation enabled" : "Paper trading off",
    fill ? "Latest fill " + fill.side + " " + fill.symbol + (fill.gross != null ? " " + money(fill.gross) : "") : "No recent fill",
  ].map(value => " · " + value).join("");
  const expanded = new Set([...$("overview").querySelectorAll("details[data-detail-key][open]")]
    .map(detail => detail.dataset.detailKey));
  const holdings = data.robinhoodPortfolio?.positions;
  const owned = holdings && new Set(holdings.map(row => row.symbol));
  const rows = data.market.map(row => {
    const saved = data.overviewCache?.quotes?.[row.symbol];
    const useSaved = saved && (!row.time || !row.changes?.["1D"] || saved.time > row.time);
    return { ...row, ...(useSaved ? { ...saved, fresh: false, saved: true } : {}),
      owned: owned ? owned.has(row.symbol) : row.owned };
  });
  const personal = rows.filter(row => row.owned || row.watched);
  const today = easternDay.format(new Date(data.updatedAt));
  const check = data.criticalNewsCheck;
  const useSavedNews = !check?.checkedAt || check.status === "unavailable";
  const stories = useSavedNews ? [...data.news, ...(data.overviewCache?.news ?? [])] : data.news;
  const headlines = stories.filter(story => (story.filingDate ?? easternDay.format(story.timestamp)) === today)
    .map(story => ({
      story,
      matches: related(story, personal),
      reason: criticalNewsReason(story.headline),
    }))
    .filter(({ story, reason, matches }) => reason && (matches.length || reason === "Market-wide economic news" || governmentRiskReason(story.headline)))
    .sort((a, b) => Number(isMajorMarketNews(b.story.headline, b.matches)) - Number(isMajorMarketNews(a.story.headline, a.matches)) ||
      Number(b.matches.some(row => row.owned)) - Number(a.matches.some(row => row.owned)) ||
      Number(Boolean(b.matches.length)) - Number(Boolean(a.matches.length)) || b.story.timestamp - a.story.timestamp);
  const events = groupNewsEvents(headlines).slice(0, 3);
  const coverage = check?.status === "partial" ? " · Some sources unavailable" :
    check?.status === "unavailable" ? " · Sources unavailable" : "";
  $("critical-news-checked").textContent = useSavedNews && data.overviewCache?.newsCheckedAt &&
      easternDay.format(new Date(data.overviewCache.newsCheckedAt)) === today
    ? "Includes saved coverage · " + date(data.overviewCache.newsCheckedAt) + " ET" + coverage
    : check?.checkedAt
    ? "Last checked " + date(check.checkedAt) + " ET" + coverage
    : "Checking news sources…";
  const emptyNews = !check?.checkedAt ? "Waiting for the first news check." :
    check.status === "unavailable" ? "Critical news could not be checked." :
    check.status === "partial" ? "No critical updates from available sources." : "No critical updates today.";
  $("overview-critical-news").replaceChildren(...(events.length ? events.map(({ lead: { story, matches, reason }, coverage }) => {
    const item = newsItem({ ...story, summary: "" });
    const tickers = matches.slice(0, 4).map(row => row.symbol);
    const scope = matches.some(row => row.owned) ? "affects holdings you track"
      : matches.length ? "affects your watchlist" : "could affect the broader market";
    item.append(el("small", reason + " " + scope + (tickers.length ? " (" + tickers.join(", ") + ")." : ".")));
    if (coverage.length) {
      const more = el("details", "");
      more.dataset.detailKey = story.url || story.headline;
      more.open = expanded.has(more.dataset.detailKey);
      const articles = el("ul", "");
      articles.append(...coverage.slice(0, 4).map(article => newsItem({ ...article, summary: "" })));
      more.append(el("summary", "More coverage"), articles);
      item.append(more);
    }
    return item;
  }) : [el("li", emptyNews)]));

  const marketStatus = "Simulated stock, ETF and crypto prices";
  $("overview-market-status").textContent = marketStatus;
  const failures = [...new Set([
    ...(data.lastDashboardRefresh?.failed ?? []),
    ...(data.quoteErrors.length ? ["Market quotes"] : []),
    ...(data.activity.error ? ["Paper activity"] : []),
  ])];
  $("overview-health").hidden = !failures.length;
  $("overview-health").textContent = failures.length ? "Data needs attention · " + failures.join(", ") : "";
  const sourceTimes = [
    ["Quote requests", data.sourceFreshness?.quotes], ["Daily price history", data.sourceFreshness?.history],
    ["Crypto market", data.cryptoMarket?.checkedAt], ["Demo holdings", data.robinhoodPortfolio?.asOf],
    ["Paper orders", data.activity.updatedAt], ["Last full dashboard check", data.sourceFreshness?.fullCheck],
  ];
  $("source-freshness").replaceChildren(...sourceTimes.flatMap(([label, time]) => [
    el("dt", label), el("dd", time ? date(time) + " ET" : "Awaiting data"),
  ]));
  function quoteState(row) {
    const digital = row.symbol.includes("/");
    const source = row.quoteSource ?? (row.delivery === "Coinbase Exchange" ? "Coinbase" : digital ? "Simulated Crypto" : data.stockFeed.toUpperCase());
    const lastSession = !digital && data.marketOpen === false && Date.parse(data.updatedAt) - row.time < 4 * 86400000;
    const state = "Completed sample";
    return state + " · " + source;
  }
  $("overview-benchmarks").replaceChildren(...["SPY", "BTC/USD"].map(symbol => {
    const robinhood = data.robinhoodBenchmarks?.[symbol];
    const row = robinhood ?? rows.find(asset => asset.symbol === symbol);
    const item = el("li", "");
    if (!row?.time || !(row.price > 0)) {
      item.textContent = symbol + " · Waiting for a quote";
      return item;
    }
    overviewPriceRow(item, row);
    const age = Date.parse(data.updatedAt) - row.time;
    const status = robinhood
      ? [row.quoteSource, row.kind, age < 15000 ? "Recent" : "As of"].join(" · ")
      : quoteState(row);
    item.append(el("small", status + " · " + date(row.time) + " ET"));
    return item;
  }));

  for (const [group, crypto] of [["stock-movers", false], ["crypto-movers", true]]) {
    const moves = rows.filter(row => row.watched && row.symbol.includes("/") === crypto &&
      Number.isFinite(row.changes?.["1D"]?.percent))
      .sort((a, b) => b.changes["1D"].percent - a.changes["1D"].percent).slice(0, 5);
    $(group).replaceChildren(...(moves.length ? moves.map(row => {
      const item = el("li", "");
      const line = el("div", "");
      line.className = "watchlist-performer-line";
      const move = row.changes["1D"];
      const tone = move.percent > 0 ? "gain" : move.percent < 0 ? "loss" : "neutral";
      const change = el("span", (move.percent > 0 ? "+" : "") + percent(move.percent), "neutral");
      change.className = tone;
      line.append(assetLink(row.symbol), el("span", row.price > 0 ? money(row.price) : "—"), change);
      item.append(line);
      if (row.time) {
        const details = el("details", "");
        details.dataset.detailKey = row.symbol;
        details.open = expanded.has(row.symbol);
        details.append(el("summary", quoteState(row)), el("time", date(row.time) + " ET"),
          el("div", "1D move ", "neutral"));
        details.lastChild.append(changeLabel(move));
        item.append(details);
      }
      return item;
    }) : [el("li", "Waiting for watchlist price changes.")]));
  }

  const downside = $("overview-downside");
  const drop = personal.filter(row => row.owned && row.changes?.["1D"]?.percent <= -0.05)
    .sort((a, b) => a.changes["1D"].percent - b.changes["1D"].percent)[0];
  downside.hidden = !drop;
  downside.replaceChildren();
  if (drop) {
    const line = el("p", "");
    overviewPriceRow(line, drop);
    const lastSession = !drop.symbol.includes("/") && drop.time && easternDay.format(drop.time) !== today;
    downside.append(el("h3", lastSession ? "Biggest holding drop · last session" : "Biggest holding drop · 1D"), line);
  }
}

const symbolNews = new Map();

function newsItem(n, short = false) {
  const li = el("li", "");
  let url;
  try { url = new URL(n.url); } catch {}
  const title = el(url?.protocol === "https:" ? "a" : "span", n.headline, "news");
  title.className = "news-headline";
  if (title.tagName === "A") Object.assign(title, { href: url.href, target: "_blank", rel: "noopener noreferrer" });
  li.append(title, el("br", ""), el("time", [n.source, n.filingDate || (n.governmentFeed ? "Feed listing " : "") + date(n.timestamp), ...n.symbols].filter(Boolean).join(" · ")));
  if (n.summary) {
    const sentence = n.summary.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? n.summary;
    const detail = short ? sentence.length > 200 ? sentence.slice(0, 197).replace(/\s+\S*$/, "") + "…" : sentence : n.summary;
    li.append(el("p", detail, "news"));
  }
  return li;
}

let benzingaRows = [];
let benzingaStatus = "Loading Benzinga headlines…";
let benzingaRequest;
let benzingaNeedsAccount = false;
async function loadBenzinga() {
  benzingaRequest?.abort();
  const request = new AbortController();
  benzingaRequest = request;
  try {
    const response = await fetch(new URL("account-api/market-news",appRoot),{
      cache:"no-store",signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)]),
    });
    const data = await response.json();
    if (benzingaRequest !== request) return;
    benzingaNeedsAccount = response.status === 401 || data.connected === false;
    if (benzingaNeedsAccount) {
      benzingaRows = [];
      benzingaStatus = "Sign in and connect Alpaca Paper from Account to see Benzinga headlines.";
    } else if (!response.ok) {
      throw Error("News unavailable");
    } else {
      benzingaRows = data.rows.filter(row=>row.source === "Benzinga");
      benzingaStatus = "No recent Benzinga headlines.";
    }
  } catch {
    if (benzingaRequest !== request) return;
    benzingaStatus = "Benzinga headlines could not be loaded. Use Refresh News to retry.";
    renderNews();
    return false;
  }
  renderNews();
}
if (page === "news") {
  document.addEventListener("paper-connection-changed",()=>{
    benzingaRows = [];
    benzingaNeedsAccount = false;
    benzingaStatus = "Loading Benzinga headlines…";
    renderNews();
    void loadBenzinga();
  });
}

function renderNews() {
  if (!current) return;
  const source = $("news-source").value;
  $("news-date").textContent = new Date(current.updatedAt).toLocaleDateString("en-US", {
    timeZone: timezone, dateStyle: "full",
  }) + " · Eastern time";
  const daily = benzingaRows.length ? [...current.news,...benzingaRows].sort((first,second)=>second.timestamp-first.timestamp) : current.news;
  const picks = source ? [] : topStories(daily);
  $("news-top-stories").hidden = Boolean(source);
  $("additional-headlines-title").textContent = source ? "Headlines" : "More headlines";
  $("briefing-stories").replaceChildren(...(picks.length ? picks.map(row => newsItem(row, true))
    : [el("li", "No market stories available for today yet")]));
  const news = uniqueHeadlines(daily.filter(row => !source || (source === "government"
    ? row.governmentFeed || governmentRiskReason(row.headline) : source === row.source)), picks);
  $("headlines").replaceChildren(...(news.length ? news.map(row => newsItem(row))
    : [el("li",source === "Benzinga" ? benzingaStatus : source ? "No headlines from this source today" : "No additional headlines today")]));
  if (source === "Benzinga" && benzingaNeedsAccount && !news.length &&
      !$("configure-control").hidden) {
    const connect = el("button","Open Account");
    connect.type = "button";
    connect.addEventListener("click",()=>$("dashboard-page").dispatchEvent(new Event("open-account")));
    $("headlines").firstElementChild.append(" ",connect);
  }
  if (source === "SEC filings" && !news.length) {
    const link = el("a","View SEC filings on EDGAR");
    link.href = "https://www.sec.gov/search-filings";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    $("headlines").firstElementChild.replaceChildren(link);
  }
}
$("news-source").addEventListener("change", renderNews);
function updatePotentialBuyPrice(label, quote) {
  if (!Number.isFinite(quote?.price) || quote.price <= 0 ||
      !Number.isFinite(quote.time) || quote.time < Number(label.dataset.quoteTime ?? 0)) return;
  label.dataset.quoteTime = quote.time;
  label.textContent = money(quote.price);
  label.title = "Last price · " + date(quote.time) + " ET";
}

function potentialBuyPrice(symbol, quote) {
  const label = el("strong", "Price unavailable");
  label.dataset.potentialBuySymbol = symbol;
  updatePotentialBuyPrice(label, quote);
  return label;
}

function refreshPotentialBuyPrices(market) {
  const quotes = new Map(market.map(row => [row.symbol, row]));
  for (const label of $("opportunities").querySelectorAll("[data-potential-buy-symbol]")) {
    updatePotentialBuyPrice(label, quotes.get(label.dataset.potentialBuySymbol));
  }
}

async function loadChecklistBuys(ai = false) {
  const status = $(ai ? "ai-checklist-status" : "checklist-status");
  const target = $(ai ? "ai-checklist-candidates" : "checklist-candidates");
  try {
    const response = await readDemo(ai ? "/api/checklist-buys?view=ai" : "/api/checklist-buys", {signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw Error("Checklist scan failed");
    const {rows, pending, usingPrevious, failed, funds, checkedAt} = await response.json();
    await waitForDashboardPress();
    if (!ai) $("fund-status").textContent = pending ? (usingPrevious ? "Updating ETFs · Showing last completed results" : "Checking tracked ETFs…")
      : funds?.length ? "" : "No tracked ETFs found.";
    if (!ai) $("fund-list").replaceChildren(...(funds ?? []).map(fund => {
      const item = el("li", "");
      item.append(assetLink(fund.symbol), " · ", potentialBuyPrice(fund.symbol, fund.quote));
      if (Number.isFinite(fund.expenseRatio)) item.append(" · " + fund.expenseRatio.toFixed(2) + "% expense ratio");
      if (fund.pe > 0) item.append(" · " + fund.pe.toFixed(2) + "× portfolio P/E");
      item.append(...percentageText(Number.isFinite(fund.year) ? " · 1Y " + percent(fund.year) : " · 1Y history unavailable"));
      if (fund.profile) item.append(el("p", fund.profile));
      return item;
    }));
    target.replaceChildren(...rows.map(row => {
      const item = el("li", "");
      const scored = row.checks.filter(([, passed]) => passed !== null).length;
      const score = el("span", scored ? row.passes + "/" + row.checks.length + " passed" : "Unscored");
      score.className = !scored ? "" : !row.passes ? "loss" : "gain";
      item.append(assetLink(row.symbol), " · ");
      if (!ai) item.append(potentialBuyPrice(row.symbol, row.quote), " · ");
      item.append(score, ...percentageText(
        Number.isFinite(row.year) ? " · 1Y " + percent(row.year) : " · 1Y history unavailable"));
      if (row.theme) item.append(" · ", el("small", row.theme));
      if (ai && row.aiDescription) item.append(el("p", row.aiDescription));
      if (row.gaps.length) item.append(el("p", "Near match · " + row.gaps.join(" · "), "neutral"));
      const details = el("ul", "");
      for (const [label, passed, measurement] of row.checks) {
        const check = el("li", label + " · ", "neutral");
        check.append(checklistJudgment(passed, measurement));
        details.append(check);
      }
      const summary = el("p", "");
      const passedCount = el("span", row.passes + " passed");
      const failedCount = el("span", (scored - row.passes) + " failed");
      const unscoredCount = el("span", (row.checks.length - scored) + " unscored");
      if (row.passes) passedCount.className = "gain";
      if (scored > row.passes) failedCount.className = "loss";
      summary.append(passedCount, " · ", failedCount, " · ", unscoredCount);
      item.append(summary, details);
      const { atr, atrPercent, date: technicalDate, source } = row.technicals ?? {};
      const atrText = Number.isFinite(atr) && Number.isFinite(atrPercent)
        ? "14-day ATR · " + money(atr) + " · " + percent(atrPercent) + " of closing price"
        : "14-day ATR unavailable";
      const technicals = el("div", "");
      technicals.append(el("strong", "Volatility"), el("p", atrText, "neutral"));
      if (technicalDate) {
        technicals.append(el("small", ["Completed daily data", technicalDate, source].filter(Boolean).join(" · ")));
      }
      item.append(technicals);
      if (Number.isFinite(row.forward) && row.forward > 0 && Number.isFinite(row.peerMedian)) {
        item.append(el("p", row.forward.toFixed(2) + "× forward P/E vs. " + row.peerMedian.toFixed(2) +
          "× median for " + row.peerCount + " tracked peers · " + row.industry));
      } else if (!pending) {
        item.append(el("p", "Comparison requires a forward P/E for this stock and two tracked industry peers."));
      }
      return item;
    }));
    status.textContent = pending ? (usingPrevious ? "Updating · Showing last completed results" :
      ai ? "Checking AI Watchlist stocks…" : "Checking tracked stocks…")
      : failed ? "Some stocks could not be checked." : rows.length ? "" : ai ? "No AI stocks meet the stock screen." : "No stocks passed the trailing P/E screen.";
    if (checkedAt) status.textContent = [status.textContent, "Last scan " + date(checkedAt) + " ET"].filter(Boolean).join(" · ");
    restorePagePosition();
    if (pending) setTimeout(() => void loadChecklistBuys(ai), 2500);
  } catch {
    status.textContent = "Checklist results couldn’t be loaded. Reload the page to try again.";
  }
}
function renderCryptoBuys(data) {
  const signals = (data.liveCryptoSignals ?? data.market).filter(row => row.signals.cryptoDaily)
    .sort((a, b) => b.signals.cryptoDaily.score - a.signals.cryptoDaily.score);
  $("crypto-buy-status").textContent = signals.length
    ? data.liveCryptoSignals ? "Coinbase Exchange · Completed daily candles" : "Simulated signals"
    : "Waiting for completed daily signals.";
  $("crypto-buy-list").replaceChildren(...signals.map(row => {
    const item = el("li", "");
    const signal = row.signals.cryptoDaily;
    item.append(assetLink(row.symbol), " · ", potentialBuyPrice(row.symbol, row), " · " + signal.action,
      ...percentageText(" · " + percent(signal.score) + " vs. 28 days earlier"),
      el("p", "Completed " + signal.asOf + " UTC" +
        (signal.action === "Buy" && !row.fresh ? " · Waiting for fresh price" : "")));
    return item;
  }));
}

if (page === "opportunities") {
  const selector = $("buy-asset-class");
  const savedClass = history.state?.buyAssetClass;
  selector.value = ["stocks", "etfs", "crypto"].includes(savedClass) ? savedClass : "stocks";
  const showAssetClass = () => {
    $("stock-candidates").hidden = selector.value !== "stocks";
    $("fund-candidates").hidden = selector.value !== "etfs";
    $("crypto-candidates").hidden = selector.value !== "crypto";
    history.replaceState({...history.state, buyAssetClass: selector.value}, "");
  };
  selector.addEventListener("change", showAssetClass);
  showAssetClass();
  void loadChecklistBuys();
}

if (page === "ai-watchlist") void loadChecklistBuys(true);

const refreshFeedbackTimers = new WeakMap();
function showRefreshed(status) {
  clearTimeout(refreshFeedbackTimers.get(status));
  status.textContent = "Refreshed";
  refreshFeedbackTimers.set(status, setTimeout(() => {
    if (status.textContent === "Refreshed") status.textContent = "";
    refreshFeedbackTimers.delete(status);
  }, 3000));
}
async function openPushDetail() {
  const id = new URLSearchParams(location.search).get("notice");
  const panel = $((page || "overview") + "-push-detail");
  if (!id || !panel) return;
  if (page === "activity" && id.startsWith("fill:")) restorePosition = null;
  panel.hidden = false;
  panel.textContent = "Loading notification…";
  try {
    const response = await readDemo("/api/notice?" + new URLSearchParams({id}), {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("Notification unavailable");
    const notice = await response.json();
    if (notice.id !== id) throw Error("Notification unavailable");
    const body = el("div", "");
    if (id.startsWith("fill:") && notice.order?.id === id.slice("fill:".length)) {
      const order = notice.order;
      const fields = [
        ["Side", order.side.toUpperCase()],
        ["Status", "Filled"],
        ["Source", order.automated ? "Bot" : "Other"],
        ["Filled quantity", order.quantity],
        ["Requested size", order.requested != null ? money(order.requested) : order.requestedQuantity ? order.requestedQuantity + " units" : null],
        [order.side === "sell" ? "Gross proceeds (USD)" : "Gross purchase (USD)", paperUsdAmount(order.quantity, order.price) ?? "—"],
        ["Request minus gross fill", order.unfilledDollars != null ? money(order.unfilledDollars) : null],
        ["Modeled fee", order.feeUsd != null ? money(order.feeUsd) : "No fee linked to this order"],
        ["Average fill price", order.price ? money(Number(order.price)) : "—"],
        ["Filled at", order.filledAt ? date(order.filledAt) + " ET" : "—"],
        ["Reason", order.reason],
        ["Order ID", order.id],
      ];
      const details = el("dl", "");
      for (const [label, value] of fields) {
        if (value != null) details.append(el("dt", label), el("dd", value, "neutral"));
      }
      body.append(details);
    } else {
      body.append(...notice.body.split("\n").filter(Boolean).map(line => el("p", line, "neutral")));
    }
    panel.replaceChildren(el("h3", notice.title, "neutral"), body);
    for (const article of notice.articles ?? []) {
      let url;
      try { url = new URL(article.url); } catch { continue; }
      if (url.protocol !== "https:") continue;
      const link = el("a", id.startsWith("critical:") ? "Read the full article" : article.label, "neutral");
      Object.assign(link, {href: url.href, target: "_blank", rel: "noopener noreferrer"});
      panel.append(el("p", link));
    }
    clearNotifications([id]);
  } catch {
    panel.textContent = "This notification couldn’t be loaded.";
  }
  const parent = panel.closest("details");
  if (parent) parent.open = true;
  function reveal() {
    if (document.hidden) return;
    document.removeEventListener("visibilitychange", reveal);
    requestAnimationFrame(() => {
      panel.focus({preventScroll: true});
      const header = document.querySelector(".pinned-header");
      const top = window.scrollY + panel.getBoundingClientRect().top - (header?.offsetHeight ?? 0) - 12;
      window.scrollTo({top: Math.max(0, top), behavior: "instant"});
    });
  }
  if (document.hidden) document.addEventListener("visibilitychange", reveal);
  else reveal();
}

function setConnection(ok) {
  const indicator = $("connection-status");
  indicator.className = ok ? "connected" : "";
  indicator.textContent = ok ? "Connected" : "Disconnected";
}

let latestFeeds;
let publicStatus;
const refreshCacheKey = "database-public-refresh";
try {
  const cached = JSON.parse(sessionStorage.getItem(refreshCacheKey));
  if (cached?.version === document.querySelector('meta[name="app-version"]').content &&
      Date.now()-Date.parse(cached.checkedAt)<10*60000) latestFeeds = cached;
} catch {}
async function refreshPublic(section) {
  const url = new URL("api/public-update",appRoot);
  if (section) url.searchParams.set("section",section);
  const response = await fetch(url,{method:"POST",cache:"no-store",signal:AbortSignal.timeout(24000)});
  if (!response.ok) throw Error("The public feed check failed.");
  const updated = await response.json();
  if (updated.version !== document.querySelector('meta[name="app-version"]').content) {
    location.reload();
    return false;
  }
  latestFeeds = {...latestFeeds,...updated,checkedAt:updated.checkedAt ?? updated.cryptoMarket?.checkedAt ?? latestFeeds?.checkedAt};
  try { sessionStorage.setItem(refreshCacheKey,JSON.stringify(latestFeeds)); } catch {}
  return true;
}

async function refreshDashboard(refresh = false) {
  try {
    const response = await readDemo("/api/status", {refresh});
    if (!response.ok) throw Error("Snapshot unavailable");
    const data = await response.json();
    if (latestFeeds) {
      const liveCrypto = latestFeeds.cryptoMarket;
      if (liveCrypto?.coins.length) {
        data.cryptoMarket = liveCrypto;
        data.liveCryptoSignals = liveCrypto.coins.map(coin=>({
          symbol:coin.symbol+"/USD",price:coin.price,time:Date.parse(liveCrypto.checkedAt),
          priceSource:liveCrypto.source,fresh:true,signals:{cryptoDaily:coin.signal},
        }));
      } else if (liveCrypto) {
        data.cryptoMarket = {...data.cryptoMarket,unavailable:true};
      }
      if (latestFeeds.treasury) data.treasury = latestFeeds.treasury;
      if (latestFeeds.sources) {
        const refreshed = new Set(latestFeeds.sources.filter(feed=>feed.available).map(feed=>feed.source));
        data.news = [...latestFeeds.news,...data.news.filter(row=>!refreshed.has(row.source))]
          .sort((a,b)=>b.timestamp-a.timestamp);
        data.publicSources = latestFeeds.sources;
        data.criticalNewsCheck = {checkedAt:latestFeeds.checkedAt,status:refreshed.size
          ? (latestFeeds.sources.some(feed=>!feed.available)?"partial":"ok") : "unavailable"};
      }
    }
    await waitForDashboardPress();
    render(data);
    const rates = data.treasury;
    $("public-rates").textContent = rates
      ? rates.date + " · " + rates.rates.map((n,i) => ["3M","2Y","10Y","30Y"][i] + " " + n.toFixed(2) + "%").join(" · ")
      : "Public rates were unavailable for this snapshot.";
    const version = document.querySelector('meta[name="app-version"]').content;
    $("app-version-status").textContent = "v" + version + " · Data refreshed at " + date(latestFeeds?.checkedAt ?? data.updatedAt) + " ET";
    if (page === "opportunities") {
      refreshPotentialBuyPrices(data.market);
      renderCryptoBuys(data);
    }
    restorePagePosition();
    return true;
  } catch (error) {
    setConnection(false);
    $("status").hidden = false;
    $("status").textContent = "Dashboard snapshot unavailable. Reload to try again.";
    console.error(error);
    return false;
  }
}
if (page === "asset") void loadAssetDetails();
if (page === "news") void loadBenzinga();
void refreshDashboard();
void openPushDetail();
function showPageTransfer() {
  const entries = [...performance.getEntriesByType("navigation"),...performance.getEntriesByType("resource")];
  const measured = entries.filter(entry=>Number.isFinite(entry.transferSize) &&
    new URL(entry.name,location.href).origin === location.origin);
  const total = measured.reduce((bytes,entry)=>bytes+entry.transferSize,0);
  $("page-transfer").textContent = measured.length
    ? new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(total/1024) + " KiB transferred for this page."
    : "Page transfer size is unavailable.";
}
if (page === "usage") {
  showPageTransfer();
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("resource")) {
    new PerformanceObserver(showPageTransfer).observe({type:"resource"});
  }
}
const updateButton = $("update-app");
async function refreshAccountSection() {
  const jobs = [];
  document.dispatchEvent(new CustomEvent("refresh-account-section",{detail:jobs}));
  const results = await Promise.allSettled(jobs);
  return results.some(result=>result.status === "rejected" || result.value === false);
}
function unavailableFeeds() {
  return (latestFeeds?.sources ?? []).filter(feed=>!feed.available).map(feed=>feed.source);
}
updateButton.addEventListener("click",async()=>{
  updateButton.disabled = true;
  updateButton.setAttribute("aria-busy","true");
  const status = $("app-version-status");
  const previous = status.textContent;
  clearTimeout(publicStatus);
  status.textContent = "Checking for updates…";
  try {
    const [refresh, benzingaResult, accountFailed] = await Promise.all([refreshPublic(),page === "news" ? loadBenzinga() : undefined,refreshAccountSection()]);
    if (!refresh) return;
    if (!await refreshDashboard()) throw Error("Dashboard refresh failed.");
    if (page === "asset") await loadAssetDetails();
    if (page === "ai-watchlist" || page === "opportunities") await loadChecklistBuys(page === "ai-watchlist");
    const refreshed = status.textContent;
    status.textContent += latestFeeds.partial || unavailableFeeds().length || latestFeeds.cryptoMarket?.partial || accountFailed || benzingaResult === false
      ? " · Some data unavailable" : " · Refreshed";
    publicStatus = setTimeout(()=>{status.textContent=refreshed;},3000);
  } catch {
    status.textContent = previous + " · Update couldn’t be completed";
  } finally {
    updateButton.disabled = false;
    updateButton.removeAttribute("aria-busy");
  }
});
const refreshName = page || "overview";
const refreshButton = $("refresh-" + refreshName);
if (refreshButton) {
  refreshButton.addEventListener("click", async () => {
    const status = $("refresh-status-" + refreshName);
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    status.textContent = "Refreshing…";
    try {
      if (page === "usage" || page === "robinhood-portfolio") {
        showPageTransfer();
        await refreshAccountSection();
        status.textContent = "";
        return;
      }
      if (page === "notifications") {
        if (current) renderNotifications(current.notifications);
        showRefreshed(status);
        return;
      }
      const liveCrypto = page === "crypto" || (page === "opportunities" && $("buy-asset-class").value === "crypto");
      const accountUpdate = refreshAccountSection();
      let benzingaResult;
      if (page === "news" || !page || liveCrypto) {
        const [publicResult,newsResult] = await Promise.all([refreshPublic(liveCrypto ? "crypto" : "feeds"),page === "news" ? loadBenzinga() : undefined]);
        if (!publicResult) return;
        benzingaResult = newsResult;
      }
      const accountFailed = await accountUpdate;
      if (page !== "activity" && !await refreshDashboard(false)) throw Error("Snapshot unavailable");
      if (page === "ai-watchlist" || (page === "opportunities" && !liveCrypto)) await loadChecklistBuys(page === "ai-watchlist");
      if (accountFailed) {
        status.textContent = "Some account data couldn’t be refreshed.";
        return;
      }
      if (liveCrypto && latestFeeds.cryptoMarket?.partial) {
        status.textContent = latestFeeds.cryptoMarket.coins.length ? "Some crypto quotes couldn’t be refreshed." : "Crypto market data couldn’t be refreshed.";
        return;
      }
      if (page === "news") {
        const missing = unavailableFeeds().filter(source=>source !== "U.S. Treasury");
        if (benzingaResult === false) missing.push("Benzinga");
        if (missing.length) {
          status.textContent = "Unavailable news sources · " + missing.join(", ");
          return;
        }
      }
      if (page === "ai-watchlist" || (page === "opportunities" && !liveCrypto)) {
        status.textContent = "Screen recalculated from the current data.";
        return;
      }
      showRefreshed(status);
    } catch {
      status.textContent = "Couldn’t reload this snapshot.";
    } finally {
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
    }
  });
}
