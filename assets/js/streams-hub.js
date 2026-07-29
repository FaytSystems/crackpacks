(() => {
  "use strict";
  const config = window.CRACKPACKS_CONFIG || {};
  const base = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const token = () => localStorage.getItem("cp_rewards_token") || "";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const viewerOnly = document.body?.dataset.liveShowsOnly === "true";
  let shows = [];
  let savedGiveaways = [];
  let giftedQueue = [];
  let sellerShows = [];
  let sellerInventoryItems = [];
  let sellerStoreListings = [];
  let sellerShowLots = [];
  let sellerCogsOrders = [];
  let sellerOrders = [];
  let sellerProductCategories = [];
  let sellerWeightProfiles = [];
  let sellerOrderTab = "all";
  let sellerOrderSearch = "";
  let sellerContextAuthorized = false;
  let showHashFocused = false;
  let showsLoadPromise = null;
  let pendingCloseShowId = "";
  let closeShowTrigger = null;
  let auctionAdvancePending = false;
  let autoNextActive = false;
  let autoNextShowId = "";
  let autoNextDeadline = 0;
  let autoNextTickTimer = 0;
  let autoNextStepTimer = 0;
  let auctionHoldTimer = 0;
  let suppressAuctionNextClick = false;
  let liveShowsSellerUsername = "";
  let sellerLiveChat = null;
  const AUTO_NEXT_HOLD_MS = 3000;
  const ALLOWED_AUCTION_DURATIONS = new Set([15, 30, 45, 60, 90, 120]);
  const pageQuery = new URLSearchParams(location.search);
  const requestedHubTab = pageQuery.get("tab") || "";
  const requestedSellerShowId = viewerOnly ? "" : String(pageQuery.get("show") || "");
  let activeTab = ["all", "live", "upcoming", "followed", "watchlist"].includes(requestedHubTab)
    ? requestedHubTab
    : document.body?.dataset.defaultHubTab || "watchlist";
  let hasSavedObsConnection = false;
  let obsGuideDismissedForSession = false;
  let obsGuideCompletedAt = "";
  let obsGuideTriggeredByCreate = false;
  const OBS_GUIDE_COMPLETED_KEY = "cp_obs_guide_completed";
  const sellerToolMeta = {
    home: { hash: "#seller-home", title: "Seller home", copy: "Shows, store inventory, orders, and live tools at a glance." },
    "show-control": { hash: "#seller-live", title: "Seller Live", copy: "Monitor OBS, organize the Auction Block, and control the active sale queue." },
    obs: { hash: "#seller-obs", title: "Private OBS connection", copy: "Create, reveal, and reuse the protected RTMPS server and stream key." },
    simulcast: { hash: "#seller-simulcast", title: "Simulcast", copy: "Relay the Crack Packs broadcast securely to the connected YouTube channel." },
    shows: { hash: "#create-show", title: "Shows", copy: "Schedule a show, upload its thumbnail, and prepare it for buyers." },
    "show-inventory": { hash: "#seller-shows", title: "Show inventory and store listings", copy: "Publish products to your store and queue account-owned inventory into a show." },
    social: { hash: "#seller-social", title: "Show social launcher", copy: "Prepare a show link and share message for each social channel." },
    inventory: { hash: "#seller-inventory", title: "Seller inventory", copy: "Track stock, PAR levels, reviewed reorders, and available quantities." },
    categories: { hash: "#seller-categories", title: "Types of products selling", copy: "Choose which product categories appear in this seller store." },
    cogs: { hash: "#seller-cogs", title: "Order COGS", copy: "Review landed costs and calculate a safer minimum auction bid." },
    shipping: { hash: "#seller-shipping", title: "Seller shipping", copy: "Manage orders, labels, clips, package weights, and tracking." },
    giveaways: { hash: "#seller-giveaways", title: "Giveaway presets", copy: "Prepare reusable giveaway rules and inventory labels before going live." }
  };
  const sellerToolAliases = {
    "#go-live": "show-control",
    "#seller-show-control": "show-control",
    "#seller-my-listings": "show-inventory"
  };

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const dollars = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
  const api = async (path, options = {}) => {
    if (!base) throw new Error("The live service is not configured.");
    const multipart = options.body instanceof FormData;
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...(multipart ? {} : { "Content-Type": "application/json" }), Accept: "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The live service could not complete that request.");
    return payload;
  };
  const dateLabel = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Schedule pending";
  function sellerToolFromHash() {
    const hash = String(location.hash || "").toLowerCase();
    if (sellerToolAliases[hash]) return sellerToolAliases[hash];
    return Object.entries(sellerToolMeta).find(([, meta]) => meta.hash === hash)?.[0] || "home";
  }
  function setSellerTool(tool, { updateHash = true } = {}) {
    const next = sellerToolMeta[tool] ? tool : "home";
    $$("[data-seller-tool-panel]").forEach(panel => {
      panel.classList.toggle("is-seller-tool-hidden", panel.dataset.sellerToolPanel !== next);
    });
    $$(".seller-tool-region").forEach(region => {
      const active = [...region.querySelectorAll("[data-seller-tool-panel]")].some(panel => panel.dataset.sellerToolPanel === next);
      region.classList.toggle("is-seller-tool-region-hidden", !active);
    });
    $$("[data-seller-tool-button]").forEach(button => {
      const active = button.dataset.sellerToolButton === next;
      button.classList.toggle("is-active", active);
      if (button.closest(".seller-tool-menu")) button.setAttribute("aria-current", active ? "page" : "false");
    });
    const meta = sellerToolMeta[next];
    $$("[data-seller-tool-title], [data-seller-inventory-tool-title]").forEach(node => { node.textContent = meta.title; });
    $$("[data-seller-tool-copy], [data-seller-inventory-tool-copy]").forEach(node => { node.textContent = meta.copy; });
    document.body.dataset.sellerTool = next;
    if (updateHash && location.hash !== meta.hash) history.replaceState({}, document.title, `${location.pathname}${location.search}${meta.hash}`);
  }
  function syncSellerStorefront(username = "") {
    const sellerUsername = String(username || "").trim();
    const href = sellerUsername ? `shop.html?seller=${encodeURIComponent(sellerUsername)}` : "shop.html";
    $$("[data-seller-storefront-link]").forEach(link => { link.href = href; });
  }
  function updateSellerDashboardMetrics() {
    const activeShows = sellerShows.filter(show => ["open", "live"].includes(String(show.status || ""))).length;
    const activeListings = sellerStoreListings.filter(item => item.status === "active" && Number(item.quantity || 0) > 0).length;
    const ordersToFulfill = sellerOrders.filter(order => ["needs_label", "needs_label_setup", "ship_now"].includes(String(order.fulfillmentStatus || ""))).length;
    const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = String(value); };
    setText("[data-dashboard-show-count]", activeShows);
    setText("[data-dashboard-listing-count]", activeListings);
    setText("[data-dashboard-inventory-count]", sellerInventoryItems.length);
    setText("[data-dashboard-order-count]", ordersToFulfill);
    const streamStatus = $("[data-dashboard-stream-status]");
    if (streamStatus) streamStatus.textContent = hasSavedObsConnection
      ? (activeShows ? "OBS ready - active show available" : "OBS ready - create or select a show")
      : "OBS connection needs setup";
  }
  function renderStreamInput(input) {
    const summary = $("[data-stream-connection-status]");
    const result = $("[data-stream-input-result]");
    const player = $("[data-seller-broadcast-player]");
    const placeholder = $("[data-seller-broadcast-placeholder]");
    const broadcastState = $("[data-seller-broadcast-state]");
    if (!summary || !result) return;
    if (!input?.rtmpsUrl || !input?.streamKey) {
      hasSavedObsConnection = false;
      summary.textContent = "Not set up yet";
      result.hidden = true;
      if (player) {
        player.removeAttribute("src");
        player.hidden = true;
      }
      if (placeholder) placeholder.hidden = false;
      if (broadcastState) broadcastState.textContent = "OBS connection needed";
      syncStreamKeyButtons();
      updateSellerDashboardMetrics();
      return;
    }
    hasSavedObsConnection = true;
    summary.textContent = "Saved to seller profile";
    $("[data-stream-rtmps-url]").value = input.rtmpsUrl;
    $("[data-stream-key]").value = input.streamKey;
    result.hidden = false;
    if (player && input.playbackUrl) {
      if (player.getAttribute("src") !== input.playbackUrl) player.src = input.playbackUrl;
      player.hidden = false;
      if (placeholder) placeholder.hidden = true;
      if (broadcastState) broadcastState.textContent = String(input.status || "").toLowerCase() === "enabled" ? "Broadcast input enabled" : "Ready for OBS";
    } else {
      if (player) {
        player.removeAttribute("src");
        player.hidden = true;
      }
      if (placeholder) placeholder.hidden = false;
      if (broadcastState) broadcastState.textContent = "Video preview unavailable";
    }
    syncStreamKeyButtons();
    updateSellerDashboardMetrics();
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
    const showId = $("[data-broadcast-show-select]")?.value || $("[data-seller-show-select]")?.value || "";
    return sellerShows.find(show => show.id === showId) || null;
  };
  const selectedShowStoreListing = () => {
    const listingId = $("[data-show-store-listing]")?.value || "";
    return sellerStoreListings.find(item => item.id === listingId) || null;
  };
  const syncSellerSectionNav = () => setSellerTool(sellerToolFromHash(), { updateHash: false });
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
  const showThumbnailTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/pjpeg"]);
  const showThumbnailMaxBytes = 5 * 1024 * 1024;
  let showThumbnailPreviewUrl = "";
  function clearShowThumbnailPreview() {
    if (showThumbnailPreviewUrl) URL.revokeObjectURL(showThumbnailPreviewUrl);
    showThumbnailPreviewUrl = "";
    const preview = $("[data-seller-show-thumbnail-preview]");
    const image = $("[data-seller-show-thumbnail-image]");
    const name = $("[data-seller-show-thumbnail-name]");
    if (preview) preview.hidden = true;
    if (image) image.removeAttribute("src");
    if (name) name.textContent = "";
  }
  function previewShowThumbnail(file) {
    clearShowThumbnailPreview();
    if (!file || !file.size) return;
    if (!showThumbnailTypes.has(String(file.type || "").toLowerCase())) throw new Error("Choose a PNG, JPG, or JPEG show thumbnail.");
    if (file.size > showThumbnailMaxBytes) throw new Error("Show thumbnail must be 5 MB or smaller.");
    const preview = $("[data-seller-show-thumbnail-preview]");
    const image = $("[data-seller-show-thumbnail-image]");
    const name = $("[data-seller-show-thumbnail-name]");
    showThumbnailPreviewUrl = URL.createObjectURL(file);
    if (image) image.src = showThumbnailPreviewUrl;
    if (name) name.textContent = `${file.name} - ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    if (preview) preview.hidden = false;
  }
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

  const showCard = show => {
    const showUrl = `live.html?show=${encodeURIComponent(show.id)}`;
    const sellerOwnsShow = Boolean(
      liveShowsSellerUsername &&
      String(show.sellerUsername || "").toLowerCase() === liveShowsSellerUsername.toLowerCase()
    );
    const featuredLot = show.featuredLot || null;
    const lotLabel = featuredLot?.status === "live" ? "Currently for sale" : "First item queued";
    const lotPrice = featuredLot ? dollars(featuredLot.startingBidCents) : "";
    const currentBid = featuredLot?.currentBidCents != null && Number(featuredLot.currentBidCents) > Number(featuredLot.startingBidCents)
      ? `<span>Current bid <strong>${dollars(featuredLot.currentBidCents)}</strong></span>`
      : "";
    const inventoryState = featuredLot?.status === "live" ? "Bidding open" : featuredLot ? "First item queued" : "Inventory pending";
    return `
    <article class="stream-card holo-panel" id="show-${escapeHtml(show.id)}">
      <a class="stream-card-thumbnail" href="${showUrl}" aria-label="Open ${escapeHtml(show.title)}">
        <img src="${escapeHtml(show.image || "assets/images/banner-cosmic.svg")}" alt="${escapeHtml(show.title)}" loading="lazy">
      </a>
      <div class="stream-card-top"><span class="stream-pill ${escapeHtml(show.state)}">${show.state === "live" ? "LIVE NOW" : "UPCOMING"}</span><span class="viewer-pill">${Number(show.viewers || 0)} viewers</span></div>
      <h3>${escapeHtml(show.title)}</h3><p><strong>${escapeHtml(show.sellerUsername)}</strong></p>
      <div class="stream-card-featured-lot">
        ${featuredLot ? `
          <span class="stream-card-lot-label">${lotLabel}</span>
          <strong>${escapeHtml(featuredLot.title)}</strong>
          <div><span>Starting bid <strong>${lotPrice}</strong></span>${currentBid}</div>
        ` : `
          <span class="stream-card-lot-label">Show inventory</span>
          <strong>First item coming soon</strong>
          <span>The seller is preparing this show's inventory.</span>
        `}
      </div>
      <div class="stream-card-meta"><span>${escapeHtml(show.state === "live" ? "Live now" : dateLabel(show.startsAt))}</span><span>${inventoryState}</span></div>
      <div class="stream-card-actions">
        ${sellerOwnsShow ? `
          <button class="btn btn-small seller-go-live-bubble seller-show-go-live-bubble" type="button" data-seller-go-live="${show.id}">
            <span class="seller-go-live-dot" aria-hidden="true"></span>
            GO LIVE NOW
          </button>
        ` : ""}
        <a class="btn btn-primary btn-small" href="${showUrl}">${show.state === "live" ? "Watch &amp; Bid" : "View Show"}</a>
        <button class="btn btn-outline btn-small" type="button" data-watch="${show.id}">${show.saved ? "Saved" : "Add to Watchlist"}</button>
        <button class="btn btn-outline btn-small" type="button" data-follow="${show.sellerId}">${show.followed ? "Following" : "Follow"}</button>
        ${show.state === "upcoming" ? `<button class="btn btn-outline btn-small" type="button" data-calendar="${show.id}">Add to Calendar</button>` : ""}
        <button class="btn btn-primary btn-small" type="button" data-open-gifted="${show.id}">Donate to Show</button>
      </div>
    </article>`;
  };

  function renderShows() {
    let filtered = shows;
    if (activeTab === "watchlist") filtered = shows.filter(show => show.saved);
    if (activeTab === "live") filtered = shows.filter(show => show.state === "live");
    if (activeTab === "upcoming") filtered = shows.filter(show => show.state === "upcoming");
    if (activeTab === "followed") filtered = shows.filter(show => show.followed);
    $$('[data-hub-tab]').forEach(node => {
      const active = node.dataset.hubTab === activeTab;
      node.classList.toggle("is-active", active);
      if (node.hasAttribute("role")) node.setAttribute("aria-selected", String(active));
    });
    $("[data-streams-list]").innerHTML = filtered.map(showCard).join("");
    $("[data-streams-empty]").hidden = filtered.length > 0;
    if (!showHashFocused && location.hash.startsWith("#show-")) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) {
        showHashFocused = true;
        requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "center" }));
      }
    }
  }

  async function loadShows() {
    if (showsLoadPromise) return showsLoadPromise;
    showsLoadPromise = (async () => {
      try { shows = (await api("/live/shows")).shows || []; }
      catch (error) { shows = []; $("[data-streams-empty]").textContent = error.message; }
      renderShows();
    })();
    try {
      await showsLoadPromise;
    } finally {
      showsLoadPromise = null;
    }
  }

  async function loadLiveShowsSellerContext() {
    if (!viewerOnly || !token()) return;
    try {
      const status = await api("/portal/status");
      liveShowsSellerUsername = status.sellerAccess ? String(status.sellerUsername || "").trim() : "";
    } catch {
      liveShowsSellerUsername = "";
    }
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
  const setSellerIdentityResult = (message = "", kind = "") => setStatus("[data-seller-identity-status-result]", message, kind);
  function showSellerIdentityPanel(message = "Stripe has accepted your ID verification for processing. Check the live status when you are ready.", kind = "success", { complete = false, retry = false } = {}) {
    const panel = $("[data-seller-identity-status-panel]");
    if (!panel) return;
    panel.hidden = false;
    const copy = $("[data-seller-identity-status-copy]");
    if (copy) copy.textContent = message;
    const completeButton = $("[data-seller-identity-complete]");
    const retryButton = $("[data-seller-identity-retry]");
    if (completeButton) completeButton.hidden = !complete;
    if (retryButton) retryButton.hidden = !retry;
    setSellerIdentityResult(message, kind);
  }
  function hideSellerIdentityPanel() {
    const panel = $("[data-seller-identity-status-panel]");
    if (panel) panel.hidden = true;
    setSellerIdentityResult("");
  }
  function showSellerIdentityPanelForStatus(status) {
    if (!status) return false;
    if (status.sellerAccess && status.activePortal !== "seller") {
      showSellerIdentityPanel("PASS: Seller Portal access is ready. Complete account setup to enter the Seller Portal.", "success", { complete: true });
      return true;
    }
    if (status.sellerAccess) {
      hideSellerIdentityPanel();
      return false;
    }
    const stripeStatus = String(status.stripeIdentityStatus || "").toLowerCase();
    const identityStatus = String(status.identityStatus || "").toLowerCase();
    const hasSellerAttempt = Boolean(status.sellerUsername || status.sellerStatus !== "not_applied" || status.hasSellerLegalProfile || stripeStatus !== "not_started");
    if (!hasSellerAttempt) {
      hideSellerIdentityPanel();
      return false;
    }
    if (identityStatus === "verified" && stripeStatus === "verified") {
      showSellerIdentityPanel("PASS: Stripe ID verification is complete. Complete account setup to activate Seller Portal access.", "success", { complete: true });
      return true;
    }
    if (["processing", "manual_review", "pending_review"].includes(stripeStatus) || ["pending_review", "manual_review"].includes(identityStatus)) {
      showSellerIdentityPanel("VERIFY IN PROGRESS: Stripe is still processing your ID verification. Check again in a moment.", "success");
      return true;
    }
    if (["requires_input", "failed", "cancelled", "canceled", "redacted"].includes(stripeStatus)) {
      showSellerIdentityPanel("ID verification needs another try. Check the live status, or retry secure ID verification.", "error", { retry: true });
      return true;
    }
    showSellerIdentityPanel("Seller ID verification is not complete yet. Continue the secure Seller verification steps.", "success", { retry: true });
    return true;
  }
  async function refreshSellerIdentityPanel() {
    const status = await api("/portal/status");
    showSellerIdentityPanelForStatus(status);
    return status;
  }
  async function completeSellerAccountSetup(button) {
    if (button) button.disabled = true;
    try {
      const result = await api("/portal/mode", { method: "POST", body: JSON.stringify({ mode: "seller" }) });
      if (result.activePortal !== "seller") throw new Error("Seller setup is not complete yet.");
      localStorage.setItem("cp_can_seller_portal", "true");
      localStorage.setItem("cp_portal_mode", "seller");
      sessionStorage.setItem("cp_portal_mode", "seller");
      window.location.href = "streams.html#seller-home";
    } catch (error) {
      setSellerIdentityResult(error.message || "Seller Portal could not open yet.", "error");
      if (button) button.disabled = false;
    }
  }
  async function retrySellerIdentity(button) {
    if (button) button.disabled = true;
    try {
      setSellerIdentityResult("Opening secure Stripe ID verification...", "success");
      const result = await api("/identity/session", { method: "POST", body: JSON.stringify({ force: true }) });
      if (result.verified) {
        await completeSellerAccountSetup(button);
        return;
      }
      if (!result.url) throw new Error("Stripe Identity did not return a verification link.");
      window.location.href = result.url;
    } catch (error) {
      setSellerIdentityResult(error.message || "Stripe ID verification could not open.", "error");
      if (button) button.disabled = false;
    }
  }
  async function checkSellerIdentityStatus(button) {
    if (button) button.disabled = true;
    try {
      setSellerIdentityResult("Checking Stripe ID verification status...", "success");
      const result = await api("/identity/sync", { method: "POST", body: JSON.stringify({ notify: true }) });
      const status = String(result.status || result.stripeStatus || "").toLowerCase();
      if (result.verified || status === "verified") {
        const portalStatus = await refreshSellerIdentityPanel();
        if (portalStatus.sellerAccess) {
          showSellerIdentityPanel("PASS: Seller Portal access is ready. Complete account setup to enter the Seller Portal.", "success", { complete: true });
        } else {
          showSellerIdentityPanel("PASS: Stripe ID verification is complete. Complete account setup to activate Seller Portal access.", "success", { complete: true });
        }
        return;
      }
      if (["processing", "manual_review", "pending_review"].includes(status)) {
        showSellerIdentityPanel("VERIFY IN PROGRESS: Stripe is still processing your ID verification. Check again in a moment.", "success");
        return;
      }
      if (["requires_input", "failed", "cancelled", "canceled", "redacted"].includes(status)) {
        const retryEmailConfirmed = String(result.resultEmailStatus || "").toLowerCase() === "failed";
        showSellerIdentityPanel(
          retryEmailConfirmed
            ? "ID verification was not accepted. A retry email has been sent to your account email."
            : "ID verification was not accepted. Use Retry Verify ID to start another secure check.",
          "error",
          { retry: true }
        );
        return;
      }
      showSellerIdentityPanel("Stripe has not returned a final result yet. Check again in a moment.", "success");
    } catch (error) {
      showSellerIdentityPanel(error.message || "Stripe ID verification status could not be checked.", "error", { retry: true });
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderSellerShows() {
    const selectors = [$("[data-seller-show-select]"), $("[data-broadcast-show-select]")].filter(Boolean);
    if (!selectors.length) return;
    const current = selectors.map(select => select.value).find(Boolean) || "";
    const active = sellerShows.filter(show => ["open", "live"].includes(show.status));
    const options = `<option value="">${active.length ? "Choose a show" : "Create a show first"}</option>${active.map(show => `<option value="${show.id}">${escapeHtml(show.title)} &middot; ${escapeHtml(show.status)}</option>`).join("")}`;
    const requestedId = active.some(show => show.id === requestedSellerShowId) ? requestedSellerShowId : "";
    const selectedId = active.some(show => show.id === current) ? current : (requestedId || active[0]?.id || "");
    selectors.forEach(select => {
      select.innerHTML = options;
      select.value = selectedId;
    });
    sellerLiveChat?.refresh({ force: true });
    updateSellerSocialComposer();
    renderShowStoreInventoryOptions();
    loadSellerLots(selectedId).catch(error => {
      setStatus("[data-seller-lot-status]", error.message, "error");
      setStatus("[data-broadcast-auction-status]", error.message, "error");
    });
    updateSellerDashboardMetrics();
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

  function selectSellerShow(showId) {
    [$("[data-seller-show-select]"), $("[data-broadcast-show-select]")].filter(Boolean).forEach(select => {
      if ([...select.options].some(option => option.value === showId)) select.value = showId;
    });
    updateSellerSocialComposer();
    renderShowStoreInventoryPreview();
    sellerLiveChat?.refresh({ force: true });
    return loadSellerLots(showId);
  }

  function renderSellerLots(lots = [], show) {
    const list = $("[data-seller-lot-list]");
    sellerShowLots = Array.isArray(lots) ? lots : [];
    renderBroadcastAuctionConsole(sellerShowLots, show);
    if (!list) return;
    const end = show && ["open", "live"].includes(show.status) ? `<button class="btn btn-danger btn-small" type="button" data-end-show="${show.id}">End show</button>` : "";
    list.innerHTML = `${end}${lots.length ? lots.map(lot => {
      const current = Number(lot.current_bid_cents ?? lot.starting_bid_cents) / 100;
      const action = lot.status === "scheduled" ? `<button class="btn btn-primary btn-small" type="button" data-lot-action="open" data-lot-id="${lot.id}">Open auction</button>` : lot.status === "live" ? `<button class="btn btn-danger btn-small" type="button" data-lot-action="close" data-lot-id="${lot.id}">Close auction</button>` : "";
      return `<article class="seller-lot-item"><div><strong>${escapeHtml(lot.title)}</strong><p>${escapeHtml(lot.status)} · $${current.toFixed(2)}${lot.winning_display ? ` · leading @${escapeHtml(lot.winning_display)}` : ""}</p></div>${action}</article>`;
    }).join("") : `<div class="stream-empty">No auction lots are saved for this show.</div>`}`;
  }

  function auctionQueueOrder(left, right) {
    const positionDifference = Number(left.queue_position || 0) - Number(right.queue_position || 0);
    if (positionDifference) return positionDifference;
    const timeDifference = Date.parse(left.created_at || 0) - Date.parse(right.created_at || 0);
    if (timeDifference) return timeDifference;
    return String(left.id || "").localeCompare(String(right.id || ""));
  }

  function renderBroadcastAuctionConsole(lots = [], show = null) {
    const currentHost = $("[data-broadcast-current-item]");
    const list = $("[data-broadcast-sale-list]");
    const liveState = $("[data-broadcast-live-state]");
    const queueCount = $("[data-broadcast-queue-count]");
    const auctionButton = $("[data-auction-off]");
    const endButton = $("[data-broadcast-end-show]");
    if (!currentHost || !list || !liveState || !queueCount || !auctionButton || !endButton) return;
    const activeShow = show && ["open", "live"].includes(String(show.status || ""));
    const current = lots.find(lot => lot.status === "live") || null;
    const queued = lots.filter(lot => lot.status === "scheduled").sort(auctionQueueOrder);
    const itemsForSale = [...(current ? [current] : []), ...queued];
    const next = queued[0] || null;
    const durationControl = $("[data-auto-next-duration]");
    liveState.textContent = current ? "LIVE" : (activeShow ? "Ready" : "Waiting");
    queueCount.textContent = `${queued.length} queued`;
    if (durationControl && current) {
      const duration = Number(current.auction_duration_seconds || 30);
      if ([...durationControl.options].some(option => Number(option.value) === duration)) durationControl.value = String(duration);
    }
    if (current) {
      const price = dollars(current.current_bid_cents ?? current.starting_bid_cents);
      const image = current.image_url ? `<img src="${escapeHtml(current.image_url)}" alt="" loading="lazy">` : "";
      currentHost.classList.toggle("has-image", Boolean(image));
      currentHost.innerHTML = `${image}<strong>${escapeHtml(current.title)}</strong><span>${price}${current.winning_display ? ` &middot; leading @${escapeHtml(current.winning_display)}` : " &middot; awaiting bids"}</span><small>${escapeHtml(current.item_condition || current.sale_type || "Sale item")}</small>`;
    } else {
      currentHost.classList.remove("has-image");
      currentHost.innerHTML = activeShow
        ? `<strong>No live auction yet.</strong><span>${next ? `${escapeHtml(next.title)} is first in the queue.` : "Add items from your store or the Shows manager."}</span>`
        : `<strong>Choose an active show.</strong><span>The sale queue will load here.</span>`;
    }
    list.innerHTML = itemsForSale.length ? itemsForSale.map(lot => {
      const live = lot.status === "live";
      const queueIndex = live ? -1 : queued.findIndex(item => item.id === lot.id);
      const price = dollars(lot.current_bid_cents ?? lot.starting_bid_cents);
      const duration = Number(lot.auction_duration_seconds || 30);
      const image = lot.image_url
        ? `<img src="${escapeHtml(lot.image_url)}" alt="" loading="lazy">`
        : `<span class="seller-auction-queue-image-placeholder" aria-hidden="true">No image</span>`;
      const controls = live
        ? `<span class="seller-auction-queue-status">Live</span>`
        : `<div class="seller-auction-queue-actions">
            <span class="seller-auction-queue-status">Queued</span>
            <button type="button" data-queue-move="up" data-lot-id="${lot.id}" aria-label="Move ${escapeHtml(lot.title)} up" title="Move up" ${queueIndex <= 0 ? "disabled" : ""}>&uarr;</button>
            <button type="button" data-queue-move="down" data-lot-id="${lot.id}" aria-label="Move ${escapeHtml(lot.title)} down" title="Move down" ${queueIndex >= queued.length - 1 ? "disabled" : ""}>&darr;</button>
            <button class="seller-queue-run-button" type="button" data-queue-run="${lot.id}">Run now</button>
          </div>`;
      return `
        <article class="seller-auction-queue-item ${live ? "is-live" : ""}">
          <span class="seller-auction-queue-number">${live ? "&#9679;" : queueIndex + 1}</span>
          ${image}
          <div class="seller-auction-queue-copy">
            <strong>${escapeHtml(lot.title)}</strong>
            <span>${live ? "Current bid" : "Starting bid"} ${price} &middot; ${duration}s &middot; ${escapeHtml(lot.item_condition || lot.sale_type || "Sale item")}</span>
          </div>
          ${controls}
        </article>
      `;
    }).join("") : `<div class="stream-empty">${activeShow ? "No items are queued for this show." : "Choose an active show to load its sale items."}</div>`;
    auctionButton.disabled = auctionAdvancePending || !activeShow || !next;
    auctionButton.setAttribute("aria-label", next
      ? `${current ? "Finish the current auction and send" : "Send"} ${next.title} to the live auction`
      : "No queued item is available for the live auction");
    endButton.disabled = !activeShow;
    endButton.dataset.broadcastEndShow = activeShow ? show.id : "";
    syncAutoNextControls();
  }

  function selectedAuctionDuration() {
    const requested = Number($("[data-auto-next-duration]")?.value || 30);
    return ALLOWED_AUCTION_DURATIONS.has(requested) ? requested : 30;
  }

  function currentBroadcastLot() {
    return sellerShowLots.find(lot => lot.status === "live") || null;
  }

  function queuedBroadcastLots() {
    return sellerShowLots.filter(lot => lot.status === "scheduled").sort(auctionQueueOrder);
  }

  function clearAutoNextTimers() {
    window.clearInterval(autoNextTickTimer);
    window.clearTimeout(autoNextStepTimer);
    autoNextTickTimer = 0;
    autoNextStepTimer = 0;
    autoNextDeadline = 0;
  }

  function clearAuctionHold() {
    window.clearTimeout(auctionHoldTimer);
    auctionHoldTimer = 0;
    $("[data-auction-next]")?.classList.remove("is-holding");
  }

  function syncAutoNextControls() {
    const panel = $("[data-auto-next-panel]");
    const mode = $("[data-auto-next-mode]");
    const countdown = $("[data-auto-next-countdown]");
    const copy = $("[data-auto-next-copy]");
    const stop = $("[data-auto-next-stop]");
    const next = $("[data-auction-next]");
    if (panel) panel.dataset.state = autoNextActive ? "auto" : "manual";
    if (mode) mode.textContent = autoNextActive ? "AUTO-NEXT ARMED" : "Manual queue";
    if (countdown && !autoNextActive) countdown.textContent = "--";
    if (copy) copy.textContent = autoNextActive
      ? "The active auction will close at zero and the next Auction Block item will start."
      : "Tap NEXT AUCTION once to advance. Hold it for 3 seconds to arm the timed queue.";
    if (stop) stop.disabled = !autoNextActive;
    if (next) next.classList.toggle("is-auto-next-active", autoNextActive);
  }

  function updateAutoNextCountdown() {
    if (!autoNextActive || !autoNextDeadline) return;
    const countdown = $("[data-auto-next-countdown]");
    if (countdown) countdown.textContent = `${Math.max(0, Math.ceil((autoNextDeadline - Date.now()) / 1000))}s`;
  }

  function stopAutoNext(message = "", state = "success") {
    const wasActive = autoNextActive;
    autoNextActive = false;
    autoNextShowId = "";
    clearAutoNextTimers();
    clearAuctionHold();
    syncAutoNextControls();
    if (message && wasActive) setStatus("[data-broadcast-auction-status]", message, state);
  }

  async function advanceAuctionQueue({ nextLotId = "", source = "manual" } = {}) {
    if (auctionAdvancePending) return null;
    const show = selectedSellerShow();
    if (!show) throw new Error("Choose an active show first.");
    auctionAdvancePending = true;
    renderBroadcastAuctionConsole(sellerShowLots, show);
    setStatus("[data-broadcast-auction-status]", nextLotId ? "Starting the selected auction..." : "Advancing the auction queue...");
    try {
      const result = await api(`/seller/shows/${encodeURIComponent(show.id)}/auction-off`, {
        method: "POST",
        body: JSON.stringify(nextLotId ? { nextLotId } : {})
      });
      await Promise.all([loadSellerLots(show.id), loadShows()]);
      const closed = result.closedLot?.title ? `${result.closedLot.title} finished. ` : "";
      const selected = source === "selected" ? "Selected item" : (result.lot?.title || "The next item");
      setStatus("[data-broadcast-auction-status]", `${closed}${selected} is live. ${Number(result.remainingQueued || 0)} item(s) remain queued.`, "success");
      return result;
    } finally {
      auctionAdvancePending = false;
      renderBroadcastAuctionConsole(sellerShowLots, selectedSellerShow());
    }
  }

  async function runAutoNextStep() {
    if (!autoNextActive) return;
    const show = selectedSellerShow();
    if (!show || show.id !== autoNextShowId) {
      stopAutoNext("Auto-Next stopped because the active show changed.", "error");
      return;
    }
    const current = currentBroadcastLot();
    const queued = queuedBroadcastLots();
    try {
      if (current && !queued.length) {
        await api(`/seller/lots/${encodeURIComponent(current.id)}/close`, { method: "POST", body: "{}" });
        await Promise.all([loadSellerLots(show.id), loadShows()]);
        stopAutoNext("Auction Block complete. The final auction closed and Auto-Next stopped.");
        return;
      }
      await advanceAuctionQueue({ source: "auto" });
      if (autoNextActive) scheduleAutoNext();
    } catch (error) {
      stopAutoNext(`Auto-Next stopped: ${error.message}`, "error");
    }
  }

  function scheduleAutoNext() {
    if (!autoNextActive) return;
    clearAutoNextTimers();
    const current = currentBroadcastLot();
    if (!current) {
      runAutoNextStep();
      return;
    }
    const durationSeconds = selectedAuctionDuration();
    const openedAt = Date.parse(current.opened_at || "");
    const elapsed = Number.isFinite(openedAt) ? Math.max(0, Date.now() - openedAt) : 0;
    const remaining = Math.max(1000, durationSeconds * 1000 - elapsed);
    autoNextDeadline = Date.now() + remaining;
    updateAutoNextCountdown();
    autoNextTickTimer = window.setInterval(updateAutoNextCountdown, 250);
    autoNextStepTimer = window.setTimeout(runAutoNextStep, remaining);
  }

  async function startAutoNext() {
    const show = selectedSellerShow();
    const activeItems = [...(currentBroadcastLot() ? [currentBroadcastLot()] : []), ...queuedBroadcastLots()];
    if (!show) {
      setStatus("[data-broadcast-auction-status]", "Choose an active show before arming Auto-Next.", "error");
      return;
    }
    if (!activeItems.length) {
      setStatus("[data-broadcast-auction-status]", "Add at least one auction to the Auction Block first.", "error");
      return;
    }
    autoNextActive = true;
    autoNextShowId = show.id;
    syncAutoNextControls();
    setStatus("[data-broadcast-auction-status]", `AUTO-NEXT armed at ${selectedAuctionDuration()} seconds per auction.`, "success");
    scheduleAutoNext();
  }

  async function reorderAuctionQueue(lotId, direction) {
    const show = selectedSellerShow();
    if (!show) throw new Error("Choose an active show first.");
    const queued = queuedBroadcastLots();
    const index = queued.findIndex(lot => lot.id === lotId);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= queued.length) return;
    [queued[index], queued[nextIndex]] = [queued[nextIndex], queued[index]];
    await api(`/seller/shows/${encodeURIComponent(show.id)}/lots/reorder`, {
      method: "POST",
      body: JSON.stringify({ lotIds: queued.map(lot => lot.id) })
    });
    await loadSellerLots(show.id);
  }

  function numberedLotSettings(item) {
    const countInput = $("[data-show-store-lot-count]");
    const startInput = $("[data-show-store-number-start]");
    const available = Math.max(1, Math.min(100, Number(item?.quantity || 1)));
    if (countInput) {
      countInput.max = String(available);
      const requested = Math.floor(Number(countInput.value || 1));
      countInput.value = String(Math.max(1, Math.min(available, requested || 1)));
    }
    if (startInput) {
      const requested = Math.floor(Number(startInput.value || 1));
      startInput.value = String(Math.max(1, Math.min(999999, requested || 1)));
    }
    return {
      count: Math.max(1, Number(countInput?.value || 1)),
      start: Math.max(1, Number(startInput?.value || 1))
    };
  }

  function renderShowStoreInventoryPreview() {
    const preview = $("[data-show-store-preview]");
    const submit = $("[data-show-store-submit]");
    if (!preview || !submit) return;
    const show = selectedSellerShow();
    const item = selectedShowStoreListing();
    submit.disabled = !show || !item;
    if (!item) {
      preview.textContent = sellerStoreListings.some(listing => listing.status === "active" && Number(listing.quantity || 0) > 0)
        ? "Every active store listing is already assigned to a scheduled or live lot."
        : "No active personal-store inventory is available. Add or activate a listing below first.";
      return;
    }
    const showMessage = show ? `Ready for ${show.title}.` : "Create or select an active show before adding this listing.";
    const numbering = numberedLotSettings(item);
    const auctionMessage = numbering.count > 1
      ? `Creates ${numbering.count} auctions: ${item.title} #${numbering.start} through ${item.title} #${numbering.start + numbering.count - 1}.`
      : `Creates one auction: ${item.title}.`;
    submit.textContent = numbering.count > 1 ? `Create ${numbering.count} numbered auctions` : "Create auction from inventory";
    preview.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${Number(item.quantity || 0)} available · ${dollars(item.priceCents)} store price · ${escapeHtml(item.condition || "Condition pending")}</span><span>${escapeHtml(auctionMessage)}</span><span>${escapeHtml(showMessage)}</span>`;
  }

  function renderShowStoreInventoryOptions() {
    const select = $("[data-show-store-listing]");
    if (!select) return;
    const prior = select.value;
    const available = sellerStoreListings.filter(item => (
      item.status === "active" &&
      Number(item.quantity || 0) > 0 &&
      !["scheduled", "live"].includes(String(item.linkedLotStatus || "").toLowerCase())
    ));
    select.innerHTML = `<option value="">${available.length ? "Choose store inventory" : "No unassigned store inventory"}</option>${available.map(item => (
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} · ${Number(item.quantity || 0)} available · ${dollars(item.priceCents)}</option>`
    )).join("")}`;
    if (available.some(item => item.id === prior)) select.value = prior;
    const count = $("[data-show-store-count]");
    if (count) count.textContent = `${available.length} available`;
    if (!available.length) {
      const countInput = $("[data-show-store-lot-count]");
      const startInput = $("[data-show-store-number-start]");
      if (countInput) {
        countInput.max = "1";
        countInput.value = "1";
      }
      if (startInput) startInput.value = "1";
      const submit = $("[data-show-store-submit]");
      if (submit) submit.textContent = "Create auction from inventory";
    }
    renderShowStoreInventoryPreview();
  }

  function renderSellerStoreListings() {
    const list = $("[data-seller-store-list]");
    if (list) list.innerHTML = sellerStoreListings.length ? sellerStoreListings.map(item => `
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
    renderShowStoreInventoryOptions();
    updateSellerDashboardMetrics();
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
    updateSellerDashboardMetrics();
  }

  const categoryLabel = key => sellerProductCategories.find(item => item.key === key)?.label || "TCG / Playing Cards";
  function renderSellerProductCategories() {
    const grid = $("[data-seller-category-options]");
    const inventorySelect = $("[data-seller-inventory-category-select]");
    const storeSelect = $("[data-seller-store-category-select]");
    const weightCategory = $("[data-weight-profile-category]");
    const categories = sellerProductCategories.length ? sellerProductCategories : [{ key: "tcg", label: "TCG / Playing Cards", enabled: true }];
    if (grid) {
      grid.innerHTML = categories.map(category => `
        <label class="seller-category-choice">
          <input type="checkbox" data-seller-category="${escapeHtml(category.key)}" ${category.enabled ? "checked" : ""}>
          <span>${escapeHtml(category.label)}</span>
        </label>
      `).join("");
    }
    const optionMarkup = categories.map(category => `<option value="${escapeHtml(category.key)}">${escapeHtml(category.label)}</option>`).join("");
    if (inventorySelect) inventorySelect.innerHTML = optionMarkup;
    if (storeSelect) storeSelect.innerHTML = optionMarkup;
    if (weightCategory) weightCategory.innerHTML = `<option value="">Any category</option>${optionMarkup}`;
  }

  function syncWeightProfileInventoryOptions() {
    const select = $("[data-weight-profile-inventory]");
    if (!select) return;
    const prior = select.value;
    select.innerHTML = `<option value="">Generic category profile</option>${sellerInventoryItems.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.product_name)} - ${escapeHtml(categoryLabel(item.product_category_key))}</option>`).join("")}`;
    if (prior && sellerInventoryItems.some(item => item.id === prior)) select.value = prior;
  }

  function syncShippingProfileSelects() {
    const selects = [$("[data-seller-inventory-shipping-profile]"), $("[data-seller-store-shipping-profile]")].filter(Boolean);
    if (!selects.length) return;
    const options = `<option value="">No profile linked</option>${sellerWeightProfiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)} - ${Number(profile.displayWeightValue || 0)} ${escapeHtml(profile.displayWeightUnit)}</option>`).join("")}`;
    selects.forEach(select => {
      const prior = select.value;
      select.innerHTML = options;
      if (prior && sellerWeightProfiles.some(profile => profile.id === prior)) select.value = prior;
    });
  }

  function renderSellerWeightProfiles() {
    const list = $("[data-weight-profile-list]");
    if (!list) return;
    list.innerHTML = sellerWeightProfiles.length ? sellerWeightProfiles.map(profile => `
      <article class="seller-weight-profile-card">
        <header>
          <div>
            <strong>${escapeHtml(profile.name)}</strong>
            <p>${escapeHtml(profile.inventoryProductName || profile.productCategoryLabel || "Any category")} - ${escapeHtml(profile.weightUnitSystem === "metric" ? "Metric" : "Imperial")}</p>
          </div>
          <div class="seller-weight-profile-badges">
            ${profile.isDefault ? `<span class="seller-order-chip is-ship-now">Default</span>` : ""}
            ${profile.autoLabelPurchaseEnabled ? `<span class="seller-order-chip is-auto-buy">Auto-Buy ON</span>` : `<span class="seller-order-chip is-muted">Auto-Buy OFF</span>`}
          </div>
        </header>
        <div class="seller-order-metrics">
          <span><small>Entered</small><strong>${Number(profile.displayWeightValue || 0)} ${escapeHtml(profile.displayWeightUnit)}</strong></span>
          <span><small>EasyPost</small><strong>${Number(profile.finalWeightOz || 0).toFixed(2)} oz</strong></span>
          <span><small>Dims</small><strong>${profile.lengthIn && profile.widthIn && profile.heightIn ? `${profile.lengthIn}x${profile.widthIn}x${profile.heightIn} in` : "Optional"}</strong></span>
        </div>
        ${profile.packagingNote ? `<p class="fine-print">${escapeHtml(profile.packagingNote)}</p>` : ""}
      </article>
    `).join("") : `<div class="stream-empty">No weight profiles yet. Create one for each common final package setup.</div>`;
    syncShippingProfileSelects();
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

  const sellerOrderStatusText = status => ({
    needs_label: "Needs Label",
    needs_label_setup: "Needs Order Data",
    ship_now: "Ship Now",
    shipped: "Shipped",
    delivered: "Delivered",
    unpaid: "Unpaid"
  })[status] || String(status || "Processing").replace(/_/g, " ");
  const sellerOrderKindText = kind => ({
    buyer_store: "Buyer Store",
    seller_store: "Stock Store",
    auction: "Auction",
    giveaway: "Giveaway"
  })[kind] || "Order";
  const sellerOrderPaidByText = value => ({
    seller: "seller",
    buyer: "buyer",
    gifter: "gifter"
  })[String(value || "").toLowerCase()] || "unknown";
  const sellerOrderSearchText = order => [
    order.orderNumber, order.title, order.kind, order.status, order.paymentStatus, order.fulfillmentStatus,
    order.customer?.email, order.customer?.username, order.customer?.name,
    order.fulfillmentOwner?.username, order.trackingCode, order.carrier, order.service, order.note
  ].filter(Boolean).join(" ").toLowerCase();
  function filteredSellerOrders() {
    const query = sellerOrderSearch.trim().toLowerCase();
    return sellerOrders.filter(order => {
      const tabMatch = sellerOrderTab === "all"
        || (sellerOrderTab === "giveaway" ? order.kind === "giveaway" : order.fulfillmentStatus === sellerOrderTab);
      return tabMatch && (!query || sellerOrderSearchText(order).includes(query));
    });
  }
  function sellerOrderAction(order) {
    if (order.fulfillmentStatus === "needs_label" && order.canPurchaseLabel) {
      return `<button class="btn btn-primary btn-small" type="button" data-seller-order-label="${escapeHtml(order.id)}">Print Label</button>`;
    }
    if (order.fulfillmentStatus === "ship_now") {
      const label = order.labelUrl ? `<a class="btn btn-primary btn-small" href="${escapeHtml(order.labelUrl)}" target="_blank" rel="noopener noreferrer">Ship Now</a>` : "";
      const tracking = order.localTrackingUrl ? `<a class="btn btn-outline btn-small" href="${escapeHtml(order.localTrackingUrl)}" target="_blank" rel="noopener noreferrer">Tracking</a>` : "";
      return `${label}${tracking}` || `<span class="seller-order-chip is-ship-now">Ship Now</span>`;
    }
    if (order.fulfillmentStatus === "needs_label_setup") {
      return `<span class="seller-order-chip is-muted">Needs saved shipment/rate</span>`;
    }
    if (order.fulfillmentStatus === "unpaid") {
      return `<span class="seller-order-chip is-unpaid">Awaiting payment</span>`;
    }
    if (order.labelUrl) return `<a class="btn btn-outline btn-small" href="${escapeHtml(order.labelUrl)}" target="_blank" rel="noopener noreferrer">Open Label</a>`;
    if (order.localTrackingUrl) return `<a class="btn btn-outline btn-small" href="${escapeHtml(order.localTrackingUrl)}" target="_blank" rel="noopener noreferrer">Tracking</a>`;
    return `<span class="seller-order-chip">${escapeHtml(sellerOrderStatusText(order.fulfillmentStatus))}</span>`;
  }
  function sellerOrderCard(order) {
    const shippingPrice = order.shippingPriceCents === null || order.shippingPriceCents === undefined ? "Not priced" : dollars(order.shippingPriceCents);
    const clipLink = order.clipUrl ? `<a class="btn btn-outline btn-small" href="${escapeHtml(order.clipUrl)}" target="_blank" rel="noopener noreferrer">Watch Clip</a>` : `<span class="seller-order-chip is-muted">No clip yet</span>`;
    const trackingLink = order.trackingUrl ? `<a class="btn btn-outline btn-small" href="${escapeHtml(order.trackingUrl)}" target="_blank" rel="noopener noreferrer">Carrier Page</a>` : "";
    const weightProfilePicker = sellerWeightProfiles.length
      ? `<label class="seller-order-weight-picker">Weight profile<select data-seller-order-weight-profile="${escapeHtml(order.id)}"><option value="">Choose final package weight</option>${sellerWeightProfiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)} - ${Number(profile.displayWeightValue || 0)} ${escapeHtml(profile.displayWeightUnit)}</option>`).join("")}</select></label>`
      : `<span class="seller-order-chip is-muted">Create a weight profile for package-based labels</span>`;
    const labelStatusClass = `is-${String(order.fulfillmentStatus || "processing").replace(/[^a-z0-9_-]/gi, "").toLowerCase()}`;
    return `
      <article class="seller-order-card ${escapeHtml(labelStatusClass)}">
        <div class="seller-order-main">
          <div>
            <span class="seller-order-kind">${escapeHtml(sellerOrderKindText(order.kind))}</span>
            <strong>${escapeHtml(order.title || "Crack Packs order")}</strong>
            <p>${escapeHtml(order.orderNumber || order.id)} Â· ${escapeHtml(dateLabel(order.placedAt))}</p>
          </div>
          <span class="seller-order-status ${escapeHtml(labelStatusClass)}">${escapeHtml(sellerOrderStatusText(order.fulfillmentStatus))}</span>
        </div>
        <div class="seller-order-metrics">
          <span><small>Status</small><strong>${escapeHtml(order.paymentStatus || order.status || "processing")}</strong></span>
          <span><small>Paid by</small><strong>${escapeHtml(sellerOrderPaidByText(order.paidBy))}</strong></span>
          <span><small>Shipping price</small><strong>${escapeHtml(shippingPrice)}</strong></span>
          <span><small>Qty</small><strong>${Number(order.quantity || 1)}</strong></span>
        </div>
        <div class="seller-order-detail-row">
          <span><small>Buyer / giver</small>${escapeHtml(order.customer?.username || order.customer?.email || order.customer?.name || "Not attached")}</span>
          <span><small>Carrier</small>${escapeHtml([order.carrier, order.service].filter(Boolean).join(" Â· ") || order.trackingStatus || "Not labeled")}</span>
          <span><small>Tracking</small>${escapeHtml(order.trackingCode || "Pending")}</span>
        </div>
        ${weightProfilePicker}
        <div class="seller-order-actions">
          ${sellerOrderAction(order)}
          ${trackingLink}
          ${clipLink}
        </div>
      </article>
    `;
  }
  function renderSellerOrders() {
    const list = $("[data-seller-orders-list]");
    if (!list) return;
    const orders = filteredSellerOrders();
    list.innerHTML = orders.length ? orders.map(sellerOrderCard).join("") : `<div class="stream-empty">No seller orders match this filter yet.</div>`;
    updateSellerDashboardMetrics();
  }

  async function loadSellerInventory() {
    const payload = await api("/seller/inventory");
    sellerInventoryItems = payload.items || [];
    renderSellerInventory(payload.reorders || []);
    syncWeightProfileInventoryOptions();
  }

  async function loadSellerCogsOrders() {
    const payload = await api("/seller/cogs-orders");
    sellerCogsOrders = payload.orders || [];
    renderSellerCogsOrders();
  }

  async function loadSellerOrders() {
    const payload = await api("/seller/orders");
    sellerOrders = payload.orders || [];
    renderSellerOrders();
  }

  async function loadSellerProductCategories() {
    const payload = await api("/seller/product-categories");
    sellerProductCategories = payload.categories || [];
    renderSellerProductCategories();
  }

  async function loadSellerWeightProfiles() {
    const payload = await api("/seller/shipping-profiles");
    sellerWeightProfiles = payload.profiles || [];
    renderSellerWeightProfiles();
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
      if (!sellerContextAuthorized) {
        showSellerIdentityPanelForStatus(status);
        $$('[data-seller-only]').forEach(node => { node.hidden = true; });
        $$('[data-seller-gate]').forEach(node => { node.hidden = false; });
        $$('[data-seller-page-content]').forEach(node => { node.hidden = true; });
        return;
      }
      hideSellerIdentityPanel();
      syncSellerStorefront(status.sellerUsername);
      $$('[data-seller-only]').forEach(node => { node.hidden = false; });
      syncSellerSectionNav();
      try {
        const streamInput = await api("/seller/stream/input");
        obsGuideCompletedAt = String(streamInput.obsSetupCompletedAt || "");
        if (obsGuideCompletedAt) localStorage.setItem(OBS_GUIDE_COMPLETED_KEY, "true");
        renderStreamInput(streamInput.input);
        await loadYouTubeOutput();
      } catch {}
      syncStreamKeyButtons();
      syncStreamGuideVisibility({ firstOpen: !hasSavedObsConnection && !hasCompletedObsGuide() });
      await loadSellerProductCategories();
      await Promise.all([loadSellerGiveaways(), loadSellerShows(), loadSellerInventory(), loadSellerStoreListings(), loadSellerCogsOrders(), loadSellerOrders(), loadSellerWeightProfiles()]);
      updateSellerDashboardMetrics();
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
    const goLive = event.target.closest("[data-seller-go-live]");
    const watch = event.target.closest("[data-watch]");
    const follow = event.target.closest("[data-follow]");
    const gift = event.target.closest("[data-open-gifted]");
    const calendar = event.target.closest("[data-calendar]");
    try {
      if (goLive) {
        event.preventDefault();
        if (!token()) throw new Error("Sign in to open Seller Live.");
        const show = shows.find(item => item.id === goLive.dataset.sellerGoLive);
        if (!show || String(show.sellerUsername || "").toLowerCase() !== liveShowsSellerUsername.toLowerCase()) {
          throw new Error("Only the seller who created this show can open its live controls.");
        }
        goLive.disabled = true;
        const result = await api("/portal/mode", { method: "POST", body: JSON.stringify({ mode: "seller" }) });
        if (result.activePortal !== "seller") throw new Error("Seller Portal access could not be confirmed.");
        localStorage.setItem("cp_can_seller_portal", "true");
        localStorage.setItem("cp_portal_mode", "seller");
        sessionStorage.setItem("cp_portal_mode", "seller");
        window.location.href = `streams.html?show=${encodeURIComponent(show.id)}#seller-live`;
      } else if (watch) {
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
    } catch (error) {
      if (goLive) goLive.disabled = false;
      window.alert(error.message);
    }
  });

  $$('[data-hub-tab]').forEach(button => button.addEventListener("click", () => {
    activeTab = button.dataset.hubTab || "watchlist";
    $$('[data-hub-tab]').forEach(node => {
      const active = node === button;
      node.classList.toggle("is-active", active);
      if (node.hasAttribute("role")) node.setAttribute("aria-selected", String(active));
    });
    renderShows();
  }));

  $("[data-seller-identity-check]")?.addEventListener("click", async event => {
    await checkSellerIdentityStatus(event.currentTarget);
  });
  $("[data-seller-identity-complete]")?.addEventListener("click", async event => {
    await completeSellerAccountSetup(event.currentTarget);
  });
  $("[data-seller-identity-retry]")?.addEventListener("click", async event => {
    await retrySellerIdentity(event.currentTarget);
  });

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

  $("[data-seller-show-thumbnail]")?.addEventListener("change", event => {
    const file = event.currentTarget.files?.[0] || null;
    try {
      previewShowThumbnail(file);
      setStatus("[data-seller-show-status]", file ? "Thumbnail ready to upload with this show." : "", file ? "success" : "");
    } catch (error) {
      event.currentTarget.value = "";
      clearShowThumbnailPreview();
      setStatus("[data-seller-show-status]", error.message, "error");
    }
  });

  $("[data-seller-show-form]")?.addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const button = event.submitter; button.disabled = true;
    try {
      const scheduledValue = String(data.get("scheduledAt") || "");
      const thumbnailFile = data.get("thumbnailFile");
      if (thumbnailFile?.size) {
        if (!showThumbnailTypes.has(String(thumbnailFile.type || "").toLowerCase())) throw new Error("Choose a PNG, JPG, or JPEG show thumbnail.");
        if (thumbnailFile.size > showThumbnailMaxBytes) throw new Error("Show thumbnail must be 5 MB or smaller.");
      }
      data.set("scheduledAt", scheduledValue ? new Date(scheduledValue).toISOString() : "");
      setStatus("[data-seller-show-status]", thumbnailFile?.size ? "Uploading thumbnail and publishing show..." : "Publishing show...", "success");
      const created = await api("/seller/shows", { method: "POST", body: data });
      form.reset();
      clearShowThumbnailPreview();
      await Promise.all([loadSellerShows(), loadShows()]);
      const publicLink = $("[data-seller-show-public-link]");
      if (publicLink) {
        publicLink.href = created.liveShowsUrl || `live-shows.html?tab=upcoming#show-${encodeURIComponent(created.id)}`;
        publicLink.hidden = false;
      }
      setStatus("[data-seller-show-status]", "Show saved and published to Live Shows.", "success");
    } catch (error) { setStatus("[data-seller-show-status]", error.message, "error"); }
    finally { button.disabled = false; }
  });

  [$("[data-seller-show-select]"), $("[data-broadcast-show-select]")].filter(Boolean).forEach(select => {
    select.addEventListener("change", event => {
      if (autoNextActive && event.currentTarget.value !== autoNextShowId) {
        stopAutoNext("Auto-Next stopped because the active show changed.");
      }
      selectSellerShow(event.currentTarget.value).catch(error => {
        setStatus("[data-seller-lot-status]", error.message, "error");
        setStatus("[data-broadcast-auction-status]", error.message, "error");
      });
    });
  });
  $("[data-seller-shows-refresh]")?.addEventListener("click", () => loadSellerShows().catch(error => setStatus("[data-seller-show-status]", error.message, "error")));
  $("[data-broadcast-queue-refresh]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const show = selectedSellerShow();
      if (!show) throw new Error("Choose an active show first.");
      await loadSellerLots(show.id);
      setStatus("[data-broadcast-auction-status]", "Auction queue refreshed.", "success");
    } catch (error) {
      setStatus("[data-broadcast-auction-status]", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  const auctionNextButton = $("[data-auction-next]");
  const startAuctionHold = event => {
    if (!auctionNextButton || auctionNextButton.disabled || auctionAdvancePending || autoNextActive) return;
    if (event.type === "pointerdown" && event.button !== 0) return;
    clearAuctionHold();
    suppressAuctionNextClick = false;
    auctionNextButton.classList.add("is-holding");
    setStatus("[data-broadcast-auction-status]", "Keep holding NEXT AUCTION to arm AUTO-NEXT...");
    auctionHoldTimer = window.setTimeout(() => {
      auctionHoldTimer = 0;
      suppressAuctionNextClick = true;
      auctionNextButton.classList.remove("is-holding");
      startAutoNext();
    }, AUTO_NEXT_HOLD_MS);
  };
  const cancelAuctionHold = () => {
    if (!auctionHoldTimer) return;
    clearAuctionHold();
    setStatus("[data-broadcast-auction-status]", "");
  };
  auctionNextButton?.addEventListener("pointerdown", startAuctionHold);
  auctionNextButton?.addEventListener("pointerup", cancelAuctionHold);
  auctionNextButton?.addEventListener("pointercancel", cancelAuctionHold);
  auctionNextButton?.addEventListener("pointerleave", cancelAuctionHold);
  auctionNextButton?.addEventListener("keydown", event => {
    if (!event.repeat && ["Enter", " "].includes(event.key)) startAuctionHold(event);
  });
  auctionNextButton?.addEventListener("keyup", event => {
    if (["Enter", " "].includes(event.key)) cancelAuctionHold();
  });
  auctionNextButton?.addEventListener("contextmenu", event => event.preventDefault());
  auctionNextButton?.addEventListener("click", async event => {
    if (suppressAuctionNextClick) {
      suppressAuctionNextClick = false;
      event.preventDefault();
      return;
    }
    if (autoNextActive) stopAutoNext("Auto-Next stopped. Manual queue control restored.");
    try {
      await advanceAuctionQueue();
    } catch (error) {
      setStatus("[data-broadcast-auction-status]", error.message, "error");
    }
  });
  $("[data-auto-next-stop]")?.addEventListener("click", () => {
    stopAutoNext("Auto-Next stopped. Choose an Auction Block item or advance one at a time.");
  });
  $("[data-auto-next-duration]")?.addEventListener("change", () => {
    if (!autoNextActive) return;
    setStatus("[data-broadcast-auction-status]", `Auto-Next timer changed to ${selectedAuctionDuration()} seconds.`, "success");
    scheduleAutoNext();
  });
  $("[data-broadcast-sale-list]")?.addEventListener("click", async event => {
    const move = event.target.closest("[data-queue-move]");
    const run = event.target.closest("[data-queue-run]");
    if (!move && !run) return;
    const controls = $$("[data-broadcast-sale-list] button");
    controls.forEach(button => { button.disabled = true; });
    try {
      if (move) {
        await reorderAuctionQueue(move.dataset.lotId, move.dataset.queueMove);
        setStatus("[data-broadcast-auction-status]", "Auction Block order saved.", "success");
      } else {
        if (autoNextActive) stopAutoNext("Auto-Next stopped so the selected item can run.");
        await advanceAuctionQueue({ nextLotId: run.dataset.queueRun, source: "selected" });
      }
    } catch (error) {
      setStatus("[data-broadcast-auction-status]", error.message, "error");
      renderBroadcastAuctionConsole(sellerShowLots, selectedSellerShow());
    }
  });
  $("[data-broadcast-end-show]")?.addEventListener("click", event => {
    const showId = event.currentTarget.dataset.broadcastEndShow || selectedSellerShow()?.id || "";
    if (showId) openCloseShowModal(showId, event.currentTarget);
  });
  $("[data-seller-social-refresh]")?.addEventListener("click", () => { updateSellerSocialComposer(); setStatus("[data-seller-social-status]", "Selected show link loaded.", "success"); });
  $("[data-listing-destination]")?.addEventListener("change", syncListingDestinationUi);
  $("[data-show-store-listing]")?.addEventListener("change", renderShowStoreInventoryPreview);
  $("[data-show-store-lot-count]")?.addEventListener("input", renderShowStoreInventoryPreview);
  $("[data-show-store-number-start]")?.addEventListener("input", renderShowStoreInventoryPreview);
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

  $("[data-show-store-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const showId = $("[data-seller-show-select]")?.value || "";
    const storeListingId = String(data.get("storeListingId") || "");
    if (!showId) { setStatus("[data-show-store-status]", "Create or choose an active show first.", "error"); return; }
    if (!storeListingId) { setStatus("[data-show-store-status]", "Choose inventory from your personal store.", "error"); return; }
    const button = event.submitter || $("[data-show-store-submit]");
    button.disabled = true;
    try {
      const result = await api(`/seller/shows/${encodeURIComponent(showId)}/lots`, {
        method: "POST",
        body: JSON.stringify({
          storeListingId,
          startingBid: Number(data.get("startingBid")),
          bidIncrement: Number(data.get("bidIncrement")),
          auctionDurationSeconds: Number(data.get("auctionDurationSeconds")),
          lotCount: Number(data.get("lotCount")),
          numberStart: Number(data.get("numberStart"))
        })
      });
      form.elements.startingBid.value = "1.00";
      form.elements.bidIncrement.value = "1.00";
      form.elements.auctionDurationSeconds.value = "30";
      form.elements.lotCount.value = "1";
      form.elements.numberStart.value = "1";
      await Promise.all([loadSellerLots(showId), loadSellerStoreListings()]);
      setStatus("[data-show-store-status]", Number(result.count || 1) > 1
        ? `${Number(result.count)} numbered auctions created from one inventory listing.`
        : "Store inventory added to the selected show.", "success");
    } catch (error) {
      setStatus("[data-show-store-status]", error.message, "error");
    } finally {
      renderShowStoreInventoryPreview();
    }
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
            productCategoryKey: data.get("productCategoryKey"),
            shippingWeightProfileId: data.get("shippingWeightProfileId"),
            fixedShipping: Number(data.get("fixedShipping") || 0),
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
      form.reset(); form.elements.startingBid.value = "1.00"; form.elements.bidIncrement.value = "1.00"; form.elements.auctionDurationSeconds.value = "30"; form.elements.storePrice.value = "1.00"; form.elements.storeQuantity.value = "1"; form.elements.fixedShipping.value = "5.00"; form.elements.shippingPayer.value = "buyer"; form.elements.saleTypeStore.value = "singles";
      if (form.elements.storeShowId) form.elements.storeShowId.value = "";
      syncListingDestinationUi();
    } catch (error) { setStatus("[data-seller-lot-status]", error.message, "error"); }
    finally { button.disabled = false; }
  });

  function openCloseShowModal(showId, trigger) {
    const modal = $("[data-close-show-modal]");
    const copy = $("[data-close-show-copy]");
    const show = sellerShows.find(item => item.id === showId);
    if (!modal || !showId) return;
    if (autoNextActive) stopAutoNext("Auto-Next stopped while the show close confirmation is open.");
    pendingCloseShowId = showId;
    closeShowTrigger = trigger || null;
    if (copy) copy.textContent = `Closing ${show?.title || "this show"} ends the broadcast session and cancels every remaining scheduled or open auction.`;
    setStatus("[data-close-show-status]", "");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    $("[data-close-show-confirm]")?.focus();
  }

  function closeCloseShowModal({ restoreFocus = true } = {}) {
    const modal = $("[data-close-show-modal]");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    pendingCloseShowId = "";
    if (restoreFocus && closeShowTrigger?.isConnected) closeShowTrigger.focus();
    closeShowTrigger = null;
  }

  $("[data-seller-lot-list]")?.addEventListener("click", async event => {
    const action = event.target.closest("[data-lot-action]"); const end = event.target.closest("[data-end-show]");
    try {
      if (action) {
        action.disabled = true;
        await api(`/seller/lots/${encodeURIComponent(action.dataset.lotId)}/${action.dataset.lotAction}`, { method: "POST", body: "{}" });
        await loadSellerLots($("[data-seller-show-select]").value);
      } else if (end) {
        openCloseShowModal(end.dataset.endShow, end);
      }
    } catch (error) { setStatus("[data-seller-lot-status]", error.message, "error"); }
  });

  $$("[data-close-show-cancel]").forEach(button => button.addEventListener("click", () => closeCloseShowModal()));
  $("[data-close-show-confirm]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!pendingCloseShowId) return;
    const showId = pendingCloseShowId;
    button.disabled = true;
    setStatus("[data-close-show-status]", "Closing stream and cancelling remaining auctions...");
    try {
      const result = await api(`/seller/shows/${encodeURIComponent(showId)}/end`, { method: "POST", body: "{}" });
      closeCloseShowModal({ restoreFocus: false });
      await loadSellerShows();
      const synced = result.streamCreditSync?.syncedVideos ? ` ${Number(result.streamCreditSync.syncedVideos)} recording source(s) synced.` : " Usage will also refresh on the next hourly cycle.";
      setStatus("[data-seller-lot-status]", `Show ended. Stream Credits are syncing.${synced}`, "success");
    } catch (error) {
      setStatus("[data-close-show-status]", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("[data-close-show-modal]")?.hidden) closeCloseShowModal();
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
      await api("/seller/inventory", { method: "POST", body: JSON.stringify({ productName: data.get("productName"), sku: data.get("sku"), productCategoryKey: data.get("productCategoryKey"), shippingWeightProfileId: data.get("shippingWeightProfileId"), unitType: data.get("unitType"), quantity: Number(data.get("quantity")), parQuantity: Number(data.get("parQuantity")), reorderQuantity: Number(data.get("reorderQuantity")), autoReorder: data.get("autoReorder") === "on" }) });
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

  $("[data-seller-categories-save]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const categories = $$("[data-seller-category]:checked").map(input => input.dataset.sellerCategory);
      await api("/seller/product-categories", { method: "POST", body: JSON.stringify({ categories }) });
      await loadSellerProductCategories();
      setStatus("[data-seller-categories-status]", "Product categories saved. Buyer marketplace filters will use these categories.", "success");
    } catch (error) {
      setStatus("[data-seller-categories-status]", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("[data-weight-profile-toggle]")?.addEventListener("click", event => {
    const form = $("[data-weight-profile-form]");
    if (!form) return;
    form.hidden = !form.hidden;
    event.currentTarget.textContent = form.hidden ? "Create Weight Profile" : "Close Weight Profile";
  });

  $("[data-weight-unit-system]")?.addEventListener("change", event => {
    const unitSelect = $("[data-weight-unit-select]");
    if (!unitSelect) return;
    const metric = event.currentTarget.value === "metric";
    unitSelect.value = metric ? "g" : "oz";
  });

  $("[data-weight-profile-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const button = event.submitter;
    button.disabled = true;
    try {
      await api("/seller/shipping-profiles", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          breakerInventoryItemId: data.get("breakerInventoryItemId"),
          productCategoryKey: data.get("productCategoryKey"),
          weightUnitSystem: data.get("weightUnitSystem"),
          displayWeightValue: Number(data.get("displayWeightValue") || 0),
          displayWeightUnit: data.get("displayWeightUnit"),
          lengthIn: data.get("lengthIn"),
          widthIn: data.get("widthIn"),
          heightIn: data.get("heightIn"),
          packagingNote: data.get("packagingNote"),
          isDefault: data.get("isDefault") === "on",
          autoLabelPurchaseEnabled: data.get("autoLabelPurchaseEnabled") === "on"
        })
      });
      form.reset();
      $("[data-weight-unit-select]").value = "oz";
      await loadSellerWeightProfiles();
      setStatus("[data-weight-profile-status]", "Weight profile saved. It is ready for shipping-label automation.", "success");
    } catch (error) {
      setStatus("[data-weight-profile-status]", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $$("[data-seller-order-tab]").forEach(button => button.addEventListener("click", () => {
    sellerOrderTab = button.dataset.sellerOrderTab || "all";
    $$("[data-seller-order-tab]").forEach(node => node.classList.toggle("is-active", node === button));
    renderSellerOrders();
  }));

  $("[data-seller-order-search]")?.addEventListener("input", event => {
    sellerOrderSearch = event.currentTarget.value || "";
    renderSellerOrders();
  });

  $("[data-seller-orders-refresh]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await loadSellerOrders();
      setStatus("[data-seller-orders-status]", "Seller orders refreshed.", "success");
    } catch (error) {
      setStatus("[data-seller-orders-status]", error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("[data-seller-orders-list]")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-seller-order-label]");
    if (!button) return;
    const orderId = button.dataset.sellerOrderLabel;
    if (!window.confirm("Buy this EasyPost label now? This charges the configured EasyPost account and saves the label to this order.")) return;
    button.disabled = true;
    button.textContent = "Buying label...";
    try {
      const weightProfileId = $(`[data-seller-order-weight-profile="${orderId}"]`)?.value || "";
      const payload = await api(`/seller/orders/${encodeURIComponent(orderId)}/label`, { method: "POST", body: JSON.stringify({ weightProfileId }) });
      await loadSellerOrders();
      if (payload.labelUrl) window.open(payload.labelUrl, "_blank", "noopener,noreferrer");
      setStatus("[data-seller-orders-status]", "Label purchased. The order is now in Ship Now.", "success");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Print Label";
      setStatus("[data-seller-orders-status]", error.message, "error");
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

  document.addEventListener("click", event => {
    const toolButton = event.target.closest("[data-seller-tool-button]");
    if (toolButton) {
      event.preventDefault();
      setSellerTool(toolButton.dataset.sellerToolButton || "home");
    }

    const addToStore = event.target.closest("[data-seller-open-store-listing]");
    if (!addToStore) return;
    event.preventDefault();
    setSellerTool("show-inventory");
    const destination = $("[data-listing-destination]");
    if (destination) destination.value = "store";
    syncListingDestinationUi();
    window.setTimeout(() => {
      const title = $("[data-seller-lot-form] [name='title']");
      title?.scrollIntoView({ behavior: "smooth", block: "center" });
      title?.focus({ preventScroll: true });
    }, 80);
  });

  const sellerChatRoot = $("[data-live-chat]");
  if (!viewerOnly && sellerChatRoot && window.CrackPacksLiveChat) {
    sellerLiveChat = window.CrackPacksLiveChat.create({
      root: sellerChatRoot,
      apiBase: base,
      token,
      getShowId: () => $("[data-broadcast-show-select]")?.value || ""
    });
  }
  loadShows();
  if (viewerOnly) loadLiveShowsSellerContext();
  const showsRefreshTimer = window.setInterval(() => {
    if (!document.hidden) loadShows();
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadShows();
  });
  window.addEventListener("pagehide", () => {
    window.clearInterval(showsRefreshTimer);
    sellerLiveChat?.stop();
    stopAutoNext();
  }, { once: true });
  if (!viewerOnly) {
    syncSellerSectionNav();
    window.addEventListener("hashchange", syncSellerSectionNav);
    syncListingDestinationUi();
    loadSellerContext();
  }
})();
