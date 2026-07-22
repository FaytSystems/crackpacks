(() => {
  "use strict";

  const STORAGE_KEY = "cp_portal_mode";
  const SELLER_ALLOWED_KEY = "cp_can_seller_portal";
  const body = document.body;
  if (!body) return;

  const getMode = () => {
    const stored = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || "buyer";
    return stored === "seller" ? "seller" : "buyer";
  };

  const sellerAllowed = () => localStorage.getItem(SELLER_ALLOWED_KEY) === "true";

  const setMode = mode => {
    const next = mode === "seller" && sellerAllowed() ? "seller" : "buyer";
    sessionStorage.setItem(STORAGE_KEY, next);
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  };

  let mode = getMode();
  if (mode === "seller" && !sellerAllowed()) mode = setMode("buyer");

  body.dataset.portalMode = mode;
  body.classList.toggle("portal-seller-mode", mode === "seller");
  body.classList.toggle("portal-buyer-mode", mode !== "seller");

  document.querySelectorAll("[data-portal-mode-label]").forEach(node => {
    node.textContent = mode === "seller" ? "Seller Portal" : "Buyer Portal";
  });

  document.querySelectorAll("[data-buyer-only]").forEach(node => {
    node.hidden = mode === "seller";
  });

  document.querySelectorAll("[data-seller-only]").forEach(node => {
    node.hidden = mode !== "seller";
  });

  document.querySelectorAll("[data-hide-store-link]").forEach(node => {
    node.hidden = mode !== "seller";
  });

  if (body.dataset.sellerPage === "true" && mode !== "seller") {
    document.querySelectorAll("[data-seller-gate]").forEach(node => {
      node.hidden = false;
    });
    document.querySelectorAll("[data-seller-page-content]").forEach(node => {
      node.hidden = true;
    });
  }

  document.querySelectorAll("[data-open-seller-portal]").forEach(button => {
    button.addEventListener("click", () => {
      if (!sellerAllowed()) {
        window.alert("Seller Portal access has not been enabled on this account yet.");
        return;
      }
      setMode("seller");
      window.location.href = "shop.html";
    });
  });

  document.querySelectorAll("[data-open-buyer-portal]").forEach(button => {
    button.addEventListener("click", () => {
      setMode("buyer");
      window.location.href = "streams.html";
    });
  });
})();
