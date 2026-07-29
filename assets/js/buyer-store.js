(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const PAGE_SIZE = 36;
  const CACHE_KEY = "cp_marketplace_catalog_v4";
  const CACHE_TTL_MS = 60_000;
  const params = new URLSearchParams(location.search);
  const requestedSellerLabel = String(params.get("seller") || "").trim().replace(/^@/, "").slice(0, 80);
  const requestedSeller = requestedSellerLabel.toLowerCase();
  const catalog = document.querySelector("[data-store-catalog]");
  if (!catalog) return;

  const statusNode = document.querySelector("[data-store-catalog-status]");
  const emptyNode = document.querySelector("[data-product-empty]");
  const searchInput = document.querySelector("[data-product-search]");
  const suggestionsNode = document.querySelector("[data-product-suggestions]");
  const sortSelect = document.querySelector("[data-marketplace-sort]");
  const seriesTabs = document.querySelector("[data-store-series-tabs]");
  const primaryTabs = document.querySelector("[data-store-primary-tabs]");
  const subcategorySelect = document.querySelector("[data-subcategory-filter]");
  const sellerInput = document.querySelector("[data-seller-search]");
  const priceMinInput = document.querySelector("[data-price-min]");
  const priceMaxInput = document.querySelector("[data-price-max]");
  const priceIncrementSelect = document.querySelector("[data-price-increment]");
  const priceReadout = document.querySelector("[data-price-range-readout]");
  const filterSummary = document.querySelector("[data-filter-summary]");
  const loadMoreButton = document.querySelector("[data-marketplace-more]");
  const topItemsGrid = document.querySelector("[data-top-ten-grid]");
  const topItemsWindow = document.querySelector("[data-top-ten-window]");
  const detailsModal = document.querySelector("[data-store-show-modal]");
  const detailsResults = document.querySelector("[data-store-show-results]");
  const detailsCopy = document.querySelector("[data-store-show-copy]");

  const state = {
    items: [],
    filtered: [],
    visibleCount: PAGE_SIZE,
    search: "",
    seller: requestedSeller,
    category: "all",
    series: "all",
    primary: "all",
    subcategory: "all",
    minPrice: 0,
    maxPrice: 1000,
    sort: String(sortSelect?.value || "rank"),
    source: "live",
    controller: null,
    renderFrame: 0
  };

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

  const safeAssetUrl = value => {
    const raw = String(value || "").trim();
    if (/^https:\/\//i.test(raw)) return raw;
    if (/^assets\/images\/[a-z0-9._/-]+$/i.test(raw)) return raw;
    return "";
  };

  const safeLink = (value, fallback = "") => {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    try {
      const url = new URL(raw, location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    } catch {
      return fallback;
    }
  };

  const formatMoney = cents => {
    const amount = Number(cents);
    if (!Number.isFinite(amount)) return "Price pending";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount / 100);
  };

  const classifyCategory = value => {
    const text = normalizeText(value);
    if (text.includes("japan")) return "japanese";
    if (/(single|slab|graded|card)/.test(text)) return "singles";
    if (/(pack|bundle|blister)/.test(text)) return "packs";
    return "sealed";
  };

  const inferSubcategory = item => {
    const text = normalizeText(`${item.title || ""} ${item.saleType || ""} ${item.productCategoryKey || ""}`);
    const patterns = [
      ["elite_trainer_box", /elite trainer|\betb\b/],
      ["booster_box", /booster box/],
      ["booster_pack", /booster pack|blister/],
      ["graded_card", /graded|slab/],
      ["single_card", /single|card/],
      ["memorabilia", /signed|jersey|hat|pennant|memorabilia/]
    ];
    return patterns.find(([, pattern]) => pattern.test(text))?.[0] || String(item.saleType || "other");
  };

  const fallbackImage = category => ({
    sealed: "assets/images/product-electric.svg",
    packs: "assets/images/product-cosmic.svg",
    japanese: "assets/images/product-aurora.svg",
    singles: "assets/images/product-vintage.svg"
  }[category] || "assets/images/product-cosmic.svg");

  function normalizeListing(item, index = 0) {
    const category = classifyCategory(`${item.saleType || ""} ${item.title || ""}`);
    const sellerUsername = String(item.sellerUsername || "CrackPacks").trim();
    const normalized = {
      id: String(item.id || `preview-${index + 1}`),
      title: String(item.title || item.name || "Store listing").trim(),
      description: String(item.description || "Product details are being prepared.").trim(),
      category,
      series: normalizeText(item.series || "other").replace(/\s+/g, "_"),
      primary: normalizeText(item.productCategoryKey || "tcg").replace(/\s+/g, "_"),
      primaryLabel: String(item.productCategoryLabel || pretty(item.productCategoryKey || "tcg")),
      subcategory: normalizeText(item.subcategory || inferSubcategory(item)).replace(/\s+/g, "_"),
      sellerUsername,
      sellerKey: normalizeText(sellerUsername),
      condition: String(item.condition || "").trim(),
      saleType: String(item.saleType || "sealed").trim(),
      quantity: Math.max(0, Number(item.quantity || 0)),
      priceCents: Number.isFinite(Number(item.priceCents)) ? Number(item.priceCents) : null,
      shippingPayer: String(item.shippingPayer || "buyer"),
      fixedShippingCents: Math.max(0, Number(item.fixedShippingCents || 0)),
      imageUrl: safeAssetUrl(item.imageUrl) || fallbackImage(category),
      createdAt: String(item.createdAt || item.updatedAt || ""),
      rank: Number(item.rank || item.salesRank || index + 1),
      liveShow: item.liveShow || null,
      preview: Boolean(item.preview)
    };
    normalized.searchText = normalizeText([
      normalized.title,
      normalized.description,
      normalized.primaryLabel,
      normalized.subcategory,
      normalized.sellerUsername,
      normalized.condition,
      normalized.saleType,
      normalized.series
    ].join(" "));
    return normalized;
  }

  function fallbackListings() {
    return (window.CRACKPACKS_PRODUCTS || [])
      .filter(item => item?.enabled !== false)
      .map((item, index) => normalizeListing({
        id: item.id,
        title: item.name,
        description: item.description,
        saleType: item.category || item.type,
        productCategoryKey: item.series || "tcg",
        productCategoryLabel: item.type || item.category,
        quantity: 0,
        imageUrl: item.image,
        sellerUsername: "CrackPacks",
        preview: true
      }, index));
  }

  function setStatus(message, status = "") {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.dataset.state = status;
  }

  function applyStorefrontContext() {
    if (!requestedSeller) return;
    const label = `@${requestedSellerLabel}`;
    document.title = `${label} Store | Crack Packs`;
    const context = document.querySelector("[data-seller-storefront-context]");
    if (context) context.hidden = false;
    document.querySelectorAll("[data-marketplace-only]").forEach(node => { node.hidden = true; });
    const title = document.querySelector("[data-seller-storefront-title]");
    const heroEyebrow = document.querySelector("[data-store-hero-eyebrow]");
    const heroTitle = document.querySelector("[data-store-hero-title]");
    const heroCopy = document.querySelector("[data-store-hero-copy]");
    if (title) title.textContent = `${label}'s Store`;
    if (heroEyebrow) heroEyebrow.textContent = "Verified seller storefront";
    if (heroTitle) heroTitle.textContent = `${label} Store`;
    if (heroCopy) heroCopy.textContent = "Browse this seller's active listings and inventory connected to upcoming or live shows.";
    if (sellerInput) {
      sellerInput.value = requestedSellerLabel;
      sellerInput.readOnly = true;
    }
  }

  function renderTopItems() {
    if (!topItemsGrid) return;
    const windowKey = String(topItemsWindow?.value || "1hr");
    const rows = Array.isArray(window.CRACKPACKS_TOP_ITEMS?.[windowKey])
      ? window.CRACKPACKS_TOP_ITEMS[windowKey].slice(0, 10)
      : [];
    topItemsGrid.innerHTML = rows.map((item, index) => {
      const title = item.name || item.title || "Trending listing";
      const seller = item.seller || (item.sellerUsername ? `@${item.sellerUsername}` : "@CrackPacks");
      const price = item.price || (Number.isFinite(Number(item.priceCents)) ? formatMoney(item.priceCents) : "View listing");
      const query = new URLSearchParams({ q: title });
      return `
        <a class="top-ten-card" href="shop.html?${query.toString()}">
          <span class="top-ten-rank">#${index + 1}</span>
          <span class="top-ten-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(seller)}</small></span>
          <span class="top-ten-meta"><strong>${escapeHtml(price)}</strong><small>${escapeHtml(item.windowLabel || windowKey)}</small></span>
        </a>`;
    }).join("");
  }

  function renderPrimaryTabs(categories = []) {
    if (!primaryTabs) return;
    const values = new Map([["all", "All categories"]]);
    categories.forEach(category => values.set(String(category.key || "tcg"), String(category.label || pretty(category.key))));
    state.items.forEach(item => values.set(item.primary, item.primaryLabel));
    primaryTabs.innerHTML = [...values].map(([key, label], index) => `
      <button class="type-pill${index === 0 ? " is-active" : ""}" type="button" data-store-primary="${escapeHtml(key)}">
        <span><strong>${escapeHtml(label)}</strong><small>${key === "all" ? "Every seller category" : "Browse inventory"}</small></span>
      </button>`).join("");
  }

  function renderSeriesTabs() {
    if (!seriesTabs) return;
    const values = new Map([["all", "All series"]]);
    state.items.forEach(item => {
      if (item.series && item.series !== "other") values.set(item.series, pretty(item.series));
    });
    seriesTabs.innerHTML = [...values].map(([key, label], index) => `
      <button class="type-pill${index === 0 ? " is-active" : ""}" type="button" data-store-series="${escapeHtml(key)}">
        <span><strong>${escapeHtml(label)}</strong><small>${key === "all" ? "Every game and series" : "Series inventory"}</small></span>
      </button>`).join("");
  }

  function syncSubcategories() {
    if (!subcategorySelect) return;
    const values = [...new Set(state.items
      .filter(item => state.primary === "all" || item.primary === state.primary)
      .map(item => item.subcategory)
      .filter(Boolean))]
      .sort((left, right) => pretty(left).localeCompare(pretty(right)));
    subcategorySelect.innerHTML = `<option value="all">All subcategories</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(pretty(value))}</option>`).join("")}`;
    if (!values.includes(state.subcategory)) state.subcategory = "all";
    subcategorySelect.value = state.subcategory;
  }

  function syncPriceControls() {
    const highest = Math.max(100, ...state.items.map(item => Math.ceil(Number(item.priceCents || 0) / 100)));
    [priceMinInput, priceMaxInput].forEach(input => {
      if (!input) return;
      input.max = String(highest);
      input.step = String(Number(priceIncrementSelect?.value || 1));
    });
    if (priceMaxInput) priceMaxInput.value = String(highest);
    state.maxPrice = highest;
    updatePriceReadout();
  }

  function updatePriceReadout() {
    if (!priceReadout) return;
    priceReadout.textContent = `${formatMoney(state.minPrice * 100)} - ${formatMoney(state.maxPrice * 100)}`;
  }

  function productCard(item) {
    const sellerHref = `shop.html?seller=${encodeURIComponent(item.sellerUsername)}`;
    const liveHref = safeLink(item.liveShow?.livePageUrl, item.liveShow?.showId ? `live.html?show=${encodeURIComponent(item.liveShow.showId)}` : "");
    const shipping = item.shippingPayer === "seller"
      ? "Seller-paid shipping"
      : `${item.fixedShippingCents ? `${formatMoney(item.fixedShippingCents)} fixed shipping` : "Buyer-paid shipping"}`;
    const quantity = item.quantity > 0 ? `${item.quantity} available` : (item.preview ? "Catalog preview" : "Sold out");
    return `
      <article class="product-card store-product-card" data-product-card data-listing-id="${escapeHtml(item.id)}">
        <div class="product-media">
          <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" width="480" height="360" loading="lazy" decoding="async">
          <span class="product-badge">${escapeHtml(quantity)}</span>
          <span class="holo-sheen" aria-hidden="true"></span>
        </div>
        <div class="product-body">
          <p class="card-kicker">${escapeHtml(item.primaryLabel)}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="store-market-meta"><a href="${escapeHtml(sellerHref)}">@${escapeHtml(item.sellerUsername)}</a>${item.condition ? `<span>${escapeHtml(item.condition)}</span>` : ""}</p>
          <p class="product-description">${escapeHtml(item.description)}</p>
          <div class="store-listing-facts"><span>${escapeHtml(pretty(item.saleType))}</span><span>${escapeHtml(shipping)}</span></div>
          <div class="product-footer">
            <div class="store-price-stack"><strong class="store-current-price">${escapeHtml(formatMoney(item.priceCents))}</strong><span class="store-shipping-label">${escapeHtml(shipping)}</span></div>
            <button class="store-checkout-button" type="button" data-listing-details="${escapeHtml(item.id)}">View details</button>
          </div>
          <div class="store-card-actions">
            <a class="btn btn-outline btn-small" href="${escapeHtml(sellerHref)}">Seller store</a>
            ${liveHref ? `<a class="btn btn-primary btn-small" href="${escapeHtml(liveHref)}">${item.liveShow?.showStatus === "live" ? "Watch live" : "View show"}</a>` : ""}
          </div>
        </div>
      </article>`;
  }

  function sortedFilteredItems() {
    const queryTokens = state.search.split(/\s+/).filter(Boolean);
    const rows = state.items.filter(item => {
      if (requestedSeller && item.sellerKey !== requestedSeller) return false;
      if (state.seller && !item.sellerKey.includes(state.seller)) return false;
      if (state.category !== "all" && item.category !== state.category) return false;
      if (state.series !== "all" && item.series !== state.series) return false;
      if (state.primary !== "all" && item.primary !== state.primary) return false;
      if (state.subcategory !== "all" && item.subcategory !== state.subcategory) return false;
      const price = Number(item.priceCents || 0) / 100;
      if (item.priceCents !== null && (price < state.minPrice || price > state.maxPrice)) return false;
      return queryTokens.every(token => item.searchText.includes(token));
    });
    const conditionRank = value => {
      const ranking = ["mint", "near mint", "light play", "moderate play", "heavy play", "damaged"];
      const index = ranking.indexOf(normalizeText(value));
      return index < 0 ? 999 : index;
    };
    return rows.sort((left, right) => {
      if (state.sort === "alpha") return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
      if (state.sort === "newest") return right.createdAt.localeCompare(left.createdAt);
      if (state.sort === "oldest") return left.createdAt.localeCompare(right.createdAt);
      if (state.sort === "price-low") return Number(left.priceCents ?? Infinity) - Number(right.priceCents ?? Infinity);
      if (state.sort === "price-high") return Number(right.priceCents ?? -1) - Number(left.priceCents ?? -1);
      if (state.sort === "condition") return conditionRank(left.condition) - conditionRank(right.condition);
      if (state.sort === "seller") return left.sellerUsername.localeCompare(right.sellerUsername, undefined, { sensitivity: "base" });
      return left.rank - right.rank;
    });
  }

  function renderSuggestions() {
    if (!suggestionsNode) return;
    if (state.search.length < 2) {
      suggestionsNode.hidden = true;
      suggestionsNode.innerHTML = "";
      return;
    }
    const matches = state.items
      .filter(item => item.searchText.includes(state.search))
      .slice(0, 6);
    suggestionsNode.innerHTML = matches.map(item => `
      <button type="button" data-suggestion="${escapeHtml(item.title)}">
        <strong>${escapeHtml(item.title)}</strong><span>@${escapeHtml(item.sellerUsername)} - ${escapeHtml(formatMoney(item.priceCents))}</span>
      </button>`).join("");
    suggestionsNode.hidden = matches.length === 0;
  }

  function renderFilterSummary() {
    if (!filterSummary) return;
    const chips = [];
    if (state.search) chips.push(`Search: ${state.search}`);
    if (state.primary !== "all") chips.push(pretty(state.primary));
    if (state.series !== "all") chips.push(pretty(state.series));
    if (state.category !== "all") chips.push(pretty(state.category));
    if (state.subcategory !== "all") chips.push(pretty(state.subcategory));
    if (state.seller && !requestedSeller) chips.push(`Seller: ${state.seller}`);
    filterSummary.innerHTML = chips.length
      ? `<span>Applied filters</span>${chips.map(chip => `<strong>${escapeHtml(chip)}</strong>`).join("")}<button type="button" data-clear-filters>Clear</button>`
      : "<span>All active seller inventory</span>";
  }

  function renderResults({ reset = false } = {}) {
    if (reset) state.visibleCount = PAGE_SIZE;
    state.filtered = sortedFilteredItems();
    const visible = state.filtered.slice(0, state.visibleCount);
    catalog.innerHTML = visible.map(productCard).join("");
    if (emptyNode) emptyNode.hidden = state.filtered.length !== 0;
    if (loadMoreButton) {
      loadMoreButton.hidden = visible.length >= state.filtered.length;
      loadMoreButton.textContent = `Load more listings (${Math.min(PAGE_SIZE, state.filtered.length - visible.length)} next)`;
    }
    renderSuggestions();
    renderFilterSummary();
    const sourceLabel = state.source === "preview" ? "preview products" : "seller listings";
    setStatus(
      `${state.filtered.length.toLocaleString()} matching ${sourceLabel}. Showing ${visible.length.toLocaleString()}.`,
      state.source === "preview" ? "fallback" : "success"
    );
  }

  function scheduleRender({ reset = true } = {}) {
    cancelAnimationFrame(state.renderFrame);
    state.renderFrame = requestAnimationFrame(() => renderResults({ reset }));
  }

  function openDetails(itemId) {
    const item = state.items.find(candidate => candidate.id === itemId);
    if (!item || !detailsModal || !detailsResults) return;
    const sellerHref = `shop.html?seller=${encodeURIComponent(item.sellerUsername)}`;
    const liveHref = safeLink(item.liveShow?.livePageUrl, item.liveShow?.showId ? `live.html?show=${encodeURIComponent(item.liveShow.showId)}` : "");
    const shipping = item.shippingPayer === "seller"
      ? "Seller pays shipping"
      : `${item.fixedShippingCents ? formatMoney(item.fixedShippingCents) : "Buyer-calculated"} shipping`;
    if (detailsCopy) detailsCopy.textContent = `${item.title} from @${item.sellerUsername}.`;
    detailsResults.innerHTML = `
      <article class="store-detail-layout">
        <div class="store-detail-media"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" width="640" height="480"></div>
        <div class="store-detail-copy">
          <p class="card-kicker">${escapeHtml(item.primaryLabel)}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description)}</p>
          <dl>
            <div><dt>Seller</dt><dd>@${escapeHtml(item.sellerUsername)}</dd></div>
            <div><dt>Price</dt><dd>${escapeHtml(formatMoney(item.priceCents))}</dd></div>
            <div><dt>Condition</dt><dd>${escapeHtml(item.condition || "Not specified")}</dd></div>
            <div><dt>Available</dt><dd>${item.quantity.toLocaleString()}</dd></div>
            <div><dt>Shipping</dt><dd>${escapeHtml(shipping)}</dd></div>
            <div><dt>Sale type</dt><dd>${escapeHtml(pretty(item.saleType))}</dd></div>
          </dl>
          <div class="store-show-card-actions">
            <a class="btn btn-outline" href="${escapeHtml(sellerHref)}">Open seller store</a>
            ${liveHref ? `<a class="btn btn-primary" href="${escapeHtml(liveHref)}">${item.liveShow?.showStatus === "live" ? "Watch live show" : "Open connected show"}</a>` : `<a class="btn btn-primary" href="live-shows.html">Browse live shows</a>`}
          </div>
        </div>
      </article>`;
    detailsModal.hidden = false;
    detailsModal.setAttribute("aria-hidden", "false");
    detailsModal.querySelector("[data-store-show-close]")?.focus();
  }

  function closeDetails() {
    if (!detailsModal) return;
    detailsModal.hidden = true;
    detailsModal.setAttribute("aria-hidden", "true");
  }

  function resetFilters() {
    state.search = "";
    state.seller = requestedSeller;
    state.category = "all";
    state.series = "all";
    state.primary = "all";
    state.subcategory = "all";
    state.minPrice = 0;
    state.sort = "rank";
    if (searchInput) searchInput.value = "";
    if (sellerInput) sellerInput.value = requestedSellerLabel;
    if (sortSelect) sortSelect.value = "rank";
    if (priceMinInput) priceMinInput.value = "0";
    document.querySelectorAll("[data-product-filter]").forEach(button => button.classList.toggle("is-active", button.dataset.productFilter === "all"));
    primaryTabs?.querySelectorAll("[data-store-primary]").forEach(button => button.classList.toggle("is-active", button.dataset.storePrimary === "all"));
    seriesTabs?.querySelectorAll("[data-store-series]").forEach(button => button.classList.toggle("is-active", button.dataset.storeSeries === "all"));
    syncSubcategories();
    updatePriceReadout();
    scheduleRender();
  }

  function bindControls() {
    searchInput?.addEventListener("input", event => {
      state.search = normalizeText(event.currentTarget.value);
      scheduleRender();
    });
    suggestionsNode?.addEventListener("click", event => {
      const button = event.target.closest("[data-suggestion]");
      if (!button || !searchInput) return;
      searchInput.value = button.dataset.suggestion || "";
      state.search = normalizeText(searchInput.value);
      scheduleRender();
    });
    primaryTabs?.addEventListener("click", event => {
      const button = event.target.closest("[data-store-primary]");
      if (!button) return;
      state.primary = button.dataset.storePrimary || "all";
      primaryTabs.querySelectorAll("[data-store-primary]").forEach(node => node.classList.toggle("is-active", node === button));
      syncSubcategories();
      scheduleRender();
    });
    seriesTabs?.addEventListener("click", event => {
      const button = event.target.closest("[data-store-series]");
      if (!button) return;
      state.series = button.dataset.storeSeries || "all";
      seriesTabs.querySelectorAll("[data-store-series]").forEach(node => node.classList.toggle("is-active", node === button));
      scheduleRender();
    });
    document.querySelectorAll("[data-product-filter]").forEach(button => {
      button.addEventListener("click", () => {
        state.category = button.dataset.productFilter || "all";
        document.querySelectorAll("[data-product-filter]").forEach(node => node.classList.toggle("is-active", node === button));
        scheduleRender();
      });
    });
    sortSelect?.addEventListener("change", event => {
      state.sort = String(event.currentTarget.value || "rank");
      scheduleRender();
    });
    subcategorySelect?.addEventListener("change", event => {
      state.subcategory = String(event.currentTarget.value || "all");
      scheduleRender();
    });
    sellerInput?.addEventListener("input", event => {
      state.seller = normalizeText(event.currentTarget.value);
      scheduleRender();
    });
    priceIncrementSelect?.addEventListener("change", event => {
      const step = String(event.currentTarget.value || "1");
      [priceMinInput, priceMaxInput].forEach(input => { if (input) input.step = step; });
    });
    priceMinInput?.addEventListener("input", event => {
      state.minPrice = Math.min(Number(event.currentTarget.value || 0), state.maxPrice);
      updatePriceReadout();
      scheduleRender();
    });
    priceMaxInput?.addEventListener("input", event => {
      state.maxPrice = Math.max(Number(event.currentTarget.value || 0), state.minPrice);
      updatePriceReadout();
      scheduleRender();
    });
    loadMoreButton?.addEventListener("click", () => {
      state.visibleCount += PAGE_SIZE;
      renderResults();
    });
    filterSummary?.addEventListener("click", event => {
      if (event.target.closest("[data-clear-filters]")) resetFilters();
    });
    catalog.addEventListener("click", event => {
      const button = event.target.closest("[data-listing-details]");
      if (button) openDetails(button.dataset.listingDetails);
    });
    detailsModal?.addEventListener("click", event => {
      if (event.target.closest("[data-store-show-close]")) closeDetails();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && detailsModal && !detailsModal.hidden) closeDetails();
    });
    topItemsWindow?.addEventListener("change", renderTopItems);
  }

  function hydrate(items, categories = [], source = "live") {
    state.items = items;
    state.source = source;
    renderPrimaryTabs(categories);
    renderSeriesTabs();
    syncSubcategories();
    syncPriceControls();
    renderResults({ reset: true });
  }

  function readCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL_MS || !Array.isArray(cached.items)) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function writeCache(payload) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        items: payload.items || [],
        categories: payload.categories || []
      }));
    } catch {}
  }

  async function loadCatalog() {
    const base = String(config.rewardsApiUrl || "").trim().replace(/\/+$/, "");
    const cache = readCache();
    if (cache) hydrate(cache.items.map(normalizeListing), cache.categories, "live");
    if (!base) {
      if (!cache) hydrate(fallbackListings(), [], "preview");
      setStatus("The live marketplace service is not configured. Showing a catalog preview.", "fallback");
      return;
    }
    state.controller?.abort();
    state.controller = new AbortController();
    const timeout = window.setTimeout(() => state.controller.abort(), 8000);
    if (!cache) setStatus("Loading current seller inventory...", "loading");
    try {
      const response = await fetch(`${base}/marketplace/listings`, {
        headers: { Accept: "application/json" },
        signal: state.controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(payload.error || "Marketplace inventory is unavailable.");
      const rows = Array.isArray(payload.items) ? payload.items : [];
      writeCache(payload);
      hydrate(rows.map(normalizeListing), Array.isArray(payload.categories) ? payload.categories : [], "live");
      if (!rows.length) setStatus(requestedSeller ? `@${requestedSellerLabel} has no active listings.` : "No active seller listings are available yet.", "success");
    } catch (error) {
      if (error?.name === "AbortError" && cache) return;
      if (!cache) hydrate(fallbackListings(), [], "preview");
      setStatus(cache ? "Showing recently loaded inventory while the live service reconnects." : "The marketplace could not be reached. Showing a catalog preview.", "fallback");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const initialQuery = String(params.get("q") || "").trim();
  if (initialQuery && searchInput) {
    searchInput.value = initialQuery;
    state.search = normalizeText(initialQuery);
  }
  applyStorefrontContext();
  bindControls();
  renderTopItems();
  loadCatalog();
})();
