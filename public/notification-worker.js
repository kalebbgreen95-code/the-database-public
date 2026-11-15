self.addEventListener("push",event=>{
  event.waitUntil(self.registration.showNotification("The Database",{
    body:"Open the dashboard to check your paper trading activity.",
    tag:"database-paper-activity",
  }));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const inbox = new URL("./?screen=notifications",self.registration.scope);
  event.waitUntil((async()=>{
    const tabs = await clients.matchAll({type:"window",includeUncontrolled:true});
    const dashboard = tabs.find(tab=>new URL(tab.url).pathname === inbox.pathname);
    if (!dashboard) return clients.openWindow(inbox.href);
    await dashboard.navigate(inbox.href);
    await dashboard.focus();
  })());
});
