(() => {
  "use strict";
  const config = window.CRACKPACKS_CONFIG || {};
  const api = String(config.rewardsApiUrl || "").replace(/\/+$/, "");
  const sessionId = new URLSearchParams(location.search).get("session_id") || "";
  const token = localStorage.getItem("cp_rewards_token") || "";
  const title = document.querySelector("[data-checkout-title]");
  const message = document.querySelector("[data-checkout-message]");
  const orderPanel = document.querySelector("[data-checkout-order]");
  const formatMoney = (cents, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(cents || 0) / 100);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  async function load() {
    if (!api || !token || !/^cs_[a-z0-9_]+$/i.test(sessionId)) {
      title.textContent = "Sign in to view your order";
      message.textContent = "Open Profile with the same account used at checkout, then return to this confirmation address.";
      return;
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await fetch(`${api}/store/checkout/status?session=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        title.textContent = "We could not load this order";
        message.textContent = payload.error || "Contact support with your Stripe receipt.";
        return;
      }
      if (payload.order) {
        title.textContent = "Order confirmed";
        message.textContent = "Payment is complete. Crack Packs will purchase the label manually and email tracking when it is attached.";
        document.querySelector("[data-checkout-order-number]").textContent = payload.order.orderNumber;
        document.querySelector("[data-checkout-total]").textContent = formatMoney(payload.order.totalCents, payload.order.currency);
        orderPanel.hidden = false;
        return;
      }
      await wait(1500);
    }
    title.textContent = "Payment received — confirmation pending";
    message.textContent = "Stripe confirmation is still processing. Do not pay again. Your order will appear in Profile automatically, and a receipt will arrive by email.";
  }
  load().catch(() => {
    title.textContent = "Confirmation is temporarily unavailable";
    message.textContent = "Do not pay again. Check Profile Orders or contact support@crackpacks.com with your Stripe receipt.";
  });
})();
