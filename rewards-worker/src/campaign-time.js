export const CAMPAIGN_TIME_ZONE = "America/New_York";
export const MAX_CAMPAIGN_EXPIRY_HOURS = 7 * 24;

export function parseCampaignExpiryHours(value) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 1 && hours <= MAX_CAMPAIGN_EXPIRY_HOURS ? hours : null;
}

const campaignClock = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
  timeZone: CAMPAIGN_TIME_ZONE,
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
  for (const part of campaignClock.formatToParts(new Date(epochMs))) {
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
  const target = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour || 0, civil.minute || 0, civil.second || 0);
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
    if (actual[field] !== (civil[field] || 0)) throw new Error("Invalid campaign week boundary.");
  }
  return candidate;
}

export function campaignWeekAt(epochMs = Date.now()) {
  const local = zonedParts(epochMs);
  const localDate = { year: local.year, month: local.month, day: local.day };
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const daysSinceThursday = (weekday - 4 + 7) % 7;
  const startDate = shiftCivilDate(localDate, -daysSinceThursday);
  const endDate = shiftCivilDate(startDate, 7);
  const startsAtMs = civilTimeToEpoch(startDate);
  const expiresAtMs = civilTimeToEpoch(endDate);
  const key = `${startDate.year}-${pad2(startDate.month)}-${pad2(startDate.day)}`;
  return {
    key,
    startsAt: new Date(startsAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}
