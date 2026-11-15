const config = await fetch("./account-api/config", {cache:"no-store"}).then(response =>
  response.ok ? response.json() : null).catch(() => null);

if (config?.accountMode) {
  const open = document.getElementById("account-button");
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
  open.hidden = false;
  open.addEventListener("click",()=> {
    if (!dialog.open) dialog.showModal();
    void run(update);
  });
  document.getElementById("account-close").addEventListener("click",()=>dialog.close());
  signIn.addEventListener("click",()=>void run(async()=>{
    const response = await call("sign-in","POST");
    if (!response.ok) throw Error("Sign-in could not be started.");
    const data = await response.json();
    location.assign(data.authorize);
  }));
  signOut.addEventListener("click",()=>void run(async()=>{
    const response = await call("sign-out","POST");
    if (!response.ok) throw Error("Sign-out failed.");
    status.textContent = "Signed out.";
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
      status.textContent = "Alpaca Paper connected.";
      renderAccount(data);
    });
  });
  disconnect.addEventListener("click",()=>void run(async()=>{
    const response = await call("alpaca-paper","DELETE");
    if (!response.ok) throw Error("Could not remove the paper connection.");
    status.textContent = "Alpaca Paper disconnected.";
    renderAccount(await response.json());
  }));
  if (result === "ready" || result === "failed") {
    if (result === "failed") status.textContent = "Sign-in could not be completed.";
    open.click();
  }
}
