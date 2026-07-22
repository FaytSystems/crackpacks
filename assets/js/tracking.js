(() => {
  const root = document.querySelector("[data-tracking-app]");
  if (!root) return;
  const config = window.CRACKPACKS_CONFIG || {};
  const api = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const orderId = String(new URLSearchParams(location.search).get("order") || "");
  const token = localStorage.getItem("cp_rewards_token") || "";
  const $ = selector => document.querySelector(selector);
  const message = (text, kind = "") => { $("[data-tracking-message]").textContent = text; $("[data-tracking-message]").dataset.kind = kind; };
  const label = value => String(value || "unknown").replace(/_/g, " ");
  async function request() {
    const response = await fetch(`${api}/orders/${encodeURIComponent(orderId)}/tracking`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || "Tracking could not be loaded."); error.status = response.status; throw error; }
    return payload;
  }
  function render(order) {
    $("[data-tracking-auth]").hidden = true; $("[data-tracking-details]").hidden = false;
    $("[data-tracking-order-number]").textContent = order.orderNumber;
    $("[data-tracking-order-meta]").textContent = `${String(order.channel || "order").replace(/^./, value => value.toUpperCase())} · Ordered ${new Date(order.placedAt).toLocaleDateString()}`;
    const status = $("[data-tracking-status]"); status.textContent = label(order.tracking?.status || order.status); status.className = `tracking-status ${order.tracking?.status || order.status || "unknown"}`;
    const items = $("[data-tracking-items]"); items.replaceChildren();
    (Array.isArray(order.items) ? order.items : []).forEach(item => { const row = document.createElement("li"); row.textContent = `${Number(item.quantity || 1)}× ${item.name}`; items.append(row); });
    $("[data-tracking-carrier]").textContent = order.tracking?.carrier || "Tracking pending";
    $("[data-tracking-code]").textContent = order.tracking?.trackingCode || "";
    const estimate = $("[data-tracking-estimate]"); estimate.textContent = order.tracking?.estimatedDeliveryDate ? `Estimated delivery: ${new Date(order.tracking.estimatedDeliveryDate).toLocaleString()}` : "Estimated delivery will appear when the carrier provides it.";
    const carrierLink = $("[data-tracking-carrier-link]"); carrierLink.hidden = !order.tracking?.carrierPublicUrl; if (!carrierLink.hidden) carrierLink.href = order.tracking.carrierPublicUrl;
    const timeline = $("[data-tracking-timeline]"); timeline.replaceChildren();
    const details = Array.isArray(order.tracking?.details) ? [...order.tracking.details].reverse() : [];
    if (!details.length) { const empty = document.createElement("li"); empty.className = "tracking-timeline-empty"; empty.textContent = "The tracker is active. The first carrier scan has not arrived yet."; timeline.append(empty); }
    details.forEach(detail => {
      const row = document.createElement("li"); row.className = "tracking-event";
      const body = document.createElement("div"); const title = document.createElement("strong"); title.textContent = detail.message || label(detail.status);
      const location = document.createElement("span"); location.textContent = [detail.location?.city, detail.location?.state, detail.location?.country].filter(Boolean).join(", ") || label(detail.statusDetail || detail.status);
      const time = document.createElement("time"); time.dateTime = detail.datetime || ""; time.textContent = detail.datetime ? new Date(detail.datetime).toLocaleString() : "Time pending";
      body.append(title, location, time); row.append(body); timeline.append(row);
    });
    message(order.tracking?.mode === "test" ? "EasyPost test tracking is connected. No label or postage was purchased." : "Tracking is current.", "success");
  }
  async function load() {
    if (!token) { $("[data-tracking-auth]").hidden = false; message("Sign in to your Profile to view this private order."); return; }
    if (!api || !/^[0-9a-f-]{36}$/i.test(orderId)) { message("This tracking address is invalid.", "error"); return; }
    try { const data = await request(); render(data.order); }
    catch (error) { if (error.status === 401) $("[data-tracking-auth]").hidden = false; message(error.message, "error"); }
  }
  $("[data-tracking-refresh]").addEventListener("click", load);
  load();
})();
