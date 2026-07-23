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
    const allowedSeries = new Set(["pokemon", "magic"]);
    const allowedSizes = new Set([12, 20, 24, 36, 48]);

    state.term = term;
    state.field = allowedFields.has(params.get("field")) ? params.get("field") : "all";
    state.orderBy = allowedSorts.has(params.get("sort")) ? params.get("sort") : "-set.releaseDate";
    state.series = allowedSeries.has(params.get("series")) ? params.get("series") : "pokemon";

    const parsedSize = Number.parseInt(params.get("size"), 10);
    state.pageSize = allowedSizes.has(parsedSize) ? parsedSize : 20;

    const parsedPage = Number.parseInt(params.get("page"), 10);
    state.page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

    input.value = state.term;
    field.value = state.field;
    order.value = state.orderBy;
    pageSize.value = String(state.pageSize);
    if (seriesTabs) {
      seriesTabs.querySelectorAll("[data-card-series]").forEach(button => {
        button.classList.toggle("is-active", String(button.dataset.cardSeries || "all") === state.series);
      });
    }
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
    return values.length ? values.join(" • ") : (card.supertype || "Trading Card");
  }

  function pricingRows(card) {
    const tcgPrices = card?.tcgplayer?.prices && typeof card.tcgplayer.prices === "object"
      ? card.tcgplayer.prices
      : {};

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

        return `
          <div class="lookup-price-row">
            <strong>${escapeHtml(label)}</strong>
            <span class="lookup-market">${market ? `${market} market` : "Market unavailable"}</span>
            <small>${[
              low ? `${low} low` : "",
              mid ? `${mid} mid` : "",
              directLow ? `${directLow} direct low` : ""
            ].filter(Boolean).join(" • ")}</small>
          </div>
        `;
      })
      .filter(Boolean);

    if (rows.length) return rows.join("");

    const cardmarketTrend = money(card?.cardmarket?.prices?.trendPrice);
    const cardmarketAverage = money(card?.cardmarket?.prices?.averageSellPrice);

    if (cardmarketTrend || cardmarketAverage) {
      return `
        <div class="lookup-price-row">
          <strong>Cardmarket reference</strong>
          <span class="lookup-market">${cardmarketTrend ? `${cardmarketTrend} trend` : `${cardmarketAverage} average`}</span>
          <small>European market reference returned by the card database.</small>
        </div>
      `;
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
    const number = card?.number || "—";
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
              ? `<a class="btn btn-small btn-primary" href="${escapeHtml(marketUrl)}" target="_blank" rel="noopener noreferrer">Verify market listing ↗</a>`
              : `<span class="lookup-no-link">No external market link returned</span>`
            }
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
    state.loading = true;

    if (state.controller) state.controller.abort();
    state.controller = new AbortController();

    clearMessages();
    setHidden(summary, true);
    results.setAttribute("aria-busy", "true");
    results.innerHTML = skeletonCards(Math.min(state.pageSize, 8));
    submit.disabled = true;
    setStatus(`Searching for “${state.term}”…`);
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
        setStatus(`No cards matched “${state.term}”.`);
        setHidden(summary, true);
      } else {
        const first = ((state.page - 1) * state.pageSize) + 1;
        const last = first + cards.length - 1;
        setStatus(`Showing ${compactNumber(first)}–${compactNumber(last)} of ${compactNumber(state.totalCount)} matches.`);
        if (summary) {
          summary.textContent = `${compactNumber(state.totalCount)} estimated match${state.totalCount === 1 ? "" : "es"} for “${state.term}”`;
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
    state.pageSize = 20;
    state.page = 1;
    state.totalCount = 0;
    input.value = "";
    field.value = state.field;
    order.value = state.orderBy;
    pageSize.value = String(state.pageSize);
    results.innerHTML = "";
    clearMessages();
    setHidden(pager, true);
    setHidden(summary, true);
    setStatus("Search by card name, set, number, rarity, type, or keyword.");
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
    setStatus("Search by card name, set, number, rarity, type, or keyword.");
  }
})();
