(() => {
  "use strict";

  const SHOWS = [
    {
      id: "crackpacks-live-tonight",
      seller: "CRACKPACKS",
      title: "Crown Zenith Heat Check",
      state: "live",
      viewers: 182,
      image: "assets/images/banner-cosmic.svg",
      startsAt: "Live now",
      item: "Sealed booster boxes, slabs, singles",
      mode: "breaks • sealed • singles"
    },
    {
      id: "legendary-rips-friday",
      seller: "LegendaryRips",
      title: "Friday Night Japanese Rip & Ship",
      state: "upcoming",
      viewers: 64,
      image: "assets/images/banner-flame.svg",
      startsAt: "Jul 24, 2026 · 7:30 PM ET",
      item: "Japanese boxes + live singles",
      mode: "rip&ship • japanese • slabs"
    },
    {
      id: "halo-hits-sunday",
      seller: "HaloHits",
      title: "Sunday Giveaway Sprint",
      state: "upcoming",
      viewers: 29,
      image: "assets/images/banner-electric.svg",
      startsAt: "Jul 26, 2026 · 4:00 PM ET",
      item: "Holo singles and giveaway slots",
      mode: "singles • giveaways"
    }
  ];

  const WATCHLIST_KEY = "cp_stream_watchlist";
  const FOLLOW_KEY = "cp_stream_follows";
  const GIVEAWAY_KEY = "cp_seller_giveaways";
  const GIFT_KEY = "cp_gifted_giveaways";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const safeJson = (key, fallback) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  };
  const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const watchlist = safeJson(WATCHLIST_KEY, {});
  const follows = safeJson(FOLLOW_KEY, {});
  const giveaways = safeJson(GIVEAWAY_KEY, []);
  const giftedQueue = safeJson(GIFT_KEY, []);

  const formatShowCard = show => {
    const watching = Boolean(watchlist[show.id]);
    const following = Boolean(follows[show.seller]);
    return `
      <article class="stream-card holo-panel">
        <img src="${show.image}" alt="${show.title}">
        <div class="stream-card-top">
          <span class="stream-pill ${show.state}">${show.state === "live" ? "LIVE NOW" : "UPCOMING"}</span>
          <span class="viewer-pill">${show.viewers} viewers</span>
        </div>
        <h3>${show.title}</h3>
        <p><strong>${show.seller}</strong> · ${show.item}</p>
        <p>${show.mode}</p>
        <div class="stream-card-meta">
          <span>${show.startsAt}</span>
          <span>${show.state === "live" ? "Bidding open" : "Add to watchlist"}</span>
        </div>
        <div class="stream-card-actions">
          <button class="btn btn-outline btn-small" type="button" data-watchlist-toggle="${show.id}">${watching ? "Saved" : "Add to Watchlist"}</button>
          <button class="btn btn-outline btn-small" type="button" data-follow-toggle="${show.seller}">${following ? "Following" : "Follow"}</button>
          <button class="btn btn-primary btn-small" type="button" data-open-gifted="${show.id}">Donate to Show</button>
        </div>
      </article>
    `;
  };

  const renderTab = tab => {
    const grid = $("[data-streams-list]");
    const empty = $("[data-streams-empty]");
    if (!grid) return;
    let filtered = SHOWS;
    if (tab === "watchlist") filtered = SHOWS.filter(show => watchlist[show.id]);
    if (tab === "live") filtered = SHOWS.filter(show => show.state === "live");
    if (tab === "upcoming") filtered = SHOWS.filter(show => show.state === "upcoming");
    if (tab === "followed") filtered = SHOWS.filter(show => follows[show.seller]);
    grid.innerHTML = filtered.map(formatShowCard).join("");
    empty.hidden = filtered.length !== 0;
    bindCardActions();
  };

  const renderSellerGiveaways = () => {
    const list = $("[data-seller-giveaway-list]");
    if (!list) return;
    if (!giveaways.length) {
      list.innerHTML = `<div class="stream-empty">No saved giveaway presets yet. Build one once, then launch it during stream.</div>`;
      return;
    }
    list.innerHTML = giveaways.map((item, index) => `
      <article class="seller-giveaway-item">
        <header><strong>${item.title}</strong><span>${item.eligibility}</span></header>
        <p>${item.quantity} winner(s) · ${item.inventoryLabel} · ${item.openMode}</p>
        <small>${item.rules}</small>
        <div class="stream-card-actions">
          <button class="btn btn-primary btn-small" type="button" data-launch-giveaway="${index}">Queue for stream</button>
        </div>
      </article>
    `).join("");
  };

  const renderGiftedQueue = () => {
    const list = $("[data-gifted-giveaway-queue]");
    if (!list) return;
    if (!giftedQueue.length) {
      list.innerHTML = `<div class="stream-empty">No funded gifted giveaways yet.</div>`;
      return;
    }
    list.innerHTML = giftedQueue.map(item => `
      <article class="gifted-giveaway-card">
        <header><strong>${item.showTitle}</strong><span>${item.status}</span></header>
        <p>${item.product} · ${item.buyerName}</p>
        <small>${item.note}</small>
      </article>
    `).join("");
  };

  const bindCardActions = () => {
    $$("[data-watchlist-toggle]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.watchlistToggle;
        watchlist[id] = !watchlist[id];
        saveJson(WATCHLIST_KEY, watchlist);
        renderTab(($(".hub-tab.is-active")?.dataset.hubTab) || "watchlist");
      });
    });
    $$("[data-follow-toggle]").forEach(button => {
      button.addEventListener("click", () => {
        const seller = button.dataset.followToggle;
        follows[seller] = !follows[seller];
        saveJson(FOLLOW_KEY, follows);
        renderTab(($(".hub-tab.is-active")?.dataset.hubTab) || "watchlist");
      });
    });
    $$("[data-open-gifted]").forEach(button => {
      button.addEventListener("click", () => {
        const show = SHOWS.find(entry => entry.id === button.dataset.openGifted);
        const modalTitle = $("[data-gifted-show-title]");
        const hiddenInput = $("[data-gifted-show-id]");
        if (show && modalTitle && hiddenInput) {
          modalTitle.textContent = `${show.seller} · ${show.title}`;
          hiddenInput.value = show.id;
        }
      });
    });
  };

  $$("[data-hub-tab]").forEach(button => {
    button.addEventListener("click", () => {
      $$("[data-hub-tab]").forEach(node => node.classList.toggle("is-active", node === button));
      renderTab(button.dataset.hubTab || "watchlist");
    });
  });

  const sellerForm = $("[data-seller-giveaway-form]");
  sellerForm?.addEventListener("submit", event => {
    event.preventDefault();
    const form = new FormData(sellerForm);
    giveaways.unshift({
      title: String(form.get("title") || "").trim(),
      quantity: String(form.get("quantity") || "1").trim(),
      inventoryLabel: String(form.get("inventoryLabel") || "").trim(),
      eligibility: String(form.get("eligibility") || "").trim(),
      openMode: String(form.get("openMode") || "").trim(),
      rules: String(form.get("rules") || "").trim()
    });
    saveJson(GIVEAWAY_KEY, giveaways);
    sellerForm.reset();
    renderSellerGiveaways();
  });

  const giftedForm = $("[data-gifted-giveaway-form]");
  giftedForm?.addEventListener("submit", event => {
    event.preventDefault();
    const form = new FormData(giftedForm);
    const show = SHOWS.find(entry => entry.id === String(form.get("showId") || ""));
    giftedQueue.unshift({
      showId: form.get("showId"),
      showTitle: show ? `${show.seller} · ${show.title}` : "Selected show",
      product: String(form.get("product") || "").trim(),
      buyerName: String(form.get("buyerName") || "Supporter").trim(),
      note: String(form.get("note") || "Reserved for seller launch after payment confirmation.").trim(),
      status: "Awaiting payment confirmation"
    });
    saveJson(GIFT_KEY, giftedQueue);
    giftedForm.reset();
    renderGiftedQueue();
  });

  renderTab("watchlist");
  renderSellerGiveaways();
  renderGiftedQueue();
})();
