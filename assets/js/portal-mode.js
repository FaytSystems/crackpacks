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
  const sellerPortalDestination = () => "streams.html#seller-home";
  const masterPortalDestination = () => "admin.html";
  const buyerPortalDestination = button => button?.getAttribute?.("href") || "referral.html?view=account";
  const sellerSetupDestination = () => authToken() ? "referral.html?return=seller" : "referral.html?mode=signin&return=seller";
  const sellerToolHashes = new Set([
    "#seller-home",
    "#seller-live",
    "#seller-show-control",
    "#go-live",
    "#seller-obs",
    "#seller-simulcast",
    "#create-show",
    "#seller-shows",
    "#seller-my-listings",
    "#seller-social",
    "#seller-inventory",
    "#seller-categories",
    "#seller-cogs",
    "#seller-shipping",
    "#seller-giveaways"
  ]);
  const hasSellerToolIntent = () => page === "streams" && sellerToolHashes.has(location.hash);
  const clearSellerPortalState = () => {
    localStorage.setItem(SELLER_ALLOWED_KEY, "false");
    sessionStorage.setItem(STORAGE_KEY, "buyer");
    localStorage.setItem(STORAGE_KEY, "buyer");
  };
  const startSellerSetup = button => {
    clearSellerPortalState();
    sessionStorage.setItem("cp_seller_upgrade_requested", "true");
    if (page === "rewards") {
      if (button) button.disabled = false;
      document.dispatchEvent(new CustomEvent("crackpacks:start-seller-upgrade"));
      return;
    }
    window.location.href = sellerSetupDestination();
  };

  const portalRequest = async (path, options = {}) => {
    if (!apiBase || !authToken()) throw new Error("Sign in to your Profile first.");
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken()}`, ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Portal access could not be verified.");
      error.status = response.status;
      throw error;
    }
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
        startSellerSetup(button);
      }
    });
  });

  document.querySelectorAll("[data-open-buyer-portal]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const destination = buyerPortalDestination(button);
      if ("disabled" in button) button.disabled = true;
      try { await portalRequest("/portal/mode", { method: "POST", body: JSON.stringify({ mode: "buyer" }) }); } catch {}
      setMode("buyer");
      window.location.href = destination;
    });
  });

  document.querySelectorAll("[data-open-master-portal]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      try {
        const result = await portalRequest("/portal/mode", { method: "POST", body: JSON.stringify({ mode: "master" }) });
        if (result.activePortal !== "master") throw new Error("Master Portal access could not be confirmed.");
        localStorage.setItem(MASTER_ALLOWED_KEY, "true");
        setMode("master");
        window.location.href = masterPortalDestination();
      } catch (error) {
        button.disabled = false;
        if (!authToken() || error.status === 401) {
          window.location.href = "referral.html?mode=signin&portal=master";
          return;
        }
        window.alert(error.message || "Master Portal access could not be verified.");
      }
    });
  });

  if (apiBase && authToken()) {
    portalRequest("/portal/status").then(status => {
      localStorage.setItem(SELLER_ALLOWED_KEY, status.sellerAccess ? "true" : "false");
      localStorage.setItem(MASTER_ALLOWED_KEY, status.isMaster ? "true" : "false");
      const confirmed = status.isMaster && getMode() === "master"
        ? "master"
        : (status.sellerAccess && status.activePortal === "seller" ? "seller" : "buyer");
      mode = setMode(confirmed);
      applyPortalDom(mode);
      if (!status.sellerAccess && hasSellerToolIntent()) startSellerSetup();
    }).catch(() => {
      clearSellerPortalState();
      localStorage.setItem(MASTER_ALLOWED_KEY, "false");
      if (hasSellerToolIntent()) startSellerSetup();
    });
  } else {
    clearSellerPortalState();
    localStorage.setItem(MASTER_ALLOWED_KEY, "false");
    if (hasSellerToolIntent()) startSellerSetup();
  }
})();
