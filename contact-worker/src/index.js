/*
Full file:
  D:\crackpacks\crackpacks-github-ready\contact-worker\src\index.js

Crack Packs Contact Worker v1.7.0
*/

const VERSION = "1.7.0";
const SERVICE = "crackpacks-contact";
const CONTACT_ADDRESS = "support@crackpacks.com";
const DEFAULT_MAX_MESSAGE_LENGTH = 4000;
const DEFAULT_RATE_LIMIT_SECONDS = 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const corsOrigin = allowedOrigins.has(origin) ? origin : "";

    if (request.method === "OPTIONS") {
      if (origin && !corsOrigin) {
        return jsonResponse(
          { ok: false, error: "Origin is not allowed." },
          403,
          corsHeaders("")
        );
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(corsOrigin)
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse(
        {
          ok: true,
          service: SERVICE,
          version: VERSION,
          configured: Boolean(env.CONTACT_EMAIL && env.CONTACT_DESTINATION),
          contactAddress: CONTACT_ADDRESS,
          endpoints: ["/health", "/contact"]
        },
        200,
        corsHeaders(corsOrigin)
      );
    }

    if (url.pathname !== "/contact") {
      return jsonResponse(
        { ok: false, error: "Not found." },
        404,
        corsHeaders(corsOrigin)
      );
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { ok: false, error: "Method not allowed." },
        405,
        {
          ...corsHeaders(corsOrigin),
          "Allow": "POST, OPTIONS"
        }
      );
    }

    if (origin && !corsOrigin) {
      return jsonResponse(
        { ok: false, error: "Origin is not allowed." },
        403,
        corsHeaders("")
      );
    }

    if (!env.CONTACT_EMAIL || !env.CONTACT_DESTINATION) {
      return jsonResponse(
        { ok: false, error: "Contact service is not configured." },
        503,
        corsHeaders(corsOrigin)
      );
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(
        { ok: false, error: "Content-Type must be application/json." },
        415,
        corsHeaders(corsOrigin)
      );
    }

    const contentLength = Number(request.headers.get("Content-Length") || "0");
    if (Number.isFinite(contentLength) && contentLength > 20000) {
      return jsonResponse(
        { ok: false, error: "Request is too large." },
        413,
        corsHeaders(corsOrigin)
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse(
        { ok: false, error: "Invalid JSON request." },
        400,
        corsHeaders(corsOrigin)
      );
    }

    const email = normalizeText(payload?.email, 254).toLowerCase();
    const message = normalizeMessage(payload?.message);
    const honeypot = normalizeText(payload?.company, 200);
    const page = normalizePage(payload?.page, allowedOrigins);
    const maxMessageLength = positiveInteger(
      env.MAX_MESSAGE_LENGTH,
      DEFAULT_MAX_MESSAGE_LENGTH
    );
    const rateLimitSeconds = positiveInteger(
      env.RATE_LIMIT_SECONDS,
      DEFAULT_RATE_LIMIT_SECONDS
    );

    if (honeypot) {
      return jsonResponse(
        { ok: true, sent: true },
        200,
        corsHeaders(corsOrigin)
      );
    }

    if (!isValidEmail(email)) {
      return jsonResponse(
        { ok: false, error: "Enter a valid email address." },
        400,
        corsHeaders(corsOrigin)
      );
    }

    if (message.length < 10) {
      return jsonResponse(
        { ok: false, error: "Enter a message with at least 10 characters." },
        400,
        corsHeaders(corsOrigin)
      );
    }

    if (message.length > maxMessageLength) {
      return jsonResponse(
        { ok: false, error: `Keep the message under ${maxMessageLength} characters.` },
        400,
        corsHeaders(corsOrigin)
      );
    }

    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateKey = await createRateLimitKey(clientIp, email);
    const cache = caches.default;
    const priorSend = await cache.match(rateKey);

    if (priorSend) {
      return jsonResponse(
        {
          ok: false,
          error: "Please wait a minute before sending another message."
        },
        429,
        {
          ...corsHeaders(corsOrigin),
          "Retry-After": String(rateLimitSeconds)
        }
      );
    }

    const now = new Date().toISOString();
    const country = String(request.cf?.country || "unknown").slice(0, 12);
    const userAgent = normalizeText(request.headers.get("User-Agent"), 300);

    const subject = "New Crack Packs website contact message";
    const textBody = [
      "A visitor submitted the Crack Packs contact form.",
      "",
      `Support address: ${CONTACT_ADDRESS}`,
      `Reply to: ${email}`,
      `Received: ${now}`,
      `Page: ${page || "not provided"}`,
      `Country: ${country}`,
      `User agent: ${userAgent || "not provided"}`,
      "",
      "Message:",
      message
    ].join("\n");

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#182033">
        <h1 style="font-size:22px;margin:0 0 16px">New Crack Packs website message</h1>
        <table style="border-collapse:collapse;margin-bottom:18px">
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Support address</td><td>${escapeHtml(CONTACT_ADDRESS)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Reply to</td><td>${escapeHtml(email)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Received</td><td>${escapeHtml(now)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Page</td><td>${escapeHtml(page || "not provided")}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Country</td><td>${escapeHtml(country)}</td></tr>
        </table>
        <h2 style="font-size:17px;margin:0 0 8px">Message</h2>
        <div style="white-space:pre-wrap;border-left:4px solid #4f7cff;padding:12px 14px;background:#f4f7ff">${escapeHtml(message)}</div>
      </div>
    `;

    try {
      const result = await env.CONTACT_EMAIL.send({
        to: env.CONTACT_DESTINATION,
        from: {
          email: CONTACT_ADDRESS,
          name: "Crack Packs Support"
        },
        replyTo: {
          email,
          name: "Website Visitor"
        },
        subject,
        text: textBody,
        html: htmlBody,
        headers: {
          "X-Crack-Packs-Source": "website-contact-form"
        }
      });

      ctx.waitUntil(
        cache.put(
          rateKey,
          new Response("sent", {
            headers: {
              "Cache-Control": `public, max-age=${rateLimitSeconds}`
            }
          })
        )
      );

      return jsonResponse(
        {
          ok: true,
          sent: true,
          messageId: result?.messageId || null
        },
        200,
        corsHeaders(corsOrigin)
      );
    } catch (error) {
      console.error("Contact email send failed", {
        code: error?.code || "",
        message: error instanceof Error ? error.message : String(error)
      });

      return jsonResponse(
        {
          ok: false,
          error: "The message could not be sent. Please try again."
        },
        502,
        corsHeaders(corsOrigin)
      );
    }
  }
};

function parseAllowedOrigins(raw) {
  const defaults = [
    "https://crackpacks.com",
    "https://www.crackpacks.com",
    "http://localhost:8080",
    "http://127.0.0.1:8080"
  ];

  return new Set(
    String(raw || defaults.join(","))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeMessage(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
}

function isValidEmail(value) {
  return value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePage(value, allowedOrigins) {
  const raw = normalizeText(value, 1000);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    return allowedOrigins.has(url.origin) ? url.href : "";
  } catch {
    return "";
  }
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function createRateLimitKey(ip, email) {
  const source = new TextEncoder().encode(`${ip}|${email}`);
  const digest = await crypto.subtle.digest("SHA-256", source);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return new Request(`https://contact-rate-limit.invalid/${hash}`, {
    method: "GET"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
