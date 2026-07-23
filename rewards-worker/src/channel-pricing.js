export const CHANNEL_PRICING_POLICY = Object.freeze({
  retail: Object.freeze({ processingPermille: 27, marginPermille: 250, denominatorPermille: 723 }),
  website: Object.freeze({ processingPermille: 29, marginPermille: 200, denominatorPermille: 771, fixedFeeCents: 30 }),
  live: Object.freeze({ platformPermille: 29, marginPermille: 180, denominatorPermille: 791, fixedFeeCents: 30 }),
  wholesaleSmall: Object.freeze({ paymentPermille: 0, marginPermille: 150, denominatorPermille: 850 }),
  wholesaleCase: Object.freeze({ paymentPermille: 0, marginPermille: 120, denominatorPermille: 880 }),
  wholesalePallet: Object.freeze({ paymentPermille: 0, marginPermille: 100, denominatorPermille: 900 })
});

const optionalCents = value => value === null || value === undefined || value === "" ? null : Number(value);
const allConfigured = values => values.every(value => Number.isFinite(value) && value >= 0);
const floorFrom = (components, denominatorPermille) => allConfigured(components)
  ? Math.ceil((components.reduce((total, value) => total + value, 0) * 1000) / denominatorPermille)
  : null;
const finalPrice = (floor, override) => floor === null ? null : override === null ? floor : Math.max(floor, override);

export function calculateChannelPricing(input = {}) {
  const cogs = optionalCents(input.cogsCents);
  const postage = optionalCents(input.usShippingCents);
  const packaging = optionalCents(input.packagingCents);
  const overhead = optionalCents(input.overheadCents);
  const retailFixedFee = optionalCents(input.retailFixedFeeCents);
  const wholesaleHandling = optionalCents(input.wholesaleHandlingCents);

  const floors = {
    retail: floorFrom([cogs, overhead, retailFixedFee], CHANNEL_PRICING_POLICY.retail.denominatorPermille),
    websiteUs: floorFrom([cogs, postage, packaging, overhead, CHANNEL_PRICING_POLICY.website.fixedFeeCents], CHANNEL_PRICING_POLICY.website.denominatorPermille),
    websiteInternational: floorFrom([cogs, packaging, overhead, CHANNEL_PRICING_POLICY.website.fixedFeeCents], CHANNEL_PRICING_POLICY.website.denominatorPermille),
    live: floorFrom([cogs, packaging, overhead, CHANNEL_PRICING_POLICY.live.fixedFeeCents], CHANNEL_PRICING_POLICY.live.denominatorPermille),
    wholesaleSmall: floorFrom([cogs, wholesaleHandling], CHANNEL_PRICING_POLICY.wholesaleSmall.denominatorPermille),
    wholesaleCase: floorFrom([cogs, wholesaleHandling], CHANNEL_PRICING_POLICY.wholesaleCase.denominatorPermille),
    wholesalePallet: floorFrom([cogs, wholesaleHandling], CHANNEL_PRICING_POLICY.wholesalePallet.denominatorPermille)
  };
  const overrides = {
    retail: optionalCents(input.retailListPriceCents),
    websiteUs: optionalCents(input.websiteListPriceCents),
    websiteInternational: optionalCents(input.internationalListPriceCents),
    live: optionalCents(input.liveListPriceCents),
    wholesaleSmall: optionalCents(input.wholesaleSmallListPriceCents),
    wholesaleCase: optionalCents(input.wholesaleCaseListPriceCents),
    wholesalePallet: optionalCents(input.wholesalePalletListPriceCents)
  };
  const prices = Object.fromEntries(Object.keys(floors).map(channel => [channel, finalPrice(floors[channel], overrides[channel])]));
  return { floors, overrides, prices };
}

export function channelPricingErrors(input = {}) {
  const { floors, overrides } = calculateChannelPricing(input);
  const labels = {
    retail: "Brick-and-mortar list price",
    websiteUs: "USA website list price",
    websiteInternational: "International website list price",
    live: "Live auction list price",
    wholesaleSmall: "Small-reseller wholesale price",
    wholesaleCase: "Case wholesale price",
    wholesalePallet: "Pallet wholesale price"
  };
  const errors = [];
  for (const channel of Object.keys(floors)) {
    if (overrides[channel] === null) continue;
    if (!Number.isFinite(overrides[channel]) || overrides[channel] < 0) {
      errors.push(`${labels[channel]} is invalid.`);
    } else if (floors[channel] === null) {
      errors.push(`${labels[channel]} needs all of its cost inputs before a safe floor can be verified.`);
    } else if (overrides[channel] < floors[channel]) {
      errors.push(`${labels[channel]} cannot be lower than its calculated safe floor.`);
    }
  }
  return errors;
}
