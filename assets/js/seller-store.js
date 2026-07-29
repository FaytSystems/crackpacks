(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const base = String(config.rewardsApiUrl || "").trim().replace(/\/+$/, "");
  const token = () => localStorage.getItem("cp_rewards_token") || "";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const state = {
    items: [],
    shows: [],
    sellerUsername: "",
    view: location.hash === "#preview" ? "preview" : "stock",
    channel: "all",
    search: "",
    sort: "updated",
    controller: null
  };

  const workspace = $$("[data-seller-store-workspace]");
  const accessPanel = $("[data-seller-store-access]");
  const statusNode = $("[data-seller-store-status]");
  const stockList = $("[data-stock-list]");
  const stockEmpty = $("[data-stock-empty]");
  const previewGrid = $("[data-preview-grid]");
  const previewEmpty = $("[data-preview-empty]");
  const modal = $("[data-listing-modal]");
  const form = $("[data-listing-form]");
  const formStatus = $("[data-listing-form-status]");
  const channelSelect = $("[data-listing-channel]");
  const showField = $("[data-listing-show-field]");
  const showSelect = $("[data-listing-show-select]");
  const shippingPayer = $("[data-listing-shipping-payer]");
  const fixedShippingField = $("[data-fixed-shipping-field]");

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));

  const normalizeText = value => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  const pretty = value => String(value || "other")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, character => character.toUpperCase());

  const formatMoney = cents => new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD"
  }).format(Number(cents || 0) / 100);

  const safeImage = value => {
    const raw = String(value || "").trim();
    if (/^https:\/\//i.test(raw) || /^assets\/images\/[a-z0-9._/-]+$/i.test(raw)) return raw;
    return "";
  };

  const fallbackImage = item => {
    const text = normalizeText(`${item.productCategoryKey || ""} ${item.saleType || ""}`);
    if (text.includes("pokemon")) return "assets/images/product-electric.svg";
    if (text.includes("magic")) return "assets/images/product-cosmic.svg";
    if (text.includes("memorabilia") || text.includes("sports")) return "assets/images/product-vintage.svg";
    return "assets/images/product-aurora.svg";
  };

  function setStatus(message, kind = "") {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.kind = kind;
  }

  function setFormStatus(message, kind = "") {
    if (!formStatus) return;
    formStatus.textContent = message;
    formStatus.dataset.kind = kind;
  }

  async function api(path, options = {}) {
    if (!base) throw Object.assign(new Error("The seller service is not configured."), { status: 503 });
    const requestController = new AbortController();
    const timeout = window.setTimeout(() => requestController.abort(), 10_000);
    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        signal: options.signal || requestController.signal,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error || "The seller service could not complete that request."), { status: response.status });
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw Object.assign(new Error("The seller service took too long to respond. Try again."), { status: 504 });
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function listingChannel(item) {
    if (item.status === "sold_out" || Number(item.quantity || 0) <= 0) return "sold";
    if (item.showId) return "shows";
    if (item.status === "active") return "store";
    return "inventory";
  }

  function showForListing(item) {
    return state.shows.find(show => show.id === item.showId) || null;
  }

  function publicStoreHref() {
    return state.sellerUsername ? `shop.html?seller=${encodeURIComponent(state.sellerUsername)}` : "shop.html";
  }

  function syncPublicLinks() {
    $$("[data-public-store-link]").forEach(link => { link.href = publicStoreHref(); });
  }

  function syncMetrics() {
    const counts = { store: 0, inventory: 0, shows: 0, sold: 0 };
    state.items.forEach(item => { counts[listingChannel(item)] += 1; });
    Object.entries(counts).forEach(([key, value]) => {
      const node = $(`[data-metric-${key}]`);
      if (node) node.textContent = value.toLocaleString();
    });
  }

  function matchesStock(item) {
    const channel = listingChannel(item);
    if (state.channel !== "all" && channel !== state.channel) return false;
    if (!state.search) return true;
    const show = showForListing(item);
    return normalizeText([
      item.title,
      item.description,
      item.productCategoryLabel,
      item.productCategoryKey,
      item.condition,
      item.saleType,
      show?.title
    ].join(" ")).includes(state.search);
  }

  function sortedStock() {
    const rows = state.items.filter(matchesStock);
    return rows.sort((left, right) => {
      if (state.sort === "title") return String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" });
      if (state.sort === "price-low") return Number(left.priceCents || 0) - Number(right.priceCents || 0);
      if (state.sort === "price-high") return Number(right.priceCents || 0) - Number(left.priceCents || 0);
      if (state.sort === "quantity") return Number(right.quantity || 0) - Number(left.quantity || 0);
      return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
    });
  }

  function stockRow(item) {
    const channel = listingChannel(item);
    const show = showForListing(item);
    const image = safeImage(item.imageUrl);
    const locationLabel = channel === "store"
      ? "In Store"
      : channel === "shows"
        ? (show?.title || "Show")
        : channel === "sold" ? "Sold Out" : "Inventory";
    const nextAction = channel === "store"
      ? `<button type="button" data-quick-channel="inventory" data-listing-id="${escapeHtml(item.id)}">Move to Inventory</button>`
      : channel === "inventory"
        ? `<button type="button" data-quick-channel="store" data-listing-id="${escapeHtml(item.id)}" ${Number(item.quantity || 0) < 1 ? "disabled" : ""}>Publish</button>`
        : "";
    const showLink = channel === "shows" && item.showId
      ? `<a href="streams.html?show=${encodeURIComponent(item.showId)}#seller-live">Open Show</a>`
      : "";
    return `
      <div class="seller-stock-row" role="row">
        <div class="seller-stock-product" role="cell">
          ${image ? `<img src="${escapeHtml(image)}" alt="" width="58" height="58" loading="lazy" decoding="async">` : `<span class="seller-stock-image-placeholder">CP</span>`}
          <div><strong>${escapeHtml(item.title || "Product")}</strong><small>${escapeHtml(item.productCategoryLabel || pretty(item.productCategoryKey))} - ${escapeHtml(item.condition || "Condition pending")}</small></div>
        </div>
        <span class="seller-stock-location ${escapeHtml(channel)}" role="cell">${escapeHtml(locationLabel)}</span>
        <span class="seller-stock-price" role="cell">${escapeHtml(formatMoney(item.priceCents))}</span>
        <span class="seller-stock-quantity" role="cell">${Number(item.quantity || 0).toLocaleString()}</span>
        <div class="seller-stock-actions" role="cell">
          <button type="button" data-edit-listing="${escapeHtml(item.id)}">Edit</button>
          <button type="button" data-preview-listing="${escapeHtml(item.id)}">Preview</button>
          ${nextAction}${showLink}
        </div>
      </div>`;
  }

  function renderStock() {
    if (!stockList) return;
    const rows = sortedStock();
    stockList.innerHTML = rows.map(stockRow).join("");
    if (stockEmpty) stockEmpty.hidden = rows.length !== 0;
  }

  function previewCard(item) {
    const image = safeImage(item.imageUrl) || fallbackImage(item);
    const show = showForListing(item);
    const location = item.showId ? `Show: ${show?.title || "Assigned show"}` : "Public storefront";
    return `
      <article class="seller-preview-card">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(item.title || "Product")}" width="480" height="360" loading="lazy" decoding="async">
        <div class="seller-preview-card-body">
          <span class="card-kicker">${escapeHtml(item.productCategoryLabel || pretty(item.productCategoryKey))}</span>
          <h3>${escapeHtml(item.title || "Product")}</h3>
          <p>${escapeHtml(item.description || "Product details are being prepared.")}</p>
          <div class="seller-preview-meta"><span>${escapeHtml(formatMoney(item.priceCents))}</span><span>${Number(item.quantity || 0)} available</span></div>
          <small>${escapeHtml(location)}</small>
          <button class="btn btn-outline btn-small" type="button" data-edit-listing="${escapeHtml(item.id)}">Edit Product</button>
        </div>
      </article>`;
  }

  function renderPreview() {
    if (!previewGrid) return;
    const visible = state.items.filter(item => item.status === "active" && Number(item.quantity || 0) > 0);
    previewGrid.innerHTML = visible.map(previewCard).join("");
    if (previewEmpty) previewEmpty.hidden = visible.length !== 0;
  }

  function renderAll() {
    syncMetrics();
    syncPublicLinks();
    renderStock();
    renderPreview();
  }

  function setView(view, { updateHash = true } = {}) {
    state.view = view === "preview" ? "preview" : "stock";
    $$("[data-store-view]").forEach(panel => { panel.hidden = panel.dataset.storeView !== state.view; });
    $$("[data-store-view-button]").forEach(button => button.classList.toggle("is-active", button.dataset.storeViewButton === state.view));
    if (updateHash) history.replaceState({}, document.title, `${location.pathname}${location.search}#${state.view}`);
  }

  function setChannel(channel) {
    state.channel = ["all", "store", "inventory", "shows", "sold"].includes(channel) ? channel : "all";
    $$("[data-stock-channel]").forEach(button => button.classList.toggle("is-active", button.dataset.stockChannel === state.channel));
    setView("stock");
    renderStock();
  }

  function populateShows(selected = "") {
    if (!showSelect) return;
    const openShows = state.shows.filter(show => ["open", "live"].includes(String(show.status || "")));
    showSelect.innerHTML = `<option value="">Choose an open show</option>${openShows.map(show => `<option value="${escapeHtml(show.id)}">${escapeHtml(show.title || "Crack Packs show")}</option>`).join("")}`;
    if (selected && openShows.some(show => show.id === selected)) showSelect.value = selected;
  }

  function syncEditorFields() {
    const showChannel = channelSelect?.value === "shows";
    if (showField) showField.hidden = !showChannel;
    if (showSelect) showSelect.required = showChannel;
    const sellerPays = shippingPayer?.value === "seller";
    if (fixedShippingField) fixedShippingField.hidden = sellerPays;
    if (form?.elements.fixedShipping) form.elements.fixedShipping.required = !sellerPays;
  }

  function openEditor(itemId = "") {
    if (!modal || !form) return;
    const item = state.items.find(candidate => candidate.id === itemId) || null;
    form.reset();
    form.elements.listingId.value = item?.id || "";
    form.elements.title.value = item?.title || "";
    form.elements.productCategoryKey.value = item?.productCategoryKey || "tcg";
    form.elements.saleType.value = item?.saleType || "singles";
    form.elements.condition.value = item?.condition || "";
    form.elements.quantity.value = String(item ? Number(item.quantity || 0) : 1);
    form.elements.price.value = item ? (Number(item.priceCents || 0) / 100).toFixed(2) : "1.00";
    form.elements.channel.value = item ? listingChannel(item).replace("sold", "inventory") : "store";
    form.elements.shippingPayer.value = item?.shippingPayer || "buyer";
    form.elements.fixedShipping.value = (Number(item?.fixedShippingCents || 500) / 100).toFixed(2);
    form.elements.imageUrl.value = item?.imageUrl || "";
    form.elements.description.value = item?.description || "";
    populateShows(item?.showId || "");
    const editorTitle = $("[data-listing-editor-title]");
    const editorEyebrow = $("[data-listing-editor-eyebrow]");
    const submit = $("[data-listing-submit]");
    if (editorTitle) editorTitle.textContent = item ? "Edit Product" : "Add Product";
    if (editorEyebrow) editorEyebrow.textContent = item ? "Update product details" : "New inventory item";
    if (submit) submit.textContent = item ? "Save Changes" : "Save Product";
    setFormStatus("");
    syncEditorFields();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    form.elements.title.focus();
  }

  function closeEditor() {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function showWorkspace() {
    if (accessPanel) accessPanel.hidden = true;
    workspace.forEach(node => { node.hidden = false; });
    setView(state.view, { updateHash: false });
  }

  function showAccess(message) {
    workspace.forEach(node => { node.hidden = true; });
    if (accessPanel) accessPanel.hidden = false;
    setStatus(message, "error");
  }

  async function loadDashboard() {
    if (!token()) {
      showAccess("Sign in to load private seller stock.");
      return;
    }
    setStatus("Loading seller stock...");
    try {
      const [listingPayload, showPayload, portal] = await Promise.all([
        api("/seller/store-listings"),
        api("/seller/shows"),
        api("/portal/status")
      ]);
      if (!portal.sellerAccess) throw Object.assign(new Error("Complete seller verification and account activation before managing store stock."), { status: 403 });
      state.items = Array.isArray(listingPayload.items) ? listingPayload.items : [];
      state.shows = Array.isArray(showPayload.shows) ? showPayload.shows : [];
      state.sellerUsername = String(portal.sellerUsername || state.items[0]?.sellerUsername || "");
      showWorkspace();
      renderAll();
      setStatus(`${state.items.length.toLocaleString()} product${state.items.length === 1 ? "" : "s"} loaded.`, "success");
    } catch (error) {
      if ([401, 403].includes(error.status)) showAccess(error.message);
      else setStatus(error.message, "error");
    }
  }

  async function patchListing(itemId, body, successMessage) {
    const result = await api(`/seller/store-listings/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    const index = state.items.findIndex(item => item.id === itemId);
    if (index >= 0) state.items[index] = result.item;
    renderAll();
    setStatus(successMessage, "success");
  }

  $$("[data-store-view-button]").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.storeViewButton));
  });

  $$("[data-channel-jump]").forEach(button => {
    button.addEventListener("click", () => setChannel(button.dataset.channelJump));
  });

  $$("[data-stock-channel]").forEach(button => {
    button.addEventListener("click", () => setChannel(button.dataset.stockChannel));
  });

  $("[data-stock-search]")?.addEventListener("input", event => {
    state.search = normalizeText(event.currentTarget.value);
    window.clearTimeout(event.currentTarget._stockSearchTimer);
    event.currentTarget._stockSearchTimer = window.setTimeout(renderStock, 60);
  });

  $("[data-stock-sort]")?.addEventListener("change", event => {
    state.sort = String(event.currentTarget.value || "updated");
    renderStock();
  });

  $("[data-add-listing]")?.addEventListener("click", () => openEditor());

  [stockList, previewGrid].filter(Boolean).forEach(container => {
    container.addEventListener("click", async event => {
      const edit = event.target.closest("[data-edit-listing]");
      const preview = event.target.closest("[data-preview-listing]");
      const quick = event.target.closest("[data-quick-channel]");
      if (edit) {
        openEditor(edit.dataset.editListing);
        return;
      }
      if (preview) {
        setView("preview");
        document.querySelector("[data-store-view='preview']")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (!quick) return;
      quick.disabled = true;
      try {
        const store = quick.dataset.quickChannel === "store";
        await patchListing(quick.dataset.listingId, {
          status: store ? "active" : "inactive",
          showId: ""
        }, store ? "Product published to the buyer store." : "Product moved to private inventory.");
      } catch (error) {
        quick.disabled = false;
        setStatus(error.message, "error");
      }
    });
  });

  $$("[data-listing-close]").forEach(button => button.addEventListener("click", closeEditor));
  channelSelect?.addEventListener("change", syncEditorFields);
  shippingPayer?.addEventListener("change", syncEditorFields);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal && !modal.hidden) closeEditor();
  });

  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = event.submitter || $("[data-listing-submit]");
    const data = new FormData(form);
    const itemId = String(data.get("listingId") || "");
    const channel = String(data.get("channel") || "store");
    const showId = channel === "shows" ? String(data.get("showId") || "") : "";
    if (channel === "shows" && !showId) {
      setFormStatus("Choose an open show for show stock.", "error");
      showSelect?.focus();
      return;
    }
    const quantity = Number(data.get("quantity"));
    if (!itemId && quantity < 1) {
      setFormStatus("New products need at least one unit.", "error");
      form.elements.quantity.focus();
      return;
    }
    const body = {
      title: String(data.get("title") || ""),
      productCategoryKey: String(data.get("productCategoryKey") || "tcg"),
      saleType: String(data.get("saleType") || "singles"),
      condition: String(data.get("condition") || ""),
      quantity,
      price: Number(data.get("price")),
      status: channel === "inventory" ? "inactive" : "active",
      showId,
      shippingPayer: String(data.get("shippingPayer") || "buyer"),
      fixedShipping: Number(data.get("fixedShipping") || 0),
      imageUrl: String(data.get("imageUrl") || ""),
      description: String(data.get("description") || "")
    };
    submit.disabled = true;
    setFormStatus(itemId ? "Saving product changes..." : "Adding product...");
    try {
      const result = itemId
        ? await api(`/seller/store-listings/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api("/seller/store-listings", { method: "POST", body: JSON.stringify(body) });
      const index = state.items.findIndex(item => item.id === result.item?.id);
      if (index >= 0) state.items[index] = result.item;
      else if (result.item) state.items.unshift(result.item);
      if (!state.sellerUsername && result.item?.sellerUsername) state.sellerUsername = result.item.sellerUsername;
      renderAll();
      closeEditor();
      setStatus(itemId ? "Product details updated." : "Product added to stock.", "success");
    } catch (error) {
      setFormStatus(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  window.addEventListener("hashchange", () => setView(location.hash === "#preview" ? "preview" : "stock", { updateHash: false }));
  setView(state.view, { updateHash: false });
  loadDashboard();
})();
