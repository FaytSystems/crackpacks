(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const apiUrl = config.cardApiUrl || "https://api.crackpacks.com/cards";

  const form = document.querySelector("[data-price-check-form]");
  if (!form) return;

  const input = form.querySelector("[data-price-check-term]");
  const field = form.querySelector("[data-price-check-field]");
  const order = form.querySelector("[data-price-check-order]");
  const pageSize = form.querySelector("[data-price-check-size]");
  const submit = form.querySelector("[data-price-check-submit]");
  const reset = form.querySelector("[data-price-check-reset]");
  const results = document.querySelector("[data-price-check-results]");
  const status = document.querySelector("[data-price-check-status]");
  const empty = document.querySelector("[data-price-check-empty]");
  const errorBox = document.querySelector("[data-price-check-error]");
  const errorText = document.querySelector("[data-price-check-error-text]");
  const pager = document.querySelector("[data-price-check-pager]");
  const previous = document.querySelector("[data-price-check-previous]");
  const next = document.querySelector("[data-price-check-next]");
  const pageLabel = document.querySelector("[data-price-check-page]");
  const summary = document.querySelector("[data-price-check-summary]");
  const seriesTabs = document.querySelector("[data-card-series-tabs]");

  const state = {
    term: "",
    field: "all",
    orderBy: "-set.releaseDate",
    series: "pokemon",
    pageSize: 20,
    page: 1,
    totalCount: 0,
    count: 0,
    loading: false,
    controller: null
  };

  const seriesOptions = [
    { id: "pokemon", label: "Pokemon", short: "PK", apiBacked: true, querySuffix: "Pokemon card", marketGroup: "tcg" },
    { id: "magic", label: "Magic", short: "MTG", apiBacked: true, querySuffix: "Magic the Gathering card", marketGroup: "tcg" },
    { id: "yugioh", label: "Yu-Gi-Oh!", short: "YG", querySuffix: "Yu-Gi-Oh card", marketGroup: "tcg" },
    { id: "sports", label: "Sports cards", short: "SP", querySuffix: "sports card", marketGroup: "sports" },
    { id: "lorcana", label: "Lorcana", short: "LC", querySuffix: "Disney Lorcana card", marketGroup: "tcg" },
    { id: "onepiece", label: "One Piece", short: "OP", querySuffix: "One Piece card game card", marketGroup: "tcg" },
    { id: "dragonball", label: "Dragon Ball", short: "DB", querySuffix: "Dragon Ball Super card game card", marketGroup: "tcg" },
    { id: "digimon", label: "Digimon", short: "DG", querySuffix: "Digimon card game card", marketGroup: "tcg" },
    { id: "fab", label: "Flesh and Blood", short: "FAB", querySuffix: "Flesh and Blood TCG card", marketGroup: "tcg" },
    { id: "weiss", label: "Weiss Schwarz", short: "WS", querySuffix: "Weiss Schwarz card", marketGroup: "tcg" },
    { id: "graded", label: "Graded slabs", short: "10", querySuffix: "graded trading card PSA BGS CGC", marketGroup: "graded" },
    { id: "sealed", label: "Sealed boxes", short: "BX", querySuffix: "sealed trading card box", marketGroup: "sealed" },
    { id: "collectibles", label: "Collectibles", short: "CO", querySuffix: "collectible", marketGroup: "collectibles" }
  ];
  const seriesMap = new Map(seriesOptions.map(option => [option.id, option]));
  const seriesIds = new Set(seriesOptions.map(option => option.id));
  const priceSources = [
    {
      id: "ebay-sold",
      title: "eBay sold listings",
      priceLabel: "Recent sold prices",
      note: "Completed sales and accepted-offer pages when eBay exposes them.",
      groups: ["tcg", "sports", "graded", "sealed", "collectibles"],
      url: query => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Complete=1&LH_Sold=1`
    },
    {
      id: "tcgplayer",
      title: "TCGplayer marketplace",
      priceLabel: "Current marketplace prices",
      note: "Listings and product pages for trading-card games.",
      groups: ["tcg", "sealed"],
      url: query => `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(query)}`
    },
    {
      id: "pricecharting",
      title: "PriceCharting",
      priceLabel: "Charted sold prices",
      note: "Ungraded and graded market charts where available.",
      groups: ["tcg", "sports", "graded", "sealed", "collectibles"],
      url: query => `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`
    },
    {
      id: "comc",
      title: "COMC marketplace",
      priceLabel: "Card marketplace listings",
      note: "Fixed-price card listings, strongest for sports and singles.",
      groups: ["sports", "graded", "collectibles"],
      url: query => `https://www.comc.com/Cards,sr,i100,=${encodeURIComponent(query)}`
    },
    {
      id: "cardmarket",
      title: "Cardmarket",
      priceLabel: "European market prices",
      note: "Cardmarket search pages for supported trading-card games.",
      groups: ["tcg", "sealed"],
      url: query => `https://www.cardmarket.com/en/Products/Search?searchString=${encodeURIComponent(query)}`
    }
  ];

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));

  const money = value => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number);
  };

  const compactNumber = value => new Intl.NumberFormat("en-US").format(Number(value) || 0);

  function setHidden(element, hidden) {
    if (element) element.hidden = hidden;
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  const currentSeries = () => seriesMap.get(state.series) || seriesOptions[0];

  function syncSeriesTabs() {
    if (!seriesTabs) return;
    seriesTabs.querySelectorAll("[data-card-series]").forEach(button => {
      button.classList.toggle("is-active", String(button.dataset.cardSeries || "pokemon") === state.series);
    });
  }

  const marketQuery = (series, term) => [term, series.querySuffix].filter(Boolean).join(" ").trim();

  function marketSourceCards(series, term) {
    const query = marketQuery(series, term);
    return priceSources
      .filter(source => source.groups.includes(series.marketGroup))
      .map(source => ({ ...source, seriesLabel: series.label, query, url: source.url(query) }));
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    if (state.term) {
      url.searchParams.set("q", state.term);
      url.searchParams.set("field", state.field);
      url.searchParams.set("sort", state.orderBy);
      url.searchParams.set("series", state.series);
      url.searchParams.set("size", String(state.pageSize));
      url.searchParams.set("page", String(state.page));
    } else {
      ["q", "field", "sort", "series", "size", "page"].forEach(key => url.searchParams.delete(key));
    }
    window.history.replaceState({}, "", url);
  }

  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    const term = (params.get("q") || "").trim();
    const allowedFields = new Set(["all", "name", "set", "number", "rarity", "type"]);
    const allowedSorts = new Set(["-set.releaseDate", "set.releaseDate", "name", "-name"]);
    const allowedSizes = new Set([12, 20, 24, 36, 48]);

    state.term = term;
    state.field = allowedFields.has(params.get("field")) ? params.get("field") : "all";
    state.orderBy = allowedSorts.has(params.get("sort")) ? params.get("sort") : "-set.releaseDate";
    state.series = seriesIds.has(params.get("series")) ? params.get("series") : "pokemon";

    const parsedSize = Number.parseInt(params.get("size"), 10);
    state.pageSize = allowedSizes.has(parsedSize) ? parsedSize : 20;

    const parsedPage = Number.parseInt(params.get("page"), 10);
    state.page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

    input.value = state.term;
    field.value = state.field;
    order.value = state.orderBy;
    pageSize.value = String(state.pageSize);
    syncSeriesTabs();
  }

  function skeletonCards(amount = 8) {
    return Array.from({ length: amount }, (_, index) => `
      <article class="lookup-card lookup-skeleton" aria-hidden="true" data-skeleton="${index}">
        <div class="lookup-skeleton-image"></div>
        <div class="lookup-skeleton-line wide"></div>
        <div class="lookup-skeleton-line"></div>
        <div class="lookup-skeleton-line short"></div>
      </article>
    `).join("");
  }

  function typeLabel(card) {
    const values = [
      ...(Array.isArray(card.types) ? card.types : []),
      ...(Array.isArray(card.subtypes) ? card.subtypes : [])
    ];
    return values.length ? values.join(" / ") : (card.supertype || "Trading Card");
  }

  function priceRowMarkup({ label, value, detail, url = "" }) {
    const content = `
      <strong>${escapeHtml(label)}</strong>
      <span class="lookup-market">${escapeHtml(value)}</span>
      ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
    `;
    return url
      ? `<a class="lookup-price-row lookup-price-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${content}<em>Open source</em></a>`
      : `<div class="lookup-price-row">${content}</div>`;
  }

  function pricingRows(card) {
    const tcgPrices = card?.tcgplayer?.prices && typeof card.tcgplayer.prices === "object"
      ? card.tcgplayer.prices
      : {};
    const tcgUrl = card?.tcgplayer?.url || "";
    const cardmarketUrl = card?.cardmarket?.url || "";

    const rows = Object.entries(tcgPrices)
      .map(([printing, values]) => {
        const market = money(values?.market);
        const low = money(values?.low);
        const mid = money(values?.mid);
        const directLow = money(values?.directLow);

        if (!market && !low && !mid && !directLow) return null;

        const label = printing
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/_/g, " ")
          .replace(/\b\w/g, character => character.toUpperCase());

        return priceRowMarkup({
          label,
          value: market ? `${market} market` : "Market unavailable",
          detail: [
            low ? `${low} low` : "",
            mid ? `${mid} mid` : "",
            directLow ? `${directLow} direct low` : ""
          ].filter(Boolean).join(" - "),
          url: tcgUrl
        });
      })
      .filter(Boolean);

    if (rows.length) return rows.join("");

    const cardmarketTrend = money(card?.cardmarket?.prices?.trendPrice);
    const cardmarketAverage = money(card?.cardmarket?.prices?.averageSellPrice);

    if (cardmarketTrend || cardmarketAverage) {
      return priceRowMarkup({
        label: "Cardmarket reference",
        value: cardmarketTrend ? `${cardmarketTrend} trend` : `${cardmarketAverage} average`,
        detail: "European market reference returned by the card database.",
        url: cardmarketUrl
      });
    }

    return `
      <div class="lookup-price-row lookup-price-unavailable">
        <strong>No current estimate returned</strong>
        <span>Pricing may be unavailable for this printing.</span>
      </div>
    `;
  }

  function externalMarketUrl(card) {
    return card?.tcgplayer?.url || card?.cardmarket?.url || "";
  }

  function renderCard(card) {
    const image = card?.images?.small || card?.images?.large || "";
    const marketUrl = externalMarketUrl(card);
    const setName = card?.set?.name || "Unknown set";
    const printedTotal = card?.set?.printedTotal || card?.set?.total || "";
    const number = card?.number || "-";
    const numberLabel = printedTotal ? `#${number} / ${printedTotal}` : `#${number}`;
    const rarity = card?.rarity || "Rarity not listed";
    const artist = card?.artist ? `<span>Artist: ${escapeHtml(card.artist)}</span>` : "";

    return `
      <article class="lookup-card holo-panel">
        <div class="lookup-card-media">
          ${image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(card.name || "Trading card")} card artwork" loading="lazy" decoding="async">`
            : `<div class="lookup-image-missing" aria-label="Artwork unavailable">Artwork unavailable</div>`
          }
          <span class="lookup-rarity">${escapeHtml(rarity)}</span>
          <span class="holo-sheen" aria-hidden="true"></span>
        </div>
        <div class="lookup-card-body">
          <p class="card-kicker">${escapeHtml(typeLabel(card))}</p>
          <h2>${escapeHtml(card.name || "Unnamed card")}</h2>
          <div class="lookup-meta">
            <span>${escapeHtml(setName)}</span>
            <strong>${escapeHtml(numberLabel)}</strong>
            ${artist}
          </div>

          <div class="lookup-pricing" aria-label="Estimated pricing">
            <div class="lookup-pricing-heading">
              <strong>Estimated market value</strong>
              <span>Reference only</span>
            </div>
            ${pricingRows(card)}
          </div>

          <div class="lookup-card-actions">
            ${marketUrl
              ? `<a class="btn btn-small btn-primary" href="${escapeHtml(marketUrl)}" target="_blank" rel="noopener noreferrer">Verify market listing</a>`
              : `<span class="lookup-no-link">No external market link returned</span>`
            }
          </div>
        </div>
      </article>
    `;
  }

  function renderMarketSourceCard(source, index) {
    return `
      <article class="lookup-card lookup-marketplace-card holo-panel">
        <div class="lookup-card-media lookup-marketplace-media">
          <div class="lookup-marketplace-badge">${escapeHtml(source.seriesLabel)}</div>
          <strong>${escapeHtml(source.title)}</strong>
          <span class="lookup-rarity">Source ${index + 1}</span>
          <span class="holo-sheen" aria-hidden="true"></span>
        </div>
        <div class="lookup-card-body">
          <p class="card-kicker">${escapeHtml(source.seriesLabel)} price source</p>
          <h2>${escapeHtml(state.term)}</h2>
          <div class="lookup-meta">
            <span>${escapeHtml(source.query)}</span>
            <strong>Live market page</strong>
          </div>

          <div class="lookup-pricing" aria-label="Source-linked pricing">
            <div class="lookup-pricing-heading">
              <strong>Source-linked price check</strong>
              <span>Open source</span>
            </div>
            ${priceRowMarkup({
              label: source.title,
              value: source.priceLabel,
              detail: source.note,
              url: source.url
            })}
          </div>

          <div class="lookup-card-actions">
            <a class="btn btn-small btn-primary" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Open price source</a>
          </div>
        </div>
      </article>
    `;
  }

  function updatePager() {
    const totalPages = Math.max(1, Math.ceil(state.totalCount / state.pageSize));
    const hasResults = state.totalCount > 0;
    setHidden(pager, !hasResults || totalPages <= 1);

    if (previous) previous.disabled = state.loading || state.page <= 1;
    if (next) next.disabled = state.loading || state.page >= totalPages;
    if (pageLabel) pageLabel.textContent = `Page ${state.page} of ${totalPages}`;
  }

  function showError(message) {
    setHidden(errorBox, false);
    if (errorText) errorText.textContent = message;
    setStatus("The search could not be completed.");
  }

  function clearMessages() {
    setHidden(empty, true);
    setHidden(errorBox, true);
    if (errorText) errorText.textContent = "";
  }

  async function searchCards({ scroll = false } = {}) {
    const term = input.value.trim();
    if (term.length < 2) {
      clearMessages();
      results.innerHTML = "";
      state.term = "";
      state.totalCount = 0;
      setHidden(pager, true);
      setHidden(summary, true);
      setStatus("Enter at least two characters to search.");
      input.focus();
      updateUrl();
      return;
    }

    state.term = term;
    state.field = field.value;
    state.orderBy = order.value;
    state.series = document.querySelector("[data-card-series].is-active")?.dataset.cardSeries || state.series || "pokemon";
    state.pageSize = Number.parseInt(pageSize.value, 10) || 20;
    const selectedSeries = currentSeries();

    if (!selectedSeries.apiBacked) {
      if (state.controller) state.controller.abort();
      state.page = 1;
      state.loading = false;
      state.count = 0;
      submit.disabled = false;
      clearMessages();
      const cards = marketSourceCards(selectedSeries, state.term);
      state.totalCount = cards.length;
      results.removeAttribute("aria-busy");
      results.innerHTML = cards.map(renderMarketSourceCard).join("");
      setHidden(pager, true);
      if (summary) {
        summary.textContent = `${compactNumber(cards.length)} source-linked market page${cards.length === 1 ? "" : "s"} for "${state.term}"`;
        summary.hidden = false;
      }
      setStatus(`Showing source-linked ${selectedSeries.label} market pages for "${state.term}".`);
      updateUrl();
      if (scroll) document.querySelector("#lookup-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    state.loading = true;

    if (state.controller) state.controller.abort();
    state.controller = new AbortController();

    clearMessages();
    setHidden(summary, true);
    results.setAttribute("aria-busy", "true");
    results.innerHTML = skeletonCards(Math.min(state.pageSize, 8));
    submit.disabled = true;
    setStatus(`Searching ${selectedSeries.label} for "${state.term}"...`);
    updatePager();
    updateUrl();

    const query = new URLSearchParams({
      term: state.term,
      field: state.field,
      series: state.series,
      page: String(state.page),
      pageSize: String(state.pageSize),
      orderBy: state.orderBy
    });

    try {
      const response = await fetch(`${apiUrl}?${query.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: state.controller.signal
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok) {
        throw new Error(payload.error || `Card search returned HTTP ${response.status}.`);
      }

      const cards = Array.isArray(payload.data) ? payload.data : [];
      state.count = Number(payload.count) || cards.length;
      state.totalCount = Number(payload.totalCount) || cards.length;

      results.innerHTML = cards.map(renderCard).join("");

      if (!cards.length) {
        setHidden(empty, false);
        setStatus(`No cards matched "${state.term}".`);
        setHidden(summary, true);
      } else {
        const first = ((state.page - 1) * state.pageSize) + 1;
        const last = first + cards.length - 1;
        setStatus(`Showing ${compactNumber(first)}-${compactNumber(last)} of ${compactNumber(state.totalCount)} matches.`);
        if (summary) {
          summary.textContent = `${compactNumber(state.totalCount)} estimated match${state.totalCount === 1 ? "" : "es"} for "${state.term}"`;
          summary.hidden = false;
        }
      }

      updatePager();

      if (scroll) {
        document.querySelector("#lookup-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      results.innerHTML = "";
      state.totalCount = 0;
      updatePager();
      showError(error?.message || "The card search service could not be reached. Please try again.");
    } finally {
      state.loading = false;
      results.removeAttribute("aria-busy");
      submit.disabled = false;
      updatePager();
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    state.page = 1;
    searchCards({ scroll: true });
  });

  reset?.addEventListener("click", () => {
    if (state.controller) state.controller.abort();
    form.reset();
    state.term = "";
    state.field = "all";
    state.orderBy = "-set.releaseDate";
    state.series = "pokemon";
    state.pageSize = 20;
    state.page = 1;
    state.totalCount = 0;
    input.value = "";
    field.value = state.field;
    order.value = state.orderBy;
    pageSize.value = String(state.pageSize);
    syncSeriesTabs();
    results.innerHTML = "";
    clearMessages();
    setHidden(pager, true);
    setHidden(summary, true);
    setStatus("Choose a category, then search by name, set, number, rarity, type, or keyword.");
    updateUrl();
    input.focus();
  });

  previous?.addEventListener("click", () => {
    if (state.loading || state.page <= 1) return;
    state.page -= 1;
    searchCards({ scroll: true });
  });

  next?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.totalCount / state.pageSize));
    if (state.loading || state.page >= totalPages) return;
    state.page += 1;
    searchCards({ scroll: true });
  });

  document.querySelectorAll("[data-price-check-example]").forEach(button => {
    button.addEventListener("click", () => {
      input.value = button.dataset.priceCheckExample || "";
      field.value = button.dataset.priceCheckField || "all";
      if (button.dataset.priceCheckSeries && seriesIds.has(button.dataset.priceCheckSeries)) {
        state.series = button.dataset.priceCheckSeries;
        syncSeriesTabs();
      }
      state.page = 1;
      searchCards({ scroll: true });
    });
  });

  seriesTabs?.querySelectorAll("[data-card-series]").forEach(button => {
    button.addEventListener("click", () => {
      seriesTabs.querySelectorAll("[data-card-series]").forEach(candidate => candidate.classList.toggle("is-active", candidate === button));
      state.series = button.dataset.cardSeries || "pokemon";
      if (state.term.length >= 2) {
        state.page = 1;
        searchCards({ scroll: true });
      } else {
        updateUrl();
      }
    });
  });

  window.addEventListener("popstate", () => {
    readUrl();
    if (state.term.length >= 2) searchCards();
  });

  readUrl();
  setHidden(pager, true);
  setHidden(summary, true);

  if (state.term.length >= 2) {
    searchCards();
  } else {
    setStatus("Choose a category, then search by name, set, number, rarity, type, or keyword.");
  }
})();
