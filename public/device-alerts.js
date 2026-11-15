const enabledKey = "database-device-alerts";
const seenKey = "database-device-alerts-seen";
const enable = document.getElementById("enable-push");
const test = document.getElementById("test-notification");
const status = document.getElementById("phone-status");
const result = document.getElementById("push-result");
const supported = isSecureContext && "Notification" in window && "serviceWorker" in navigator;
const worker = new URL("./notification-worker.js", import.meta.url);
let registration;
let enabled = saved(enabledKey) === "true";
let known = new Set();
try { known = new Set(JSON.parse(saved(seenKey) || "[]")); } catch {}

function saved(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function renderState() {
  const permission = supported ? Notification.permission : "unsupported";
  enable.disabled = permission === "unsupported";
  const active = enabled && permission === "granted";
  enable.textContent = active ? "Disable notifications" : "Enable notifications";
  test.hidden = !active;
  status.textContent = permission === "unsupported" ? "Device notifications are unavailable in this browser."
    : permission === "denied" ? "Notifications are blocked. Allow them in this browser’s site settings."
    : active ? "Device notifications are enabled. New alerts appear when the dashboard checks for updates."
    : "Enable device notifications for new alerts while the dashboard is open.";
}

async function showNotification(title, body, tag) {
  registration ??= navigator.serviceWorker.register(worker).catch(error=>{
    registration = undefined;
    throw error;
  });
  await registration;
  const ready = await navigator.serviceWorker.ready;
  await ready.showNotification(title,{body,tag});
}

enable.addEventListener("click",async()=>{
  enable.disabled = true;
  result.textContent = "";
  try {
    if (enabled && Notification.permission === "granted") {
      enabled = false;
    } else {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      enabled = permission === "granted";
      if (permission === "default") result.textContent = "Notification permission wasn’t granted.";
    }
    save(enabledKey,String(enabled));
  } catch {
    result.textContent = "Couldn’t change device notifications.";
  } finally {
    renderState();
  }
});

test.addEventListener("click",async()=>{
  test.disabled = true;
  try {
    await showNotification("The Database","Device notifications are working.","database-test");
    result.textContent = "Test notification sent.";
  } catch {
    result.textContent = "Couldn’t display a test notification.";
  } finally {
    test.disabled = false;
  }
});

let firstCheck = saved(seenKey) === null;
export function checkDeviceAlerts(notifications) {
  try {
    for (const id of JSON.parse(saved(seenKey) || "[]")) known.add(id);
  } catch {}
  const unseen = notifications.filter(row=>!known.has(row.id));
  if (!firstCheck && supported && enabled && Notification.permission === "granted" && unseen.length) {
    const newest = unseen[0];
    void showNotification(newest.title,newest.body,"database-" + newest.id).catch(()=>{
      result.textContent = "Couldn’t display the latest device notification.";
    });
  }
  firstCheck = false;
  for (const row of unseen) known.add(row.id);
  known = new Set([...known].slice(-200));
  save(seenKey,JSON.stringify([...known]));
}

window.addEventListener("focus",renderState);
renderState();
