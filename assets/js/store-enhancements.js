(() => {
  "use strict";

  const catalog = document.querySelector("[data-store-catalog]");
  const topTenGrid = document.querySelector("[data-top-ten-grid]");
  const topTenWindow = document.querySelector("[data-top-ten-window]");
  const primaryTabs = document.querySelector("[data-store-primary-tabs]");
  const searchInput = document.querySelector("[data-product-search]");
  const suggestions = document.querySelector("[data-product-suggestions]");
  const sortSelect = document.querySelector("[data-marketplace-sort]");
  const subcategoryFilter = document.querySelector("[data-subcategory-filter]");
  const sellerSearchInput = document.querySelector("[data-seller-search]");
  const priceMinInput = document.querySelector("[data-price-min]");
  const priceMaxInput = document.querySelector("[data-price-max]");
  const priceRangeReadout = document.querySelector("[data-price-range-readout]");
  const emptyState = document.querySelector("[data-product-empty]");
  const seriesTabsContainer = document.querySelector("[data-store-series-tabs]");
  const topItemsByWindow = window.CRACKPACKS_TOP_ITEMS || {};
  const showModal = document.querySelector("[data-store-show-modal]");
  const showResults = document.querySelector("[data-store-show-results]");
  const showCopy = document.querySelector("[data-store-show-copy]");

  if (!catalog) return;

  const state = {
    primary: "all",
    subcategory: "all",
    search: "",
    seller: "",
    sort: String(sortSelect?.value || "rank"),
    minPrice: Number(priceMinInput?.value || 0),
    maxPrice: Number(priceMaxInput?.value || 1000),
    shows: []
  };
  let syncingCatalog = false;

  const taxonomy = {
    all: ["all"],
    pokemon: ["all", "booster_box", "elite_trainer_box", "booster_pack", "single_card", "graded_card", "accessory", "japanese", "vintage"],
    magic: ["all", "play_booster_box", "collector_booster_box", "commander_deck", "single_card", "graded_card", "secret_lair", "accessory"],
    sports: ["all", "baseball", "basketball", "football", "hockey", "soccer", "racing", "wrestling", "multi_sport"],
    memorabilia: ["all", "shirts", "hats", "pennants", "signed_items", "display_items", "tickets", "other_memorabilia"],
    collectibles: ["all", "cups", "toys", "boardgames", "figures", "pins", "plush", "sealed_collectibles"],
    tcg: ["all", "pokemon", "magic", "yugioh", "one_piece", "lorcana", "dragon_ball", "flesh_and_blood", "digimon", "sports_cards"]
  };

  const primaryButtons = [
    { id: "all", label: "All", icon: "✦" },
    { id: "pokemon", label: "Pokemon", icon: "⚡" },
    { id: "magic", label: "Magic", icon: "✧" },
    { id: "sports", label: "Sports", icon: "🏆" },
    { id: "memorabilia", label: "Memorabilia", icon: "🎟" },
    { id: "collectibles", label: "Collectibles", icon: "🧸" },
    { id: "tcg", label: "All TCG", icon: "🃏" }
  ];

  const slugify = value => String(value || "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "other";
  const pretty = value => String(value || "other").replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());

  const inferPrimary = text => {
    const value = String(text || "").toLowerCase();
    if (/pokemon|etb|trainer|scarlet|violet|paldea|booster/.test(value)) return "pokemon";
    if (/magic|mtg|commander|ravnica|modern|secret lair/.test(value)) return "magic";
    if (/baseball|basketball|football|hockey|soccer|racing|wrestling|sport/.test(value)) return "sports";
    if (/shirt|hat|pennant|signed|memorabilia|ticket/.test(value)) return "memorabilia";
    if (/toy|board ?game|figure|cup|pin|plush|collectible/.test(value)) return "collectibles";
    if (/yugioh|one piece|lorcana|dragon ball|digimon|flesh and blood|tcg|trading card/.test(value)) return "tcg";
    return "all";
  };

  const inferSubcategory = text => {
    const value = String(text || "").toLowerCase();
    if (/elite trainer|etb/.test(value)) return "elite_trainer_box";
    if (/booster box/.test(value)) return "booster_box";
    if (/booster pack|pack lot|blister/.test(value)) return "booster_pack";
    if (/play booster/.test(value)) return "play_booster_box";
    if (/collector booster/.test(value)) return "collector_booster_box";
    if (/commander/.test(value)) return "commander_deck";
    if (/secret lair/.test(value)) return "secret_lair";
    if (/single|raw|slab|graded|card/.test(value)) return "single_card";
    const hit = value.match(/baseball|basketball|football|hockey|soccer|racing|wrestling|shirt|hat|pennant|signed|ticket|toy|board ?game|figure|cup|pin|plush|pokemon|magic|yugioh|one piece|lorcana|dragon ball|digimon|flesh and blood/);
    return slugify(hit?.[0] || value);
  };

  const parsePrice = card => {
    const text = card.querySelector(".store-current-price")?.textContent || "";
    const normalized = Number(text.replace(/[^0-9.]/g, ""));
    return Number.isFinite(normalized) ? Math.round(normalized * 100) : 0;
  };

  const parseSeller = card => String(card.querySelector(".store-market-meta strong")?.textContent || "").replace(/^@/, "").trim().toLowerCase();

  const activeSeries = () => seriesTabsContainer?.querySelector("[data-store-series].is-active")?.dataset.storeSeries || "all";
  const dateLabel = value => {
    const stamp = Date.parse(value || "");
    if (!Number.isFinite(stamp)) return "Schedule pending";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(stamp));
  };

  function hydrateCards() {
    [...catalog.querySelectorAll("[data-product-card]")].forEach((card, index) => {
      const text = card.textContent || "";
      const seller = parseSeller(card);
      const primary = inferPrimary(text);
      const subcategory = inferSubcategory(text);
      card.dataset.primaryCategory = primary;
      card.dataset.subcategory = subcategory;
      card.dataset.seller = seller;
      card.dataset.priceCents = String(parsePrice(card));
      card.dataset.rank = card.dataset.rank || String(index + 1);
      card.dataset.createdAt = card.dataset.createdAt || "";
      card.dataset.search = `${text} ${seller} ${primary} ${subcategory}`.toLowerCase();
      if (!card.querySelector("[data-store-show-open]")) {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "btn btn-outline btn-small store-show-action";
        action.dataset.storeShowOpen = "true";
        action.textContent = "Show";
        card.querySelector(".product-body")?.append(action);
      }
    });
  }

  function renderTopTen() {
    if (!topTenGrid) return;
    const windowKey = String(topTenWindow?.value || "1hr");
    const rows = Array.isArray(topItemsByWindow[windowKey]) ? topItemsByWindow[windowKey] : [];
    topTenGrid.innerHTML = rows.slice(0, 10).map((item, index) => `
      <article class="top-ten-card holo-panel">
        <div class="top-ten-rank">#${index + 1}</div>
        <div class="top-ten-copy">
          <p class="card-kicker">${item.category || "Top seller"}</p>
          <h3>${item.name || "Top item"}</h3>
          <p>${item.description || "High-performing product from the selected sales window."}</p>
        </div>
        <div class="top-ten-meta">
          <strong>${item.price || "-"}</strong>
          <span>${item.seller || "@crackpacks"}</span>
          <small>${item.windowLabel || windowKey}</small>
        </div>
      </article>`).join("");
  }

  function renderPrimaryTabs() {
    if (!primaryTabs) return;
    primaryTabs.innerHTML = primaryButtons.map(button => `
      <button class="type-pill${button.id === state.primary ? " is-active" : ""}" type="button" data-store-primary="${button.id}">
        <i>${button.icon}</i>
        <span><strong>${button.label}</strong><small>${button.label} listings</small></span>
      </button>`).join("");
    primaryTabs.querySelectorAll("[data-store-primary]").forEach(button => {
      button.addEventListener("click", () => {
        state.primary = button.dataset.storePrimary || "all";
        primaryTabs.querySelectorAll("[data-store-primary]").forEach(candidate => candidate.classList.toggle("is-active", candidate === button));
        populateSubcategories();
        applyFilters();
      });
    });
  }

  function populateSubcategories() {
    if (!subcategoryFilter) return;
    const options = taxonomy[state.primary] || taxonomy.all;
    subcategoryFilter.innerHTML = options.map(option => `<option value="${option}">${option === "all" ? "All subcategories" : pretty(option)}</option>`).join("");
    state.subcategory = "all";
    subcategoryFilter.value = "all";
  }

  function updatePriceControls() {
    const prices = [...catalog.querySelectorAll("[data-product-card]")].map(parsePrice);
    const maxWhole = Math.max(1, Math.ceil((Math.max(...prices, 100000)) / 100));
    if (priceMinInput) priceMinInput.max = String(maxWhole);
    if (priceMaxInput) priceMaxInput.max = String(maxWhole);
    if (Number(priceMaxInput?.value || 0) > maxWhole) priceMaxInput.value = String(maxWhole);
    if (!priceMaxInput?.value) priceMaxInput.value = String(maxWhole);
    state.minPrice = Number(priceMinInput?.value || 0);
    state.maxPrice = Number(priceMaxInput?.value || maxWhole);
    updatePriceReadout();
  }

  function updatePriceReadout() {
    if (!priceRangeReadout) return;
    priceRangeReadout.textContent = `$${state.minPrice.toLocaleString()} - $${state.maxPrice.toLocaleString()}`;
  }

  function applySorting(cards) {
    return cards.sort((left, right) => {
      if (state.sort === "seller") return String(left.dataset.seller || "").localeCompare(String(right.dataset.seller || ""), undefined, { sensitivity: "base" });
      if (state.sort === "alpha") return String(left.querySelector("h3")?.textContent || "").localeCompare(String(right.querySelector("h3")?.textContent || ""), undefined, { sensitivity: "base" });
      if (state.sort === "newest") return String(right.dataset.createdAt || "").localeCompare(String(left.dataset.createdAt || ""));
      if (state.sort === "oldest") return String(left.dataset.createdAt || "").localeCompare(String(right.dataset.createdAt || ""));
      if (state.sort === "price-high") return Number(right.dataset.priceCents || 0) - Number(left.dataset.priceCents || 0);
      if (state.sort === "price-low") return Number(left.dataset.priceCents || 0) - Number(right.dataset.priceCents || 0);
      return Number(left.dataset.rank || 999999) - Number(right.dataset.rank || 999999);
    });
  }

  async function loadShows() {
    const base = String(window.CRACKPACKS_CONFIG?.rewardsApiUrl || "").trim().replace(/\/+$/, "");
    if (!base) return;
    try {
      const response = await fetch(`${base}/live/shows`, { headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      state.shows = Array.isArray(payload?.shows) ? payload.shows : [];
    } catch (_) {
      state.shows = [];
    }
  }

  function closeShowModal() {
    if (!showModal) return;
    showModal.hidden = true;
    showModal.setAttribute("aria-hidden", "true");
  }

  function openShowModal(card) {
    if (!showModal || !showResults || !showCopy) return;
    const seller = String(card.dataset.seller || "");
    const title = String(card.querySelector("h3")?.textContent || "Listing");
    const category = String(card.querySelector(".card-kicker")?.textContent || "Category");
    const price = String(card.querySelector(".store-current-price")?.textContent || "Price coming soon");
    const condition = String(card.querySelector(".store-market-meta span")?.textContent || "Condition pending");
    const search = state.search || title.toLowerCase();
    const exactShowLink = String(card.dataset.showLink || "");
    const exactShowId = String(card.dataset.showId || "");
    const exactShowTitle = String(card.dataset.showTitle || "");
    const exactShowStatus = String(card.dataset.showStatus || "");
    const exactStartingBidCents = Number(card.dataset.showStartingBidCents || 0);
    const exactBidInRange = String(card.dataset.showBidInRange || "") === "true";
    const exactHasScheduledInventory = String(card.dataset.showHasScheduledInventory || "") === "true";
    const filtered = state.shows.filter(show => {
      const sellerMatch = seller ? String(show.sellerUsername || "").trim().toLowerCase() === seller : true;
      const text = `${show.title || ""} ${show.sellerUsername || ""} ${show.state || ""}`.toLowerCase();
      const queryMatch = !search || text.includes(search) || title.toLowerCase().includes(search);
      return sellerMatch && (show.state === "live" || show.state === "upcoming" || show.id === exactShowId) && queryMatch;
    });
    const cards = exactShowId ? [{
      id: exactShowId,
      title: exactShowTitle || filtered[0]?.title || "Crack Packs show",
      sellerUsername: seller,
      state: exactShowStatus || filtered[0]?.state || "open",
      startsAt: filtered[0]?.startsAt || "",
      viewers: filtered[0]?.viewers || 0,
      livePageUrl: exactShowLink,
      startingBidCents: exactStartingBidCents,
      startingBidInRange: exactBidInRange,
      hasScheduledInventory: exactHasScheduledInventory
    }, ...filtered.filter(show => show.id !== exactShowId).map(show => ({
      ...show,
      livePageUrl: `live.html?show=${encodeURIComponent(show.id || "")}`,
      startingBidCents: 0,
      startingBidInRange: false,
      hasScheduledInventory: false
    }))] : filtered.map(show => ({
      ...show,
      livePageUrl: `live.html?show=${encodeURIComponent(show.id || "")}`,
      startingBidCents: 0,
      startingBidInRange: false,
      hasScheduledInventory: false
    }));
    showCopy.textContent = filtered.length
      ? `Live and upcoming shows for @${seller || "seller"} connected to ${title}.`
      : `No matching live or upcoming shows found for @${seller || "seller"} right now.`;
    showResults.innerHTML = `
      <div class="store-listing-summary">
        <span><small>Title</small><strong>${title}</strong></span>
        <span><small>Category</small><strong>${category}</strong></span>
        <span><small>Price</small><strong>${price}</strong></span>
        <span><small>Condition</small><strong>${condition}</strong></span>
        <span><small>Show</small><strong>${cards.length ? `${cards.length} found` : "0 found"}</strong></span>
      </div>
      ${cards.map(show => `
        <article class="store-show-card">
          <div class="store-show-card-top">
            <span class="store-show-pill ${show.state === "live" ? "is-live" : "is-upcoming"}">${show.state === "live" ? "Live now" : "Upcoming"}</span>
            <span class="store-show-badge">@${show.sellerUsername || "seller"}</span>
          </div>
          <h3>${show.title || "Crack Packs show"}</h3>
          <p>${show.state === "live" ? "Bidding is active now." : "Save the date and watch this one when it opens."}</p>
          <div class="store-show-card-meta">
            <span>${show.state === "live" ? "Live now" : dateLabel(show.startsAt)}</span>
            <span>${Number(show.viewers || 0)} viewers</span>
            ${show.hasScheduledInventory ? `<span>Show inventory ready</span>` : ""}
            ${show.startingBidCents > 0 ? `<span>Start bid $${(show.startingBidCents / 100).toFixed(2)}</span>` : ""}
            ${show.startingBidInRange ? `<span>Bid in range</span>` : ""}
          </div>
          <div class="store-show-card-actions">
            <a class="btn btn-primary btn-small" href="${show.livePageUrl || `live.html?show=${encodeURIComponent(show.id || "")}`}">${show.state === "live" ? "Watch live sale" : "Open show page"}</a>
            <a class="btn btn-outline btn-small" href="streams.html">Live hub</a>
          </div>
        </article>`).join("") || `<article class="store-show-card"><h3>No matching show yet</h3><p>Try a broader search, or check the seller live hub page for new inventory and auctions.</p><div class="store-show-card-actions"><a class="btn btn-primary btn-small" href="streams.html">Open live hub</a></div></article>`}
    `;
    showModal.hidden = false;
    showModal.setAttribute("aria-hidden", "false");
  }

  function refreshSuggestions() {
    if (!suggestions) return;
    if (!state.search) {
      suggestions.hidden = true;
      suggestions.innerHTML = "";
      return;
    }
    const cards = [...catalog.querySelectorAll("[data-product-card]")];
    const matches = cards.filter(card => String(card.dataset.search || "").includes(state.search)).slice(0, 6);
    suggestions.hidden = !matches.length;
    suggestions.innerHTML = matches.map(card => `<button class="filter-btn" type="button" data-suggestion="${(card.querySelector("h3")?.textContent || "").replace(/"/g, "&quot;")}">${card.querySelector("h3")?.textContent || "Listing"} · ${pretty(card.dataset.subcategory || card.dataset.primaryCategory || "listing")} · @${card.dataset.seller || "seller"}</button>`).join("");
  }

  function applyFilters() {
    if (syncingCatalog) return;
    hydrateCards();
    const cards = [...catalog.querySelectorAll("[data-product-card]")];
    syncingCatalog = true;
    applySorting(cards).forEach(card => catalog.append(card));
    let visible = 0;
    const series = activeSeries();
    cards.forEach(card => {
      const searchMatch = !state.search || String(card.dataset.search || "").includes(state.search);
      const sellerMatch = !state.seller || String(card.dataset.seller || "").includes(state.seller);
      const primaryMatch = state.primary === "all" || String(card.dataset.primaryCategory || "all") === state.primary;
      const subcategoryMatch = state.subcategory === "all" || String(card.dataset.subcategory || "other") === state.subcategory;
      const priceDollars = Number(card.dataset.priceCents || 0) / 100;
      const priceMatch = priceDollars >= state.minPrice && priceDollars <= state.maxPrice;
      const seriesMatch = series === "all" || String(card.dataset.series || "").toLowerCase() === series;
      const show = searchMatch && sellerMatch && primaryMatch && subcategoryMatch && priceMatch && seriesMatch;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (emptyState) emptyState.hidden = visible !== 0;
    refreshSuggestions();
    syncingCatalog = false;
  }

  topTenWindow?.addEventListener("change", renderTopTen);
  searchInput?.addEventListener("input", event => {
    state.search = String(event.currentTarget.value || "").trim().toLowerCase();
    applyFilters();
  });
  sellerSearchInput?.addEventListener("input", event => {
    state.seller = String(event.currentTarget.value || "").trim().toLowerCase();
    applyFilters();
  });
  sortSelect?.addEventListener("change", event => {
    state.sort = String(event.currentTarget.value || "rank");
    applyFilters();
  });
  subcategoryFilter?.addEventListener("change", event => {
    state.subcategory = String(event.currentTarget.value || "all");
    applyFilters();
  });
  suggestions?.addEventListener("click", event => {
    const button = event.target.closest("[data-suggestion]");
    if (!button || !searchInput) return;
    searchInput.value = button.dataset.suggestion || "";
    state.search = String(searchInput.value || "").trim().toLowerCase();
    applyFilters();
  });
  catalog.addEventListener("click", event => {
    const button = event.target.closest("[data-store-show-open]");
    if (!button) return;
    const card = button.closest("[data-product-card]");
    if (card) openShowModal(card);
  });
  showModal?.addEventListener("click", event => {
    if (event.target.closest("[data-store-show-close]")) closeShowModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && showModal && !showModal.hidden) closeShowModal();
  });
  priceMinInput?.addEventListener("input", event => {
    state.minPrice = Number(event.currentTarget.value || 0);
    if (state.minPrice > state.maxPrice) {
      state.maxPrice = state.minPrice;
      if (priceMaxInput) priceMaxInput.value = String(state.maxPrice);
    }
    updatePriceReadout();
    applyFilters();
  });
  priceMaxInput?.addEventListener("input", event => {
    state.maxPrice = Number(event.currentTarget.value || 0);
    if (state.maxPrice < state.minPrice) {
      state.minPrice = state.maxPrice;
      if (priceMinInput) priceMinInput.value = String(state.minPrice);
    }
    updatePriceReadout();
    applyFilters();
  });

  const observer = new MutationObserver(() => {
    if (syncingCatalog) return;
    updatePriceControls();
    applyFilters();
  });
  observer.observe(catalog, { childList: true });

  renderPrimaryTabs();
  populateSubcategories();
  renderTopTen();
  updatePriceControls();
  loadShows().finally(applyFilters);
})();
