(() => {
  "use strict";

  const profiles = [...document.querySelectorAll("[data-nav-profile]")];
  const config = window.CRACKPACKS_CONFIG || {};
  const rewardsApi = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const token = () => localStorage.getItem("cp_rewards_token") || "";
  const body = document.body;
  const page = String(body?.dataset.page || "").toLowerCase();
  const buyerProfileUrl = "referral.html";
  const sellerSetupUrl = () => (token() ? "referral.html?return=seller" : "referral.html?mode=signin&return=seller");
  const sellerGoLiveUrl = "streams.html#go-live";
  const sellerCreateShowUrl = "streams.html#create-show";
  let ownerSignupUrl = "referral.html?mode=signup";
  let portalState = { signedIn: false, sellerAccess: false, activePortal: "buyer" };

  const requestJson = async path => {
    if (!rewardsApi) throw new Error("Rewards service is not configured.");
    const response = await fetch(`${rewardsApi}${path}`, {
      headers: { Accept: "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Navigation state could not be loaded.");
    return payload;
  };

  const goLiveHref = () => (portalState.sellerAccess ? sellerGoLiveUrl : sellerSetupUrl());
  const createShowHref = () => (portalState.sellerAccess ? sellerCreateShowUrl : sellerSetupUrl());
  const routeToSellerSetup = () => {
    localStorage.setItem("cp_can_seller_portal", "false");
    localStorage.setItem("cp_portal_mode", "buyer");
    sessionStorage.setItem("cp_portal_mode", "buyer");
    sessionStorage.setItem("cp_seller_upgrade_requested", "true");
    window.location.href = sellerSetupUrl();
  };
  const accountMenuMarkup = () => `
    <div class="nav-account-bubbles" aria-label="Account portal switcher">
      <button class="nav-account-bubble ${portalState.activePortal !== "seller" ? "is-active" : ""}" type="button" data-open-buyer-portal>Buyer</button>
      <button class="nav-account-bubble ${portalState.activePortal === "seller" ? "is-active" : ""}" type="button" data-open-seller-portal>Seller</button>
    </div>
    <a href="${buyerProfileUrl}"><strong>Profile</strong><small>Invites, rewards, orders and account tools</small></a>
  `;

  function ensureHeaderActionLinks() {
    const nav = document.querySelector(".site-nav");
    if (!nav) return;
    let createLink = nav.querySelector("[data-header-create-show]");
    let liveLink = nav.querySelector("[data-header-go-live]");
    if (!createLink) {
      createLink = document.createElement("a");
      createLink.className = "nav-live nav-account-action";
      createLink.dataset.headerCreateShow = "";
      createLink.textContent = "Create Show";
      nav.append(createLink);
    }
    if (!liveLink) {
      liveLink = document.createElement("a");
      liveLink.className = "nav-live nav-account-action nav-account-action-primary";
      liveLink.dataset.headerGoLive = "";
      liveLink.textContent = "Go Live";
      nav.append(liveLink);
    }
    createLink.href = createShowHref();
    liveLink.href = goLiveHref();
    createLink.classList.toggle("is-signup-route", !portalState.sellerAccess);
    liveLink.classList.toggle("is-signup-route", !portalState.sellerAccess);
  }

  function renderAccountMenus() {
    profiles.forEach(profile => {
      const trigger = profile.querySelector("[data-profile-trigger]");
      const menu = profile.querySelector(".nav-profile-menu");
      if (!trigger || !menu) return;
      trigger.innerHTML = `Account <span class="nav-profile-caret" aria-hidden="true">▼</span>`;
      menu.innerHTML = accountMenuMarkup();
    });
    ensureHeaderActionLinks();
  }

  profiles.forEach(profile => {
    const trigger = profile.querySelector("[data-profile-trigger]");
    if (!trigger) return;
    const close = () => { profile.classList.remove("is-open"); trigger.setAttribute("aria-expanded", "false"); };
    trigger.addEventListener("click", event => {
      event.stopPropagation();
      const opening = !profile.classList.contains("is-open");
      profiles.forEach(item => { item.classList.remove("is-open"); item.querySelector("[data-profile-trigger]")?.setAttribute("aria-expanded", "false"); });
      if (opening) { profile.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true"); }
    });
    document.addEventListener("click", event => { if (!profile.contains(event.target)) close(); });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && profile.classList.contains("is-open")) {
        close();
        trigger.focus();
      }
    });
  });

  async function loadNavAccountState() {
    try {
      const publicReferral = rewardsApi ? await requestJson("/public/owner-referral") : null;
      ownerSignupUrl = String(publicReferral?.sellerSignupUrl || publicReferral?.signupUrl || ownerSignupUrl);
    } catch {}
    if (!token() || !rewardsApi) {
      portalState = { signedIn: false, sellerAccess: false, activePortal: "buyer" };
      renderAccountMenus();
      return;
    }
    try {
      const status = await requestJson("/portal/status");
      portalState = {
        signedIn: true,
        sellerAccess: Boolean(status.sellerAccess || status.isMaster),
        activePortal: status.sellerAccess && status.activePortal === "seller" ? "seller" : "buyer"
      };
    } catch {
      portalState = { signedIn: false, sellerAccess: false, activePortal: "buyer" };
    }
    renderAccountMenus();
  }

  document.addEventListener("click", async event => {
    const buyer = event.target.closest("[data-open-buyer-portal]");
    const seller = event.target.closest("[data-open-seller-portal]");
    if (!buyer && !seller) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    if (!token() || !rewardsApi) {
      if (seller) routeToSellerSetup();
      else window.location.href = buyerProfileUrl;
      return;
    }
    if (seller && !portalState.sellerAccess) {
      routeToSellerSetup();
      return;
    }
    try {
      const response = await fetch(`${rewardsApi}/portal/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ mode: seller ? "seller" : "buyer" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Portal access could not be verified.");
      if (seller) {
        if (payload.activePortal !== "seller") throw new Error("Seller setup is not complete yet.");
        localStorage.setItem("cp_can_seller_portal", "true");
        localStorage.setItem("cp_portal_mode", "seller");
        sessionStorage.setItem("cp_portal_mode", "seller");
      }
      window.location.href = seller ? "streams.html" : buyerProfileUrl;
    } catch {
      if (seller) routeToSellerSetup();
      else window.location.href = buyerProfileUrl;
    }
  });

  loadNavAccountState();

  const mountSocialFooter = () => {
    if (!document.body || document.querySelector("[data-crack-packs-social-footer]")) return;

    const footer = document.createElement("footer");
    footer.className = "crack-social-footer";
    footer.dataset.crackPacksSocialFooter = "";
    footer.setAttribute("aria-labelledby", "crack-social-title");
    footer.innerHTML = `
      <div class="crack-social-footer-glow" aria-hidden="true"></div>
      <div class="crack-social-footer-inner">
        <div class="crack-social-cta">
          <p class="crack-social-eyebrow"><span aria-hidden="true">&#10022;</span> The crew never sleeps</p>
          <h2 id="crack-social-title">Keep cracking <span>with us.</span></h2>
          <p>Live breaks, fresh pulls, collector chaos, and first-look drops&mdash;follow Crack Packs wherever you scroll.</p>
          <span class="crack-social-sticker" aria-hidden="true">Tap in &bull; Join the crew</span>
        </div>

        <nav class="crack-social-grid" aria-label="Crack Packs social profiles">
          <a class="crack-social-link crack-social-youtube" href="https://www.youtube.com/@CRACKPACKSdotcom" target="_blank" rel="noopener noreferrer" aria-label="Watch Crack Packs on YouTube (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="M14 20Q15 12 25 11L55 14Q64 15 63 25L61 50Q60 59 50 60L20 57Q10 56 11 46Z"/>
              <path class="crack-social-icon-panel" d="M11 17Q12 9 22 8L52 11Q61 12 60 22L58 47Q57 56 47 57L17 54Q7 53 8 43Z"/>
              <path class="crack-social-icon-mark" d="M29 24 46 34 27 43Z"/>
              <path class="crack-social-icon-spark" d="m59 5 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>YouTube</strong><small>Watch the rips</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-live" href="streams.html" target="_blank" rel="noopener noreferrer" aria-label="Open Crack Packs live streams (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="M17 17 55 12 63 51 26 61 10 49Z"/>
              <path class="crack-social-icon-panel" d="m14 13 38-5 8 39-37 10L7 45Z"/>
              <path class="crack-social-icon-mark crack-social-live-mark" d="m17 25 8 19 8-17 8 14 9-23"/>
              <path class="crack-social-icon-spark" d="m58 51 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>Live</strong><small>Shop live breaks</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-instagram" href="https://www.instagram.com/crackpacksdotcom/?utm_source=ig_web_button_share_sheet" target="_blank" rel="noopener noreferrer" aria-label="Follow Crack Packs on Instagram (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="M17 10 55 13Q63 14 62 24L59 54Q58 62 48 62L17 58Q8 57 9 47l3-29q1-8 5-8Z"/>
              <path class="crack-social-icon-panel" d="M14 7 52 10Q60 11 59 21L56 51Q55 59 45 59L14 55Q5 54 6 44l3-29q1-8 5-8Z"/>
              <rect class="crack-social-camera-frame" x="19" y="19" width="27" height="27" rx="8" transform="rotate(6 32.5 32.5)"/>
              <circle class="crack-social-camera-lens" cx="32" cy="33" r="7"/>
              <circle class="crack-social-camera-dot" cx="42" cy="23" r="2.5"/>
              <path class="crack-social-icon-spark" d="m59 4 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>Instagram</strong><small>See the heat</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-facebook" href="https://www.facebook.com/CRACKPACKSdotcom" target="_blank" rel="noopener noreferrer" aria-label="Follow Crack Packs on Facebook (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="m20 12 35 2q9 1 8 11l-3 26q-1 9-11 9l-10-1-10 8 1-9-13-2Q8 55 9 45l3-25q1-9 8-8Z"/>
              <path class="crack-social-icon-panel" d="m17 8 35 2q9 1 8 11l-3 26q-1 9-11 9l-10-1-10 8 1-9-13-2Q5 51 6 41l3-25q1-9 8-8Z"/>
              <path class="crack-social-icon-mark crack-social-facebook-mark" d="M38 48 40 34h7l1-8h-7l1-4q0-4 5-3l3-7q-15-4-18 9l-1 5h-6l-1 8h6l-2 14Z"/>
              <path class="crack-social-icon-spark" d="m58 49 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>Facebook</strong><small>Join the crew</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-x" href="https://x.com/CRACKPACKS_com" target="_blank" rel="noopener noreferrer" aria-label="Follow Crack Packs on X at CRACKPACKS underscore com (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="m18 11 38 3 7 37-30 13L9 48Z"/>
              <path class="crack-social-icon-panel" d="m15 7 38 3 7 37-30 13L6 44Z"/>
              <path class="crack-social-icon-mark crack-social-x-mark" d="m23 20 27 32M50 19 22 52"/>
              <path class="crack-social-icon-spark" d="m59 4 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>X</strong><small>@CRACKPACKS_com</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>
        </nav>
      </div>
      <p class="crack-social-signoff">Crack Packs <span aria-hidden="true">&bull;</span> Rip loud. Collect proud.</p>
    `;

    document.body.append(footer);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountSocialFooter, { once: true });
  } else {
    mountSocialFooter();
  }
})();
