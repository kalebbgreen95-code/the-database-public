const enable = document.getElementById("enable-push");
const test = document.getElementById("test-notification");
const status = document.getElementById("phone-status");
const result = document.getElementById("push-result");
const pagePicker = document.getElementById("dashboard-page");
const notificationsOption = pagePicker.querySelector('option[value="/notifications"]');
const onNotifications = new URLSearchParams(location.search).get("screen") === "notifications" ||
  location.hash === "#notifications";
const supported = isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
const worker = new URL("./notification-worker.js",import.meta.url);
const endpoint = new URL("./account-api/browser-push",import.meta.url);
let subscription;

async function request(method,device) {
  const response = await fetch(endpoint,{method,cache:"no-store",signal:AbortSignal.timeout(18000),
    ...(device ? {headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:device.endpoint})} : {})});
  const data = await response.json();
  if (response.status === 401) throw Error("Sign in from Account to enable push notifications.");
  if (!response.ok) throw Error(data.error ?? "Browser push is unavailable.");
  return data;
}

function renderState() {
  const permission = supported ? Notification.permission : "unsupported";
  enable.disabled = permission === "unsupported";
  const active = Boolean(subscription) && permission === "granted";
  if (active) {
    notificationsOption.remove();
    if (onNotifications) pagePicker.selectedIndex = -1;
  } else if (!notificationsOption.parentNode) {
    pagePicker.append(notificationsOption);
    if (onNotifications) pagePicker.value = notificationsOption.value;
  }
  enable.textContent = active ? "Disable push notifications" : "Enable push notifications";
  test.hidden = !active;
  status.textContent = permission === "unsupported" ? "This browser does not support push notifications."
    : permission === "denied" ? "Notifications are blocked in this browser’s site settings."
    : active ? "This device can receive paper order alerts while the dashboard is closed."
    : "Sign in to enable paper order alerts on this device.";
}

async function existingSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(worker);
  return registration?.pushManager.getSubscription();
}

export async function disableDevicePush() {
  if (!supported) return;
  const device = subscription ?? await existingSubscription();
  if (!device) return;
  try { await request("DELETE",device); }
  finally {
    await device.unsubscribe();
    subscription = undefined;
    renderState();
  }
}

enable.addEventListener("click",async()=>{
  enable.disabled = true;
  result.textContent = "";
  try {
    if (subscription && Notification.permission === "granted") {
      await disableDevicePush();
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
      result.textContent = "Notification permission wasn’t granted.";
      return;
    }
    const {publicKey} = await request("GET");
    await navigator.serviceWorker.register(worker);
    const registration = await navigator.serviceWorker.ready;
    const device = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:Uint8Array.from(atob(publicKey.replace(/-/g,"+").replace(/_/g,"/")),character=>character.charCodeAt(0)),
    });
    try {
      await request("PUT",device);
      subscription = device;
    } catch (error) {
      await device.unsubscribe();
      throw error;
    }
  } catch (error) {
    result.textContent = error.message || "Couldn’t enable push notifications.";
  } finally {
    renderState();
  }
});

test.addEventListener("click",async()=>{
  test.disabled = true;
  try {
    await request("POST",subscription);
    result.textContent = "The push service accepted your test notification.";
  } catch (error) {
    result.textContent = error.message || "Couldn’t send a test notification.";
  } finally {
    test.disabled = false;
  }
});

renderState();
if (supported) {
  const syncSubscription = async () => {
    if (enable.disabled) return;
    const device = await existingSubscription();
    if (enable.disabled) return;
    subscription = device;
    renderState();
  };
  void syncSubscription().catch(()=>{});
  document.addEventListener("visibilitychange",()=>{
    if (!document.hidden) void syncSubscription().catch(()=>{});
  });
}
