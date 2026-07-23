// D:\crackpacks\crackpacks-github-ready\youtube-live-worker\src\index.js

import { DurableObject } from "cloudflare:workers";

const WORKER_NAME = "crackpacks-youtube-live";
const WORKER_VERSION = "1.7.0";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_FEED_BASE = "https://www.youtube.com/feeds/videos.xml";
const FACEBOOK_GRAPH_BASE = "https://graph.facebook.com";
const DEFAULT_STATUS_CACHE_SECONDS = 45;
const DEFAULT_DISCOVERY_CACHE_SECONDS = 3600;
const MAX_CANDIDATE_VIDEOS = 30;
const FACEBOOK_RETRY_DELAY_MS = 15 * 60 * 1000;
const FACEBOOK_MAX_REJECTED_ATTEMPTS = 12;

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

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function validFacebookPageId(value) {
  const candidate = String(value || "").trim();
  return /^\d{5,30}$/.test(candidate) ? candidate : "";
}

function facebookGraphVersion(value) {
  const candidate = String(value || "").trim();
  return /^v\d{1,2}\.\d$/.test(candidate) ? candidate : "v25.0";
}

function safeCrackPacksUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return "";
    if (hostname !== "crackpacks.com" && hostname !== "www.crackpacks.com") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function safeWorkerOrigin(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function facebookConfiguration(env) {
  const pageId = validFacebookPageId(env.FACEBOOK_PAGE_ID);
  const pageAccessToken = String(env.FACEBOOK_PAGE_ACCESS_TOKEN || "").trim();
  const appSecret = String(env.FACEBOOK_APP_SECRET || "").trim();
  const liveHubUrl = safeCrackPacksUrl(env.CRACKPACKS_LIVE_URL || "https://crackpacks.com/streams.html");

  return {
    enabled: enabled(env.FACEBOOK_AUTO_POST_ENABLED),
    configured: Boolean(
      pageId &&
      pageAccessToken &&
      appSecret &&
      liveHubUrl &&
      env.SOCIAL_ANNOUNCEMENTS
    ),
    pageId,
    pageAccessToken,
    appSecret,
    liveHubUrl,
    graphVersion: facebookGraphVersion(env.FACEBOOK_GRAPH_VERSION)
  };
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

function normalizedPostText(value, maximumLength) {
  return truncate(
    String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n"),
    maximumLength
  );
}

function safeYoutubeWatchUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return "";
    if (
      hostname !== "youtube.com" &&
      hostname !== "www.youtube.com" &&
      hostname !== "youtu.be"
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function facebookAnnouncementMessage(live, liveHubUrl) {
  const title = normalizedPostText(live?.title, 180) || "Crack Packs is live";
  const description = normalizedPostText(live?.description, 420);
  const youtubeUrl = safeYoutubeWatchUrl(live?.watchUrl);
  const lines = [
    "LIVE ON CRACKPACKS",
    title
  ];

  if (description) lines.push(description);

  lines.push(
    "Join Crack Packs live:",
    liveHubUrl
  );

  if (youtubeUrl) {
    lines.push(
      "YouTube stream:",
      youtubeUrl
    );
  }

  return truncate(lines.join("\n\n"), 2000);
}

async function hmacSha256Hex(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function publishFacebookAnnouncement(env, live) {
  const config = facebookConfiguration(env);
  if (!config.enabled || !config.configured) {
    return {
      ok: false,
      attempted: false,
      retryable: false,
      error: "Facebook auto-posting is not fully configured."
    };
  }

  const message = facebookAnnouncementMessage(live, config.liveHubUrl);
  const appSecretProof = await hmacSha256Hex(config.appSecret, config.pageAccessToken);
  const form = new URLSearchParams({
    message,
    link: safeYoutubeWatchUrl(live?.watchUrl) || config.liveHubUrl,
    appsecret_proof: appSecretProof
  });
  const endpoint = `${FACEBOOK_GRAPH_BASE}/${config.graphVersion}/${config.pageId}/feed`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.pageAccessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: form.toString()
    });
  } catch (error) {
    return {
      ok: false,
      attempted: true,
      retryable: false,
      ambiguous: true,
      error: truncate(error?.message || "The Facebook request failed without a response.", 300)
    };
  }

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    const graphError = payload?.error || {};
    return {
      ok: false,
      attempted: true,
      retryable: response.status >= 400 && response.status < 500,
      ambiguous: response.status >= 500,
      httpStatus: response.status,
      graphErrorCode: Number.isFinite(Number(graphError.code)) ? Number(graphError.code) : null,
      graphErrorType: truncate(graphError.type, 80) || null,
      error: truncate(graphError.message || `Facebook returned HTTP ${response.status}.`, 300)
    };
  }

  const postId = String(payload?.id || "").trim();
  if (!postId) {
    return {
      ok: false,
      attempted: true,
      retryable: false,
      ambiguous: true,
      httpStatus: response.status,
      error: "Facebook accepted the request but did not return a post ID."
    };
  }

  return {
    ok: true,
    attempted: true,
    retryable: false,
    postId
  };
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

async function runScheduledAnnouncement(env) {
  const facebook = facebookConfiguration(env);
  if (!facebook.enabled) return;

  if (!facebook.configured) {
    console.warn("Facebook auto-posting is enabled but is not fully configured.");
    return;
  }

  const channelId = validChannelId(env.YOUTUBE_CHANNEL_ID);
  const apiKeyConfigured = Boolean(String(env.YOUTUBE_API_KEY || "").trim());
  if (!channelId || !apiKeyConfigured) {
    console.warn("Facebook auto-posting skipped because YouTube is not fully configured.");
    return;
  }

  const workerOrigin = safeWorkerOrigin(env.WORKER_PUBLIC_URL) || "https://live-api.crackpacks.com";
  const request = new Request(`${workerOrigin}/status`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Origin: "https://crackpacks.com"
    }
  });
  const response = await handleStatus(request, env, {});
  if (!response.ok) {
    console.error("Scheduled YouTube live check failed", { status: response.status });
    return;
  }

  const payload = await response.json().catch(() => null);
  if (!payload?.live || !validVideoId(payload.videoId)) return;

  const coordinator = env.SOCIAL_ANNOUNCEMENTS.getByName("facebook-page");
  const result = await coordinator.announce(payload);

  if (result?.status === "posted") {
    console.log("Facebook live announcement posted", {
      videoId: payload.videoId,
      postId: result.postId
    });
  } else if (result?.status === "failed" || result?.status === "unknown") {
    console.error("Facebook live announcement was not posted", {
      videoId: payload.videoId,
      status: result.status,
      error: result.error || null
    });
  }
}

export class SocialAnnouncementCoordinator extends DurableObject {
  async announce(live) {
    const videoId = validVideoId(live?.videoId);
    if (!videoId) {
      return { status: "invalid", error: "A valid YouTube video ID is required." };
    }

    const key = `facebook:youtube:${videoId}`;
    const existing = await this.ctx.storage.get(key);
    const timestamp = Date.now();

    if (existing?.status === "posted") {
      return {
        status: "already-posted",
        postId: existing.postId || null,
        postedAt: existing.postedAt || null
      };
    }

    if (existing?.status === "posting" || existing?.status === "unknown") {
      return {
        status: existing.status,
        error: existing.error || null
      };
    }

    const previousAttempts = Number.isFinite(Number(existing?.attempts))
      ? Number(existing.attempts)
      : 0;

    if (existing?.status === "failed") {
      if (previousAttempts >= FACEBOOK_MAX_REJECTED_ATTEMPTS) {
        return {
          status: "failed",
          error: existing.error || "Facebook rejected the maximum number of posting attempts."
        };
      }

      if (Number(existing.nextAttemptAt || 0) > timestamp) {
        return {
          status: "waiting",
          nextAttemptAt: existing.nextAttemptAt
        };
      }
    }

    const attempts = previousAttempts + 1;
    const reservedAt = new Date(timestamp).toISOString();
    await this.ctx.storage.put(key, {
      status: "posting",
      videoId,
      title: normalizedPostText(live?.title, 180),
      attempts,
      reservedAt
    });

    const result = await publishFacebookAnnouncement(this.env, live);
    const completedAt = new Date().toISOString();

    if (result.ok) {
      const posted = {
        status: "posted",
        videoId,
        title: normalizedPostText(live?.title, 180),
        attempts,
        reservedAt,
        postedAt: completedAt,
        postId: result.postId
      };
      await this.ctx.storage.put(key, posted);
      return posted;
    }

    if (result.retryable && !result.ambiguous) {
      const failed = {
        status: "failed",
        videoId,
        title: normalizedPostText(live?.title, 180),
        attempts,
        reservedAt,
        failedAt: completedAt,
        nextAttemptAt: timestamp + FACEBOOK_RETRY_DELAY_MS,
        httpStatus: result.httpStatus || null,
        graphErrorCode: result.graphErrorCode || null,
        graphErrorType: result.graphErrorType || null,
        error: result.error || "Facebook rejected the post."
      };
      await this.ctx.storage.put(key, failed);
      return failed;
    }

    const unknown = {
      status: "unknown",
      videoId,
      title: normalizedPostText(live?.title, 180),
      attempts,
      reservedAt,
      failedAt: completedAt,
      httpStatus: result.httpStatus || null,
      error: result.error || "The Facebook posting outcome is unknown."
    };
    await this.ctx.storage.put(key, unknown);
    return unknown;
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
          facebookAutoPost: {
            enabled: facebookConfiguration(env).enabled,
            configured: facebookConfiguration(env).configured
          },
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
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runScheduledAnnouncement(env).catch(error => {
        console.error("Scheduled social announcement failed", {
          error: truncate(error?.message || "Unknown scheduled-task error.", 300)
        });
      })
    );
  }
};
