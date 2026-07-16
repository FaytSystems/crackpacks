// D:\crackpacks\crackpacks-github-ready\youtube-live-worker\src\index.js

const WORKER_NAME = "crackpacks-youtube-live";
const WORKER_VERSION = "1.6.0";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_FEED_BASE = "https://www.youtube.com/feeds/videos.xml";
const DEFAULT_STATUS_CACHE_SECONDS = 45;
const DEFAULT_DISCOVERY_CACHE_SECONDS = 3600;
const MAX_CANDIDATE_VIDEOS = 30;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  return configured.length
    ? configured
    : ["https://crackpacks.com", "https://www.crackpacks.com"];
}

function isLocalOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
  }

  if (!allowedOrigins(env).includes(origin) && !isLocalOrigin(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function validChannelId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9_-]{20,40}$/.test(candidate) ? candidate : "";
}

function validVideoId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : "";
}

function uniqueVideoIds(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const videoId = validVideoId(value);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    result.push(videoId);
    if (result.length >= MAX_CANDIDATE_VIDEOS) break;
  }

  return result;
}

function truncate(value, maximumLength) {
  const text = String(value || "").trim();
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function isoDate(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function thumbnailUrl(snippet) {
  const thumbnails = snippet?.thumbnails || {};
  return thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    null;
}

function statusCacheControl(env) {
  const ttl = boundedInteger(
    env.STATUS_CACHE_SECONDS,
    DEFAULT_STATUS_CACHE_SECONDS,
    15,
    300
  );
  return `public, max-age=15, s-maxage=${ttl}, stale-while-revalidate=120`;
}

function statusCacheKey(request, channelId) {
  const url = new URL(request.url);
  url.pathname = "/status";
  url.search = `channel=${encodeURIComponent(channelId)}`;
  return new Request(url.toString(), { method: "GET" });
}

function discoveryCacheKey(request, channelId) {
  const url = new URL(request.url);
  url.pathname = "/internal/youtube-discovery";
  url.search = `channel=${encodeURIComponent(channelId)}`;
  return new Request(url.toString(), { method: "GET" });
}

async function fetchChannelFeedIds(channelId) {
  const url = new URL(YOUTUBE_FEED_BASE);
  url.searchParams.set("channel_id", channelId);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
      "User-Agent": `${WORKER_NAME}/${WORKER_VERSION}`
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 60
    }
  });

  if (!response.ok) return [];

  const xml = await response.text();
  const ids = [];
  const pattern = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g;
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    ids.push(match[1]);
  }

  return uniqueVideoIds(ids);
}

async function fetchSearchDiscoveryIds(request, env, channelId) {
  const cache = caches.default;
  const cacheKey = discoveryCacheKey(request, channelId);
  const cached = await cache.match(cacheKey);

  if (cached) {
    const payload = await cached.json().catch(() => null);
    return Array.isArray(payload?.videoIds) ? uniqueVideoIds(payload.videoIds) : [];
  }

  async function searchEventType(eventType) {
    const url = new URL(`${YOUTUBE_API_BASE}/search`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("channelId", channelId);
    url.searchParams.set("type", "video");
    url.searchParams.set("eventType", eventType);
    url.searchParams.set("order", "date");
    url.searchParams.set("maxResults", "10");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("key", env.YOUTUBE_API_KEY);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) return [];

    const payload = await response.json();
    return Array.isArray(payload?.items)
      ? payload.items.map(item => item?.id?.videoId)
      : [];
  }

  const [liveIds, upcomingIds] = await Promise.all([
    searchEventType("live"),
    searchEventType("upcoming")
  ]);
  const videoIds = uniqueVideoIds([...liveIds, ...upcomingIds]);

  const ttl = boundedInteger(
    env.DISCOVERY_CACHE_SECONDS,
    DEFAULT_DISCOVERY_CACHE_SECONDS,
    900,
    21600
  );

  const cacheResponse = jsonResponse(
    { videoIds, checkedAt: new Date().toISOString() },
    200,
    { "Cache-Control": `public, max-age=${ttl}` }
  );

  await cache.put(cacheKey, cacheResponse);
  return videoIds;
}

async function fetchVideoDetails(env, videoIds) {
  if (!videoIds.length) return [];

  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set("part", "snippet,liveStreamingDetails,status");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", env.YOUTUBE_API_KEY);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    const message = truncate(await response.text(), 300);
    throw new Error(`YouTube videos.list failed with HTTP ${response.status}: ${message}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

function isEmbeddable(video) {
  return video?.status?.embeddable !== false && video?.status?.privacyStatus !== "private";
}

function liveRank(video) {
  const start = Date.parse(video?.liveStreamingDetails?.actualStartTime || "");
  return Number.isFinite(start) ? start : 0;
}

function upcomingRank(video) {
  const start = Date.parse(video?.liveStreamingDetails?.scheduledStartTime || "");
  return Number.isFinite(start) ? start : Number.MAX_SAFE_INTEGER;
}

function selectLiveVideo(videos) {
  return videos
    .filter(video => {
      const details = video?.liveStreamingDetails;
      const broadcastState = video?.snippet?.liveBroadcastContent;
      return isEmbeddable(video) &&
        broadcastState === "live" &&
        Boolean(details?.actualStartTime) &&
        !details?.actualEndTime;
    })
    .sort((left, right) => liveRank(right) - liveRank(left))[0] || null;
}

function selectUpcomingVideo(videos) {
  const now = Date.now();
  const gracePeriodMs = 12 * 60 * 60 * 1000;

  return videos
    .filter(video => {
      const details = video?.liveStreamingDetails;
      const scheduledStart = Date.parse(details?.scheduledStartTime || "");
      return isEmbeddable(video) &&
        video?.snippet?.liveBroadcastContent === "upcoming" &&
        !details?.actualEndTime &&
        Number.isFinite(scheduledStart) &&
        scheduledStart >= now - gracePeriodMs;
    })
    .sort((left, right) => upcomingRank(left) - upcomingRank(right))[0] || null;
}

function videoPayload(video, channelId) {
  if (!video) return null;

  const videoId = validVideoId(video.id);
  if (!videoId) return null;

  const details = video.liveStreamingDetails || {};
  const snippet = video.snippet || {};

  return {
    videoId,
    title: truncate(snippet.title, 180),
    description: truncate(snippet.description, 260),
    channelTitle: truncate(snippet.channelTitle, 120),
    thumbnail: thumbnailUrl(snippet),
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    scheduledStartTime: isoDate(details.scheduledStartTime),
    actualStartTime: isoDate(details.actualStartTime),
    concurrentViewers: details.concurrentViewers ? Number(details.concurrentViewers) : null
  };
}

async function buildStatus(request, env, channelId) {
  const feedPromise = fetchChannelFeedIds(channelId).catch(() => []);
  const discoveryPromise = fetchSearchDiscoveryIds(request, env, channelId).catch(() => []);
  const [feedIds, discoveryIds] = await Promise.all([feedPromise, discoveryPromise]);
  const candidateIds = uniqueVideoIds([...feedIds, ...discoveryIds]);

  const videos = await fetchVideoDetails(env, candidateIds);
  const liveVideo = selectLiveVideo(videos);
  const upcomingVideo = selectUpcomingVideo(videos);
  const live = videoPayload(liveVideo, channelId);
  const upcoming = videoPayload(upcomingVideo, channelId);

  if (live) {
    return {
      ok: true,
      service: WORKER_NAME,
      version: WORKER_VERSION,
      configured: true,
      live: true,
      checkedAt: new Date().toISOString(),
      ...live,
      upcoming
    };
  }

  return {
    ok: true,
    service: WORKER_NAME,
    version: WORKER_VERSION,
    configured: true,
    live: false,
    checkedAt: new Date().toISOString(),
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    upcoming
  };
}

async function handleStatus(request, env, cors) {
  const channelId = validChannelId(env.YOUTUBE_CHANNEL_ID);
  const apiKeyConfigured = Boolean(String(env.YOUTUBE_API_KEY || "").trim());

  if (!channelId || !apiKeyConfigured) {
    return jsonResponse(
      {
        ok: true,
        service: WORKER_NAME,
        version: WORKER_VERSION,
        configured: false,
        live: false,
        checkedAt: new Date().toISOString(),
        missing: [
          ...(!apiKeyConfigured ? ["YOUTUBE_API_KEY"] : []),
          ...(!channelId ? ["YOUTUBE_CHANNEL_ID"] : [])
        ]
      },
      200,
      { ...cors, "Cache-Control": "no-store" }
    );
  }

  const cache = caches.default;
  const cacheKey = statusCacheKey(request, channelId);
  const cached = await cache.match(cacheKey);

  if (cached) {
    const response = new Response(cached.body, cached);
    Object.entries(cors).forEach(([key, value]) => response.headers.set(key, value));
    response.headers.set("X-Crack-Packs-Cache", "HIT");
    return response;
  }

  try {
    const payload = await buildStatus(request, env, channelId);
    const cacheControl = statusCacheControl(env);
    const response = jsonResponse(payload, 200, {
      ...cors,
      "Cache-Control": cacheControl,
      "X-Crack-Packs-Cache": "MISS"
    });

    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    console.error("YouTube live status error", error);
    return jsonResponse(
      {
        ok: false,
        service: WORKER_NAME,
        version: WORKER_VERSION,
        configured: true,
        live: false,
        checkedAt: new Date().toISOString(),
        error: "The YouTube live-status service could not complete its upstream check."
      },
      502,
      { ...cors, "Cache-Control": "no-store" }
    );
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (!cors) {
      return jsonResponse(
        { ok: false, error: "Origin is not allowed." },
        403,
        { "Cache-Control": "no-store" }
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        { ok: false, error: "Method not allowed." },
        405,
        { ...cors, "Allow": "GET, OPTIONS", "Cache-Control": "no-store" }
      );
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse(
        {
          ok: true,
          service: WORKER_NAME,
          version: WORKER_VERSION,
          configured: Boolean(validChannelId(env.YOUTUBE_CHANNEL_ID) && String(env.YOUTUBE_API_KEY || "").trim()),
          endpoints: ["/health", "/status"]
        },
        200,
        { ...cors, "Cache-Control": "no-store" }
      );
    }

    if (url.pathname === "/status") {
      return handleStatus(request, env, cors);
    }

    return jsonResponse(
      { ok: false, error: "Not found." },
      404,
      { ...cors, "Cache-Control": "no-store" }
    );
  }
};
