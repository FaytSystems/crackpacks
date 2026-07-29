// D:\crackpacks\crackpacks-github-ready\assets\js\config.js

window.CRACKPACKS_CONFIG = {
  liveHubUrl: "live-shows.html",
  cardApiUrl: "https://api.crackpacks.com/cards",
  ebayApiUrl: "https://api.crackpacks.com/ebay",
  rewardsApiUrl: "https://rewards-api.crackpacks.com",
  turnstileSiteKey: "0x4AAAAAAD3RxD5Wyh6r4B_p",
  youtubeLiveStatusUrl: "https://live-api.crackpacks.com/status",
  facebookUrl: "https://www.facebook.com/CRACKPACKSdotcom",
  instagramUrl: "https://www.instagram.com/crackpacksdotcom/?utm_source=ig_web_button_share_sheet",
  xUrl: "https://x.com/CRACKPACKS_com",
  youtubeChannelUrl: "https://www.youtube.com/@CRACKPACKSdotcom",
  youtubeManualVideoId: "",
  youtubeStatusRefreshMs: 60000,
  youtubeSlideshowMs: 6500,
  youtubeRequestTimeoutMs: 8000,
  storeUrl: "shop.html",
  cardSeriesTabs: [
    { id: "pokemon", label: "Pokemon" },
    { id: "magic", label: "Magic" },
    { id: "yugioh", label: "Yu-Gi-Oh!" },
    { id: "sports", label: "Sports cards" },
    { id: "lorcana", label: "Lorcana" },
    { id: "onepiece", label: "One Piece" },
    { id: "dragonball", label: "Dragon Ball" },
    { id: "digimon", label: "Digimon" },
    { id: "fab", label: "Flesh and Blood" },
    { id: "weiss", label: "Weiss Schwarz" },
    { id: "graded", label: "Graded slabs" },
    { id: "sealed", label: "Sealed boxes" },
    { id: "collectibles", label: "Collectibles" }
  ],
  email: "support@crackpacks.com",
  domain: "https://crackpacks.com",
  updated: "July 29, 2026",
  storeNotice: "The Crack Packs marketplace is in preview while seller payouts, shipping, and payment settings complete launch verification.",
  newsletterMessage: "Create your verified Profile to join Crack Packs drop alerts."
};

(() => {
  "use strict";
  if (!/^(?:www\.)?crackpacks\.com$/i.test(location.hostname)) return;
  const endpoint = `${String(window.CRACKPACKS_CONFIG?.rewardsApiUrl || "").replace(/\/$/, "")}/analytics/client`;
  if (!endpoint.startsWith("https://")) return;
  const metrics = new Map();
  let sent = false;
  const remember = (name, value) => {
    if (Number.isFinite(value)) metrics.set(name, Math.round(value * 100) / 100);
  };
  try {
    new PerformanceObserver(list => {
      const entry = list.getEntries().at(-1);
      if (entry) remember("lcp", entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  try {
    let cls = 0;
    new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        if (!entry.hadRecentInput) cls += entry.value;
      });
      remember("cls", cls);
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  try {
    let inp = 0;
    new PerformanceObserver(list => {
      list.getEntries().forEach(entry => { inp = Math.max(inp, entry.duration || 0); });
      remember("inp", inp);
    }).observe({ type: "event", buffered: true, durationThreshold: 40 });
  } catch {}
  try {
    new PerformanceObserver(list => {
      const fcp = list.getEntriesByName("first-contentful-paint")[0];
      if (fcp) remember("fcp", fcp.startTime);
    }).observe({ type: "paint", buffered: true });
  } catch {}
  const send = () => {
    if (sent || !metrics.size) return;
    sent = true;
    metrics.forEach((metricValue, metricName) => {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          eventName: "performance.web_vital",
          pagePath: location.pathname,
          metricName,
          metricValue
        })
      }).catch(() => {});
    });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") send();
  });
  window.addEventListener("pagehide", send, { once: true });
})();
