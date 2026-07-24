window.CRACKPACKS_TOP_ITEMS = {
  "1hr": [
    { slug: "obsidian-flames-booster-box", name: "Obsidian Flames Booster Box", series: "pokemon", primaryCategory: "tcg", subcategory: "booster boxes", sellerUsername: "CRACKPACKS", priceCents: 15499, rank: 1 },
    { slug: "surging-sparks-etb", name: "Surging Sparks Elite Trainer Box", series: "pokemon", primaryCategory: "tcg", subcategory: "elite trainer boxes", sellerUsername: "RipWizard", priceCents: 5299, rank: 2 },
    { slug: "mtg-final-fantasy-bundle", name: "MTG Final Fantasy Bundle", series: "magic", primaryCategory: "tcg", subcategory: "bundles", sellerUsername: "StackedBreaks", priceCents: 6899, rank: 3 },
    { slug: "prizm-nba-blaster", name: "Prizm NBA Blaster", series: "sports", primaryCategory: "sports", subcategory: "basketball", sellerUsername: "CourtChase", priceCents: 3999, rank: 4 },
    { slug: "graded-charizard-slab", name: "Charizard Graded Slab", series: "pokemon", primaryCategory: "collectibles", subcategory: "graded cards", sellerUsername: "VaultFire", priceCents: 32999, rank: 5 },
    { slug: "one-piece-double-pack", name: "One Piece Double Pack", series: "one_piece", primaryCategory: "tcg", subcategory: "double packs", sellerUsername: "TreasureHits", priceCents: 1499, rank: 6 },
    { slug: "yugioh-quarter-century-box", name: "Yu-Gi-Oh Quarter Century Box", series: "yugioh", primaryCategory: "tcg", subcategory: "booster boxes", sellerUsername: "ShadowCards", priceCents: 7999, rank: 7 },
    { slug: "sealed-151-mini-tin", name: "Pokémon 151 Mini Tin", series: "pokemon", primaryCategory: "collectibles", subcategory: "tins", sellerUsername: "TinHunter", priceCents: 1899, rank: 8 },
    { slug: "crackpacks-holo-thankyou-single", name: "Crack Packs Holo Thank You Single", series: "pokemon", primaryCategory: "tcg", subcategory: "singles", sellerUsername: "CRACKPACKS", priceCents: 699, rank: 9 },
    { slug: "vintage-team-logo-hat", name: "Vintage Team Logo Hat", series: "memorabilia", primaryCategory: "memorabilia", subcategory: "hats", sellerUsername: "RetroCase", priceCents: 2499, rank: 10 }
  ],
  "3hr": [],
  "5hr": [],
  "12hr": [],
  "24hr": [],
  "3day": [],
  "5day": [],
  "7day": [],
  "30day": [],
  "3months": [],
  "6months": [],
  "year": [],
  "ytd": []
};

["3hr","5hr","12hr","24hr","3day","5day","7day","30day","3months","6months","year","ytd"].forEach(key => {
  window.CRACKPACKS_TOP_ITEMS[key] = window.CRACKPACKS_TOP_ITEMS["1hr"].map((item, index) => ({
    ...item,
    rank: index + 1,
    priceCents: item.priceCents + (index * 125)
  }));
});
