(() => {
  "use strict";
  const config = window.CRACKPACKS_CONFIG || {};
  const base = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const token = () => localStorage.getItem("cp_rewards_token") || "";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  let shows = [];
  let savedGiveaways = [];
  let giftedQueue = [];
  let sellerShows = [];
  let sellerInventoryItems = [];
  let sellerContextAuthorized = false;
  let activeTab = "watchlist";

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const api = async (path, options = {}) => {
    if (!base) throw new Error("The live service is not configured.");
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The live service could not complete that request.");
    return payload;
  };
  const dateLabel = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Schedule pending";

  const calendarDownload = show => {
    const start = new Date(show.startsAt || Date.now());
    const end = new Date(start.getTime() + 3 * 60 * 60e3);
    const stamp = value => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Crack Packs//Live Show//EN", "BEGIN:VEVENT", `UID:${show.id}@crackpacks.com`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${show.title}`, `DESCRIPTION:Crack Packs live show by ${show.sellerUsername}`, `URL:${location.origin}${location.pathname}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
    const link = document.createElement("a"); link.href = url; link.download = `${show.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const showCard = show => `
    <article class="stream-card holo-panel">
      <img src="${escapeHtml(show.image || "assets/images/banner-cosmic.svg")}" alt="${escapeHtml(show.title)}">
      <div class="stream-card-top"><span class="stream-pill ${escapeHtml(show.state)}">${show.state === "live" ? "LIVE NOW" : "UPCOMING"}</span><span class="viewer-pill">${Number(show.viewers || 0)} viewers</span></div>
      <h3>${escapeHtml(show.title)}</h3><p><strong>${escapeHtml(show.sellerUsername)}</strong></p>
      <div class="stream-card-meta"><span>${escapeHtml(show.state === "live" ? "Live now" : dateLabel(show.startsAt))}</span><span>${show.state === "live" ? "Bidding open" : "Save the date"}</span></div>
      <div class="stream-card-actions">
        <button class="btn btn-outline btn-small" type="button" data-watch="${show.id}">${show.saved ? "Saved" : "Add to Watchlist"}</button>
        <button class="btn btn-outline btn-small" type="button" data-follow="${show.sellerId}">${show.followed ? "Following" : "Follow"}</button>
        ${show.state === "upcoming" ? `<button class="btn btn-outline btn-small" type="button" data-calendar="${show.id}">Add to Calendar</button>` : `<a class="btn btn-primary btn-small" href="live.html?show=${show.id}">Watch &amp; Bid</a>`}
        <button class="btn btn-primary btn-small" type="button" data-open-gifted="${show.id}">Donate to Show</button>
      </div>
    </article>`;

  function renderShows() {
    let filtered = shows;
    if (activeTab === "watchlist") filtered = shows.filter(show => show.saved);
    if (activeTab === "live") filtered = shows.filter(show => show.state === "live");
    if (activeTab === "upcoming") filtered = shows.filter(show => show.state === "upcoming");
    if (activeTab === "followed") filtered = shows.filter(show => show.followed);
    $("[data-streams-list]").innerHTML = filtered.map(showCard).join("");
    $("[data-streams-empty]").hidden = filtered.length > 0;
  }

  async function loadShows() {
    try { shows = (await api("/live/shows")).shows || []; }
    catch (error) { shows = []; $("[data-streams-empty]").textContent = error.message; }
    renderShows();
  }

  async function loadGiftCatalog(showId) {
    const select = $("[data-gifted-product]");
    select.innerHTML = `<option value="">Loading seller inventory...</option>`;
    const payload = await api(`/gifted-giveaways/catalog?show=${encodeURIComponent(showId)}`);
    const items = Array.isArray(payload.items) ? payload.items : [];
    select.innerHTML = `<option value="">Choose a paid giveaway item</option>${items.map(item => `<option value="${item.id}">${escapeHtml(item.name)} · $${(Number(item.priceCents) / 100).toFixed(2)} · ${Number(item.quantity)} available</option>`).join("")}`;
    if (!items.length) select.innerHTML = `<option value="">Seller has no giftable inventory configured</option>`;
  }

  function renderSellerGiveaways() {
    const list = $("[data-seller-giveaway-list]");
    if (!list) return;
    list.innerHTML = savedGiveaways.length ? savedGiveaways.map(item => `<article class="seller-giveaway-item"><header><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.status)}</span></header><p>${Number(item.quantity)} winner(s) · ${escapeHtml(item.inventory_label)}</p><small>${escapeHtml(item.rules || "")}</small></article>`).join("") : `<div class="stream-empty">No saved giveaway presets yet.</div>`;
  }
  function renderGiftedQueue() {
    const list = $("[data-gifted-giveaway-queue]");
    if (!list) return;
    list.innerHTML = giftedQueue.length ? giftedQueue.map(item => `<article class="gifted-giveaway-card"><header><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.status)}</span></header><p>${escapeHtml(item.product_name)} · ${Number(item.quantity)}</p><small>${escapeHtml(item.message || "")}</small></article>`).join("") : `<div class="stream-empty">No paid gifted giveaways are waiting in this seller queue.</div>`;
  }
  const setStatus = (selector, message = "", kind = "") => {
    const node = $(selector); if (!node) return; node.textContent = message; node.dataset.kind = kind;
  };

  function renderSellerShows() {
    const select = $("[data-seller-show-select]");
    if (!select) return;
    const current = select.value;
    const active = sellerShows.filter(show => ["open", "live"].includes(show.status));
    select.innerHTML = `<option value="">${active.length ? "Choose a show" : "Create a show first"}</option>${active.map(show => `<option value="${show.id}">${escapeHtml(show.title)} · ${escapeHtml(show.status)}</option>`).join("")}`;
    if (active.some(show => show.id === current)) select.value = current;
    else if (active.length) select.value = active[0].id;
    loadSellerLots(select.value).catch(error => setStatus("[data-seller-lot-status]", error.message, "error"));
  }

  function renderSellerLots(lots = [], show) {
    const list = $("[data-seller-lot-list]");
    if (!list) return;
    const end = show && ["open", "live"].includes(show.status) ? `<button class="btn btn-danger btn-small" type="button" data-end-show="${show.id}">End show</button>` : "";
    list.innerHTML = `${end}${lots.length ? lots.map(lot => {
      const current = Number(lot.current_bid_cents ?? lot.starting_bid_cents) / 100;
      const action = lot.status === "scheduled" ? `<button class="btn btn-primary btn-small" type="button" data-lot-action="open" data-lot-id="${lot.id}">Open auction</button>` : lot.status === "live" ? `<button class="btn btn-danger btn-small" type="button" data-lot-action="close" data-lot-id="${lot.id}">Close auction</button>` : "";
      return `<article class="seller-lot-item"><div><strong>${escapeHtml(lot.title)}</strong><p>${escapeHtml(lot.status)} · $${current.toFixed(2)}${lot.winning_display ? ` · leading @${escapeHtml(lot.winning_display)}` : ""}</p></div>${action}</article>`;
    }).join("") : `<div class="stream-empty">No auction lots are saved for this show.</div>`}`;
  }

  async function loadSellerLots(showId) {
    if (!showId) { renderSellerLots([]); return; }
    const payload = await api(`/seller/shows/${encodeURIComponent(showId)}/lots`);
    renderSellerLots(payload.lots || [], payload.show);
  }

  async function loadSellerShows() {
    const payload = await api("/seller/shows");
    sellerShows = payload.shows || [];
    renderSellerShows();
  }

  function renderSellerInventory(reorders = []) {
    const list = $("[data-seller-inventory-list]");
    const reorderList = $("[data-seller-reorder-list]");
    if (list) list.innerHTML = sellerInventoryItems.length ? sellerInventoryItems.map(item => `<article class="seller-giveaway-item"><header><div><strong>${escapeHtml(item.product_name)}</strong><p>${escapeHtml(item.sku || item.unit_type)} · ${Number(item.quantity)} available · ${Number(item.inbound_quantity)} inbound</p><small>PAR ${Number(item.par_quantity)} · reorder ${Number(item.reorder_quantity)} · auto ${Number(item.auto_reorder_enabled) ? "on" : "off"}</small></div><div class="stream-card-actions"><input data-inventory-adjust-quantity="${item.id}" type="number" min="1" max="100000" value="1" aria-label="Adjustment quantity"><button class="btn btn-outline btn-small" type="button" data-inventory-adjust="received" data-inventory-id="${item.id}">Receive +</button><button class="btn btn-danger btn-small" type="button" data-inventory-adjust="sale" data-inventory-id="${item.id}">Sale −</button></div></header></article>`).join("") : `<div class="stream-empty">No seller inventory yet. Paid Seller Store purchases will appear as inbound automatically.</div>`;
    if (reorderList) reorderList.innerHTML = reorders.length ? reorders.map(item => `<article class="seller-giveaway-item"><strong>${escapeHtml(item.product_name)}</strong><p>${Number(item.requested_quantity)} requested · ${escapeHtml(item.status)}</p></article>`).join("") : `<div class="stream-empty">No reorders are waiting for owner review.</div>`;
  }

  async function loadSellerInventory() {
    const payload = await api("/seller/inventory");
    sellerInventoryItems = payload.items || [];
    renderSellerInventory(payload.reorders || []);
  }

  async function loadSellerContext() {
    if (!token()) return;
    try {
      const status = await api("/portal/status");
      sellerContextAuthorized = Boolean(status.sellerAccess && status.activePortal === "seller");
      localStorage.setItem("cp_can_seller_portal", status.sellerAccess ? "true" : "false");
      if (!sellerContextAuthorized) return;
      $$('[data-seller-only]').forEach(node => { node.hidden = false; });
      await Promise.all([loadSellerGiveaways(), loadSellerShows(), loadSellerInventory()]);
    } catch {}
  }

  async function loadSellerGiveaways() {
    if (!sellerContextAuthorized) return;
    try {
      const payload = await api("/seller/giveaways");
      savedGiveaways = payload.saved || []; giftedQueue = payload.gifted || [];
      renderSellerGiveaways(); renderGiftedQueue();
    } catch (error) { $("[data-seller-giveaway-list]").textContent = error.message; }
  }

  $("[data-streams-list]")?.addEventListener("click", async event => {
    const watch = event.target.closest("[data-watch]");
    const follow = event.target.closest("[data-follow]");
    const gift = event.target.closest("[data-open-gifted]");
    const calendar = event.target.closest("[data-calendar]");
    try {
      if (watch) {
        if (!token()) throw new Error("Sign in to save a watchlist.");
        const show = shows.find(item => item.id === watch.dataset.watch); await api("/live/watchlist", { method: "POST", body: JSON.stringify({ showId: show.id, enabled: !show.saved }) }); show.saved = !show.saved; renderShows();
      } else if (follow) {
        if (!token()) throw new Error("Sign in to follow sellers.");
        const show = shows.find(item => item.sellerId === follow.dataset.follow); await api("/live/follow", { method: "POST", body: JSON.stringify({ sellerId: show.sellerId, enabled: !show.followed }) }); shows.filter(item => item.sellerId === show.sellerId).forEach(item => { item.followed = !show.followed; }); renderShows();
      } else if (calendar) calendarDownload(shows.find(item => item.id === calendar.dataset.calendar));
      else if (gift) {
        if (!token()) throw new Error("Sign in to fund a gifted giveaway.");
        const show = shows.find(item => item.id === gift.dataset.openGifted);
        $("[data-gifted-show-title]").textContent = `${show.sellerUsername} · ${show.title}`;
        $("[data-gifted-show-id]").value = show.id;
        await loadGiftCatalog(show.id);
        $("[data-gifted-giveaway-form]").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (error) { window.alert(error.message); }
  });

  $$('[data-hub-tab]').forEach(button => button.addEventListener("click", () => {
    activeTab = button.dataset.hubTab || "watchlist";
    $$('[data-hub-tab]').forEach(node => node.classList.toggle("is-active", node === button)); renderShows();
  }));

  $("[data-seller-giveaway-form]")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.submitter; button.disabled = true;
    try {
      await api("/seller/giveaways", { method: "POST", body: JSON.stringify({ title: form.get("title"), quantity: Number(form.get("quantity")), inventoryLabel: form.get("inventoryLabel"), eligibilityProfile: form.get("eligibility"), openMode: form.get("openMode"), rules: form.get("rules") }) });
      event.currentTarget.reset(); await loadSellerGiveaways();
    } catch (error) { window.alert(error.message); } finally { button.disabled = false; }
  });

  $("[data-gifted-giveaway-form]")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.submitter; button.disabled = true; button.textContent = "Opening Stripe...";
    try {
      const payload = await api("/gifted-giveaways/checkout", { method: "POST", body: JSON.stringify({ showId: form.get("showId"), inventoryItemId: form.get("inventoryItemId"), quantity: 1, message: form.get("note") }) });
      if (!payload.checkoutUrl) throw new Error("Stripe did not return a checkout page.");
      location.href = payload.checkoutUrl;
    } catch (error) { window.alert(error.message); button.disabled = false; button.textContent = "Fund giveaway securely"; }
  });

  $("[data-stream-input-create]")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true;
    setStatus("[data-stream-input-status]", "Loading your private Cloudflare Stream input...");
    try {
      let payload = await api("/seller/stream/input");
      if (!payload.input) payload = await api("/seller/stream/input", { method: "POST", body: "{}" });
      if (!payload.input?.rtmpsUrl || !payload.input?.streamKey) throw new Error("Cloudflare did not return a complete OBS connection.");
      $("[data-stream-rtmps-url]").value = payload.input.rtmpsUrl;
      $("[data-stream-key]").value = payload.input.streamKey;
      $("[data-stream-input-result]").hidden = false;
      setStatus("[data-stream-input-status]", "OBS connection ready. Keep the stream key private.", "success");
    } catch (error) { setStatus("[data-stream-input-status]", error.message, "error"); }
    finally { button.disabled = false; }
  });

  $("[data-reveal-stream-key]")?.addEventListener("click", event => {
    const field = $("[data-stream-key]"); const reveal = field.type === "password";
    field.type = reveal ? "text" : "password"; event.currentTarget.textContent = reveal ? "Hide" : "Reveal";
  });

  $$('[data-copy-stream-field]').forEach(button => button.addEventListener("click", async () => {
    const field = button.dataset.copyStreamField === "key" ? $("[data-stream-key]") : $("[data-stream-rtmps-url]");
    if (!field?.value) return;
    try { await navigator.clipboard.writeText(field.value); setStatus("[data-stream-input-status]", "OBS value copied.", "success"); }
    catch { field.select(); document.execCommand("copy"); setStatus("[data-stream-input-status]", "OBS value copied.", "success"); }
  }));

  $("[data-seller-show-form]")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const button = event.submitter; button.disabled = true;
    try {
      const scheduledValue = String(data.get("scheduledAt") || "");
      await api("/seller/shows", { method: "POST", body: JSON.stringify({ title: data.get("title"), scheduledAt: scheduledValue ? new Date(scheduledValue).toISOString() : null, thumbnailUrl: data.get("thumbnailUrl") }) });
      form.reset(); await loadSellerShows(); setStatus("[data-seller-show-status]", "Show saved.", "success");
    } catch (error) { setStatus("[data-seller-show-status]", error.message, "error"); }
    finally { button.disabled = false; }
  });

  $("[data-seller-show-select]")?.addEventListener("change", event => loadSellerLots(event.currentTarget.value).catch(error => setStatus("[data-seller-lot-status]", error.message, "error")));
  $("[data-seller-shows-refresh]")?.addEventListener("click", () => loadSellerShows().catch(error => setStatus("[data-seller-show-status]", error.message, "error")));

  $("[data-seller-lot-form]")?.addEventListener("submit", async event => {
    event.preventDefault(); const showId = $("[data-seller-show-select]").value;
    if (!showId) { setStatus("[data-seller-lot-status]", "Choose an active show first.", "error"); return; }
    const form = event.currentTarget; const data = new FormData(form); const button = event.submitter; button.disabled = true;
    try {
      await api(`/seller/shows/${encodeURIComponent(showId)}/lots`, { method: "POST", body: JSON.stringify(Object.fromEntries(data.entries())) });
      form.reset(); form.elements.startingBid.value = "1.00"; form.elements.bidIncrement.value = "1.00";
      await loadSellerLots(showId); setStatus("[data-seller-lot-status]", "Auction lot added.", "success");
    } catch (error) { setStatus("[data-seller-lot-status]", error.message, "error"); }
    finally { button.disabled = false; }
  });

  $("[data-seller-lot-list]")?.addEventListener("click", async event => {
    const action = event.target.closest("[data-lot-action]"); const end = event.target.closest("[data-end-show]");
    try {
      if (action) {
        action.disabled = true;
        await api(`/seller/lots/${encodeURIComponent(action.dataset.lotId)}/${action.dataset.lotAction}`, { method: "POST", body: "{}" });
        await loadSellerLots($("[data-seller-show-select]").value);
      } else if (end && confirm("End this show and cancel every open or scheduled auction lot?")) {
        end.disabled = true;
        await api(`/seller/shows/${encodeURIComponent(end.dataset.endShow)}/end`, { method: "POST", body: "{}" });
        await loadSellerShows(); setStatus("[data-seller-lot-status]", "Show ended.", "success");
      }
    } catch (error) { setStatus("[data-seller-lot-status]", error.message, "error"); }
  });

  $("[data-seller-inventory-form]")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const button = event.submitter; button.disabled = true;
    try {
      await api("/seller/inventory", { method: "POST", body: JSON.stringify({ productName: data.get("productName"), sku: data.get("sku"), unitType: data.get("unitType"), quantity: Number(data.get("quantity")), parQuantity: Number(data.get("parQuantity")), reorderQuantity: Number(data.get("reorderQuantity")), autoReorder: data.get("autoReorder") === "on" }) });
      form.reset(); await loadSellerInventory(); setStatus("[data-seller-inventory-status]", "Seller inventory saved.", "success");
    } catch (error) { setStatus("[data-seller-inventory-status]", error.message, "error"); }
    finally { button.disabled = false; }
  });

  $("[data-seller-inventory-list]")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-inventory-adjust]"); if (!button) return;
    const quantity = Number($(`[data-inventory-adjust-quantity="${button.dataset.inventoryId}"]`)?.value || 0);
    button.disabled = true;
    try {
      await api(`/seller/inventory/${encodeURIComponent(button.dataset.inventoryId)}/adjust`, { method: "POST", body: JSON.stringify({ action: button.dataset.inventoryAdjust, quantity }) });
      await loadSellerInventory(); setStatus("[data-seller-inventory-status]", "Inventory updated.", "success");
    } catch (error) { button.disabled = false; setStatus("[data-seller-inventory-status]", error.message, "error"); }
  });

  loadShows();
  loadSellerContext();
})();
