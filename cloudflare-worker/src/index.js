// D:\crackpacks\crackpacks-github-ready\cloudflare-worker\src\index.js

const POKEMON_API_BASE = "https://api.pokemontcg.io/v2";
const SCRYFALL_API_BASE = "https://api.scryfall.com";
const APITCG_API_BASE = "https://api.apitcg.com/api";
const EBAY_PRODUCTION_API_BASE = "https://api.ebay.com";
const EBAY_SANDBOX_API_BASE = "https://api.sandbox.ebay.com";
const EBAY_OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 48;
const CACHE_SECONDS = 300;
const EBAY_CACHE_SECONDS = 180;
const WORKER_VERSION = "2.3.0";
let ebayTokenCache = null;
let ebayTokenRequest = null;
const API_TCG_SERIES = new Map([
  ["onepiece", "one-piece"],
  ["yugioh", "yugioh"],
  ["lorcana", "lorcana"],
  ["dragonball", "dragon-ball-super-fusion-world"],
  ["digimon", "digimon"],
  ["fab", "flesh-and-blood"],
  ["starwars", "star-wars-unlimited"],
  ["unionarena", "union-arena"]
]);
const API_TCG_LABELS = new Map([
  ["onepiece", "One Piece"],
  ["yugioh", "Yu-Gi-Oh!"],
  ["lorcana", "Disney Lorcana"],
  ["dragonball", "Dragon Ball Super Fusion World"],
  ["digimon", "Digimon"],
  ["fab", "Flesh and Blood"],
  ["starwars", "Star Wars Unlimited"],
  ["unionarena", "Union Arena"]
]);
const SUPPORTED_LOOKUP_LANGUAGES = new Set([
  "any",
  "en",
  "ja",
  "zh-cn",
  "zh-tw",
  "ko",
  "fr",
  "de",
  "it",
  "es",
  "pt",
  "pt-br",
  "pt-pt",
  "nl",
  "pl",
  "ru",
  "id",
  "th",
  "he",
  "la",
  "grc",
  "ar"
]);
const MAGIC_LANGUAGE_MAP = new Map([
  ["any", ""],
  ["en", "en"],
  ["ja", "ja"],
  ["zh-cn", "zhs"],
  ["zh-tw", "zht"],
  ["ko", "ko"],
  ["fr", "fr"],
  ["de", "de"],
  ["it", "it"],
  ["es", "es"],
  ["pt", "pt"],
  ["ru", "ru"],
  ["he", "he"],
  ["la", "la"],
  ["grc", "grc"],
  ["ar", "ar"]
]);

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = allowedOrigins(env);

  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
  }

  if (!allowed.includes(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function sanitizeSearchTerm(value) {
  return String(value || "")
    .trim()
    .replace(/[\\+\-!(){}\[\]^"~*?:/]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function validField(value) {
  const allowed = new Set(["all", "name", "set", "number", "rarity", "type"]);
  return allowed.has(value) ? value : "all";
}

function validOrderBy(value) {
  const allowed = new Set([
    "-set.releaseDate",
    "set.releaseDate",
    "name",
    "-name"
  ]);
  return allowed.has(value) ? value : "-set.releaseDate";
}

function validSeries(value) {
  const series = String(value || "pokemon").trim().toLowerCase();
  if (series === "magic") return "magic";
  if (API_TCG_SERIES.has(series)) return series;
  return "pokemon";
}

function validLanguage(value) {
  const language = String(value || "any").trim().toLowerCase();
  return SUPPORTED_LOOKUP_LANGUAGES.has(language) ? language : "any";
}

function ebayEnvironment(env) {
  return String(env.EBAY_ENVIRONMENT || "production").trim().toLowerCase() === "sandbox"
    ? "sandbox"
    : "production";
}

function ebayApiBase(env) {
  return ebayEnvironment(env) === "sandbox"
    ? EBAY_SANDBOX_API_BASE
    : EBAY_PRODUCTION_API_BASE;
}

function ebayMarketplaceId(env) {
  const marketplaceId = String(env.EBAY_MARKETPLACE_ID || "EBAY_US").trim().toUpperCase();
  return /^EBAY_[A-Z]{2,3}$/.test(marketplaceId) ? marketplaceId : "EBAY_US";
}

function ebayConfigured(env) {
  return Boolean(
    String(env.EBAY_CLIENT_ID || "").trim() &&
    String(env.EBAY_CLIENT_SECRET || "").trim()
  );
}

function magicLanguageCode(language) {
  return MAGIC_LANGUAGE_MAP.get(validLanguage(language)) || "";
}

function fieldValue(term, { wildcard = false } = {}) {
  const words = term.split(" ").filter(Boolean);
  if (words.length === 1) return `${words[0]}${wildcard ? "*" : ""}`;
  return `"${term}"`;
}

function buildPokemonQuery(term, field) {
  const nameValue = fieldValue(term, { wildcard: true });
  const generalValue = fieldValue(term, { wildcard: true });
  const exactValue = fieldValue(term);

  switch (field) {
    case "name":
      return `name:${nameValue}`;
    case "set":
      return `set.name:${generalValue}`;
    case "number":
      return `number:${exactValue}`;
    case "rarity":
      return `rarity:${generalValue}`;
    case "type":
      return `(types:${generalValue} OR subtypes:${generalValue})`;
    case "all":
    default:
      return [
        `name:${nameValue}`,
        `set.name:${generalValue}`,
        `rarity:${generalValue}`,
        `number:${exactValue}`,
        `types:${generalValue}`,
        `subtypes:${generalValue}`
      ].join(" OR ");
  }
}

async function handleCards(request, env, cors) {
  const incomingUrl = new URL(request.url);
  const series = validSeries(incomingUrl.searchParams.get("series"));
  const language = validLanguage(incomingUrl.searchParams.get("language"));
  if (series === "magic") return handleMagicCards(incomingUrl, cors, language);
  if (API_TCG_SERIES.has(series)) return handleApiTcgCards(incomingUrl, env, cors, series, language);
  if (!env.POKEMON_TCG_API_KEY) {
    return jsonResponse(
      { error: "Card search is not configured on the server." },
      503,
      cors
    );
  }

  const term = sanitizeSearchTerm(incomingUrl.searchParams.get("term"));
  const field = validField(incomingUrl.searchParams.get("field"));
  const page = boundedInteger(incomingUrl.searchParams.get("page"), 1, 1, 1000);
  const pageSize = boundedInteger(
    incomingUrl.searchParams.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE
  );
  const orderBy = validOrderBy(incomingUrl.searchParams.get("orderBy"));

  if (term.length < 2) {
    return jsonResponse(
      { error: "Enter at least two characters to search the card catalog." },
      400,
      cors
    );
  }

  const submittedQuery = buildPokemonQuery(term, field);
  const upstreamUrl = new URL(`${POKEMON_API_BASE}/cards`);
  upstreamUrl.searchParams.set("q", submittedQuery);
  upstreamUrl.searchParams.set("page", String(page));
  upstreamUrl.searchParams.set("pageSize", String(pageSize));
  upstreamUrl.searchParams.set("orderBy", orderBy);
  upstreamUrl.searchParams.set(
    "select",
    "id,name,supertype,subtypes,hp,types,set,number,artist,rarity,images,tcgplayer,cardmarket"
  );

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: "application/json",
        "X-Api-Key": env.POKEMON_TCG_API_KEY
      },
      cf: {
        cacheEverything: true,
        cacheTtl: CACHE_SECONDS
      }
    });
  } catch {
    return jsonResponse(
      { error: "The card database could not be reached. Please try again shortly." },
      502,
      cors
    );
  }

  const text = await upstreamResponse.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!upstreamResponse.ok) {
    return jsonResponse(
      {
        error: payload?.error?.message ||
          payload?.message ||
          "The card database rejected the request."
      },
      upstreamResponse.status >= 500 ? 502 : upstreamResponse.status,
      cors
    );
  }

  const responsePayload = payload || {
    data: [],
    page,
    pageSize,
    count: 0,
    totalCount: 0
  };

  responsePayload.meta = {
    ...(responsePayload.meta || {}),
    workerVersion: WORKER_VERSION,
    authMode: "cloudflare-secret",
    submittedField: field,
    submittedTerm: term,
    submittedQuery,
    submittedLanguage: language,
    languageNotice: ["any", "en"].includes(language)
      ? "PokemonTCG.io catalog response."
      : "The connected Pokemon catalog is English-only; use the frontend source links for non-English market checks."
  };

  return jsonResponse(
    responsePayload,
    200,
    {
      ...cors,
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`
    }
  );
}

function apiTcgProductList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
}

function apiTcgTotal(payload, fallback) {
  const values = [
    payload?.total,
    payload?.totalCount,
    payload?.count,
    payload?.meta?.total,
    payload?.pagination?.total,
    payload?.data?.total
  ];
  const total = values.map(value => Number(value)).find(Number.isFinite);
  return total || fallback;
}

function apiTcgErrorMessage(payload, rawText = "") {
  const message = stringValue(payload?.message, payload?.error?.message, payload?.error);
  if (message) return message;
  const details = payload?.details ?? payload?.errors;
  if (details) {
    try {
      return `API TCG rejected the request: ${JSON.stringify(details).slice(0, 400)}`;
    } catch {
      return "API TCG rejected the request with validation details.";
    }
  }
  if (rawText.trim()) return `API TCG rejected the request: ${rawText.trim().slice(0, 400)}`;
  return "API TCG rejected the request.";
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstUrl(...values) {
  const flattened = values.flatMap(value => Array.isArray(value) ? value : [value]);
  return stringValue(...flattened.filter(value => /^https?:\/\//i.test(String(value || ""))));
}

function numericPrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value || "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function addPrice(prices, label, value) {
  const amount = numericPrice(value);
  if (amount === null) return;
  const key = String(label || "market").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "market";
  prices[key] = { market: amount };
}

function apiTcgPrices(product) {
  const prices = {};
  addPrice(prices, "market", product.price ?? product.marketPrice ?? product.market_price ?? product.currentPrice ?? product.current_price ?? product.priceUsd ?? product.price_usd);
  addPrice(prices, "low", product.lowPrice ?? product.low_price);
  addPrice(prices, "mid", product.midPrice ?? product.mid_price ?? product.averagePrice ?? product.average_price);
  addPrice(prices, "high", product.highPrice ?? product.high_price);

  if (product.prices && typeof product.prices === "object") {
    for (const [key, value] of Object.entries(product.prices)) {
      if (value && typeof value === "object") {
        const group = {};
        const market = numericPrice(value.market ?? value.current ?? value.price ?? value.average ?? value.avg);
        const low = numericPrice(value.low);
        const mid = numericPrice(value.mid);
        const directLow = numericPrice(value.directLow ?? value.direct_low);
        if (market !== null) group.market = market;
        if (low !== null) group.low = low;
        if (mid !== null) group.mid = mid;
        if (directLow !== null) group.directLow = directLow;
        if (Object.keys(group).length) prices[key] = group;
      } else {
        addPrice(prices, key, value);
      }
    }
  }

  const history = Array.isArray(product.priceHistory) ? product.priceHistory : Array.isArray(product.price_history) ? product.price_history : [];
  const latest = history.at(-1);
  if (latest && typeof latest === "object") addPrice(prices, "latest history", latest.price ?? latest.value ?? latest.market);

  return prices;
}

function apiTcgCard(product, series) {
  const set = product.set && typeof product.set === "object" ? product.set : {};
  const expansion = product.expansion && typeof product.expansion === "object" ? product.expansion : {};
  const images = product.images && typeof product.images === "object" ? product.images : {};
  const links = product.links && typeof product.links === "object" ? product.links : {};
  const label = API_TCG_LABELS.get(series) || "API TCG";
  const image = firstUrl(
    product.image,
    product.imageUrl,
    product.image_url,
    product.thumbnail,
    product.thumbnailUrl,
    product.thumbnail_url,
    images.small,
    images.large,
    images.full,
    images.front,
    images.url,
    images[0]
  );

  return {
    id: stringValue(product.id, product.uuid, product.productId, product.product_id, product.slug, crypto.randomUUID()),
    name: stringValue(product.name, product.title, product.productName, product.product_name, product.cardName, product.card_name, "Unnamed product"),
    supertype: label,
    subtypes: [
      stringValue(product.type, product.productType, product.product_type),
      stringValue(product.category, product.cardType, product.card_type)
    ].filter(Boolean),
    types: Array.isArray(product.types) ? product.types.filter(Boolean) : [],
    number: stringValue(product.number, product.cardNumber, product.card_number, product.collectorNumber, product.collector_number, product.code, product.productId, product.product_id),
    artist: stringValue(product.artist, product.illustrator),
    rarity: stringValue(product.rarity, product.rarityName, product.rarity_name, product.rarityCode, product.rarity_code, "API TCG"),
    set: {
      id: stringValue(set.id, expansion.id, product.setId, product.set_id, product.expansionId, product.expansion_id),
      name: stringValue(set.name, expansion.name, product.setName, product.set_name, product.expansionName, product.expansion_name, "Unknown set"),
      printedTotal: "",
      total: "",
      releaseDate: stringValue(set.releaseDate, set.release_date, expansion.releaseDate, expansion.release_date, product.releaseDate, product.release_date)
    },
    images: { small: image, large: firstUrl(images.large, images.full, images.url, image) },
    tcgplayer: {
      url: firstUrl(product.url, product.marketUrl, product.market_url, product.productUrl, product.product_url, links.market, links.tcgplayer, links.url, links.self),
      prices: apiTcgPrices(product)
    }
  };
}

function apiTcgSearchParams(term, field) {
  const params = new Map();
  if (field === "set") params.set("set", term);
  else if (field === "number") params.set("number", term);
  else if (field === "rarity") params.set("rarity", term);
  else params.set("name", term);
  return params;
}

async function handleApiTcgCards(incomingUrl, env, cors, series, language = "any") {
  if (!env.APITCG_API_KEY) {
    return jsonResponse(
      { error: "API TCG search is not configured on the server. Add APITCG_API_KEY as a Worker secret." },
      503,
      cors
    );
  }

  const term = sanitizeSearchTerm(incomingUrl.searchParams.get("term"));
  const field = validField(incomingUrl.searchParams.get("field"));
  const page = boundedInteger(incomingUrl.searchParams.get("page"), 1, 1, 1000);
  const pageSize = boundedInteger(incomingUrl.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, 1, 100);

  if (term.length < 2) {
    return jsonResponse({ error: "Enter at least two characters to search the card catalog." }, 400, cors);
  }

  const tcgSlug = API_TCG_SERIES.get(series);
  const upstreamUrl = new URL(`${APITCG_API_BASE}/products`);
  upstreamUrl.searchParams.set("tcg", tcgSlug);
  for (const [key, value] of apiTcgSearchParams(term, field)) {
    upstreamUrl.searchParams.set(key, value);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: "application/json",
        "x-api-key": env.APITCG_API_KEY,
        "User-Agent": "CrackPacks.com card search/2.2 (support@crackpacks.com)"
      },
      cf: {
        cacheEverything: true,
        cacheTtl: CACHE_SECONDS
      }
    });
  } catch {
    return jsonResponse({ error: "API TCG could not be reached. Please try again shortly." }, 502, cors);
  }

  const text = await upstreamResponse.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }
  if (!upstreamResponse.ok) {
    return jsonResponse(
      { error: apiTcgErrorMessage(payload, text) },
      upstreamResponse.status >= 500 ? 502 : upstreamResponse.status,
      cors
    );
  }

  const products = apiTcgProductList(payload);
  const data = products.map(product => apiTcgCard(product, series));
  return jsonResponse(
    {
      data,
      page,
      pageSize,
      count: data.length,
      totalCount: apiTcgTotal(payload, data.length),
      meta: {
        workerVersion: WORKER_VERSION,
        source: "apitcg",
        submittedField: field,
        submittedTerm: term,
        submittedLanguage: language,
        submittedSeries: series,
        submittedTcg: tcgSlug
      }
    },
    200,
    {
      ...cors,
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`
    }
  );
}

async function ebayApplicationToken(env) {
  const clientId = String(env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = String(env.EBAY_CLIENT_SECRET || "").trim();
  const environment = ebayEnvironment(env);
  const now = Date.now();

  if (!clientId || !clientSecret) {
    throw new Error("eBay search is not configured. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET as Worker secrets.");
  }

  if (
    ebayTokenCache &&
    ebayTokenCache.clientId === clientId &&
    ebayTokenCache.environment === environment &&
    ebayTokenCache.expiresAt > now + 60_000
  ) {
    return ebayTokenCache.accessToken;
  }

  if (ebayTokenRequest) return ebayTokenRequest;

  ebayTokenRequest = (async () => {
    let response;
    try {
      response = await fetch(`${ebayApiBase(env)}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: EBAY_OAUTH_SCOPE
        }).toString()
      });
    } catch {
      throw new Error("eBay OAuth could not be reached. Please try again shortly.");
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      if (response.status === 400 || response.status === 401) {
        throw new Error("eBay OAuth rejected EBAY_CLIENT_ID or EBAY_CLIENT_SECRET.");
      }
      if (response.status === 429) {
        throw new Error("eBay OAuth rate limit reached. Please try again shortly.");
      }
      throw new Error("eBay OAuth could not create an application access token.");
    }

    const expiresIn = boundedInteger(payload.expires_in, 7200, 120, 86400);
    ebayTokenCache = {
      accessToken: payload.access_token,
      clientId,
      environment,
      expiresAt: Date.now() + (expiresIn * 1000)
    };
    return ebayTokenCache.accessToken;
  })();

  try {
    return await ebayTokenRequest;
  } finally {
    ebayTokenRequest = null;
  }
}

function ebayErrorMessage(payload, status) {
  const message = stringValue(
    payload?.errors?.[0]?.longMessage,
    payload?.errors?.[0]?.message,
    payload?.error_description,
    payload?.message
  );
  if (status === 401) return "eBay rejected the application token. Check the Production keyset.";
  if (status === 403) return "eBay Browse API access is not enabled for this Production keyset.";
  if (status === 429) return "eBay search has reached its current request limit. Please try again later.";
  return message ? `eBay search rejected the request: ${message}` : "eBay search rejected the request.";
}

function ebayListing(item) {
  const shippingOption = Array.isArray(item.shippingOptions)
    ? item.shippingOptions.find(option => numericPrice(option?.shippingCost?.value) !== null)
    : null;
  const location = item.itemLocation && typeof item.itemLocation === "object"
    ? item.itemLocation
    : {};

  return {
    source: "ebay",
    id: stringValue(item.itemId, item.legacyItemId, crypto.randomUUID()),
    title: stringValue(item.title, item.shortDescription, "Untitled eBay listing"),
    image: firstUrl(
      item.image?.imageUrl,
      item.thumbnailImages?.map(image => image?.imageUrl),
      item.additionalImages?.map(image => image?.imageUrl)
    ),
    url: firstUrl(item.itemAffiliateWebUrl, item.itemWebUrl),
    condition: stringValue(item.condition, item.conditionId, "Condition not listed"),
    seller: stringValue(item.seller?.username),
    price: {
      value: numericPrice(item.price?.value),
      currency: stringValue(item.price?.currency, "USD")
    },
    shipping: shippingOption
      ? {
          value: numericPrice(shippingOption.shippingCost?.value),
          currency: stringValue(shippingOption.shippingCost?.currency, item.price?.currency, "USD"),
          type: stringValue(shippingOption.shippingCostType)
        }
      : null,
    buyingOptions: Array.isArray(item.buyingOptions) ? item.buyingOptions.filter(Boolean) : [],
    location: {
      city: stringValue(location.city),
      stateOrProvince: stringValue(location.stateOrProvince),
      country: stringValue(location.country)
    },
    itemCreationDate: stringValue(item.itemCreationDate),
    itemEndDate: stringValue(item.itemEndDate)
  };
}

async function handleEbayListings(incomingUrl, env, cors) {
  if (!ebayConfigured(env)) {
    return jsonResponse(
      { error: "eBay search is not configured. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET as Worker secrets." },
      503,
      cors
    );
  }

  const term = sanitizeSearchTerm(incomingUrl.searchParams.get("term"));
  const page = boundedInteger(incomingUrl.searchParams.get("page"), 1, 1, 200);
  const pageSize = boundedInteger(incomingUrl.searchParams.get("pageSize"), 12, 1, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  if (term.length < 2) {
    return jsonResponse(
      { error: "Enter at least two characters to search eBay listings." },
      400,
      cors
    );
  }

  let accessToken;
  try {
    accessToken = await ebayApplicationToken(env);
  } catch (error) {
    return jsonResponse(
      { error: error?.message || "eBay OAuth could not start." },
      503,
      cors
    );
  }

  const upstreamUrl = new URL(`${ebayApiBase(env)}/buy/browse/v1/item_summary/search`);
  upstreamUrl.searchParams.set("q", term);
  upstreamUrl.searchParams.set("limit", String(pageSize));
  upstreamUrl.searchParams.set("offset", String(offset));

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": ebayMarketplaceId(env)
      },
      cf: {
        cacheEverything: true,
        cacheTtl: EBAY_CACHE_SECONDS
      }
    });
  } catch {
    return jsonResponse(
      { error: "eBay listings could not be reached. Please try again shortly." },
      502,
      cors
    );
  }

  const payload = await upstreamResponse.json().catch(() => ({}));
  if (!upstreamResponse.ok) {
    return jsonResponse(
      { error: ebayErrorMessage(payload, upstreamResponse.status) },
      upstreamResponse.status >= 500 ? 502 : upstreamResponse.status,
      cors
    );
  }

  const itemSummaries = Array.isArray(payload.itemSummaries) ? payload.itemSummaries : [];
  const data = itemSummaries.map(ebayListing).filter(listing => listing.url);
  return jsonResponse(
    {
      data,
      page,
      pageSize,
      count: data.length,
      totalCount: Number(payload.total) || data.length,
      meta: {
        workerVersion: WORKER_VERSION,
        source: "ebay-browse",
        priceType: "active-listing",
        submittedTerm: term,
        environment: ebayEnvironment(env),
        marketplaceId: ebayMarketplaceId(env),
        reason: data.length
          ? ""
          : "eBay returned no active listings for this search. Try fewer keywords or a broader category."
      }
    },
    200,
    {
      ...cors,
      "Cache-Control": `public, max-age=${EBAY_CACHE_SECONDS}`
    }
  );
}

function magicQuery(term, field, language = "any") {
  const quoted = `"${term.replace(/"/g, "")}"`;
  let query;
  if (field === "name") query = `name:${quoted}`;
  else if (field === "number") query = `cn:${quoted}`;
  else if (field === "rarity") query = `rarity:${term.toLowerCase().replace(/\s+/g, "")}`;
  else if (field === "type") query = `type:${quoted}`;
  else query = term;

  const languageCode = magicLanguageCode(language);
  return languageCode ? `${query} lang:${languageCode}` : query;
}

function magicCard(card) {
  const face = Array.isArray(card.card_faces) ? card.card_faces.find(entry => entry.image_uris) : null;
  const imageUris = card.image_uris || face?.image_uris || {};
  const prices = {};
  if (card.prices?.usd) prices.normal = { market: Number(card.prices.usd) };
  if (card.prices?.usd_foil) prices.foil = { market: Number(card.prices.usd_foil) };
  if (card.prices?.usd_etched) prices.etched = { market: Number(card.prices.usd_etched) };
  return {
    id: card.id, name: card.name, supertype: "Magic: The Gathering", subtypes: [card.type_line].filter(Boolean),
    types: [], number: card.collector_number, artist: card.artist || face?.artist || "", rarity: card.rarity || "",
    set: { id: card.set, name: card.set_name, printedTotal: "", total: "", releaseDate: card.released_at },
    images: { small: imageUris.normal || imageUris.small || "", large: imageUris.large || imageUris.png || imageUris.normal || "" },
    tcgplayer: { url: card.purchase_uris?.tcgplayer || card.scryfall_uri || "", prices }
  };
}

async function handleMagicCards(incomingUrl, cors, language = "any") {
  const term = sanitizeSearchTerm(incomingUrl.searchParams.get("term"));
  const field = validField(incomingUrl.searchParams.get("field"));
  const page = boundedInteger(incomingUrl.searchParams.get("page"), 1, 1, 1000);
  const pageSize = boundedInteger(incomingUrl.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const orderBy = validOrderBy(incomingUrl.searchParams.get("orderBy"));
  if (term.length < 2) return jsonResponse({ error: "Enter at least two characters to search the card catalog." }, 400, cors);
  const offset = (page - 1) * pageSize;
  const upstreamPage = Math.floor(offset / 175) + 1;
  const localOffset = offset % 175;
  const sort = orderBy.includes("releaseDate") ? "released" : "name";
  const direction = orderBy.startsWith("-") ? "desc" : "asc";
  const submittedQuery = magicQuery(term, field, language);
  const upstreamUrl = new URL(`${SCRYFALL_API_BASE}/cards/search`);
  upstreamUrl.searchParams.set("q", submittedQuery);
  upstreamUrl.searchParams.set("page", String(upstreamPage));
  upstreamUrl.searchParams.set("order", sort);
  upstreamUrl.searchParams.set("dir", direction);
  upstreamUrl.searchParams.set("unique", "prints");
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8", "User-Agent": "CrackPacks.com card search/2.1 (support@crackpacks.com)" },
      cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS }
    });
  } catch {
    return jsonResponse({ error: "The Magic card database could not be reached. Please try again shortly." }, 502, cors);
  }
  const payload = await upstreamResponse.json().catch(() => ({}));
  if (upstreamResponse.status === 404) {
    return jsonResponse({
      data: [],
      page,
      pageSize,
      count: 0,
      totalCount: 0,
      meta: {
        workerVersion: WORKER_VERSION,
        source: "scryfall",
        submittedField: field,
        submittedTerm: term,
        submittedLanguage: language,
        submittedQuery,
        reason: "No Magic cards matched the term, field, and language filter."
      }
    }, 200, cors);
  }
  if (!upstreamResponse.ok) return jsonResponse({ error: payload.details || "The Magic card database rejected the request." }, upstreamResponse.status >= 500 ? 502 : upstreamResponse.status, cors);
  const allCards = Array.isArray(payload.data) ? payload.data : [];
  const data = allCards.slice(localOffset, localOffset + pageSize).map(magicCard);
  return jsonResponse({ data, page, pageSize, count: data.length, totalCount: Number(payload.total_cards || data.length), meta: { workerVersion: WORKER_VERSION, source: "scryfall", submittedField: field, submittedTerm: term, submittedLanguage: language, submittedQuery } }, 200, { ...cors, "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return jsonResponse({ error: "Origin not allowed." }, 403);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, {
        ...cors,
        Allow: "GET, OPTIONS"
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/") {
      return jsonResponse(
        {
          ok: true,
          service: "crackpacks-card-search",
          version: WORKER_VERSION,
          pokemonApiKeyConfigured: Boolean(env.POKEMON_TCG_API_KEY),
          apiTcgConfigured: Boolean(env.APITCG_API_KEY),
          ebayConfigured: ebayConfigured(env),
          ebayEnvironment: ebayEnvironment(env),
          ebayMarketplaceId: ebayMarketplaceId(env),
          magicConfigured: true,
          supportedFields: ["all", "name", "set", "number", "rarity", "type"],
          supportedApiTcgSeries: Object.fromEntries(API_TCG_SERIES),
          supportedLanguages: {
            pokemonCatalog: ["any", "en"],
            magicCatalog: [...MAGIC_LANGUAGE_MAP.keys()],
            sourceLinkedSearch: [...SUPPORTED_LOOKUP_LANGUAGES]
          }
        },
        200,
        cors
      );
    }

    if (url.pathname === "/cards") {
      return handleCards(request, env, cors);
    }

    if (url.pathname === "/ebay") {
      return handleEbayListings(url, env, cors);
    }

    return jsonResponse({ error: "Not found." }, 404, cors);
  }
};
