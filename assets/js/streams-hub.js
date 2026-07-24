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
  let sellerStoreListings = [];
  let sellerShowLots = [];
  let sellerCogsOrders = [];
  let sellerContextAuthorized = false;
  let activeTab = "watchlist";
  let hasSavedObsConnection = false;
  let obsGuideDismissedForSession = false;
  let obsGuideCompletedAt = "";
  let obsGuideTriggeredByCreate = false;
  const OBS_GUIDE_COMPLETED_KEY = "cp_obs_guide_completed";

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const dollars = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
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
  function renderStreamInput(input) {
    const summary = $("[data-stream-connection-status]");
    const result = $("[data-stream-input-result]");
    if (!summary || !result) return;
    if (!input?.rtmpsUrl || !input?.streamKey) {
      hasSavedObsConnection = false;
      summary.textContent = "Not set up yet";
      result.hidden = true;
      syncStreamKeyButtons();
      return;
    }
    hasSavedObsConnection = true;
    summary.textContent = "Saved to seller profile";
    $("[data-stream-rtmps-url]").value = input.rtmpsUrl;
    $("[data-stream-key]").value = input.streamKey;
    result.hidden = false;
    syncStreamKeyButtons();
  }
  function renderYouTubeOutput(output) {
    const connected = Boolean(output?.connected);
    const status = $("[data-youtube-output-status]");
    const disconnect = $("[data-youtube-output-disconnect]");
    const channelInput = $("[data-youtube-output-form] [name='channelUrl']");
    const channelLink = $("[data-youtube-channel-link]");
    if (status) {
      status.textContent = connected ? "Connected for simulcast" : "Not connected";
      status.classList.toggle("is-connected", connected);
    }
    if (disconnect) disconnect.disabled = !connected;
    if (channelInput && output?.channelUrl) channelInput.value = output.channelUrl;
    if (channelLink) channelLink.href = output?.channelUrl || "https://studio.youtube.com/";
  }
  async function loadYouTubeOutput() {
    if (!sellerContextAuthorized || !hasSavedObsConnection) {
      renderYouTubeOutput(null);
      return;
    }
    try {
      renderYouTubeOutput(await api("/seller/stream/youtube"));
    } catch (error) {
      setStatus("[data-youtube-output-message]", error.message, "error");
    }
  }
  const showShareUrl = show => new URL(`live.html?show=${encodeURIComponent(show?.id || "")}`, location.href).href;
  const selectedSellerShow = () => {
    const showId = $("[data-seller-show-select]")?.value || "";
    return sellerShows.find(show => show.id === showId) || null;
  };
  const sellerSocialCaption = show => {
    if (!show) throw new Error("Choose a show first.");
    const message = String($("[data-seller-social-message]")?.value || "").trim() || `I'm live on Crack Packs: ${show.title}`;
    return `${message}\n\n${showShareUrl(show)}`;
  };
  const copyText = async text => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.width = "1px";
    area.style.height = "1px";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.append(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("Copy did not complete. Use Save to download the key instead.");
    return true;
  };

  const calendarDownload = show => {
    const start = new Date(show.startsAt || Date.now());
    const end = new Date(start.getTime() + 3 * 60 * 60e3);
    const stamp = value => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Crack Packs//Live Show//EN", "BEGIN:VEVENT", `UID:${show.id}@crackpacks.com`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${show.title}`, `DESCRIPTION:Crack Packs live show by ${show.sellerUsername}`, `URL:${location.origin}${location.pathname}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
    const link = document.createElement("a"); link.href = url; link.download = `${show.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadTextFile = (filename, text) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const streamKeyCreatorState = { mode: "create", generated: false };
  const hasCompletedObsGuide = () => Boolean(obsGuideCompletedAt) || localStorage.getItem(OBS_GUIDE_COMPLETED_KEY) === "true";
  const markObsGuideCompleted = stamp => {
    obsGuideCompletedAt = stamp || new Date().toISOString();
    localStorage.setItem(OBS_GUIDE_COMPLETED_KEY, "true");
  };
  function syncStreamKeyButtons() {
    const create = $("[data-stream-input-create]");
    const load = $("[data-stream-input-load]");
    const rotate = $("[data-stream-input-rotate]");
    if (create) create.textContent = hasSavedObsConnection ? "Regenerate Key" : "Create Key";
    if (load) load.textContent = "Show Saved OBS Connection";
    if (rotate) rotate.textContent = "OBS Setup Guide";
  }
  function syncStreamGuideVisibility({ forceOpen = false, firstOpen = false } = {}) {
    const guide = $("[data-stream-setup-guide]");
    if (!guide) return;
    const shouldAutoOpen = obsGuideTriggeredByCreate && !hasSavedObsConnection && !hasCompletedObsGuide() && !obsGuideDismissedForSession;
    const manualOpen = !guide.hidden && (obsGuideTriggeredByCreate || hasSavedObsConnection || hasCompletedObsGuide());
    const visible = forceOpen || shouldAutoOpen || manualOpen;
    guide.hidden = !visible;
    guide.classList.toggle("is-visible", visible);
    guide.classList.toggle("is-first-open", Boolean(firstOpen && visible));
  }
  function closeStreamKeyCreator() {
    const panel = $("[data-stream-key-creator]");
    if (!panel) return;
    panel.hidden = true;
    streamKeyCreatorState.mode = "create";
    streamKeyCreatorState.generated = false;
    const input = $("[data-stream-key-creator-value]");
    const confirm = $("[data-stream-key-creator-confirm]");
    const copy = $("[data-stream-key-creator-copy-button]");
    const save = $("[data-stream-key-creator-save-button]");
    if (input) input.value = "";
    if (input) input.placeholder = "Your new OBS stream key will appear here after you click Create Key or Regenerate Key.";
    if (confirm) confirm.textContent = "Create Key";
    if (copy) copy.disabled = true;
    if (save) save.disabled = true;
  }
  function openStreamKeyCreator(mode = "create") {
    const panel = $("[data-stream-key-creator]");
    if (!panel) return;
    const regenerate = mode === "regenerate";
    streamKeyCreatorState.mode = regenerate ? "regenerate" : "create";
    streamKeyCreatorState.generated = false;
    panel.hidden = false;
    $("[data-stream-key-creator-title]").textContent = regenerate ? "Regenerate key" : "Create key";
    $("[data-stream-key-creator-copy]").textContent = regenerate
      ? "Your current key stays active until you click Regenerate Key."
      : "Create your private OBS key when you are ready.";
    $("[data-stream-key-creator-value]").value = "";
    $("[data-stream-key-creator-value]").placeholder = regenerate
      ? "Your regenerated OBS stream key will appear here."
      : "Your new OBS stream key will appear here.";
    $("[data-stream-key-creator-confirm]").textContent = regenerate ? "Regenerate Key" : "Create Key";
    $("[data-stream-key-creator-copy-button]").disabled = true;
    $("[data-stream-key-creator-save-button]").disabled = true;
    syncStreamGuideVisibility({ forceOpen: true, firstOpen: obsGuideTriggeredByCreate && !hasSavedObsConnection && !hasCompletedObsGuide() });
  }

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
    updateSellerSocialComposer();
    loadSellerLots(select.value).catch(error => setStatus("[data-seller-lot-status]", error.message, "error"));
  }

  function updateSellerSocialComposer() {
    const show = selectedSellerShow();
    const link = $("[data-seller-social-link]");
    const message = $("[data-seller-social-message]");
    if (!link || !message) return;
    link.value = show ? showShareUrl(show) : "";
    if (show && !message.value.trim()) {
      const when = show.scheduled_at ? ` on ${dateLabel(show.scheduled_at)}` : "";
      message.value = `I'm ${show.status === "live" ? "live" : "going live"} on Crack Packs${when}: ${show.title}. Come watch, bid, and hang out.`;
    }
  }

  function renderSellerLots(lots = [], show) {
    const list = $("[data-seller-lot-list]");
    if (!list) return;
    sellerShowLots = Array.isArray(lots) ? lots : [];
    const end = show && ["open", "live"].includes(show.status) ? `<button class="btn btn-danger btn-small" type="button" data-end-show="${show.id}">End show</button>` : "";
    list.innerHTML = `${end}${lots.length ? lots.map(lot => {
      const current = Number(lot.current_bid_cents ?? lot.starting_bid_cents) / 100;
      const action = lot.status === "scheduled" ? `<button class="btn btn-primary btn-small" type="button" data-lot-action="open" data-lot-id="${lot.id}">Open auction</button>` : lot.status === "live" ? `<button class="btn btn-danger btn-small" type="button" data-lot-action="close" data-lot-id="${lot.id}">Close auction</button>` : "";
      return `<article class="seller-lot-item"><div><strong>${escapeHtml(lot.title)}</strong><p>${escapeHtml(lot.status)} · $${current.toFixed(2)}${lot.winning_display ? ` · leading @${escapeHtml(lot.winning_display)}` : ""}</p></div>${action}</article>`;
    }).join("") : `<div class="stream-empty">No auction lots are saved for this show.</div>`}`;
  }

  function renderSellerStoreListings() {
    const list = $("[data-seller-store-list]");
    if (!list) return;
    list.innerHTML = sellerStoreListings.length ? sellerStoreListings.map(item => `
      <article class="seller-lot-item">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.status)} · ${escapeHtml(item.condition || "Condition pending")} · $${(Number(item.priceCents || 0) / 100).toFixed(2)} · ${Number(item.quantity || 0)} listed</p>
          <small>@${escapeHtml(item.sellerUsername || "seller")} · ${escapeHtml(item.saleType || "sealed")} · ${escapeHtml(item.shippingPayer === "seller" ? "Seller pays shipping" : "Buyer pays shipping")}</small>
        </div>
        <div class="stream-card-actions">
          <button class="btn btn-outline btn-small" type="button" data-store-status="${item.id}" data-store-next-status="${item.status === "active" ? "inactive" : "active"}">${item.status === "active" ? "Turn off" : "Turn on"}</button>
        </div>
      </article>
    `).join("") : `<div class="stream-empty">No store listings yet. Use “Add to store” to publish products into the buyer marketplace.</div>`;
  }

  async function loadSellerLots(showId) {
    if (!showId) { renderSellerLots([]); syncStoreShowOptionsFromSellerShows(); return; }
    const payload = await api(`/seller/shows/${encodeURIComponent(showId)}/lots`);
    renderSellerLots(payload.lots || [], payload.show);
    syncStoreShowOptionsFromSellerShows();
  }

  async function loadSellerShows() {
    const payload = await api("/seller/shows");
    sellerShows = payload.shows || [];
    renderSellerShows();
    syncStoreShowOptionsFromSellerShows();
  }

  function renderSellerInventory(reorders = []) {
    const list = $("[data-seller-inventory-list]");
    const reorderList = $("[data-seller-reorder-list]");
    if (list) list.innerHTML = sellerInventoryItems.length ? sellerInventoryItems.map(item => `<article class="seller-giveaway-item"><header><div><strong>${escapeHtml(item.product_name)}</strong><p>${escapeHtml(item.sku || item.unit_type)} · ${Number(item.quantity)} available · ${Number(item.inbound_quantity)} inbound</p><small>PAR ${Number(item.par_quantity)} · reorder ${Number(item.reorder_quantity)} · auto ${Number(item.auto_reorder_enabled) ? "on" : "off"}</small></div><div class="stream-card-actions"><input data-inventory-adjust-quantity="${item.id}" type="number" min="1" max="100000" value="1" aria-label="Adjustment quantity"><button class="btn btn-outline btn-small" type="button" data-inventory-adjust="received" data-inventory-id="${item.id}">Receive +</button><button class="btn btn-danger btn-small" type="button" data-inventory-adjust="sale" data-inventory-id="${item.id}">Sale −</button></div></header></article>`).join("") : `<div class="stream-empty">No seller inventory yet. Paid Seller Store purchases will appear as inbound automatically.</div>`;
    if (reorderList) reorderList.innerHTML = reorders.length ? reorders.map(item => `<article class="seller-giveaway-item"><strong>${escapeHtml(item.product_name)}</strong><p>${Number(item.requested_quantity)} requested · ${escapeHtml(item.status)}</p></article>`).join("") : `<div class="stream-empty">No reorders are waiting for owner review.</div>`;
  }

  function cogsOrderCard(item) {
    const packsPerUnit = Number(item.packsPerUnit || 0);
    const perPack = item.perPackCents == null ? "Set packs/unit for per-pack math" : dollars(item.perPackCents);
    const catalogCogs = item.catalogCogsCents == null ? "No catalog COGS stored" : dollars(item.catalogCogsCents);
    return `
      <article class="seller-cogs-card">
        <header>
          <div>
            <strong>${escapeHtml(item.productName)}</strong>
            <p>${escapeHtml(item.orderNumber)} · ${escapeHtml(dateLabel(item.placedAt))}</p>
          </div>
          <span class="seller-cogs-bid">Break-even bid ${dollars(item.suggestedMinimumBidCents)}</span>
        </header>
        <div class="seller-cogs-metrics">
          <span><small>Ordered</small><strong>${Number(item.orderedUnits || 0)} unit(s)</strong></span>
          <span><small>Total landed</small><strong>${dollars(item.landedCents)}</strong></span>
          <span><small>Per unit</small><strong>${dollars(item.perUnitCents)}</strong></span>
          <span><small>Per pack/card</small><strong>${perPack}</strong></span>
        </div>
        <details class="seller-cogs-details">
          <summary>Cost breakdown</summary>
          <p>Item ${dollars(item.subtotalCents)} · shipping ${dollars(item.shippingCents)} · tax ${dollars(item.taxCents)} · catalog COGS ${catalogCogs}</p>
          <p>Break-even bid uses CrackPacks.com processing only: 2.9% + $0.30, with 0% platform commission.</p>
          <p>Seller stock now shows ${Number(item.currentQuantity || 0)} available and ${Number(item.inboundQuantity || 0)} inbound. ${packsPerUnit ? `${packsPerUnit} pack/card count is being used for per-pack math.` : "Add packs per unit in seller inventory when you want pack-level floors."}</p>
        </details>
      </article>
    `;
  }

  function renderSellerCogsOrders() {
    const list = $("[data-seller-cogs-list]");
    if (!list) return;
    list.innerHTML = sellerCogsOrders.length ? sellerCogsOrders.map(cogsOrderCard).join("") : `<div class="stream-empty">No paid Seller Store orders are ready for COGS yet.</div>`;
  }

  async function loadSellerInventory() {
    const payload = await api("/seller/inventory");
    sellerInventoryItems = payload.items || [];
    renderSellerInventory(payload.reorders || []);
  }

  async function loadSellerCogsOrders() {
    const payload = await api("/seller/cogs-orders");
    sellerCogsOrders = payload.orders || [];
    renderSellerCogsOrders();
  }

  async function loadSellerStoreListings() {
    const payload = await api("/seller/store-listings");
    sellerStoreListings = payload.items || [];
    renderSellerStoreListings();
  }

  function syncStoreShowOptionsFromSellerShows() {
    const select = $("[data-store-show-link]");
    if (!select) return;
    const options = [`<option value="">No scheduled show linked</option>`].concat(
      sellerShows.map(show => `<option value="${escapeHtml(show.id)}">${escapeHtml(show.title)} · ${escapeHtml(show.status || "scheduled")} · ${escapeHtml(dateLabel(show.scheduled_at || show.started_at || ""))}</option>`)
    );
    select.innerHTML = options.join("");
  }

  function syncStoreShowOptions() {
    const select = $("[data-store-show-link]");
    if (!select) return;
    const options = [`<option value="">No scheduled show linked</option>`].concat(
      sellerShowLots.map(lot => `<option value="${escapeHtml(lot.id)}">${escapeHtml(lot.title)} · ${escapeHtml(lot.status)} · ${dollars(lot.starting_bid_cents)}</option>`)
    );
    select.innerHTML = options.join("");
  }

  function syncListingDestinationUi() {
    const destination = $("[data-listing-destination]")?.value || "show";
    $$("[data-listing-show-field]").forEach(node => { node.hidden = destination !== "show"; });
    $$("[data-listing-store-field]").forEach(node => { node.hidden = destination !== "store"; });
    const advanced = $("[data-listing-advanced]");
    if (advanced) advanced.hidden = destination !== "store" && destination !== "show" ? false : false;
    const submit = $("[data-listing-submit-label]");
    if (submit) submit.textContent = destination === "store" ? "Add to store" : "Add auction lot";
  }

  async function loadSellerContext() {
    if (!token()) return;
    try {
      const status = await api("/portal/status");
      sellerContextAuthorized = Boolean(status.sellerAccess && status.activePortal === "seller");
      localStorage.setItem("cp_can_seller_portal", status.sellerAccess ? "true" : "false");
      if (!sellerContextAuthorized) return;
      $$('[data-seller-only]').forEach(node => { node.hidden = false; });
      try {
        const streamInput = await api("/seller/stream/input");
        obsGuideCompletedAt = String(streamInput.obsSetupCompletedAt || "");
        if (obsGuideCompletedAt) localStorage.setItem(OBS_GUIDE_COMPLETED_KEY, "true");
        renderStreamInput(streamInput.input);
        await loadYouTubeOutput();
      } catch {}
      syncStreamKeyButtons();
      syncStreamGuideVisibility({ firstOpen: !hasSavedObsConnection && !hasCompletedObsGuide() });
      await Promise.all([loadSellerGiveaways(), loadSellerShows(), loadSellerInventory(), loadSellerStoreListings(), loadSellerCogsOrders()]);
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

  $("[data-youtube-output-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const button = event.submitter;
    button.disabled = true;
    button.textContent = "Connecting...";
    setStatus("[data-youtube-output-message]", "Creating your private YouTube simulcast output...");
    try {
      const output = await api("/seller/stream/youtube", {
        method: "POST",
        body: JSON.stringify({ channelUrl: form.get("channelUrl"), streamKey: form.get("streamKey") })
      });
      formElement.elements.streamKey.value = "";
      renderYouTubeOutput(output);
      setStatus("[data-youtube-output-message]", "YouTube connected. Starting OBS during an active show will stream on Crack Packs and YouTube together.", "success");
    } catch (error) {
      setStatus("[data-youtube-output-message]", error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Connect YouTube";
    }
  });
  $("[data-youtube-output-disconnect]")?.addEventListener("click", async event => {
    if (!window.confirm("Disconnect YouTube simulcasting from this seller account?")) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const output = await api("/seller/stream/youtube", { method: "DELETE" });
      renderYouTubeOutput(output);
      setStatus("[data-youtube-output-message]", "YouTube simulcasting disconnected. Your Crack Packs OBS connection is unchanged.", "success");
    } catch (error) {
      button.disabled = false;
      setStatus("[data-youtube-output-message]", error.message, "error");
    }
  });

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

  async function loadOrCreateStreamInput({ createIfMissing = false, replaceExisting = false } = {}) {
    setStatus("[data-stream-input-status]", replaceExisting ? "Regenerating your saved OBS key..." : "Loading your saved OBS connection...");
    try {
      let payload = await api("/seller/stream/input");
      if ((replaceExisting || (!payload.input && createIfMissing))) {
        payload = await api(replaceExisting ? "/seller/stream/input/regenerate" : "/seller/stream/input", { method: "POST", body: "{}" });
      }
      if (!payload.input?.rtmpsUrl || !payload.input?.streamKey) {
        if (!createIfMissing && !replaceExisting) throw new Error("No OBS connection is saved yet. Use Create static OBS connection first.");
        throw new Error("Cloudflare did not return a complete OBS connection.");
      }
      renderStreamInput(payload.input);
      setStatus("[data-stream-input-status]", replaceExisting ? "New static OBS key saved. Update OBS once with the regenerated key." : "Static OBS connection ready. This saved key can be reused for future shows.", "success");
      return payload;
    } catch (error) {
      setStatus("[data-stream-input-status]", error.message, "error");
      throw error;
    }
  }
  async function generateStreamKey({ regenerate = false } = {}) {
    const button = $("[data-stream-key-creator-confirm]");
    const input = $("[data-stream-key-creator-value]");
    if (!button) return;
    const isRegenerate = Boolean(regenerate);
    button.disabled = true;
    button.textContent = isRegenerate ? "Regenerating..." : "Creating...";
    if (input) {
      input.value = "";
      input.placeholder = isRegenerate ? "Generating regenerated key..." : "Generating OBS key...";
    }
    setStatus("[data-stream-input-status]", isRegenerate ? "Generating your new OBS key..." : "Creating your OBS key...");
    try {
      const payload = await loadOrCreateStreamInput({ createIfMissing: true, replaceExisting: isRegenerate });
      const liveKey = payload?.input?.streamKey || $("[data-stream-key]")?.value || "";
      if (!liveKey) throw new Error("No OBS key was returned. Your current key was not changed; try again.");
      if (input) {
        input.value = liveKey;
        input.placeholder = liveKey ? "OBS key created." : "No key was returned.";
      }
      $("[data-stream-key-creator-copy-button]").disabled = !liveKey;
      $("[data-stream-key-creator-save-button]").disabled = !liveKey;
      streamKeyCreatorState.generated = Boolean(liveKey);
      hasSavedObsConnection = Boolean(liveKey);
      if (liveKey) {
        markObsGuideCompleted(payload?.obsSetupCompletedAt);
        obsGuideDismissedForSession = true;
        obsGuideTriggeredByCreate = false;
      }
      syncStreamKeyButtons();
      syncStreamGuideVisibility();
      await loadYouTubeOutput();
      setStatus("[data-stream-input-status]", isRegenerate ? "New OBS key created. Copy or save it before updating OBS." : "OBS key created and displayed. Copy or save it for OBS setup.", "success");
    } catch (error) {
      const reason = String(error?.message || "The live input could not be created.");
      if (input) {
        input.value = "";
        input.placeholder = reason;
        input.title = reason;
      }
      $("[data-stream-key-creator-copy-button]").disabled = true;
      $("[data-stream-key-creator-save-button]").disabled = true;
      setStatus("[data-stream-input-status]", error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = isRegenerate ? "Regenerate Key" : "Create Key";
    }
  }
  $("[data-stream-input-create]")?.addEventListener("click", async event => {
    if (hasSavedObsConnection) {
      obsGuideTriggeredByCreate = false;
      openStreamKeyCreator("regenerate");
      await generateStreamKey({ regenerate: true });
      return;
    }
    obsGuideDismissedForSession = false;
    obsGuideTriggeredByCreate = true;
    openStreamKeyCreator("create");
    await generateStreamKey({ regenerate: false });
  });
  $("[data-stream-input-load]")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true;
    await loadOrCreateStreamInput({ createIfMissing: false });
    button.disabled = false;
  });
  $("[data-stream-input-rotate]")?.addEventListener("click", async event => {
    const guide = $("[data-stream-setup-guide]");
    if (!guide) return;
    if (guide.hidden) {
      guide.hidden = false;
      guide.classList.add("is-visible");
      guide.classList.remove("is-first-open");
      return;
    }
    guide.hidden = true;
    guide.classList.remove("is-visible", "is-first-open");
    obsGuideDismissedForSession = true;
  });
  $("[data-stream-key-creator-cancel]")?.addEventListener("click", () => {
    closeStreamKeyCreator();
    setStatus("[data-stream-input-status]", "Current OBS key kept unchanged.", "success");
  });
  $("[data-stream-key-creator-confirm]")?.addEventListener("click", async event => {
    const isRegenerate = streamKeyCreatorState.mode === "regenerate";
    await generateStreamKey({ regenerate: isRegenerate });
  });
  $("[data-stream-key-creator-copy-button]")?.addEventListener("click", async () => {
    const value = $("[data-stream-key-creator-value]")?.value || "";
    if (!value) return;
    try {
      await copyText(value);
      setStatus("[data-stream-input-status]", "New OBS key copied.", "success");
    } catch (error) {
      setStatus("[data-stream-input-status]", error.message, "error");
    }
  });
  $("[data-stream-key-creator-save-button]")?.addEventListener("click", () => {
    const value = $("[data-stream-key-creator-value]")?.value || "";
    if (!value) return;
    downloadTextFile("crackpacks-obs-stream-key.txt", value);
    setStatus("[data-stream-input-status]", "OBS key saved to your device.", "success");
  });
  syncStreamKeyButtons();
  syncStreamGuideVisibility();

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

  $("[data-seller-show-select]")?.addEventListener("change", event => {
    updateSellerSocialComposer();
    loadSellerLots(event.currentTarget.value).catch(error => setStatus("[data-seller-lot-status]", error.message, "error"));
  });
  $("[data-seller-shows-refresh]")?.addEventListener("click", () => loadSellerShows().catch(error => setStatus("[data-seller-show-status]", error.message, "error")));
  $("[data-seller-social-refresh]")?.addEventListener("click", () => { updateSellerSocialComposer(); setStatus("[data-seller-social-status]", "Selected show link loaded.", "success"); });
  $("[data-listing-destination]")?.addEventListener("change", syncListingDestinationUi);
  $("[data-seller-social-copy]")?.addEventListener("click", async () => {
    try { await copyText(sellerSocialCaption(selectedSellerShow())); setStatus("[data-seller-social-status]", "Show message and link copied.", "success"); }
    catch (error) { setStatus("[data-seller-social-status]", error.message, "error"); }
  });
  $("[data-seller-social-native]")?.addEventListener("click", async () => {
    try {
      const show = selectedSellerShow();
      if (!show) throw new Error("Choose a show first.");
      const caption = sellerSocialCaption(show);
      if (!navigator.share) throw new Error("Device sharing is not available in this browser.");
      await navigator.share({ title: show.title, text: caption, url: showShareUrl(show) });
      setStatus("[data-seller-social-status]", "Device share opened.", "success");
    } catch (error) { setStatus("[data-seller-social-status]", error.message, "error"); }
  });
  $("[data-seller-social-post]")?.addEventListener("click", async () => {
    try {
      const show = selectedSellerShow();
      if (!show) throw new Error("Choose a show first.");
      const caption = sellerSocialCaption(show);
      const checked = $$("[data-seller-social-target]:checked").map(node => node.dataset.sellerSocialTarget);
      if (!checked.length) throw new Error("Select at least one social page.");
      const destinations = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(showShareUrl(show))}`,
        x: `https://x.com/intent/post?text=${encodeURIComponent(caption)}`,
        instagram: "https://www.instagram.com/",
        youtube: "https://www.youtube.com/"
      };
      checked.forEach(platform => window.open(destinations[platform], "_blank", "noopener,noreferrer"));
      await copyText(caption);
      setStatus("[data-seller-social-status]", "Selected social pages opened. Message and show link copied for paste.", "success");
    } catch (error) { setStatus("[data-seller-social-status]", error.message, "error"); }
  });

  $("[data-seller-lot-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const destination = $("[data-listing-destination]")?.value || "show";
    const showId = $("[data-seller-show-select]").value;
    if (destination === "show" && !showId) { setStatus("[data-seller-lot-status]", "Choose an active show first.", "error"); return; }
    const form = event.currentTarget; const data = new FormData(form); const button = event.submitter; button.disabled = true;
    try {
      if (destination === "store") {
        await api("/seller/store-listings", {
          method: "POST",
          body: JSON.stringify({
            title: data.get("title"),
            saleType: data.get("saleTypeStore") || "singles",
            price: Number(data.get("storePrice") || 0),
            quantity: Number(data.get("storeQuantity") || 0),
            condition: data.get("condition"),
            shippingPayer: data.get("shippingPayer") || "buyer",
            imageUrl: data.get("imageUrl"),
            description: data.get("description"),
            showId: data.get("storeShowId") || ""
          })
        });
        await loadSellerStoreListings();
        setStatus("[data-seller-store-status]", "Store listing published to the buyer marketplace.", "success");
      } else {
        await api(`/seller/shows/${encodeURIComponent(showId)}/lots`, { method: "POST", body: JSON.stringify(Object.fromEntries(data.entries())) });
        await loadSellerLots(showId);
        setStatus("[data-seller-lot-status]", "Auction lot added.", "success");
      }
      form.reset(); form.elements.startingBid.value = "1.00"; form.elements.bidIncrement.value = "1.00"; form.elements.storePrice.value = "1.00"; form.elements.storeQuantity.value = "1"; form.elements.shippingPayer.value = "buyer"; form.elements.saleTypeStore.value = "singles";
      if (form.elements.storeShowId) form.elements.storeShowId.value = "";
      syncListingDestinationUi();
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
        const result = await api(`/seller/shows/${encodeURIComponent(end.dataset.endShow)}/end`, { method: "POST", body: "{}" });
        await loadSellerShows();
        const synced = result.streamCreditSync?.syncedVideos ? ` ${Number(result.streamCreditSync.syncedVideos)} recording source(s) synced.` : " Usage will also refresh on the next hourly cycle.";
        setStatus("[data-seller-lot-status]", `Show ended. Stream Credits are syncing.${synced}`, "success");
      }
    } catch (error) { setStatus("[data-seller-lot-status]", error.message, "error"); }
  });

  $("[data-seller-store-list]")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-store-status]");
    if (!button) return;
    button.disabled = true;
    try {
      await api(`/seller/store-listings/${encodeURIComponent(button.dataset.storeStatus)}/status`, { method: "POST", body: JSON.stringify({ status: button.dataset.storeNextStatus }) });
      await loadSellerStoreListings();
      setStatus("[data-seller-store-status]", "Store listing updated.", "success");
    } catch (error) {
      button.disabled = false;
      setStatus("[data-seller-store-status]", error.message, "error");
    }
  });

  $("[data-seller-inventory-form]")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const button = event.submitter; button.disabled = true;
    try {
      await api("/seller/inventory", { method: "POST", body: JSON.stringify({ productName: data.get("productName"), sku: data.get("sku"), unitType: data.get("unitType"), quantity: Number(data.get("quantity")), parQuantity: Number(data.get("parQuantity")), reorderQuantity: Number(data.get("reorderQuantity")), autoReorder: data.get("autoReorder") === "on" }) });
      form.reset(); await loadSellerInventory(); setStatus("[data-seller-inventory-status]", "Seller inventory saved.", "success");
    } catch (error) { setStatus("[data-seller-inventory-status]", error.message, "error"); }
    finally { button.disabled = false; }
  });

  $("[data-seller-cogs-refresh]")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      await loadSellerCogsOrders();
      setStatus("[data-seller-cogs-status]", "Order COGS refreshed.", "success");
    } catch (error) {
      setStatus("[data-seller-cogs-status]", error.message, "error");
    } finally {
      button.disabled = false;
    }
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
  syncListingDestinationUi();
  loadSellerContext();
})();
