(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const page = document.body?.dataset.storeMarket || "us";
  const market = page === "international" ? "international" : "us";
  const catalog = document.querySelector("[data-store-catalog]");
  const catalogStatus = document.querySelector("[data-store-catalog-status]");
  const emptyState = document.querySelector("[data-product-empty]");
  const searchInput = document.querySelector("[data-product-search]");
  const sortSelect = document.querySelector("[data-product-sort]");
  const currencySelect = document.querySelector("[data-store-currency]");
  const inventoryEndpoint = "/store/inventory";
  const quoteEndpoint = "/store/shipping-quote";
  const checkoutEndpoint = "/store/checkout";
  const fallbackImages = {
    sealed: "assets/images/product-electric.svg",
    packs: "assets/images/product-cosmic.svg",
    japanese: "assets/images/product-aurora.svg",
    singles: "assets/images/product-vintage.svg"
  };

  let inventoryItems = [];
  let activeFilter = "all";
  let activeSearch = "";
  let activeSort = "recent";
  let catalogController = null;
  let storeComingSoon = true;
  let checkoutEnabled = false;
  let stripeBuyButtonScriptAdded = false;
  let shippingTurnstileToken = "";
  let shippingTurnstileWidgetId = null;
  let shippingTurnstileScriptAdded = false;

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));

  const rewardsUrl = path => {
    const base = String(config.rewardsApiUrl || "").trim().replace(/\/+$/, "");
    return base ? `${base}${path}` : "";
  };

  const centsValue = value => {
    if (value === null || value === undefined || value === "") return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
  };

  const formatMoney = (cents, currency = "USD") => {
    const amount = centsValue(cents);
    if (amount === null) return "";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: String(currency || "USD").toUpperCase(),
        currencyDisplay: "narrowSymbol"
      }).format(amount / 100);
    } catch (_) {
      return `${String(currency || "USD").toUpperCase()} ${(amount / 100).toFixed(2)}`;
    }
  };

  const classifyCategory = value => {
    const category = String(value || "").trim().toLowerCase();
    if (/japan/.test(category)) return "japanese";
    if (/single|slab|card/.test(category)) return "singles";
    if (/pack|bundle|blister/.test(category)) return "packs";
    return "sealed";
  };

  const safeSourceUrl = value => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  };

  function ensureSearchSuggestions() {
    if (!searchInput) return null;
    let suggestions = document.querySelector("[data-store-search-suggestions]");
    if (suggestions) return suggestions;
    const parent = searchInput.closest(".search-box") || searchInput.parentElement;
    if (parent) parent.classList.add("store-search-box");
    if (parent && !parent.querySelector(".store-search-title")) {
      const title = document.createElement("span");
      title.className = "store-search-title";
      title.textContent = "Search inventory";
      parent.prepend(title);
    }
    suggestions = document.createElement("div");
    suggestions.className = "store-search-suggestions";
    suggestions.dataset.storeSearchSuggestions = "";
    suggestions.hidden = true;
    suggestions.id = "store-search-suggestions";
    searchInput.setAttribute("aria-autocomplete", "list");
    searchInput.setAttribute("aria-controls", suggestions.id);
    searchInput.setAttribute("aria-expanded", "false");
    parent?.append(suggestions);
    return suggestions;
  }

  function inferPackCount(item) {
    const text = `${item?.name || ""} ${item?.category || ""} ${item?.categoryLabel || ""} ${item?.description || ""}`.toLowerCase();
    const explicit = text.match(/(\d+)\s*[- ]?\s*pack/);
    if (explicit) return Number(explicit[1]);
    if (/booster box/.test(text) && /japan|japanese/.test(text)) return /high class|vstar|shiny treasure|terastal/.test(text) ? 10 : 30;
    if (/booster box/.test(text)) return 36;
    if (/booster bundle/.test(text)) return 6;
    if (/elite trainer box|etb/.test(text)) return 9;
    if (/build\s*&\s*battle/.test(text)) return 4;
    if (/premium collection/.test(text)) return 8;
    if (/sleeved booster|booster pack/.test(text)) return 1;
    return 0;
  }

  function inferCardCount(item, packs) {
    const text = `${item?.name || ""} ${item?.description || ""}`.toLowerCase();
    const explicit = text.match(/(\d+)\s*cards?/);
    if (explicit && !/40-card prerelease/.test(text)) return Number(explicit[1]);
    if (/build\s*&\s*battle/.test(text)) return 40 + packs * 10;
    if (!packs) return 0;
    return packs * (/japan|japanese/.test(text) && !/high class|mega dream|vstar|shiny treasure|terastal/.test(text) ? 5 : 10);
  }

  function releaseRank(item) {
    const text = `${item?.name || ""} ${item?.categoryLabel || ""}`.toLowerCase();
    const known = [
      [/pitch black|chaos rising|perfect order|mega dream|abyss eye|ninja spinner|munikis zero/, 202607],
      [/inferno x|mega brave|mega symphonia/, 202606],
      [/black bolt|white flare|glory of team rocket|destined rivals/, 202505],
      [/journey together|battle partners/, 202503],
      [/prismatic evolutions|terastal festival/, 202501],
      [/surging sparks/, 202411],
      [/stellar crown/, 202409],
      [/twilight masquerade|mask of change|crimson haze/, 202405],
      [/temporal forces/, 202403],
      [/paldean fates|shiny treasure/, 202401],
      [/pokemon 151/, 202309],
      [/obsidian flames|ruler of the black flame/, 202308],
      [/paldea evolved/, 202306],
      [/scarlet & violet base|scarlet-violet base/, 202303],
      [/crown zenith|vstar universe/, 202301],
      [/silver tempest/, 202211],
      [/lost origin/, 202209],
      [/pokemon go/, 202207],
      [/brilliant stars/, 202202],
      [/evolving skies/, 202108]
    ];
    const match = known.find(([pattern]) => pattern.test(text));
    return match ? match[1] : 0;
  }

  function enrichProduct(item, index = 0) {
    const packs = Number(item?.packCount ?? item?.packs ?? inferPackCount(item)) || 0;
    const cards = Number(item?.cardCount ?? item?.cards ?? inferCardCount(item, packs)) || 0;
    return {
      ...item,
      packCount: packs,
      cardCount: cards,
      releaseRank: Number(item?.releaseRank || 0) || releaseRank(item),
      soldCount: Number(item?.soldCount || item?.salesCount || 0) || 0,
      catalogIndex: index
    };
  }

  function normalizeApiItem(item, payload) {
    const category = classifyCategory(item?.category);
    const displayCurrency = String(item?.price?.currency || payload?.displayCurrency || "USD").toUpperCase();
    const msrpCurrency = String(item?.msrp?.currency || displayCurrency).toUpperCase();
    const displayPriceCents = centsValue(item?.price?.displayCents);
    const displayMsrpCents = centsValue(item?.msrp?.displayCents);
    return {
      slug: String(item?.slug || "").trim(),
      sku: String(item?.sku || "").trim(),
      name: String(item?.name || "Unlisted product").trim(),
      category,
      categoryLabel: String(item?.category || category).trim(),
      description: String(item?.description || "Product details will be posted before the store opens.").trim(),
      imageUrl: safeSourceUrl(item?.imageUrl) || fallbackImages[category],
      sourceUrl: safeSourceUrl(item?.sourceUrl),
      available: item?.available === true,
      quantityLabel: String(item?.quantityLabel || (item?.available ? "Availability will be confirmed" : "Coming soon")).trim(),
      priceCents: displayPriceCents ?? centsValue(item?.price?.usdCents),
      priceCurrency: displayPriceCents === null ? "USD" : displayCurrency,
      priceIncludesUsShipping: item?.price?.includesUsShipping === true,
      msrpCents: displayMsrpCents ?? centsValue(item?.msrp?.usdCents),
      msrpCurrency: displayMsrpCents === null ? "USD" : msrpCurrency,
      msrpLabel: String(item?.msrp?.label || "Average MSRP").trim(),
      msrpObservedAt: String(item?.msrp?.observedAt || "").trim(),
      paylink: item?.paylink && (item.paylink.url || item.paylink.buyButtonId) ? {
        url: safeSourceUrl(item.paylink.url),
        buyButtonId: String(item.paylink.buyButtonId || "").trim(),
        publishableKey: String(item.paylink.publishableKey || "").trim()
      } : null,
      productSpec: item?.productSpec || null,
      shippingReady: item?.shippingReady === true,
      isFallback: false
    };
  }

  function normalizeFallbackItem(item, index) {
    const category = classifyCategory(item?.category);
    return {
      slug: String(item?.id || `preview-${index + 1}`),
      sku: String(item?.sku || "").trim(),
      name: String(item?.name || "Store preview"),
      category,
      categoryLabel: String(item?.type || item?.category || "Product preview"),
      description: String(item?.description || "Product details will be posted before launch."),
      imageUrl: safeSourceUrl(item?.image) || fallbackImages[category],
      sourceUrl: "",
      available: false,
      quantityLabel: "Preview category",
      priceCents: null,
      priceCurrency: currencySelect?.value || "USD",
      priceIncludesUsShipping: market === "us",
      msrpCents: null,
      msrpCurrency: currencySelect?.value || "USD",
      msrpLabel: "Average MSRP to be posted",
      msrpObservedAt: "",
      paylink: null,
      productSpec: null,
      shippingReady: false,
      isFallback: true
    };
  }

  const fallbackInventory = () => (window.CRACKPACKS_PRODUCTS || [])
    .filter(item => item?.enabled !== false)
    .map(normalizeFallbackItem);

  function setCatalogStatus(message, state = "") {
    if (!catalogStatus) return;
    catalogStatus.textContent = message;
    catalogStatus.dataset.state = state;
  }

  function msrpMarkup(item) {
    const formatted = formatMoney(item.msrpCents, item.msrpCurrency);
    if (!formatted) return `<span>${escapeHtml(item.msrpLabel)}</span>`;
    const observed = item.msrpObservedAt ? ` · observed ${item.msrpObservedAt}` : "";
    return `<span>${escapeHtml(item.msrpLabel)}</span><span class="store-msrp-old" aria-label="Average MSRP ${escapeHtml(formatted)}${escapeHtml(observed)}">${escapeHtml(formatted)}</span>`;
  }

  function priceMarkup(item) {
    const price = formatMoney(item.priceCents, item.priceCurrency);
    if (!price) {
      return `<strong class="store-current-price">Price coming soon</strong><span class="store-shipping-label">${market === "us" ? "USA shipping will be included" : "Shipping is quoted separately"}</span>`;
    }
    const shipping = market === "us"
      ? (item.priceIncludesUsShipping ? "Free USA shipping included" : "Exact shipping calculated by address")
      : "Product price only · shipping quoted separately";
    return `<strong class="store-current-price">${escapeHtml(price)}</strong><span class="store-shipping-label">${escapeHtml(shipping)}</span>`;
  }

  function productSpecMarkup(item) {
    const spec = item.productSpec || {};
    const parts = [];
    if (Number(item.packCount) > 0) parts.push(`${Number(item.packCount)} pack${Number(item.packCount) === 1 ? "" : "s"}`);
    if (Number(item.cardCount) > 0) parts.push(`${Number(item.cardCount)} card${Number(item.cardCount) === 1 ? "" : "s"} est.`);
    if (Number(spec.sealedWeightOz) > 0) parts.push(`Sealed ${Number(spec.sealedWeightOz).toFixed(2)} oz`);
    if (Number(spec.packagingWeightOz) >= 0) parts.push(`Pack allowance ${(Number(spec.packagingWeightOz) / 16).toFixed(3)} lb`);
    if (Number(spec.packedWeightOz) > 0) parts.push(`Ship ${Number(spec.packedWeightOz).toFixed(2)} oz`);
    const dims = spec.packedDimensionsIn;
    if (dims && Number(dims.length) > 0 && Number(dims.width) > 0 && Number(dims.height) > 0) parts.push(`Box ${dims.length} x ${dims.width} x ${dims.height} in`);
    return parts.length ? `<p class="store-product-specs">${parts.map(escapeHtml).join(" / ")}</p>` : "";
  }

  function checkoutMarkup(item) {
    const paylink = item.paylink || {};
    if (!item.available) return `<button class="store-checkout-button" type="button" disabled aria-disabled="true">Sold out / off</button>`;
    if (paylink.url) return `<a class="store-checkout-button is-live" href="${escapeHtml(paylink.url)}" target="_blank" rel="noopener noreferrer">Add to cart + checkout</a>`;
    if (paylink.buyButtonId && paylink.publishableKey) return `<div class="store-stripe-buy-button"><stripe-buy-button buy-button-id="${escapeHtml(paylink.buyButtonId)}" publishable-key="${escapeHtml(paylink.publishableKey)}"></stripe-buy-button></div>`;
    return `<button class="store-checkout-button" type="button" disabled aria-disabled="true">Checkout coming soon</button>`;
  }

  function productCard(item) {
    const search = `${item.name} ${item.sku || ""} ${item.categoryLabel} ${item.description}`.toLowerCase();
    const livePaylink = item.available && (item.paylink?.url || (item.paylink?.buyButtonId && item.paylink?.publishableKey));
    const sourceLink = item.sourceUrl
      ? `<a class="store-source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Product source ↗</a>`
      : "";
    const quoteButton = item.slug && !livePaylink
      ? `<button class="btn btn-small btn-outline" type="button" data-quote-product="${escapeHtml(item.slug)}">${market === "international" ? "Estimate shipping" : "Choose shipping + checkout"}</button>`
      : "";
    const image = item.imageUrl
      ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" data-store-product-image>`
      : `<span class="store-product-placeholder">Crack Packs</span>`;
    return `
      <article class="product-card store-product-card${livePaylink ? " is-paylink-live" : ""} holo-panel reveal is-visible" data-product-card data-category="${escapeHtml(item.category)}" data-search="${escapeHtml(search)}" id="${escapeHtml(item.slug)}">
        <div class="product-media">
          ${image}
          <span class="product-badge">${escapeHtml(item.quantityLabel)}</span>
          <span class="holo-sheen" aria-hidden="true"></span>
        </div>
        <div class="product-body">
          <p class="card-kicker">${escapeHtml(item.categoryLabel)}</p>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="product-description">${escapeHtml(item.description)}</p>
          ${productSpecMarkup(item)}
          <div class="store-msrp-row">${msrpMarkup(item)}</div>
          ${sourceLink}
          <div class="product-footer">
            <div class="store-price-stack">${priceMarkup(item)}</div>
            ${checkoutMarkup(item)}
          </div>
          ${quoteButton}
        </div>
      </article>`;
  }

  function bindImageFallbacks() {
    catalog?.querySelectorAll("[data-store-product-image]").forEach(image => {
      image.addEventListener("error", () => {
        const replacement = document.createElement("span");
        replacement.className = "store-product-placeholder";
        replacement.textContent = "Crack Packs";
        image.replaceWith(replacement);
      }, { once: true });
    });
  }

  function ensureStripeBuyButtonScript(items) {
    if (stripeBuyButtonScriptAdded || !items.some(item => item.paylink?.buyButtonId && item.paylink?.publishableKey)) return;
    stripeBuyButtonScriptAdded = true;
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/buy-button.js";
    script.async = true;
    document.head.append(script);
  }

  function renderCatalog(items) {
    inventoryItems = items.map(enrichProduct);
    if (!catalog) return;
    catalog.innerHTML = sortedItems(inventoryItems).map(productCard).join("");
    ensureStripeBuyButtonScript(inventoryItems);
    bindImageFallbacks();
    populateShippingProducts(inventoryItems);
    applyFilters();
    renderSearchSuggestions();
  }

  function sortValuePrice(item) {
    return centsValue(item.priceCents) ?? centsValue(item.msrpCents) ?? Number.MAX_SAFE_INTEGER;
  }

  function sortedItems(items) {
    const copy = [...items];
    copy.sort((a, b) => {
      if (activeSort === "price_asc") return sortValuePrice(a) - sortValuePrice(b) || a.catalogIndex - b.catalogIndex;
      if (activeSort === "price_desc") return sortValuePrice(b) - sortValuePrice(a) || a.catalogIndex - b.catalogIndex;
      if (activeSort === "packs_desc") return Number(b.packCount || 0) - Number(a.packCount || 0) || a.catalogIndex - b.catalogIndex;
      if (activeSort === "cards_desc") return Number(b.cardCount || 0) - Number(a.cardCount || 0) || a.catalogIndex - b.catalogIndex;
      if (activeSort === "best_selling") return Number(b.soldCount || 0) - Number(a.soldCount || 0) || Number(b.available) - Number(a.available) || a.catalogIndex - b.catalogIndex;
      return Number(b.releaseRank || 0) - Number(a.releaseRank || 0) || a.catalogIndex - b.catalogIndex;
    });
    return copy;
  }

  function rerenderCatalog() {
    if (!catalog) return;
    catalog.innerHTML = sortedItems(inventoryItems).map(productCard).join("");
    ensureStripeBuyButtonScript(inventoryItems);
    bindImageFallbacks();
    populateShippingProducts(inventoryItems);
    applyFilters();
    renderSearchSuggestions();
  }

  function applyFilters() {
    const cards = [...document.querySelectorAll("[data-store-catalog] [data-product-card]")];
    let visible = 0;
    cards.forEach(card => {
      const categoryMatch = activeFilter === "all" || card.dataset.category === activeFilter;
      const searchMatch = !activeSearch || String(card.dataset.search || "").includes(activeSearch);
      const show = categoryMatch && searchMatch;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (emptyState) emptyState.hidden = visible !== 0;
  }

  function scoreSearchSuggestion(item, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return 0;
    const fields = [item.name, item.sku, item.categoryLabel, item.description].map(value => String(value || "").toLowerCase());
    let best = 0;
    for (const field of fields) {
      if (!field) continue;
      if (field === q) best = Math.max(best, 100);
      else if (field.startsWith(q)) best = Math.max(best, 88);
      else if (field.includes(q)) best = Math.max(best, 66);
      else {
        const tokens = q.split(/\s+/).filter(Boolean);
        const hits = tokens.filter(token => field.includes(token)).length;
        if (hits) best = Math.max(best, 28 + hits * 11);
      }
    }
    return best;
  }

  function renderSearchSuggestions() {
    const suggestions = ensureSearchSuggestions();
    if (!searchInput || !suggestions) return;
    const query = searchInput.value.trim();
    suggestions.replaceChildren();
    if (query.length < 2) {
      suggestions.hidden = true;
      searchInput.setAttribute("aria-expanded", "false");
      return;
    }
    const matches = sortedItems(inventoryItems)
      .map(item => ({ item, score: scoreSearchSuggestion(item, query) }))
      .filter(match => match.score > 0)
      .sort((a, b) => b.score - a.score || a.item.catalogIndex - b.item.catalogIndex)
      .slice(0, 8);
    if (!matches.length) {
      suggestions.innerHTML = `<div class="store-search-empty">No inventory match yet.</div>`;
    } else {
      matches.forEach(({ item }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = `<strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.sku ? `SKU ${item.sku}` : "", item.categoryLabel, item.packCount ? `${item.packCount} packs` : ""].filter(Boolean).join(" / "))}</span>`;
        button.addEventListener("click", () => {
          searchInput.value = item.name;
          activeSearch = item.name.toLowerCase();
          suggestions.hidden = true;
          searchInput.setAttribute("aria-expanded", "false");
          applyFilters();
          document.getElementById(item.slug)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        suggestions.append(button);
      });
    }
    suggestions.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  function bindFilters() {
    document.querySelectorAll("[data-product-filter]").forEach(button => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.productFilter || "all";
        document.querySelectorAll("[data-product-filter]").forEach(candidate => candidate.classList.toggle("is-active", candidate === button));
        applyFilters();
      });
    });
    searchInput?.addEventListener("input", event => {
      activeSearch = String(event.currentTarget.value || "").trim().toLowerCase();
      applyFilters();
      renderSearchSuggestions();
    });
    searchInput?.addEventListener("focus", renderSearchSuggestions);
    searchInput?.addEventListener("blur", () => setTimeout(() => {
      const suggestions = document.querySelector("[data-store-search-suggestions]");
      if (suggestions) suggestions.hidden = true;
      searchInput.setAttribute("aria-expanded", "false");
    }, 140));
    sortSelect?.addEventListener("change", event => {
      activeSort = String(event.currentTarget.value || "recent");
      rerenderCatalog();
    });
    const requested = String(new URLSearchParams(window.location.search).get("category") || "").toLowerCase();
    const requestedButton = [...document.querySelectorAll("[data-product-filter]")].find(button => button.dataset.productFilter === requested);
    if (requestedButton) {
      activeFilter = requested;
      document.querySelectorAll("[data-product-filter]").forEach(candidate => candidate.classList.toggle("is-active", candidate === requestedButton));
    }
  }

  function selectedCurrency() {
    return String(currencySelect?.value || "USD").toUpperCase();
  }

  async function loadCatalog() {
    const endpoint = rewardsUrl(inventoryEndpoint);
    if (!endpoint) {
      renderCatalog(fallbackInventory());
      setCatalogStatus("Live inventory is not connected. Showing the launch catalog preview.", "fallback");
      return;
    }

    catalogController?.abort();
    catalogController = new AbortController();
    setCatalogStatus("Loading the latest store inventory…", "loading");

    try {
      const url = new URL(endpoint);
      url.searchParams.set("market", market);
      url.searchParams.set("currency", selectedCurrency());
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: catalogController.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || payload?.message || "Inventory is temporarily unavailable.");

      const rows = Array.isArray(payload?.items) ? payload.items : [];
      if (!rows.length) {
        renderCatalog(fallbackInventory());
        setCatalogStatus("The live catalog is empty while inventory is being prepared. Showing the store preview.", "fallback");
        return;
      }

      const normalized = rows.map(item => normalizeApiItem(item, payload));
      storeComingSoon = payload?.comingSoon !== false;
      checkoutEnabled = payload?.checkoutEnabled === true;
      const tape = document.querySelector("[data-store-coming-soon]"); if (tape) tape.hidden = !storeComingSoon;
      const launchNote = document.querySelector("[data-store-launch-note] strong"); if (launchNote && checkoutEnabled) launchNote.textContent = market === "international" ? "International checkout is open" : "Secure checkout is open";
      renderCatalog(normalized);
      if (!storeComingSoon) mountShippingTurnstile();
      const currencyNote = market === "international" && payload?.rate
        ? ` Display conversion: 1 USD = ${Number(payload.rate.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${payload.displayCurrency || selectedCurrency()}; source ${payload.rate.source || "reference rate"}.`
        : "";
      const warning = payload?.currencyWarning ? ` ${payload.currencyWarning}` : "";
      setCatalogStatus(`${normalized.length.toLocaleString()} launch product${normalized.length === 1 ? "" : "s"} loaded.${currencyNote}${warning}`, warning ? "fallback" : "success");
    } catch (error) {
      if (error?.name === "AbortError") return;
      renderCatalog(fallbackInventory());
      setCatalogStatus("Live inventory could not be reached. Showing the launch catalog preview; checkout remains locked.", "fallback");
    }
  }

  currencySelect?.addEventListener("change", () => {
    loadCatalog();
  });

  const shippingForm = document.querySelector("[data-shipping-quote-form]");
  const shippingProduct = shippingForm?.querySelector("[data-shipping-product]");
  const shippingStatus = document.querySelector("[data-shipping-quote-status]");
  const shippingRates = document.querySelector("[data-shipping-rates]");
  const shippingDisclosure = document.querySelector("[data-shipping-disclosure]");
  const shippingSubmit = shippingForm?.querySelector('button[type="submit"]');
  const shippingTurnstileNode = shippingForm?.querySelector("[data-shipping-turnstile]");

  function mountShippingTurnstile() {
    if (!shippingTurnstileNode) return;
    if (storeComingSoon) {
      shippingTurnstileNode.textContent = "The security check activates when live carrier quotes open.";
      return;
    }
    if (!config.turnstileSiteKey) {
      shippingTurnstileNode.textContent = "The launch security check is not configured yet.";
      return;
    }
    if (shippingTurnstileScriptAdded) return;
    shippingTurnstileScriptAdded = true;
    window.cpStoreTurnstileReady = () => {
      if (!window.turnstile || shippingTurnstileWidgetId !== null) return;
      shippingTurnstileWidgetId = window.turnstile.render(shippingTurnstileNode, {
        sitekey: config.turnstileSiteKey,
        theme: "dark",
        callback: value => { shippingTurnstileToken = value; },
        "expired-callback": () => { shippingTurnstileToken = ""; },
        "error-callback": () => {
          shippingTurnstileToken = "";
          setShippingStatus("The security check could not load. Refresh before requesting a live quote.", "error");
        }
      });
    };
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=cpStoreTurnstileReady&render=explicit";
    script.async = true;
    script.defer = true;
    document.head.append(script);
  }

  function populateShippingProducts(items) {
    if (!shippingProduct) return;
    const prior = shippingProduct.value;
    const options = items.filter(item => item.slug).map(item => `<option value="${escapeHtml(item.slug)}">${escapeHtml(item.name)}</option>`).join("");
    shippingProduct.innerHTML = `<option value="">Choose a product</option>${options}`;
    if (prior && items.some(item => item.slug === prior)) shippingProduct.value = prior;
  }

  function setShippingStatus(message, state = "") {
    if (!shippingStatus) return;
    shippingStatus.textContent = message;
    shippingStatus.dataset.state = state;
  }

  function renderShippingRates(payload) {
    if (!shippingRates) return;
    const rates = Array.isArray(payload?.rates) ? payload.rates : [];
    if (!rates.length) {
      shippingRates.innerHTML = "";
      setShippingStatus("No shipping services were returned for that address.", "error");
      return;
    }
    const currency = String(payload?.currency || "USD").toUpperCase();
    const expiry = payload?.expiresAt
      ? ` Quote expires ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.expiresAt))}.`
      : "";
    shippingRates.innerHTML = rates
      .slice()
      .sort((a, b) => Number(a?.amountCents || 0) - Number(b?.amountCents || 0))
      .map(rate => {
        const days = Number(rate?.deliveryDays);
        const delivery = Number.isFinite(days) && days >= 0 ? `${days} estimated business day${days === 1 ? "" : "s"}` : "Delivery estimate unavailable";
        const checkout = checkoutEnabled
          ? `<button class="store-checkout-button" type="button" data-store-checkout data-quote-id="${escapeHtml(payload?.quoteId || "")}" data-rate-id="${escapeHtml(rate?.id || "")}">Secure checkout</button>`
          : `<button class="store-checkout-button" type="button" disabled aria-disabled="true">Checkout coming soon</button>`;
        return `<article class="shipping-rate"><div><strong>${escapeHtml(`${rate?.carrier || "Carrier"} ${rate?.service || "service"}`)}</strong><small>${escapeHtml(delivery)}</small></div><span class="shipping-rate-price">${escapeHtml(formatMoney(rate?.amountCents, currency))}</span>${checkout}</article>`;
      }).join("");
    if (shippingDisclosure) {
      shippingDisclosure.textContent = String(payload?.disclosure || "");
      shippingDisclosure.hidden = !shippingDisclosure.textContent;
    }
    setShippingStatus(`${rates.length} shipping option${rates.length === 1 ? "" : "s"} found.${expiry}${checkoutEnabled ? " Choose a service to continue to Stripe." : " Checkout remains locked during prelaunch."}`, "success");
  }

  shippingRates?.addEventListener("click", async event => {
    const button = event.target.closest("[data-store-checkout]");
    if (!button) return;
    const token = localStorage.getItem("cp_rewards_token") || "";
    if (!token) {
      setShippingStatus("Sign in or create your verified Profile before checkout. Your shipping quote remains available for 10 minutes.", "error");
      window.open("referral.html", "_blank", "noopener");
      return;
    }
    button.disabled = true;
    button.textContent = "Opening Stripe...";
    setShippingStatus("Reserving this item and opening secure payment...", "loading");
    try {
      const response = await fetch(rewardsUrl(checkoutEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ quoteId: button.dataset.quoteId, rateId: button.dataset.rateId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !/^https:\/\/checkout\.stripe\.com\//.test(payload?.checkoutUrl || "")) throw new Error(payload?.error || "Secure checkout could not be opened.");
      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Secure checkout";
      setShippingStatus(error.message || "Secure checkout could not be opened.", "error");
    }
  });

  catalog?.addEventListener("click", event => {
    const button = event.target.closest("[data-quote-product]");
    if (!button || !shippingProduct) return;
    shippingProduct.value = button.dataset.quoteProduct || "";
    document.querySelector("#shipping-quote")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => shippingProduct.focus(), 450);
  });

  shippingForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const endpoint = rewardsUrl(quoteEndpoint);
    if (!endpoint) {
      setShippingStatus("Shipping quotes are not connected yet. No checkout or charge was created.", "unavailable");
      return;
    }

    if (!shippingForm.reportValidity()) return;
    if (!storeComingSoon && !shippingTurnstileToken) {
      setShippingStatus("Complete the security check before requesting a live carrier quote.", "error");
      shippingTurnstileNode?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const data = new FormData(shippingForm);
    const country = String(data.get("country") || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      setShippingStatus("Enter a two-letter country code, such as CA, GB, AU, JP, or DE.", "error");
      shippingForm.elements.country?.focus();
      return;
    }

    const body = {
      slug: String(data.get("slug") || "").trim(),
      quantity: 1,
      address: {
        name: String(data.get("name") || "").trim(),
        street1: String(data.get("street1") || "").trim(),
        street2: String(data.get("street2") || "").trim(),
        city: String(data.get("city") || "").trim(),
        state: String(data.get("state") || "").trim(),
        postalCode: String(data.get("postalCode") || "").trim(),
        country,
        phone: String(data.get("phone") || "").trim(),
        email: String(data.get("email") || "").trim()
      },
      currency: selectedCurrency(),
      turnstileToken: shippingTurnstileToken
    };

    if (shippingRates) shippingRates.innerHTML = "";
    if (shippingDisclosure) { shippingDisclosure.textContent = ""; shippingDisclosure.hidden = true; }
    if (shippingSubmit) shippingSubmit.disabled = true;
    shippingForm.setAttribute("aria-busy", "true");
    setShippingStatus("Checking available carrier rates…", "loading");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const unavailable = response.status === 503 || payload?.code === "SHIPPING_NOT_CONFIGURED";
        const message = unavailable
          ? "Exact shipping quotes are not switched on yet. Checkout is still locked and no charge was created."
          : (payload?.error || payload?.message || "A shipping quote could not be created for that address.");
        setShippingStatus(message, unavailable ? "unavailable" : "error");
        return;
      }
      renderShippingRates(payload);
    } catch (_) {
      setShippingStatus("The shipping service could not be reached. No checkout or charge was created.", "error");
    } finally {
      shippingTurnstileToken = "";
      if (shippingTurnstileWidgetId !== null && window.turnstile?.reset) window.turnstile.reset(shippingTurnstileWidgetId);
      if (shippingSubmit) shippingSubmit.disabled = false;
      shippingForm.removeAttribute("aria-busy");
    }
  });

  bindFilters();
  mountShippingTurnstile();
  loadCatalog();
})();
