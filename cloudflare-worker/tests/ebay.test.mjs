import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const configuredEnv = {
  ALLOWED_ORIGINS: "https://crackpacks.com",
  EBAY_CLIENT_ID: "CrackPacks-test-client",
  EBAY_CLIENT_SECRET: "test-secret",
  EBAY_ENVIRONMENT: "production",
  EBAY_MARKETPLACE_ID: "EBAY_US"
};

test("health reports whether eBay credentials are configured", async () => {
  const response = await worker.fetch(new Request("https://api.crackpacks.com/health"), {});
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ebayConfigured, false);
  assert.equal(payload.ebayEnvironment, "production");
  assert.equal(payload.ebayMarketplaceId, "EBAY_US");
});

test("eBay route explains missing credentials", async () => {
  const response = await worker.fetch(
    new Request("https://api.crackpacks.com/ebay?term=charizard"),
    {}
  );
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.match(payload.error, /EBAY_CLIENT_ID/);
  assert.match(payload.error, /EBAY_CLIENT_SECRET/);
});

test("eBay route returns safe upstream OAuth diagnostics", async t => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async input => {
    assert.match(String(input), /\/identity\/v1\/oauth2\/token$/);
    return Response.json(
      {
        error: "invalid_client",
        error_description: "client authentication failed"
      },
      { status: 401 }
    );
  };

  const response = await worker.fetch(
    new Request("https://api.crackpacks.com/ebay?term=charizard"),
    {
      ...configuredEnv,
      EBAY_CLIENT_ID: "diagnostic-client"
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.match(payload.error, /invalid_client/);
  assert.match(payload.error, /client authentication failed/);
  assert.doesNotMatch(payload.error, /test-secret/);
});

test("eBay route mints one token and normalizes active listings", async t => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let tokenCalls = 0;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.endsWith("/identity/v1/oauth2/token")) {
      tokenCalls += 1;
      return Response.json({
        access_token: "application-token",
        expires_in: 7200,
        token_type: "Application Access Token"
      });
    }

    if (url.includes("/buy/browse/v1/item_summary/search")) {
      return Response.json({
        total: 1,
        itemSummaries: [
          {
            itemId: "v1|123|0",
            title: "Charizard trading card",
            image: { imageUrl: "https://i.ebayimg.com/images/example.jpg" },
            itemWebUrl: "https://www.ebay.com/itm/123",
            condition: "Ungraded",
            price: { value: "125.50", currency: "USD" },
            shippingOptions: [
              {
                shippingCost: { value: "5.25", currency: "USD" },
                shippingCostType: "FIXED"
              }
            ],
            buyingOptions: ["FIXED_PRICE"],
            seller: { username: "card-seller" },
            itemLocation: {
              city: "Allentown",
              stateOrProvince: "PA",
              country: "US"
            }
          }
        ]
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const requestUrl = "https://api.crackpacks.com/ebay?term=Charizard%20Pokemon%20TCG&page=1&pageSize=6";
  const firstResponse = await worker.fetch(new Request(requestUrl), configuredEnv);
  const firstPayload = await firstResponse.json();
  const secondResponse = await worker.fetch(new Request(requestUrl), configuredEnv);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(tokenCalls, 1);
  assert.equal(firstPayload.meta.source, "ebay-browse");
  assert.equal(firstPayload.meta.priceType, "active-listing");
  assert.equal(firstPayload.data.length, 1);
  assert.equal(firstPayload.data[0].price.value, 125.5);
  assert.equal(firstPayload.data[0].shipping.value, 5.25);
  assert.equal(firstPayload.data[0].url, "https://www.ebay.com/itm/123");

  const tokenRequest = requests.find(entry => entry.url.includes("/identity/v1/oauth2/token"));
  assert.equal(tokenRequest.init.method, "POST");
  assert.match(tokenRequest.init.headers.Authorization, /^Basic /);
  assert.match(tokenRequest.init.body, /grant_type=client_credentials/);

  const searchRequest = requests.find(entry => entry.url.includes("/item_summary/search"));
  assert.equal(searchRequest.init.headers.Authorization, "Bearer application-token");
  assert.equal(searchRequest.init.headers["X-EBAY-C-MARKETPLACE-ID"], "EBAY_US");
  assert.match(searchRequest.url, /q=Charizard\+Pokemon\+TCG/);
});

test("API TCG search forwards the requested page and page size", async t => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl = "";

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async input => {
    upstreamUrl = String(input);
    return Response.json({
      data: [
        {
          id: "op-1",
          name: "Monkey D. Luffy",
          type: "card",
          number: "OP01-001",
          setName: "Romance Dawn"
        },
        { id: "op-2", name: "Luffy Two", type: "card" },
        { id: "op-3", name: "Luffy Three", type: "card" },
        { id: "op-4", name: "Luffy Four", type: "card" }
      ],
      total: 42
    });
  };

  const response = await worker.fetch(
    new Request(
      "https://api.crackpacks.com/cards?term=Luffy&field=name&series=onepiece&page=2&pageSize=3"
    ),
    {
      APITCG_API_KEY: "test-api-tcg-key"
    }
  );
  const payload = await response.json();
  const parsedUpstreamUrl = new URL(upstreamUrl);

  assert.equal(response.status, 200);
  assert.equal(parsedUpstreamUrl.searchParams.get("tcg"), "one-piece");
  assert.equal(parsedUpstreamUrl.searchParams.get("limit"), "3");
  assert.equal(parsedUpstreamUrl.searchParams.get("page"), "2");
  assert.equal(payload.page, 2);
  assert.equal(payload.pageSize, 3);
  assert.equal(payload.data.length, 3);
  assert.equal(payload.totalCount, 42);
});

test("Pokemon search falls back to API TCG when the primary catalog rejects its key", async t => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("api.pokemontcg.io")) {
      return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
    }
    if (url.includes("api.apitcg.com")) {
      return Response.json({
        data: [{
          id: "pokemon-1",
          name: "Charizard ex",
          type: "card",
          number: "125/197",
          setName: "Obsidian Flames"
        }],
        total: 1
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const response = await worker.fetch(
    new Request("https://api.crackpacks.com/cards?term=charizard&field=name&series=pokemon&page=1&pageSize=3"),
    {
      POKEMON_TCG_API_KEY: "rejected-primary-key",
      APITCG_API_KEY: "working-fallback-key"
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.source, "apitcg");
  assert.equal(payload.meta.submittedTcg, "pokemon");
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].name, "Charizard ex");
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /api\.pokemontcg\.io/);
  assert.match(requests[1].url, /api\.apitcg\.com\/api\/products/);
  assert.equal(requests[1].init.headers["x-api-key"], "working-fallback-key");
});
