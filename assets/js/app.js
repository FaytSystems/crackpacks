(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const products = (window.CRACKPACKS_PRODUCTS || []).filter(item => item.enabled !== false);
  const releases = window.CRACKPACKS_RELEASES || [];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));

  const resolveDynamicUrl = url => {
    if (!url || url.includes("YOUR_USERNAME")) return config.whatnotUrl || "#";
    return url;
  };

  const isExternal = url => /^https?:\/\//i.test(url || "");

  document.querySelectorAll("[data-whatnot]").forEach(link => {
    const url = config.whatnotUrl || "#";
    link.href = url;
    if (isExternal(url)) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  });

  document.querySelectorAll("[data-email]").forEach(link => {
    const email = config.email || "hello@crackpacks.com";
    link.href = `mailto:${email}`;
    link.textContent = email;
  });

  document.querySelectorAll("[data-year]").forEach(element => {
    element.textContent = String(new Date().getFullYear());
  });

  document.querySelectorAll("[data-updated]").forEach(element => {
    element.textContent = config.updated || "";
  });

  const storeNotice = document.querySelector("[data-store-notice]");
  if (storeNotice) storeNotice.textContent = config.storeNotice || "";

  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".site-nav");
  menuButton?.addEventListener("click", () => {
    const open = navigation?.classList.toggle("is-open") ?? false;
    menuButton.setAttribute("aria-expanded", String(open));
  });

  navigation?.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      navigation.classList.remove("is-open");
      menuButton?.setAttribute("aria-expanded", "false");
    });
  });

  function externalAttributes(url) {
    return isExternal(url) ? ' target="_blank" rel="noopener noreferrer"' : "";
  }

  function productCard(item) {
    const url = resolveDynamicUrl(item.url);
    return `
      <article class="product-card holo-panel reveal" data-product-card data-category="${escapeHtml(item.category)}" data-search="${escapeHtml(`${item.name} ${item.type} ${item.set} ${item.description}`.toLowerCase())}" id="${escapeHtml(item.id)}">
        <a class="product-media" href="${escapeHtml(url)}"${externalAttributes(url)} aria-label="View ${escapeHtml(item.name)}">
          <img src="${escapeHtml(item.image)}" alt="Original Crack Packs artwork for ${escapeHtml(item.name)}" loading="lazy">
          <span class="product-badge">${escapeHtml(item.badge)}</span>
          <span class="holo-sheen" aria-hidden="true"></span>
        </a>
        <div class="product-body">
          <p class="card-kicker">${escapeHtml(item.type)}</p>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="product-set">${escapeHtml(item.set)}</p>
          <p class="product-description">${escapeHtml(item.description)}</p>
          <div class="product-footer">
            <div><strong>${escapeHtml(item.priceLabel)}</strong><span>${escapeHtml(item.stockLabel)}</span></div>
            <a class="btn btn-small btn-outline" href="${escapeHtml(url)}"${externalAttributes(url)}>View listing ↗</a>
          </div>
        </div>
      </article>`;
  }

  const featuredProducts = document.querySelector("[data-featured-products]");
  if (featuredProducts) {
    featuredProducts.innerHTML = products.filter(item => item.featured).slice(0, 4).map(productCard).join("");
  }

  const allProducts = document.querySelector("[data-all-products]");
  if (allProducts) {
    allProducts.innerHTML = products.map(productCard).join("");
  }

  let activeProductFilter = "all";
  let productSearchTerm = "";

  function applyProductFilters() {
    const cards = [...document.querySelectorAll("[data-product-card]")];
    let visible = 0;
    cards.forEach(card => {
      const categoryMatch = activeProductFilter === "all" || card.dataset.category === activeProductFilter;
      const searchMatch = !productSearchTerm || card.dataset.search.includes(productSearchTerm);
      const show = categoryMatch && searchMatch;
      card.hidden = !show;
      if (show) visible += 1;
    });
    const empty = document.querySelector("[data-product-empty]");
    if (empty) empty.hidden = visible !== 0;
  }

  document.querySelectorAll("[data-product-filter]").forEach(button => {
    button.addEventListener("click", () => {
      activeProductFilter = button.dataset.productFilter || "all";
      document.querySelectorAll("[data-product-filter]").forEach(item => item.classList.toggle("is-active", item === button));
      applyProductFilters();
    });
  });

  const searchInput = document.querySelector("[data-product-search]");
  searchInput?.addEventListener("input", event => {
    productSearchTerm = event.currentTarget.value.trim().toLowerCase();
    applyProductFilters();
  });

  const requestedCategory = new URLSearchParams(window.location.search).get("category");
  if (requestedCategory) {
    const button = document.querySelector(`[data-product-filter="${CSS.escape(requestedCategory)}"]`);
    button?.click();
  }


  function cardMarketPrice(card) {
    const priceGroups = card?.tcgplayer?.prices || {};
    const priority = [
      "normal",
      "holofoil",
      "reverseHolofoil",
      "unlimitedHolofoil",
      "unlimited",
      "firstEditionHolofoil",
      "firstEditionNormal"
    ];

    for (const groupName of priority) {
      const market = Number(priceGroups[groupName]?.market);
      if (Number.isFinite(market) && market > 0) return market;
    }

    for (const group of Object.values(priceGroups)) {
      const market = Number(group?.market);
      if (Number.isFinite(market) && market > 0) return market;
    }

    return null;
  }

  function catalogCard(card) {
    const image = card?.images?.small || card?.images?.large || "assets/images/product-cosmic.svg";
    const largeImage = card?.images?.large || image;
    const setName = card?.set?.name || "Unknown set";
    const number = card?.number ? `#${card.number}` : "Number unavailable";
    const rarity = card?.rarity || "Rarity unavailable";
    const types = Array.isArray(card?.types) && card.types.length ? card.types.join(" · ") : "Trading Card";
    const price = cardMarketPrice(card);
    const priceLabel = price === null ? "Market price unavailable" : `Market reference $${price.toFixed(2)}`;
    const pricingUrl = card?.tcgplayer?.url || largeImage;

    return `
      <article class="catalog-card holo-panel reveal is-visible">
        <a class="catalog-card-media" href="${escapeHtml(largeImage)}" target="_blank" rel="noopener noreferrer" aria-label="Open large image of ${escapeHtml(card?.name || "card")}">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(card?.name || "Pokémon trading card")}" loading="lazy">
          <span class="holo-sheen" aria-hidden="true"></span>
        </a>
        <div class="catalog-card-body">
          <p class="card-kicker">${escapeHtml(types)}</p>
          <h3>${escapeHtml(card?.name || "Unknown card")}</h3>
          <p class="catalog-set">${escapeHtml(setName)} <span>${escapeHtml(number)}</span></p>
          <p class="catalog-rarity">${escapeHtml(rarity)}</p>
          <div class="catalog-card-footer">
            <strong>${escapeHtml(priceLabel)}</strong>
            <a class="text-link" href="${escapeHtml(pricingUrl)}" target="_blank" rel="noopener noreferrer">Card details ↗</a>
          </div>
        </div>
      </article>`;
  }

  const catalogForm = document.querySelector("[data-card-catalog-form]");
  if (catalogForm) {
    const catalogInput = catalogForm.querySelector("[data-card-catalog-input]");
    const catalogOrder = catalogForm.querySelector("[data-card-catalog-order]");
    const catalogResults = document.querySelector("[data-card-catalog-results]");
    const catalogStatus = document.querySelector("[data-card-catalog-status]");
    const catalogEmpty = document.querySelector("[data-card-catalog-empty]");
    const catalogLoadMore = document.querySelector("[data-card-catalog-more]");
    const catalogSubmit = catalogForm.querySelector('button[type="submit"]');
    const cardApiUrl = String(config.cardApiUrl || "").trim();
    const pageSize = Math.min(Math.max(Number(config.cardSearchPageSize) || 24, 1), 48);

    let activeSearch = "";
    let activeOrder = "-set.releaseDate";
    let activePage = 1;
    let totalCount = 0;
    let renderedCount = 0;
    let requestController = null;

    function setCatalogLoading(loading) {
      catalogForm.setAttribute("aria-busy", String(loading));
      if (catalogSubmit) catalogSubmit.disabled = loading;
      if (catalogLoadMore) catalogLoadMore.disabled = loading;
      catalogResults?.classList.toggle("is-loading", loading);
    }

    function setCatalogStatus(message, state = "") {
      if (!catalogStatus) return;
      catalogStatus.textContent = message;
      catalogStatus.dataset.state = state;
    }

    function buildCatalogUrl(term, page) {
      const url = new URL(cardApiUrl);
      url.searchParams.set("term", term);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      url.searchParams.set("orderBy", activeOrder);
      return url.toString();
    }

    async function searchCatalog({ append = false } = {}) {
      if (!cardApiUrl) {
        setCatalogStatus("Card search is not configured yet. Add cardApiUrl in assets/js/config.js.", "error");
        return;
      }

      if (activeSearch.length < 2) {
        setCatalogStatus("Enter at least two characters, such as Charizard, Pikachu ex, or Umbreon.", "error");
        catalogInput?.focus();
        return;
      }

      requestController?.abort();
      requestController = new AbortController();
      setCatalogLoading(true);
      setCatalogStatus(append ? "Loading more cards…" : `Searching the card catalog for “${activeSearch}”…`, "loading");
      if (!append && catalogEmpty) catalogEmpty.hidden = true;

      try {
        const response = await fetch(buildCatalogUrl(activeSearch, activePage), {
          headers: { Accept: "application/json" },
          signal: requestController.signal
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload?.error || `Card search failed with status ${response.status}.`);
        }

        const cards = Array.isArray(payload?.data) ? payload.data : [];
        totalCount = Number(payload?.totalCount) || cards.length;
        renderedCount = append ? renderedCount + cards.length : cards.length;

        if (catalogResults) {
          const markup = cards.map(catalogCard).join("");
          if (append) catalogResults.insertAdjacentHTML("beforeend", markup);
          else catalogResults.innerHTML = markup;
        }

        const noResults = renderedCount === 0;
        if (catalogEmpty) catalogEmpty.hidden = !noResults;
        if (catalogLoadMore) catalogLoadMore.hidden = noResults || renderedCount >= totalCount || cards.length < pageSize;

        if (noResults) {
          setCatalogStatus(`No cards found for “${activeSearch}”. Try a shorter name or different spelling.`, "empty");
        } else {
          setCatalogStatus(`Showing ${renderedCount.toLocaleString()} of ${totalCount.toLocaleString()} matching cards.`, "success");
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!append && catalogResults) catalogResults.innerHTML = "";
        if (catalogLoadMore) catalogLoadMore.hidden = true;
        setCatalogStatus(error?.message || "Card search is temporarily unavailable.", "error");
      } finally {
        setCatalogLoading(false);
      }
    }

    catalogForm.addEventListener("submit", event => {
      event.preventDefault();
      activeSearch = catalogInput?.value.trim() || "";
      activeOrder = catalogOrder?.value || "-set.releaseDate";
      activePage = 1;
      renderedCount = 0;
      searchCatalog();
    });

    catalogLoadMore?.addEventListener("click", () => {
      activePage += 1;
      searchCatalog({ append: true });
    });
  }

  function releaseStatus(dateString) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${dateString}T00:00:00`);
    const difference = Math.round((target - today) / 86400000);
    if (difference > 1) return { group: "upcoming", label: `${difference} days away`, className: "status-upcoming" };
    if (difference === 1) return { group: "upcoming", label: "Releases tomorrow", className: "status-upcoming" };
    if (difference === 0) return { group: "upcoming", label: "Releases today", className: "status-today" };
    return { group: "released", label: "Released", className: "status-released" };
  }

  function releaseCard(item) {
    const status = releaseStatus(item.date);
    const formattedDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${item.date}T12:00:00`));
    return `
      <article class="release-card holo-panel reveal accent-${escapeHtml(item.accent || "electric")}" data-release-card data-release-status="${status.group}" id="${escapeHtml(item.id)}">
        <div class="release-media">
          <img src="${escapeHtml(item.image)}" alt="Original Crack Packs artwork for ${escapeHtml(item.name)} ${escapeHtml(item.product)}" loading="lazy">
          <span class="release-date">${escapeHtml(formattedDate)}</span>
          <span class="holo-sheen" aria-hidden="true"></span>
        </div>
        <div class="release-body">
          <p class="card-kicker">${escapeHtml(item.name)}</p>
          <h3>${escapeHtml(item.product)}</h3>
          <div class="release-meta"><span>${escapeHtml(item.msrp)}</span><strong class="${status.className}">${escapeHtml(status.label)}</strong></div>
          <p>${escapeHtml(item.details)}</p>
          <div class="release-actions">
            <a class="btn btn-small btn-outline" href="${escapeHtml(item.shopUrl)}">Check store</a>
            <a class="text-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceLabel)} ↗</a>
          </div>
        </div>
      </article>`;
  }

  const featuredReleases = document.querySelector("[data-featured-releases]");
  if (featuredReleases) {
    featuredReleases.innerHTML = releases.filter(item => item.featured).slice(0, 3).map(releaseCard).join("");
  }

  const allReleases = document.querySelector("[data-all-releases]");
  if (allReleases) {
    allReleases.innerHTML = releases.map(releaseCard).join("");
  }

  document.querySelectorAll("[data-release-filter]").forEach(button => {
    button.addEventListener("click", () => {
      const filter = button.dataset.releaseFilter || "all";
      document.querySelectorAll("[data-release-filter]").forEach(item => item.classList.toggle("is-active", item === button));
      const cards = [...document.querySelectorAll("[data-release-card]")];
      let visible = 0;
      cards.forEach(card => {
        const show = filter === "all" || card.dataset.releaseStatus === filter;
        card.hidden = !show;
        if (show) visible += 1;
      });
      const empty = document.querySelector("[data-release-empty]");
      if (empty) empty.hidden = visible !== 0;
    });
  });

  document.querySelectorAll("[data-marquee]").forEach(marquee => {
    const slides = [...marquee.querySelectorAll(".marquee-slide")];
    const dots = marquee.querySelector(".marquee-dots");
    if (slides.length < 2 || !dots) return;

    let current = 0;
    let intervalId;

    const buttons = slides.map((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Show slide ${index + 1}`);
      button.addEventListener("click", () => show(index, true));
      dots.appendChild(button);
      return button;
    });

    function show(index, restart = false) {
      current = (index + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => slide.classList.toggle("is-active", slideIndex === current));
      buttons.forEach((button, buttonIndex) => button.classList.toggle("is-active", buttonIndex === current));
      if (restart && !reduceMotion) start();
    }

    function start() {
      clearInterval(intervalId);
      intervalId = window.setInterval(() => show(current + 1), 5200);
    }

    marquee.addEventListener("mouseenter", () => clearInterval(intervalId));
    marquee.addEventListener("mouseleave", () => !reduceMotion && start());
    marquee.addEventListener("focusin", () => clearInterval(intervalId));
    marquee.addEventListener("focusout", () => !reduceMotion && start());

    show(0);
    if (!reduceMotion) start();
  });

  document.querySelector("[data-newsletter]")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.querySelector('input[type="email"]')?.value.trim() || "";
    const target = new URL("referral.html", window.location.href);
    target.searchParams.set("mode", "signup");
    if (email) target.searchParams.set("email", email);
    window.location.assign(target.href);
  });

  const revealItems = [...document.querySelectorAll(".reveal")];
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealItems.forEach(item => item.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach(item => observer.observe(item));
  }
})();
