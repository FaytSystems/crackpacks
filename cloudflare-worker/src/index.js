// D:\crackpacks\crackpacks-github-ready\cloudflare-worker\src\index.js

const POKEMON_API_BASE = "https://api.pokemontcg.io/v2";
const SCRYFALL_API_BASE = "https://api.scryfall.com";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 48;
const CACHE_SECONDS = 300;
const WORKER_VERSION = "2.0.0";

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
  const series = incomingUrl.searchParams.get("series") === "magic" ? "magic" : "pokemon";
  if (series === "magic") return handleMagicCards(incomingUrl, cors);
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
    submittedQuery
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

function magicQuery(term, field) {
  const quoted = `"${term.replace(/"/g, "")}"`;
  if (field === "name") return `name:${quoted}`;
  if (field === "number") return `cn:${quoted}`;
  if (field === "rarity") return `rarity:${term.toLowerCase().replace(/\s+/g, "")}`;
  if (field === "type") return `type:${quoted}`;
  return term;
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

async function handleMagicCards(incomingUrl, cors) {
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
  const upstreamUrl = new URL(`${SCRYFALL_API_BASE}/cards/search`);
  upstreamUrl.searchParams.set("q", magicQuery(term, field));
  upstreamUrl.searchParams.set("page", String(upstreamPage));
  upstreamUrl.searchParams.set("order", sort);
  upstreamUrl.searchParams.set("dir", direction);
  upstreamUrl.searchParams.set("unique", "prints");
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8", "User-Agent": "CrackPacks.com card search/2.0 (support@crackpacks.com)" },
      cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS }
    });
  } catch {
    return jsonResponse({ error: "The Magic card database could not be reached. Please try again shortly." }, 502, cors);
  }
  const payload = await upstreamResponse.json().catch(() => ({}));
  if (upstreamResponse.status === 404) return jsonResponse({ data: [], page, pageSize, count: 0, totalCount: 0, meta: { workerVersion: WORKER_VERSION, source: "scryfall" } }, 200, cors);
  if (!upstreamResponse.ok) return jsonResponse({ error: payload.details || "The Magic card database rejected the request." }, upstreamResponse.status >= 500 ? 502 : upstreamResponse.status, cors);
  const allCards = Array.isArray(payload.data) ? payload.data : [];
  const data = allCards.slice(localOffset, localOffset + pageSize).map(magicCard);
  return jsonResponse({ data, page, pageSize, count: data.length, totalCount: Number(payload.total_cards || data.length), meta: { workerVersion: WORKER_VERSION, source: "scryfall", submittedField: field, submittedTerm: term } }, 200, { ...cors, "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
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
          magicConfigured: true,
          supportedFields: ["all", "name", "set", "number", "rarity", "type"]
        },
        200,
        cors
      );
    }

    if (url.pathname === "/cards") {
      return handleCards(request, env, cors);
    }

    return jsonResponse({ error: "Not found." }, 404, cors);
  }
};
