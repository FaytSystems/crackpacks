// D:\crackpacks\crackpacks-github-ready\assets\js\config.js

window.CRACKPACKS_CONFIG = {
  liveHubUrl: "streams.html",
  cardApiUrl: "https://api.crackpacks.com/cards",
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
    { id: "pokemon", label: "Pokémon" },
    { id: "magic", label: "Magic the Gathering" }
  ],
  email: "support@crackpacks.com",
  domain: "https://crackpacks.com",
  updated: "July 18, 2026",
  storeNotice: "The Crack Packs storefront is a Coming Soon preview. Checkout is locked until inventory, shipping, and payment settings are verified.",
  newsletterMessage: "Create your verified Profile to join Crack Packs drop alerts."
};

if (!document.querySelector('script[data-crackpacks-social-loader]')) {
  const socialScript = document.createElement('script');
  socialScript.src = 'assets/js/social-footer.js?v=1.0.0';
  socialScript.dataset.crackpacksSocialLoader = '';
  document.head.append(socialScript);
}
