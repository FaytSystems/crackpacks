(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const apiUrl = config.cardApiUrl || "https://api.crackpacks.com/cards";

  const form = document.querySelector("[data-price-check-form]");
  if (!form) return;

  const input = form.querySelector("[data-price-check-term]");
  const field = form.querySelector("[data-price-check-field]");
  const order = form.querySelector("[data-price-check-order]");
  const language = form.querySelector("[data-price-check-language]");
  const pageSize = form.querySelector("[data-price-check-size]");
  const submit = form.querySelector("[data-price-check-submit]");
  const reset = form.querySelector("[data-price-check-reset]");
  const results = document.querySelector("[data-price-check-results]");
  const status = document.querySelector("[data-price-check-status]");
  const empty = document.querySelector("[data-price-check-empty]");
  const emptyText = document.querySelector("[data-price-check-empty-text]");
  const errorBox = document.querySelector("[data-price-check-error]");
  const errorText = document.querySelector("[data-price-check-error-text]");
  const pager = document.querySelector("[data-price-check-pager]");
  const previous = document.querySelector("[data-price-check-previous]");
  const next = document.querySelector("[data-price-check-next]");
  const pageLabel = document.querySelector("[data-price-check-page]");
  const summary = document.querySelector("[data-price-check-summary]");
  const seriesTabs = document.querySelector("[data-card-series-tabs]");
  const mainCategoryTabs = document.querySelector("[data-main-category-tabs]");
  const suggestionList = document.querySelector("[data-price-check-suggestions]");
  const closeMatches = document.querySelector("[data-close-match-suggestions]");

  const state = {
    term: "",
    field: "all",
    orderBy: "-set.releaseDate",
    mainCategory: "tcg",
    series: "pokemon",
    language: "any",
    pageSize: 20,
    page: 1,
    totalCount: 0,
    count: 0,
    loading: false,
    controller: null
  };

  const languageSets = {
    tcg: [
      ["any", "Any language"],
      ["en", "English"],
      ["ja", "Japanese"],
      ["zh-cn", "Chinese - Simplified"],
      ["zh-tw", "Chinese - Traditional"],
      ["ko", "Korean"],
      ["fr", "French"],
      ["de", "German"],
      ["it", "Italian"],
      ["es", "Spanish"],
      ["pt", "Portuguese"],
      ["pt-br", "Portuguese - Brazil"],
      ["nl", "Dutch"],
      ["pl", "Polish"],
      ["ru", "Russian"],
      ["id", "Indonesian"],
      ["th", "Thai"]
    ],
    magic: [
      ["any", "Any language"],
      ["en", "English"],
      ["ja", "Japanese"],
      ["zh-cn", "Chinese - Simplified"],
      ["zh-tw", "Chinese - Traditional"],
      ["ko", "Korean"],
      ["fr", "French"],
      ["de", "German"],
      ["it", "Italian"],
      ["es", "Spanish"],
      ["pt", "Portuguese"],
      ["ru", "Russian"],
      ["he", "Hebrew"],
      ["la", "Latin"],
      ["grc", "Ancient Greek"],
      ["ar", "Arabic"]
    ],
    sports: [
      ["any", "Any language / region"],
      ["en", "English"],
      ["ja", "Japanese"],
      ["zh-cn", "Chinese"],
      ["ko", "Korean"],
      ["es", "Spanish"],
      ["fr", "French"],
      ["de", "German"],
      ["it", "Italian"],
      ["pt", "Portuguese"]
    ],
    memorabilia: [
      ["any", "Any language / region"],
      ["en", "English"],
      ["ja", "Japanese"],
      ["zh-cn", "Chinese"],
      ["ko", "Korean"],
      ["es", "Spanish"],
      ["fr", "French"],
      ["de", "German"],
      ["it", "Italian"],
      ["pt", "Portuguese"]
    ]
  };

  const mainCategories = [
    { id: "tcg", label: "TCG Games", short: "TCG", description: "Pokemon, Magic, One Piece and other trading-card games" },
    { id: "sports", label: "Sports", short: "SP", description: "Soccer, football, basketball, baseball, hockey and more" },
    { id: "memorabilia", label: "Memorabilia", short: "MEM", description: "Signed pieces, apparel, equipment, cups, mugs and collectibles" }
  ];

  const seriesOptions = [
    { id: "pokemon", mainCategory: "tcg", label: "Pokemon", short: "PK", apiBacked: true, languageSet: "tcg", querySuffix: "Pokemon TCG card", marketGroup: "tcg", suggestions: ["Charizard", "Pikachu", "Eevee", "Mewtwo", "Japanese Charizard", "Korean Pikachu", "Chinese Pokemon booster box", "PSA 10 Charizard"] },
    { id: "magic", mainCategory: "tcg", label: "Magic", short: "MTG", apiBacked: true, languageSet: "magic", querySuffix: "Magic the Gathering card", marketGroup: "tcg", suggestions: ["Black Lotus", "Sol Ring", "Lightning Bolt", "Mana Crypt", "Japanese Liliana", "Korean Magic foil", "Chinese Magic booster box"] },
    { id: "onepiece", mainCategory: "tcg", label: "One Piece", short: "OP", apiBacked: true, querySuffix: "One Piece card game card", marketGroup: "tcg", suggestions: ["Monkey D Luffy manga", "Roronoa Zoro", "Nami parallel", "One Piece booster box", "Japanese One Piece card"] },
    { id: "yugioh", mainCategory: "tcg", label: "Yu-Gi-Oh!", short: "YG", apiBacked: true, querySuffix: "Yu-Gi-Oh card", marketGroup: "tcg", suggestions: ["Blue-Eyes White Dragon", "Dark Magician", "Exodia", "Starlight Rare", "Japanese Yu-Gi-Oh card", "Korean Blue-Eyes"] },
    { id: "lorcana", mainCategory: "tcg", label: "Lorcana", short: "LC", apiBacked: true, querySuffix: "Disney Lorcana card", marketGroup: "tcg", suggestions: ["Elsa Spirit of Winter", "Mickey Mouse Brave Little Tailor", "Lorcana enchanted", "Lorcana booster box"] },
    { id: "dragonball", mainCategory: "tcg", label: "Dragon Ball", short: "DB", apiBacked: true, querySuffix: "Dragon Ball Super card game card", marketGroup: "tcg", suggestions: ["Son Goku SCR", "Vegeta SPR", "Dragon Ball booster box", "Japanese Dragon Ball card"] },
    { id: "digimon", mainCategory: "tcg", label: "Digimon", short: "DG", apiBacked: true, querySuffix: "Digimon card game card", marketGroup: "tcg", suggestions: ["Omnimon", "WarGreymon", "Digimon alternate art", "Digimon booster box"] },
    { id: "fab", mainCategory: "tcg", label: "Flesh and Blood", short: "FAB", apiBacked: true, querySuffix: "Flesh and Blood TCG card", marketGroup: "tcg", suggestions: ["Command and Conquer", "Fyendal's Spring Tunic", "Cold Foil", "Flesh and Blood booster box"] },
    { id: "weiss", mainCategory: "tcg", label: "Weiss Schwarz", short: "WS", querySuffix: "Weiss Schwarz card", marketGroup: "tcg", suggestions: ["Weiss Schwarz signed SP", "Attack on Titan SP", "Hololive SSP", "Japanese Weiss Schwarz"] },
    { id: "starwars", mainCategory: "tcg", label: "Star Wars Unlimited", short: "SWU", apiBacked: true, querySuffix: "Star Wars Unlimited card", marketGroup: "tcg", suggestions: ["Darth Vader", "Luke Skywalker showcase", "Star Wars Unlimited booster box"] },
    { id: "unionarena", mainCategory: "tcg", label: "Union Arena", short: "UA", apiBacked: true, querySuffix: "Union Arena card", marketGroup: "tcg", suggestions: ["Union Arena signed", "Jujutsu Kaisen Union Arena", "Hunter x Hunter Union Arena"] },
    { id: "cardfight", mainCategory: "tcg", label: "Cardfight Vanguard", short: "VG", querySuffix: "Cardfight Vanguard card", marketGroup: "tcg", suggestions: ["Cardfight Vanguard SP", "Blaster Blade", "Vanguard booster box"] },
    { id: "shadowverse", mainCategory: "tcg", label: "Shadowverse Evolve", short: "SV", querySuffix: "Shadowverse Evolve card", marketGroup: "tcg", suggestions: ["Shadowverse Evolve leader", "Uma Musume leader", "Shadowverse booster box"] },
    { id: "graded", mainCategory: "tcg", label: "Graded slabs", short: "10", querySuffix: "graded trading card PSA BGS CGC", marketGroup: "graded", suggestions: ["PSA 10 Charizard", "BGS 10 Black Label", "CGC Pristine Pokemon", "PSA 10 manga Luffy"] },
    { id: "sealed", mainCategory: "tcg", label: "Sealed boxes", short: "BX", querySuffix: "sealed trading card booster box", marketGroup: "sealed", suggestions: ["Pokemon booster box", "Japanese booster box", "Magic collector booster box", "One Piece booster box"] },
    { id: "other_tcg", mainCategory: "tcg", label: "Other TCG", short: "TCG+", querySuffix: "trading card game card", marketGroup: "tcg", suggestions: ["MetaZoo card", "Grand Archive card", "Universus card", "Final Fantasy TCG card"] },

    { id: "sports_all", mainCategory: "sports", label: "All sports", short: "ALL", querySuffix: "sports card", marketGroup: "sports", suggestions: ["Michael Jordan rookie", "Tom Brady rookie", "Lionel Messi rookie", "Shohei Ohtani rookie", "Wayne Gretzky rookie"] },
    { id: "baseball", mainCategory: "sports", label: "Baseball", short: "BB", querySuffix: "baseball card", marketGroup: "sports", suggestions: ["Shohei Ohtani rookie", "Ken Griffey Jr rookie", "Mickey Mantle", "Topps Chrome baseball"] },
    { id: "basketball", mainCategory: "sports", label: "Basketball", short: "BK", querySuffix: "basketball card", marketGroup: "sports", suggestions: ["Michael Jordan rookie", "LeBron James rookie", "Kobe Bryant rookie", "Victor Wembanyama rookie"] },
    { id: "football", mainCategory: "sports", label: "Football", short: "FB", querySuffix: "football card", marketGroup: "sports", suggestions: ["Tom Brady rookie", "Patrick Mahomes rookie", "CJ Stroud rookie", "Prizm football"] },
    { id: "soccer", mainCategory: "sports", label: "Soccer", short: "SC", querySuffix: "soccer card", marketGroup: "sports", suggestions: ["Lionel Messi rookie", "Cristiano Ronaldo rookie", "Kylian Mbappe rookie", "Panini soccer"] },
    { id: "hockey", mainCategory: "sports", label: "Hockey", short: "HK", querySuffix: "hockey card", marketGroup: "sports", suggestions: ["Wayne Gretzky rookie", "Connor McDavid rookie", "Connor Bedard Young Guns", "Upper Deck hockey"] },
    { id: "racing", mainCategory: "sports", label: "Racing", short: "RC", querySuffix: "racing card", marketGroup: "sports", suggestions: ["Lewis Hamilton card", "Dale Earnhardt card", "Max Verstappen card"] },
    { id: "wrestling", mainCategory: "sports", label: "Wrestling", short: "WR", querySuffix: "wrestling card", marketGroup: "sports", suggestions: ["Hulk Hogan card", "The Rock rookie", "WWE Prizm"] },
    { id: "golf", mainCategory: "sports", label: "Golf", short: "GF", querySuffix: "golf card", marketGroup: "sports", suggestions: ["Tiger Woods rookie", "Upper Deck golf", "Rory McIlroy card"] },
    { id: "tennis", mainCategory: "sports", label: "Tennis", short: "TN", querySuffix: "tennis card", marketGroup: "sports", suggestions: ["Serena Williams card", "Roger Federer card", "Carlos Alcaraz rookie"] },
    { id: "combat", mainCategory: "sports", label: "UFC / Boxing", short: "UFC", querySuffix: "UFC boxing card", marketGroup: "sports", suggestions: ["Conor McGregor card", "Muhammad Ali card", "UFC Prizm"] },

    { id: "memorabilia_all", mainCategory: "memorabilia", label: "All memorabilia", short: "ALL", querySuffix: "sports memorabilia collectible", marketGroup: "memorabilia", suggestions: ["signed jersey", "game used jersey", "signed baseball", "signed hockey stick", "signed football helmet"] },
    { id: "signed", mainCategory: "memorabilia", label: "Signed", short: "SIG", querySuffix: "signed autograph memorabilia", marketGroup: "memorabilia", suggestions: ["signed Michael Jordan jersey", "signed baseball", "signed Pokemon card", "signed photo"] },
    { id: "jerseys", mainCategory: "memorabilia", label: "Game jerseys", short: "JER", querySuffix: "game used jersey memorabilia", marketGroup: "memorabilia", suggestions: ["game used jersey", "signed jersey", "match worn soccer jersey"] },
    { id: "hats", mainCategory: "memorabilia", label: "Hats", short: "HAT", querySuffix: "collectible hat cap memorabilia", marketGroup: "memorabilia", suggestions: ["signed hat", "team cap collectible", "game used hat"] },
    { id: "tees", mainCategory: "memorabilia", label: "Tee shirts", short: "TEE", querySuffix: "tee shirt collectible memorabilia", marketGroup: "memorabilia", suggestions: ["vintage team tee", "signed tee shirt", "concert tee collectible"] },
    { id: "cups_mugs", mainCategory: "memorabilia", label: "Cups / mugs", short: "CUP", querySuffix: "cup mug collectible memorabilia", marketGroup: "memorabilia", suggestions: ["team mug", "stadium cup", "vintage sports cup"] },
    { id: "pennants", mainCategory: "memorabilia", label: "Pennants", short: "PEN", querySuffix: "pennant collectible memorabilia", marketGroup: "memorabilia", suggestions: ["vintage pennant", "team pennant", "World Series pennant"] },
    { id: "baseballs_mem", mainCategory: "memorabilia", label: "Baseballs", short: "BALL", querySuffix: "signed baseball memorabilia", marketGroup: "memorabilia", suggestions: ["signed baseball", "game used baseball", "World Series baseball"] },
    { id: "equipment", mainCategory: "memorabilia", label: "Equipment", short: "EQ", querySuffix: "game used sports equipment memorabilia", marketGroup: "memorabilia", suggestions: ["game used equipment", "signed helmet", "game used cleats"] },
    { id: "hockey_sticks", mainCategory: "memorabilia", label: "Hockey sticks", short: "STK", querySuffix: "game used hockey stick memorabilia", marketGroup: "memorabilia", suggestions: ["signed hockey stick", "game used hockey stick", "Wayne Gretzky stick"] },
    { id: "bats", mainCategory: "memorabilia", label: "Baseball bats", short: "BAT", querySuffix: "game used baseball bat memorabilia", marketGroup: "memorabilia", suggestions: ["signed baseball bat", "game used bat", "Louisville Slugger signed"] },
    { id: "gloves", mainCategory: "memorabilia", label: "Gloves", short: "GLV", querySuffix: "game used glove memorabilia", marketGroup: "memorabilia", suggestions: ["game used glove", "signed boxing glove", "baseball glove signed"] },
    { id: "shoes", mainCategory: "memorabilia", label: "Shoes", short: "SHOE", querySuffix: "game used shoes sneakers memorabilia", marketGroup: "memorabilia", suggestions: ["game worn shoes", "signed sneakers", "Michael Jordan game shoes"] },
    { id: "tickets_programs", mainCategory: "memorabilia", label: "Tickets / programs", short: "TIX", querySuffix: "ticket program collectible memorabilia", marketGroup: "memorabilia", suggestions: ["Super Bowl ticket", "World Series program", "vintage ticket stub"] },
    { id: "photos_posters", mainCategory: "memorabilia", label: "Photos / posters", short: "PIC", querySuffix: "photo poster collectible memorabilia", marketGroup: "memorabilia", suggestions: ["signed photo", "movie poster signed", "sports poster"] }
  ];

  const seriesMap = new Map(seriesOptions.map(option => [option.id, option]));
  const seriesIds = new Set(seriesOptions.map(option => option.id));
  const mainCategoryIds = new Set(mainCategories.map(option => option.id));

  const priceSources = [
    {
      id: "ebay-sold",
      title: "eBay sold listings",
      priceLabel: "Recent sold prices",
      note: "Completed sales and accepted-offer pages when eBay exposes them.",
      groups: ["tcg", "sports", "graded", "sealed", "memorabilia"],
      url: query => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Complete=1&LH_Sold=1`
    },
    {
      id: "tcgplayer",
      title: "TCGplayer marketplace",
      priceLabel: "Current marketplace prices",
      note: "Listings and product pages for many trading-card games.",
      groups: ["tcg", "sealed"],
      url: query => `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(query)}`
    },
    {
      id: "pricecharting",
      title: "PriceCharting",
      priceLabel: "Charted sold prices",
      note: "Ungraded and graded market charts where available.",
      groups: ["tcg", "sports", "graded", "sealed", "memorabilia"],
      url: query => `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`
    },
    {
      id: "130point",
      title: "130 Point sold-card search",
      priceLabel: "Sold-card comps",
      note: "Sports and trading-card sold-price references from public marketplace data.",
      groups: ["sports", "graded", "memorabilia"],
      url: query => `https://130point.com/cards/?search=${encodeURIComponent(query)}`
    },
    {
      id: "comc",
      title: "COMC marketplace",
      priceLabel: "Card marketplace listings",
      note: "Fixed-price card listings, strongest for sports and singles.",
      groups: ["sports", "graded"],
      url: query => `https://www.comc.com/Cards,sr,i100,=${encodeURIComponent(query)}`
    },
    {
      id: "cardmarket",
      title: "Cardmarket",
      priceLabel: "European market prices",
      note: "Cardmarket search pages for supported trading-card games.",
      groups: ["tcg", "sealed"],
      url: query => `https://www.cardmarket.com/en/Products/Search?searchString=${encodeURIComponent(query)}`
    },
    {
      id: "mercari",
      title: "Mercari marketplace",
      priceLabel: "Current resale listings",
      note: "General collectibles and memorabilia listing pages.",
      groups: ["memorabilia"],
      url: query => `https://www.mercari.com/search/?keyword=${encodeURIComponent(query)}`
    },
    {
      id: "goldin",
      title: "Goldin search",
      priceLabel: "Premium auction comps",
      note: "Auction and premium collectible search results when available.",
      groups: ["sports", "graded", "memorabilia"],
      url: query => `https://goldin.co/search?q=${encodeURIComponent(query)}`
    }
  ];

  const allSuggestions = [...new Set(seriesOptions.flatMap(option => option.suggestions || []))];

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
  const currentLanguageLabel = () => {
    const selected = [...(languageSets[currentSeries().languageSet] || languageSets[state.mainCategory] || languageSets.tcg)]
      .find(([id]) => id === state.language);
    return selected?.[1] || "Any language";
  };

  function renderMainCategories() {
    if (!mainCategoryTabs) return;
    mainCategoryTabs.innerHTML = mainCategories.map(option => `
      <button class="lookup-main-tab${option.id === state.mainCategory ? " is-active" : ""}" type="button" data-main-category="${escapeHtml(option.id)}">
        <span>${escapeHtml(option.short)}</span>
        <strong>${escapeHtml(option.label)}</strong>
        <small>${escapeHtml(option.description)}</small>
      </button>
    `).join("");
  }

  function renderSeriesTabs() {
    if (!seriesTabs) return;
    const options = seriesOptions.filter(option => option.mainCategory === state.mainCategory);
    if (!options.some(option => option.id === state.series)) state.series = options[0]?.id || "pokemon";
    seriesTabs.innerHTML = options.map(option => `
      <button class="card-series-tab${option.id === state.series ? " is-active" : ""}" type="button" data-card-series="${escapeHtml(option.id)}">
        <span>${escapeHtml(option.short)}</span>${escapeHtml(option.label)}
      </button>
    `).join("");
  }

  function renderLanguageOptions() {
    if (!language) return;
    const selectedSeries = currentSeries();
    const options = languageSets[selectedSeries.languageSet] || languageSets[state.mainCategory] || languageSets.tcg;
    if (!options.some(([id]) => id === state.language)) state.language = "any";
    language.innerHTML = options.map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join("");
    language.value = state.language;
  }

  function syncControls() {
    renderMainCategories();
    renderSeriesTabs();
    renderLanguageOptions();
    updateSuggestions();
  }

  function sourceModeReason(series) {
    if (series.apiBacked && series.id === "pokemon" && !["any", "en"].includes(state.language)) {
      return `Reason: Pokemon result cards from the current API are English catalog records; selected ${currentLanguageLabel()} searches open live source pages instead.`;
    }
    if (!series.apiBacked) {
      return `Reason: ${series.label} does not have a direct card database connected here yet, so Crack Packs opens live sold/listing source pages for current prices.`;
    }
    return "";
  }

  function usesApiForCurrentSearch(series = currentSeries()) {
    if (!series.apiBacked) return false;
    if (series.id === "pokemon" && !["any", "en"].includes(state.language)) return false;
    return true;
  }

  function marketQuery(series, term) {
    const languageLabel = state.language === "any" ? "" : currentLanguageLabel();
    return [term, languageLabel, series.querySuffix].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

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
      url.searchParams.set("category", state.mainCategory);
      url.searchParams.set("series", state.series);
      url.searchParams.set("language", state.language);
      url.searchParams.set("size", String(state.pageSize));
      url.searchParams.set("page", String(state.page));
    } else {
      ["q", "field", "sort", "category", "series", "language", "size", "page"].forEach(key => url.searchParams.delete(key));
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
    state.mainCategory = mainCategoryIds.has(params.get("category")) ? params.get("category") : "tcg";
    state.series = seriesIds.has(params.get("series")) ? params.get("series") : seriesOptions.find(option => option.mainCategory === state.mainCategory)?.id || "pokemon";
    state.language = params.get("language") || "any";

    const series = seriesMap.get(state.series);
    if (!series || series.mainCategory !== state.mainCategory) {
      state.series = seriesOptions.find(option => option.mainCategory === state.mainCategory)?.id || "pokemon";
    }

    const parsedSize = Number.parseInt(params.get("size"), 10);
    state.pageSize = allowedSizes.has(parsedSize) ? parsedSize : 20;

    const parsedPage = Number.parseInt(params.get("page"), 10);
    state.page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

    input.value = state.term;
    field.value = state.field;
    order.value = state.orderBy;
    pageSize.value = String(state.pageSize);
    syncControls();
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
        <span>Reason: the connected database returned the card, but did not return pricing for this printing.</span>
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
            <span>${escapeHtml(currentLanguageLabel())}</span>
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
              : `<span class="lookup-no-link">No external market link returned. Use the source-linked cards below if available.</span>`
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
            <strong>${escapeHtml(currentLanguageLabel())}</strong>
          </div>

          <div class="lookup-pricing" aria-label="Source-linked pricing">
            <div class="lookup-pricing-heading">
              <strong>Live market price check</strong>
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
    renderCloseMatches([]);
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function scoreSuggestion(term, candidate) {
    const t = normalize(term);
    const c = normalize(candidate);
    if (!t || !c) return 0;
    if (c === t) return 100;
    if (c.startsWith(t)) return 90;
    if (c.includes(t)) return 75;
    const words = t.split(" ").filter(Boolean);
    return words.reduce((score, word) => score + (c.includes(word) ? 12 : 0), 0);
  }

  function suggestionsForCurrentSeries(term = input.value) {
    const selectedSeries = currentSeries();
    const categorySuggestions = seriesOptions
      .filter(option => option.mainCategory === state.mainCategory)
      .flatMap(option => option.suggestions || []);
    const pool = [...new Set([...(selectedSeries.suggestions || []), ...categorySuggestions, ...allSuggestions])];
    return pool
      .map(candidate => ({ candidate, score: scoreSuggestion(term, candidate) }))
      .filter(item => item.score > 0 || !term)
      .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))
      .slice(0, 12)
      .map(item => item.candidate);
  }

  function updateSuggestions() {
    if (!suggestionList) return;
    suggestionList.innerHTML = suggestionsForCurrentSeries().map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
  }

  function renderCloseMatches(matches) {
    if (!closeMatches) return;
    if (!matches.length) {
      closeMatches.hidden = true;
      closeMatches.innerHTML = "";
      return;
    }
    closeMatches.hidden = false;
    closeMatches.innerHTML = `
      <strong>Close match ideas</strong>
      <div>${matches.map(match => `<button class="lookup-close-match" type="button" data-close-match="${escapeHtml(match)}">${escapeHtml(match)}</button>`).join("")}</div>
    `;
  }

  function noResultReason(series, payload = {}) {
    const parts = [
      `Reason: the connected ${series.label} database returned zero exact matches for "${state.term}".`,
      `Search was limited to ${field.options[field.selectedIndex]?.textContent || "all fields"}.`,
      state.language !== "any" ? `Language filter: ${currentLanguageLabel()}.` : "Language filter: any language."
    ];
    if (payload?.meta?.source) parts.push(`Source: ${payload.meta.source}.`);
    parts.push("Try a close match, shorten the name, remove grading terms, or open the live sold-listing sources.");
    return parts.join(" ");
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
      setStatus("Reason: enter at least two characters so the search can compare names, sets, and marketplace listings.");
      input.focus();
      updateUrl();
      return;
    }

    state.term = term;
    state.field = field.value;
    state.orderBy = order.value;
    state.language = language?.value || "any";
    state.pageSize = Number.parseInt(pageSize.value, 10) || 20;
    const selectedSeries = currentSeries();
    const sourceReason = sourceModeReason(selectedSeries);

    if (!usesApiForCurrentSearch(selectedSeries)) {
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
        summary.textContent = `${compactNumber(cards.length)} live source page${cards.length === 1 ? "" : "s"} for "${state.term}"`;
        summary.hidden = false;
      }
      renderCloseMatches(suggestionsForCurrentSeries(state.term).filter(match => normalize(match) !== normalize(state.term)).slice(0, 6));
      setStatus(`${sourceReason} Open these source pages to see current sold/listing prices.`);
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
    setStatus(`Searching ${selectedSeries.label} for "${state.term}" in ${currentLanguageLabel()}...`);
    updatePager();
    updateUrl();

    const query = new URLSearchParams({
      term: state.term,
      field: state.field,
      series: state.series,
      language: state.language,
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

      const sourceCards = marketSourceCards(selectedSeries, state.term);
      results.innerHTML = [
        ...cards.map(renderCard),
        ...(cards.length ? sourceCards.slice(0, 3).map((source, index) => renderMarketSourceCard(source, index)) : [])
      ].join("");

      if (!cards.length) {
        const reason = noResultReason(selectedSeries, payload);
        setHidden(empty, false);
        if (emptyText) emptyText.textContent = reason;
        setStatus(reason);
        renderCloseMatches(suggestionsForCurrentSeries(state.term).filter(match => normalize(match) !== normalize(state.term)).slice(0, 6));
        results.innerHTML = sourceCards.map(renderMarketSourceCard).join("");
        state.totalCount = sourceCards.length;
        setHidden(pager, true);
        if (summary) {
          summary.textContent = `No exact ${selectedSeries.label} database card; ${sourceCards.length} live price source${sourceCards.length === 1 ? "" : "s"} shown`;
          summary.hidden = false;
        }
      } else {
        const first = ((state.page - 1) * state.pageSize) + 1;
        const last = first + cards.length - 1;
        setStatus(`Showing ${compactNumber(first)}-${compactNumber(last)} of ${compactNumber(state.totalCount)} database matches, plus live source links for current price checks.`);
        renderCloseMatches([]);
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
      const sourceCards = marketSourceCards(selectedSeries, state.term);
      results.innerHTML = sourceCards.map(renderMarketSourceCard).join("");
      state.totalCount = sourceCards.length;
      updatePager();
      showError(`${error?.message || "The card search service could not be reached."} Reason: the live database call failed, so source-linked price pages are shown instead.`);
      renderCloseMatches(suggestionsForCurrentSeries(state.term).filter(match => normalize(match) !== normalize(state.term)).slice(0, 6));
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

  input.addEventListener("input", updateSuggestions);

  reset?.addEventListener("click", () => {
    if (state.controller) state.controller.abort();
    form.reset();
    state.term = "";
    state.field = "all";
    state.orderBy = "-set.releaseDate";
    state.mainCategory = "tcg";
    state.series = "pokemon";
    state.language = "any";
    state.pageSize = 20;
    state.page = 1;
    state.totalCount = 0;
    input.value = "";
    field.value = state.field;
    order.value = state.orderBy;
    pageSize.value = String(state.pageSize);
    syncControls();
    results.innerHTML = "";
    clearMessages();
    setHidden(pager, true);
    setHidden(summary, true);
    setStatus("Choose TCG, Sports, or Memorabilia, then search by name, set, number, rarity, type, or keyword.");
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
      const targetSeries = seriesMap.get(button.dataset.priceCheckSeries || "");
      if (targetSeries) {
        state.mainCategory = targetSeries.mainCategory;
        state.series = targetSeries.id;
        state.language = button.dataset.priceCheckLanguage || "any";
        syncControls();
      }
      input.value = button.dataset.priceCheckExample || "";
      field.value = button.dataset.priceCheckField || "all";
      state.page = 1;
      searchCards({ scroll: true });
    });
  });

  mainCategoryTabs?.addEventListener("click", event => {
    const button = event.target.closest("[data-main-category]");
    if (!button) return;
    state.mainCategory = button.dataset.mainCategory || "tcg";
    state.series = seriesOptions.find(option => option.mainCategory === state.mainCategory)?.id || "pokemon";
    state.language = "any";
    state.page = 1;
    syncControls();
    if (state.term.length >= 2 || input.value.trim().length >= 2) searchCards({ scroll: false });
    else updateUrl();
  });

  seriesTabs?.addEventListener("click", event => {
    const button = event.target.closest("[data-card-series]");
    if (!button) return;
    state.series = button.dataset.cardSeries || "pokemon";
    state.page = 1;
    renderSeriesTabs();
    renderLanguageOptions();
    updateSuggestions();
    if (state.term.length >= 2 || input.value.trim().length >= 2) searchCards({ scroll: false });
    else updateUrl();
  });

  language?.addEventListener("change", event => {
    state.language = event.currentTarget.value || "any";
    state.page = 1;
    updateSuggestions();
    if (state.term.length >= 2 || input.value.trim().length >= 2) searchCards({ scroll: false });
    else updateUrl();
  });

  closeMatches?.addEventListener("click", event => {
    const button = event.target.closest("[data-close-match]");
    if (!button) return;
    input.value = button.dataset.closeMatch || "";
    state.page = 1;
    searchCards({ scroll: true });
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
    setStatus("Choose TCG, Sports, or Memorabilia, then search by name, set, number, rarity, type, or keyword.");
  }
})();
