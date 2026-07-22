const encoder = new TextEncoder();

export function stripeFormBody(entries) {
  const body = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null && value !== "") body.append(key, String(value));
  }
  return body;
}

export async function stripeRequest(secretKey, path, entries = [], idempotencyKey = "") {
  if (!secretKey) throw new Error("STRIPE_NOT_CONFIGURED");
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const result = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers,
    body: stripeFormBody(entries)
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    console.error("Stripe request failed", { status: result.status, type: payload?.error?.type || "", code: payload?.error?.code || "" });
    const error = new Error("STRIPE_PROVIDER_ERROR");
    error.stripeStatus = result.status;
    throw error;
  }
  return payload;
}

function parseSignatureHeader(value) {
  const parts = String(value || "").split(",");
  let timestamp = 0;
  const signatures = [];
  for (const part of parts) {
    const [key, raw] = part.trim().split("=", 2);
    if (key === "t") timestamp = Number(raw);
    if (key === "v1" && /^[a-f0-9]{64}$/i.test(raw || "")) signatures.push(raw.toLowerCase());
  }
  return { timestamp, signatures };
}

function timingSafeEqualHex(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyStripeWebhook({ rawBody, signatureHeader, secret, nowMs = Date.now(), toleranceSeconds = 300 }) {
  if (!secret || typeof rawBody !== "string") return { ok: false, error: "missing" };
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0 || !signatures.length) return { ok: false, error: "format" };
  if (Math.abs(Math.floor(nowMs / 1000) - timestamp) > toleranceSeconds) return { ok: false, error: "stale" };
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some(signature => timingSafeEqualHex(signature, expected)) ? { ok: true } : { ok: false, error: "signature" };
}
