(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const page = document.body?.dataset.storeMarket || "us";
  const market = page === "international" ? "international" : "us";
  const catalog = document.querySelector("[data-store-catalog]");
  const catalogStatus = document.querySelector("[data-store-catalog-status]");
  const emptyState = document.querySelector("[data-product-empty]");
  const searchInput = document.querySelector("[data-product-search]");
  const currencySelect = document.querySelector("[data-store-currency]");
  const inventoryEndpoint = "/store/inventory";
  const quoteEndpoint = "/store/shipping-quote";
  const checkoutEndpoint = "/store/checkout";
  const authToken = () => localStorage.getItem("cp_rewards_token") || "";
  const fallbackImages = {
    sealed: "assets/images/product-electric.svg",
    packs: "assets/images/product-cosmic.svg",
    japanese: "assets/images/product-aurora.svg",
    singles: "assets/images/product-vintage.svg"
  };
  const cardSeriesTabs = Array.isArray(config.cardSeriesTabs) ? config.cardSeriesTabs : [];

  let inventoryItems = [];
  let activeFilter = "all";
  let activeSearch = "";
  let catalogController = null;
  let storeComingSoon = true;
  let storeCheckoutEnabled = false;
  let currentQuoteId = "";
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

  function normalizeApiItem(item, payload) {
    const category = classifyCategory(item?.category);
    const series = String(item?.series || item?.game || item?.tcg || "pokemon").trim().toLowerCase();
    const displayCurrency = String(item?.price?.currency || payload?.displayCurrency || "USD").toUpperCase();
    const msrpCurrency = String(item?.msrp?.currency || displayCurrency).toUpperCase();
    const displayPriceCents = centsValue(item?.price?.displayCents);
    const displayMsrpCents = centsValue(item?.msrp?.displayCents);
    return {
      slug: String(item?.slug || "").trim(),
      name: String(item?.name || "Unlisted product").trim(),
      category,
      series,
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
      shippingReady: item?.shippingReady === true,
      isFallback: false
    };
  }

  function normalizeFallbackItem(item, index) {
    const category = classifyCategory(item?.category);
    return {
      slug: String(item?.id || `preview-${index + 1}`),
      name: String(item?.name || "Store preview"),
      category,
      series: String(item?.series || "pokemon").trim().toLowerCase(),
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
      ? (item.priceIncludesUsShipping ? "Free USA shipping included" : "USA shipping status pending")
      : "Product price only · shipping quoted separately";
    return `<strong class="store-current-price">${escapeHtml(price)}</strong><span class="store-shipping-label">${escapeHtml(shipping)}</span>`;
  }

  function productCard(item) {
    const search = `${item.name} ${item.categoryLabel} ${item.description}`.toLowerCase();
    const sourceLink = item.sourceUrl
      ? `<a class="store-source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Product source ↗</a>`
      : "";
    const quoteButton = item.slug && item.available && item.shippingReady
      ? `<button class="btn btn-small btn-outline" type="button" data-quote-product="${escapeHtml(item.slug)}">${storeCheckoutEnabled ? "Prepare checkout" : "Estimate shipping"}</button>`
      : "";
    const image = item.imageUrl
      ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" data-store-product-image>`
      : `<span class="store-product-placeholder">Crack Packs</span>`;
    return `
      <article class="product-card store-product-card holo-panel reveal is-visible" data-product-card data-category="${escapeHtml(item.category)}" data-series="${escapeHtml(item.series || "pokemon")}" data-search="${escapeHtml(search)}" id="${escapeHtml(item.slug)}">
        <div class="product-media">
          ${image}
          <span class="product-badge">${escapeHtml(item.quantityLabel)}</span>
          <span class="holo-sheen" aria-hidden="true"></span>
        </div>
        <div class="product-body">
          <p class="card-kicker">${escapeHtml(item.categoryLabel)}</p>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="product-description">${escapeHtml(item.description)}</p>
          <div class="store-msrp-row">${msrpMarkup(item)}</div>
          ${sourceLink}
          <div class="product-footer">
            <div class="store-price-stack">${priceMarkup(item)}</div>
            <button class="store-checkout-button" type="button" disabled aria-disabled="true">${storeCheckoutEnabled ? "Choose shipping below" : "Checkout coming soon"}</button>
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

  function renderCatalog(items) {
    inventoryItems = items;
    if (!catalog) return;
    catalog.innerHTML = items.map(productCard).join("");
    bindImageFallbacks();
    populateShippingProducts(items);
    applyFilters();
  }

  function applyFilters() {
    const cards = [...document.querySelectorAll("[data-store-catalog] [data-product-card]")];
    const activeSeries = document.querySelector("[data-store-series].is-active")?.dataset.storeSeries || "all";
    let visible = 0;
    cards.forEach(card => {
      const categoryMatch = activeFilter === "all" || card.dataset.category === activeFilter;
      const seriesMatch = activeSeries === "all" || String(card.dataset.series || "pokemon") === activeSeries;
      const searchMatch = !activeSearch || String(card.dataset.search || "").includes(activeSearch);
      const show = categoryMatch && seriesMatch && searchMatch;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (emptyState) emptyState.hidden = visible !== 0;
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
    });
    const requested = String(new URLSearchParams(window.location.search).get("category") || "").toLowerCase();
    const requestedButton = [...document.querySelectorAll("[data-product-filter]")].find(button => button.dataset.productFilter === requested);
    if (requestedButton) {
      activeFilter = requested;
      document.querySelectorAll("[data-product-filter]").forEach(candidate => candidate.classList.toggle("is-active", candidate === requestedButton));
    }
  }

  function bindSeriesTabs() {
    if (!cardSeriesTabs.length) return;
    const container = document.querySelector("[data-store-series-tabs]");
    if (!container) return;
    container.innerHTML = cardSeriesTabs.map((tab, index) => `
      <button class="type-pill${index === 0 ? " is-active" : ""}" type="button" data-store-series="${escapeHtml(tab.id)}">
        <i>${index === 0 ? "⚡" : "✦"}</i>
        <span><strong>${escapeHtml(tab.label)}</strong><small>${escapeHtml(tab.label)} inventory</small></span>
      </button>`).join("");
    container.querySelectorAll("[data-store-series]").forEach(button => {
      button.addEventListener("click", () => {
        container.querySelectorAll("[data-store-series]").forEach(candidate => candidate.classList.toggle("is-active", candidate === button));
        applyFilters();
      });
    });
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
        headers: { Accept: "application/json", ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}) },
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

      storeComingSoon = payload?.comingSoon !== false;
      storeCheckoutEnabled = payload?.checkoutEnabled === true;
      const normalized = rows.map(item => normalizeApiItem(item, payload));
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
    currentQuoteId = String(payload?.quoteId || "");
    const expiry = payload?.expiresAt
      ? ` Quote expires ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.expiresAt))}.`
      : "";
    shippingRates.innerHTML = rates
      .slice()
      .sort((a, b) => Number(a?.amountCents || 0) - Number(b?.amountCents || 0))
      .map(rate => {
        const days = Number(rate?.deliveryDays);
        const delivery = Number.isFinite(days) && days >= 0 ? `${days} estimated business day${days === 1 ? "" : "s"}` : "Delivery estimate unavailable";
        const checkout = storeCheckoutEnabled && currentQuoteId
          ? `<button class="store-checkout-button" type="button" data-start-checkout data-rate-id="${escapeHtml(rate?.id || "")}">Checkout</button>`
          : `<button class="store-checkout-button" type="button" disabled aria-disabled="true">Checkout coming soon</button>`;
        return `<article class="shipping-rate"><div><strong>${escapeHtml(`${rate?.carrier || "Carrier"} ${rate?.service || "service"}`)}</strong><small>${escapeHtml(delivery)}</small></div><span class="shipping-rate-price">${escapeHtml(formatMoney(rate?.amountCents, currency))}</span>${checkout}</article>`;
      }).join("");
    if (shippingDisclosure) {
      shippingDisclosure.textContent = String(payload?.disclosure || "");
      shippingDisclosure.hidden = !shippingDisclosure.textContent;
    }
    setShippingStatus(`${rates.length} shipping option${rates.length === 1 ? "" : "s"} found.${expiry}${storeCheckoutEnabled ? " Choose Checkout to continue to Stripe." : " Checkout remains locked during prelaunch."}`, "success");
  }

  shippingRates?.addEventListener("click", async event => {
    const button = event.target.closest("[data-start-checkout]");
    if (!button) return;
    if (!authToken()) {
      setShippingStatus("Sign in to your verified Seller Profile before checkout.", "error");
      return;
    }
    button.disabled = true;
    button.textContent = "Opening Stripe...";
    try {
      const response = await fetch(rewardsUrl(checkoutEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${authToken()}` },
        body: JSON.stringify({ quoteId: currentQuoteId, rateId: button.dataset.rateId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.checkoutUrl) throw new Error(payload.error || "Checkout could not be opened.");
      location.href = payload.checkoutUrl;
    } catch (error) {
      button.disabled = false;
      button.textContent = "Checkout";
      setShippingStatus(error.message, "error");
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
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}) },
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
    bindSeriesTabs();
  mountShippingTurnstile();
  loadCatalog();
})();
