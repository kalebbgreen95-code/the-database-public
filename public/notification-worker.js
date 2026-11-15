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
