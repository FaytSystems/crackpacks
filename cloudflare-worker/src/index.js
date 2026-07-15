const POKEMON_API_BASE = "https://api.pokemontcg.io/v2";
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const CACHE_SECONDS = 300;

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

function pokemonNameQuery(term) {
  const words = term.split(" ").filter(Boolean);
  if (words.length === 1) return `name:${words[0]}*`;
  return `name:"${term}"`;
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

async function handleCards(request, env, cors) {
  if (!env.POKEMON_TCG_API_KEY) {
    return jsonResponse(
      { error: "Card search is not configured on the server." },
      503,
      cors
    );
  }

  const incomingUrl = new URL(request.url);
  const term = sanitizeSearchTerm(incomingUrl.searchParams.get("term"));
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

  const upstreamUrl = new URL(`${POKEMON_API_BASE}/cards`);
  upstreamUrl.searchParams.set("q", pokemonNameQuery(term));
  upstreamUrl.searchParams.set("page", String(page));
  upstreamUrl.searchParams.set("pageSize", String(pageSize));
  upstreamUrl.searchParams.set("orderBy", orderBy);
  upstreamUrl.searchParams.set(
    "select",
    "id,name,supertype,subtypes,hp,types,set,number,artist,rarity,images,tcgplayer"
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
        error: payload?.error?.message || payload?.message || "The card database rejected the request."
      },
      upstreamResponse.status >= 500 ? 502 : upstreamResponse.status,
      cors
    );
  }

  return jsonResponse(
    payload || { data: [], page, pageSize, count: 0, totalCount: 0 },
    200,
    {
      ...cors,
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`
    }
  );
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
          apiKeyConfigured: Boolean(env.POKEMON_TCG_API_KEY)
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
