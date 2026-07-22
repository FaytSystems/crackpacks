(() => {
  const config = window.CRACKPACKS_CONFIG || {};
  const api = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const params = new URLSearchParams(location.search);
  const sale = String(params.get("sale") || "");
  const token = String(params.get("token") || "");
  const $ = selector => document.querySelector(selector);
  const status = $("[data-verify-status]");
  const showStatus = (message = "", kind = "") => { status.textContent = message; status.dataset.kind = kind; };
  const dateLabel = value => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Pending";
  const offsetLabel = seconds => seconds === null || seconds === undefined ? "Pending" : `${Math.floor(Number(seconds) / 60)}m ${Number(seconds) % 60}s into stream`;
  async function loadVerification() {
    if (!api) throw new Error("Rewards service is not configured.");
    if (!sale || !token) throw new Error("This Verify Order link is missing its private sale token.");
    const response = await fetch(`${api}/verify-order/sale?sale=${encodeURIComponent(sale)}&token=${encodeURIComponent(token)}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "This Verify Order link could not be loaded.");
    return payload.sale;
  }
  function render(sale) {
    $("[data-verify-title]").textContent = sale.productName || "Crack Packs breaker sale";
    const summary = $("[data-verify-summary]");
    summary.replaceChildren();
    [
      ["Quantity", String(sale.quantity || 1)],
      ["Auction won", dateLabel(sale.saleOccurredAt)],
      ["Stream offset", offsetLabel(sale.streamOffsetSeconds)],
      ["Clip starts", dateLabel(sale.clipStartedAt || sale.saleOccurredAt)],
      ["Clip ends", dateLabel(sale.clipEndedAt)],
      ["Clip method", String(sale.clipMethod || "pending").replace(/_/g, " ")],
      ["Clip length", sale.clipDurationSeconds ? `${sale.clipDurationSeconds}s` : "Pending"],
      ["Breaker", sale.whatnotUsername ? `@${sale.whatnotUsername}` : sale.email || "Crack Packs breaker"]
    ].forEach(([labelText, valueText]) => {
      const item = document.createElement("div");
      const label = document.createElement("span"); label.textContent = labelText;
      const value = document.createElement("strong"); value.textContent = valueText;
      item.append(label, value); summary.append(item);
    });
    const actions = $("[data-verify-actions]");
    actions.replaceChildren();
    if (sale.clipUrl) {
      const link = document.createElement("a"); link.className = "btn btn-primary"; link.href = sale.clipUrl; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Open Clip";
      actions.append(link);
    }
    if (sale.streamRecordingUrl) {
      const link = document.createElement("a"); link.className = "btn btn-outline"; link.href = sale.streamRecordingUrl; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Open Stream Recording";
      actions.append(link);
    }
    showStatus(sale.clipUrl || sale.streamRecordingUrl ? "Recording proof is attached to this sale." : sale.clipError || "This sale is timestamped. The clip will appear after the recording is uploaded.", sale.clipUrl || sale.streamRecordingUrl ? "success" : "error");
  }
  loadVerification().then(render).catch(error => showStatus(error.message, "error"));
})();
