(() => {
  "use strict";

  const STORAGE_KEY = "cp_portal_mode";
  const SELLER_ALLOWED_KEY = "cp_can_seller_portal";
  const MASTER_ALLOWED_KEY = "cp_can_master_portal";
  const apiBase = String(window.CRACKPACKS_CONFIG?.rewardsApiUrl || "").replace(/\/$/, "");
  const authToken = () => localStorage.getItem("cp_rewards_token") || "";
  const body = document.body;
  if (!body) return;
  const page = String(body.dataset.page || "").toLowerCase();

  const getMode = () => {
    const stored = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || "buyer";
    return stored === "master" ? "master" : (stored === "seller" ? "seller" : "buyer");
  };

  const sellerAllowed = () => localStorage.getItem(SELLER_ALLOWED_KEY) === "true";
  const masterAllowed = () => localStorage.getItem(MASTER_ALLOWED_KEY) === "true";
  const sellerPortalDestination = () => page === "streams" || page === "live" ? "streams.html" : "shop.html";
  const buyerPortalDestination = () => page === "shop" ? "shop.html" : "shop.html";
  const sellerSetupDestination = () => authToken() ? "referral.html?return=seller" : "referral.html?mode=signin&return=seller";

  const portalRequest = async (path, options = {}) => {
    if (!apiBase || !authToken()) throw new Error("Sign in to your Profile first.");
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken()}`, ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Portal access could not be verified.");
    return payload;
  };

  const setMode = mode => {
    const next = mode === "master" && masterAllowed()
      ? "master"
      : (mode === "seller" && sellerAllowed() ? "seller" : "buyer");
    sessionStorage.setItem(STORAGE_KEY, next);
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  };

  let mode = getMode();
  if (mode === "seller" && apiBase && authToken()) mode = "buyer";
  if (mode === "master" && apiBase && authToken()) mode = "buyer";
  if (mode === "master" && !masterAllowed()) mode = setMode("buyer");
  if (mode === "seller" && !sellerAllowed()) mode = setMode("buyer");

  const applyPortalDom = nextMode => {
    body.dataset.portalMode = nextMode;
    body.classList.toggle("portal-seller-mode", nextMode === "seller");
    body.classList.toggle("portal-master-mode", nextMode === "master");
    body.classList.toggle("portal-buyer-mode", nextMode === "buyer");
    document.querySelectorAll("[data-portal-mode-label]").forEach(node => { node.textContent = nextMode === "master" ? "Master Portal" : (nextMode === "seller" ? "Seller Portal" : "Buyer Portal"); });
    document.querySelectorAll("[data-buyer-only]").forEach(node => { node.hidden = nextMode !== "buyer"; });
    document.querySelectorAll("[data-seller-only]").forEach(node => { node.hidden = nextMode !== "seller"; });
    document.querySelectorAll("[data-master-only]").forEach(node => { node.hidden = nextMode !== "master"; });
    document.querySelectorAll("[data-hide-store-link]").forEach(node => { node.hidden = false; });
    if (body.dataset.sellerPage === "true") {
      document.querySelectorAll("[data-seller-gate]").forEach(node => { node.hidden = nextMode === "seller"; });
      document.querySelectorAll("[data-seller-page-content]").forEach(node => { node.hidden = nextMode !== "seller"; });
    }
  };
  applyPortalDom(mode);

  document.querySelectorAll("[data-open-seller-portal]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await portalRequest("/portal/mode", { method: "POST", body: JSON.stringify({ mode: "seller" }) });
        if (result.activePortal !== "seller") throw new Error("Seller setup is not complete yet.");
        localStorage.setItem(SELLER_ALLOWED_KEY, "true");
        setMode(result.activePortal || "seller");
        window.location.href = sellerPortalDestination();
      } catch (error) {
        localStorage.setItem(SELLER_ALLOWED_KEY, "false");
        sessionStorage.setItem(STORAGE_KEY, "buyer");
        localStorage.setItem(STORAGE_KEY, "buyer");
        if (page === "rewards") {
          button.disabled = false;
          sessionStorage.setItem("cp_seller_upgrade_requested", "true");
          document.dispatchEvent(new CustomEvent("crackpacks:start-seller-upgrade"));
          return;
        }
        window.location.href = sellerSetupDestination();
      }
    });
  });

  document.querySelectorAll("[data-open-buyer-portal]").forEach(button => {
    button.addEventListener("click", async () => {
      try { await portalRequest("/portal/mode", { method: "POST", body: JSON.stringify({ mode: "buyer" }) }); } catch {}
      setMode("buyer");
      window.location.href = buyerPortalDestination();
    });
  });

  document.querySelectorAll("[data-open-master-portal]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (apiBase && authToken()) {
          await fetch(`${apiBase}/auth/logout`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken()}` },
            body: "{}"
          }).catch(() => {});
        }
      } finally {
        sessionStorage.removeItem("cp_admin_token");
        localStorage.removeItem("cp_rewards_token");
        localStorage.setItem(SELLER_ALLOWED_KEY, "false");
        localStorage.setItem(MASTER_ALLOWED_KEY, "false");
        sessionStorage.setItem(STORAGE_KEY, "buyer");
        localStorage.setItem(STORAGE_KEY, "buyer");
        window.location.href = "referral.html?mode=signin&portal=master";
      }
    });
  });

  if (apiBase && authToken()) {
    portalRequest("/portal/status").then(status => {
      localStorage.setItem(SELLER_ALLOWED_KEY, status.sellerAccess ? "true" : "false");
      localStorage.setItem(MASTER_ALLOWED_KEY, status.isMaster ? "true" : "false");
      const confirmed = status.isMaster && status.activePortal === "master"
        ? "master"
        : (status.sellerAccess && status.activePortal === "seller" ? "seller" : "buyer");
      mode = setMode(confirmed);
      applyPortalDom(mode);
    }).catch(() => {
      localStorage.setItem(SELLER_ALLOWED_KEY, "false");
      localStorage.setItem(MASTER_ALLOWED_KEY, "false");
    });
  } else {
    localStorage.setItem(SELLER_ALLOWED_KEY, "false");
    localStorage.setItem(MASTER_ALLOWED_KEY, "false");
  }
})();
