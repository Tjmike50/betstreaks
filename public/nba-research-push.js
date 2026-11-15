self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("BetStreaks", {
    body: "You have a new NBA watchlist update.",
    icon: "/favicon.png",
    tag: "betstreaks-nba-watchlist",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/research/nba?tab=watchlist"));
});
