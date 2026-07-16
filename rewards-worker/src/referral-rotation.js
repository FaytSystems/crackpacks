export const OWNER_REFERRAL_TIME_ZONE = "America/New_York";
export const OWNER_REFERRAL_WINDOW_LABELS = {
  7: "7:00 AM–7:00 PM ET",
  19: "7:00 PM–7:00 AM ET"
};

const encoder = new TextEncoder();
const referralClock = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
  timeZone: OWNER_REFERRAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});
const pad2 = value => String(value).padStart(2, "0");

function zonedParts(epochMs) {
  const values = {};
  for (const part of referralClock.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function shiftCivilDate({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function civilTimeToEpoch(civil) {
  const target = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute || 0, civil.second || 0);
  let candidate = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observed = zonedParts(candidate);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const correction = target - observedAsUtc;
    if (correction === 0) break;
    candidate += correction;
  }
  const actual = zonedParts(candidate);
  for (const field of ["year", "month", "day", "hour", "minute", "second"]) {
    if (actual[field] !== (civil[field] || 0)) throw new Error("Invalid owner referral boundary.");
  }
  return candidate;
}

export function ownerReferralSlotAt(epochMs = Date.now()) {
  const local = zonedParts(epochMs);
  let date = { year: local.year, month: local.month, day: local.day };
  let startHour;
  if (local.hour >= 19) startHour = 19;
  else if (local.hour >= 7) startHour = 7;
  else {
    date = shiftCivilDate(date, -1);
    startHour = 19;
  }
  const endDate = startHour === 19 ? shiftCivilDate(date, 1) : date;
  const endHour = startHour === 19 ? 7 : 19;
  const startsAtMs = civilTimeToEpoch({ ...date, hour: startHour });
  const expiresAtMs = civilTimeToEpoch({ ...endDate, hour: endHour });
  return {
    id: `${date.year}-${pad2(date.month)}-${pad2(date.day)}-${pad2(startHour)}`,
    startsAt: new Date(startsAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    label: OWNER_REFERRAL_WINDOW_LABELS[startHour],
    nextBoundaryLabel: endHour === 7 ? "7:00 AM Eastern" : "7:00 PM Eastern"
  };
}

const toBase64url = bytes => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64url = value => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
};

async function hmacKey(secret, usage) {
  if (!secret) throw new Error("OWNER_REFERRAL_SECRET_NOT_CONFIGURED");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function signingMessage(siteUrl, ownerMemberId, slotId) {
  const origin = new URL(siteUrl).origin.toLowerCase();
  return `crackpacks-owner-referral|v1|${origin}|${ownerMemberId}|${slotId}`;
}

export async function issueOwnerReferral(siteUrl, ownerMemberId, secret, epochMs = Date.now()) {
  const slot = ownerReferralSlotAt(epochMs);
  const key = await hmacKey(secret, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingMessage(siteUrl, ownerMemberId, slot.id)));
  const token = `v1.${toBase64url(new Uint8Array(signature))}`;
  const url = new URL("/referral.html", new URL(siteUrl).origin);
  url.searchParams.set("owner_ref", token);
  return { token, url: url.toString(), ...slot };
}

export async function verifyOwnerReferral(token, siteUrl, ownerMemberId, secret, epochMs = Date.now()) {
  const match = /^v1\.([A-Za-z0-9_-]{43})$/.exec(String(token || ""));
  if (!match) return false;
  let signature;
  try { signature = fromBase64url(match[1]); } catch { return false; }
  if (toBase64url(signature) !== match[1]) return false;
  const slot = ownerReferralSlotAt(epochMs);
  const key = await hmacKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(signingMessage(siteUrl, ownerMemberId, slot.id)));
}
