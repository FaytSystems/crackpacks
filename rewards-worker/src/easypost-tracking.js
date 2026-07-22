const encoder = new TextEncoder();

const TRACKING_STATUSES = new Set([
  "unknown",
  "pre_transit",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "available_for_pickup",
  "return_to_sender",
  "failure",
  "cancelled",
  "error"
]);

const bounded = (value, max) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);

function hexBytes(value) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), pair => Number.parseInt(pair, 16));
}

export async function verifyEasyPostWebhook({ secret, timestamp, path, signature, method = "POST", rawBody = "", nowMs = Date.now(), toleranceMinutes = 1 }) {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!timestamp || !path || !signature) return { ok: false, reason: "missing_headers" };
  if (!Number.isInteger(toleranceMinutes) || toleranceMinutes < 0 || toleranceMinutes > 60) return { ok: false, reason: "invalid_tolerance" };
  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "invalid_timestamp" };
  const ageMs = nowMs - sentAt;
  if (ageMs > toleranceMinutes * 60_000 || ageMs < -30_000) return { ok: false, reason: "stale_timestamp" };
  const match = /^hmac-sha256-hex=([a-f0-9]{64})$/i.exec(signature.trim());
  const supplied = match ? hexBytes(match[1]) : null;
  if (!supplied) return { ok: false, reason: "invalid_signature_format" };
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = encoder.encode(`${timestamp}${String(method).toUpperCase()}${path}${rawBody}`);
  const ok = await crypto.subtle.verify("HMAC", key, supplied, signed);
  return { ok, reason: ok ? "verified" : "signature_mismatch" };
}

export function sanitizeEasyPostTracker(tracker) {
  if (!tracker || tracker.object !== "Tracker" || !/^trk_[a-z0-9]+$/i.test(String(tracker.id || ""))) return null;
  const details = Array.isArray(tracker.tracking_details) ? tracker.tracking_details.slice(-50).map(detail => {
    const location = detail?.tracking_location || {};
    return {
      message: bounded(detail?.message || detail?.description, 240),
      status: TRACKING_STATUSES.has(detail?.status) ? detail.status : "unknown",
      statusDetail: bounded(detail?.status_detail, 80),
      datetime: bounded(detail?.datetime, 40),
      source: bounded(detail?.source, 60),
      location: {
        city: bounded(location.city, 80),
        state: bounded(location.state, 40),
        country: bounded(location.country, 40)
      }
    };
  }) : [];
  return {
    id: String(tracker.id),
    mode: tracker.mode === "production" ? "production" : "test",
    trackingCode: bounded(tracker.tracking_code, 120),
    carrier: bounded(tracker.carrier, 60),
    status: TRACKING_STATUSES.has(tracker.status) ? tracker.status : "unknown",
    statusDetail: bounded(tracker.status_detail, 80),
    estimatedDeliveryDate: bounded(tracker.est_delivery_date, 40) || null,
    publicUrl: /^https:\/\//i.test(String(tracker.public_url || "")) ? String(tracker.public_url).slice(0, 500) : "",
    details
  };
}

export function trackingStatusLabel(value) {
  return bounded(value, 40).replace(/_/g, " ");
}
