(function () {
  const apiBase = (window.CRACKPACKS_CONFIG && window.CRACKPACKS_CONFIG.rewardsApiUrl) || "https://rewards-api.crackpacks.com";
  const token = () => localStorage.getItem("cp_rewards_token") || "";
  const showId = new URLSearchParams(location.search).get("show") || "";
  let viewerClientId = localStorage.getItem("cp_viewer_client_id") || "";
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(viewerClientId)) {
    viewerClientId = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem("cp_viewer_client_id", viewerClientId);
  }
  const $ = (sel) => document.querySelector(sel);
  const els = {
    card: $("[data-live-bid-card]"),
    status: $("[data-live-status]"),
    showTitle: $("[data-live-show-title]"),
    showThumbnail: $("[data-live-show-thumbnail]"),
    title: $("[data-lot-title]"),
    description: $("[data-lot-description]"),
    currentLabel: $("[data-current-bid-label]"),
    nextLabel: $("[data-next-bid-label]"),
    current: $("[data-current-bid]"),
    next: $("[data-next-bid]"),
    copy: $("[data-bid-state-copy]"),
    flash: $("[data-winner-flash]"),
    slider: $("[data-slide-bid]"),
    handle: $("[data-slide-handle]"),
    fill: $("[data-slide-fill]"),
    customForm: $("[data-custom-bid-form]"),
    customCurrentLabel: $("[data-custom-current-label]"),
    customMinLabel: $("[data-custom-min-label]"),
    customCurrent: $("[data-custom-live-current]"),
    customMin: $("[data-custom-live-min]"),
    customHelp: $("[data-custom-bid-help]"),
    player: $("[data-live-stream-player]"),
    placeholder: $("[data-live-video-placeholder]"),
    viewers: $("[data-live-viewers]")
  };

  let lot = null;
  let dragging = false;
  let lastRenderedBidCents = 0;
  let activePlaybackUrl = "";

  const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
  const dollars = (cents) => (Number(cents || 0) / 100).toFixed(2);

  const api = async (path, options = {}) => {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const auth = token();
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const res = await fetch(`${apiBase}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Live auction request failed.");
    return data;
  };

  const setSlider = (pct) => {
    const value = Math.max(0, Math.min(100, pct));
    if (els.fill) els.fill.style.width = `${value}%`;
    if (els.handle) els.handle.style.left = `calc(${Math.min(value, 42)}% + 6px)`;
  };

  const setBiddingEnabled = enabled => {
    if (els.handle) {
      els.handle.disabled = !enabled;
      els.handle.setAttribute("aria-disabled", String(!enabled));
      els.handle.textContent = enabled ? "SLIDE TO BID" : "BIDDING OPENS LIVE";
    }
    if (els.customForm) {
      Array.from(els.customForm.elements).forEach(control => {
        control.disabled = !enabled;
      });
    }
  };

  const syncCustomBidWindow = () => {
    if (!els.customForm) return;
    const input = els.customForm.elements.bidAmount;
    const scheduled = lot?.status === "scheduled";
    const currentCents = Number(lot?.currentBidCents || lot?.startingBidCents || 0);
    const minCents = scheduled ? Number(lot?.bidIncrementCents || 0) : Number(lot?.minNextBidCents || 0);

    if (els.customCurrentLabel) els.customCurrentLabel.textContent = scheduled ? "Starting bid" : "Live current bid";
    if (els.customMinLabel) els.customMinLabel.textContent = scheduled ? "Bid increment" : "Minimum next bid";
    if (els.customCurrent) els.customCurrent.textContent = money(currentCents);
    if (els.customMin) els.customMin.textContent = money(minCents);

    if (input) {
      input.min = String(Math.max(0.01, minCents / 100));
      input.placeholder = minCents ? `Minimum ${money(minCents)}` : "Enter your max bid";
      const existingValue = Number(input.value);
      if (!Number.isFinite(existingValue) || existingValue <= 0) {
        input.value = minCents ? dollars(minCents) : "";
      } else if (minCents && existingValue * 100 < minCents) {
        input.value = dollars(minCents);
      }
    }

    if (els.customHelp) {
      els.customHelp.textContent = scheduled
        ? `Bidding opens when the seller starts this item at ${money(currentCents)}.`
        : minCents
        ? `Rolling live bid is ${money(currentCents)}. Your bid must stay at or above ${money(minCents)}.`
        : "Enter the amount you want to bid. This updates live while the auction moves.";
    }
  };

  const animateBidIfRaised = (nextCurrent) => {
    if (!els.current || !lastRenderedBidCents || nextCurrent <= lastRenderedBidCents) return;
    els.current.classList.remove("bid-pop");
    void els.current.offsetWidth;
    els.current.classList.add("bid-pop");
  };

  const render = (nextLot) => {
    lot = nextLot || null;
    if (lot?.status === "live" && lot.playbackUrl) setPlayback(lot.playbackUrl);
    if (!lot) {
      els.card.dataset.state = "ready";
      els.status.textContent = "No auction is live yet. Keep this page open.";
      els.title.textContent = "No live auction yet";
      els.description.textContent = "Waiting for the breaker to open the next lot.";
      if (els.currentLabel) els.currentLabel.textContent = "Current bid";
      if (els.nextLabel) els.nextLabel.textContent = "Next slide bid";
      els.current.textContent = "$0.00";
      els.next.textContent = "$0.00";
      els.copy.textContent = token() ? "Ready when the next auction starts." : "Sign in to your Profile before bidding.";
      els.flash.hidden = true;
      lastRenderedBidCents = 0;
      setBiddingEnabled(false);
      syncCustomBidWindow();
      setSlider(0);
      return;
    }

    const scheduled = lot.status === "scheduled";
    const live = lot.status === "live";
    const nextCurrent = Number(lot.currentBidCents || lot.startingBidCents || 0);
    els.card.dataset.state = scheduled ? "scheduled" : lot.viewerBidState || "ready";
    els.status.textContent = scheduled
      ? "Show published. This auction item is queued."
      : live
      ? "Auction live now."
      : "Auction just closed.";
    els.title.textContent = lot.title || "Live auction";
    els.description.textContent = lot.description || (scheduled ? "Bidding opens when the seller starts this item." : "Slide to bid, or set your own bid amount.");
    if (els.currentLabel) els.currentLabel.textContent = scheduled ? "Starting bid" : "Current bid";
    if (els.nextLabel) els.nextLabel.textContent = scheduled ? "Bid increment" : "Next slide bid";
    els.current.textContent = money(nextCurrent);
    els.next.textContent = money(scheduled ? lot.bidIncrementCents : lot.minNextBidCents);
    animateBidIfRaised(nextCurrent);

    if (scheduled) els.copy.textContent = "This item is ready. Bidding unlocks when the seller starts the auction.";
    else if (!token()) els.copy.textContent = "Sign in to bid. Watching is fine, bidding needs a verified Profile.";
    else if (lot.viewerBidState === "winning") els.copy.textContent = "You're winning. The custom bid box is still tracking the live number.";
    else if (lot.viewerBidState === "losing") els.copy.textContent = "You're losing. The bid box is rolling live, so underbids get bumped to the minimum.";
    else els.copy.textContent = "Slide for the next bid, or use Set Your Bid for your own dollar amount.";

    if (lot.showWinnerBanner) {
      els.flash.textContent = `${lot.winningDisplay || "BUYER/USER ID"} Won ${lot.title || "Auction"}`;
      els.flash.hidden = false;
    } else {
      els.flash.hidden = true;
    }

    lastRenderedBidCents = nextCurrent;
    setBiddingEnabled(live);
    syncCustomBidWindow();
    setSlider(0);
  };

  const setPlayback = url => {
    if (!url || !els.player) return;
    if (url !== activePlaybackUrl) {
      activePlaybackUrl = url;
      els.player.src = url;
    }
    els.player.hidden = false;
    if (els.showThumbnail) els.showThumbnail.hidden = true;
    if (els.placeholder) els.placeholder.hidden = true;
  };

  const renderShow = show => {
    const title = show?.title || "Crack Packs Live Auction";
    if (els.showTitle) els.showTitle.textContent = title;
    document.title = `${title} | Crack Packs`;
    if (show?.status === "live" && show.playbackUrl) {
      setPlayback(show.playbackUrl);
      return;
    }
    if (els.player) els.player.hidden = true;
    if (els.showThumbnail && show?.imageUrl) {
      els.showThumbnail.src = show.imageUrl;
      els.showThumbnail.alt = `${title} show thumbnail`;
      els.showThumbnail.hidden = false;
      if (els.placeholder) els.placeholder.hidden = true;
      return;
    }
    if (els.showThumbnail) els.showThumbnail.hidden = true;
    if (els.placeholder) els.placeholder.hidden = false;
  };

  const refresh = async () => {
    try {
      const data = await api(`/live/auction${showId ? `?show=${encodeURIComponent(showId)}` : ""}`, { method: "GET" });
      renderShow(data.show);
      if (els.viewers) els.viewers.textContent = String(data.show?.viewerCount ?? data.lot?.viewerCount ?? 0);
      render(data.lot);
    } catch (err) {
      els.status.textContent = err.message;
      if (!token()) els.copy.textContent = "Sign in to your Profile before bidding.";
    }
  };

  const heartbeat = async () => {
    if (!showId) return;
    try {
      const data = await api("/live/viewers/heartbeat", { method: "POST", body: JSON.stringify({ showId, clientId: viewerClientId }) });
      if (els.viewers) els.viewers.textContent = String(data.viewers || 0);
    } catch {}
  };

  const placeBid = async (payload = {}) => {
    if (!lot || lot.status !== "live") return;
    if (!token()) {
      els.copy.textContent = "Sign in to your Profile before bidding.";
      return;
    }
    els.copy.textContent = "Sending bid...";
    try {
      const data = await api(`/live/auction/lots/${lot.id}/bid`, { method: "POST", body: JSON.stringify(payload) });
      render(data.lot);
    } catch (err) {
      els.copy.textContent = err.message;
      syncCustomBidWindow();
      setSlider(0);
    }
  };

  if (els.handle && els.slider) {
    els.handle.addEventListener("pointerdown", (event) => {
      dragging = true;
      els.handle.setPointerCapture(event.pointerId);
    });

    els.handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = els.slider.getBoundingClientRect();
      setSlider(((event.clientX - rect.left) / rect.width) * 100);
    });

    els.handle.addEventListener("pointerup", async (event) => {
      if (!dragging) return;
      dragging = false;
      const rect = els.slider.getBoundingClientRect();
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      if (pct >= 82) await placeBid();
      else setSlider(0);
    });
  }

  if (els.customForm) {
    els.customForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = els.customForm.elements.bidAmount;
      const bidAmount = Number(input.value);
      if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
        els.copy.textContent = "Enter a bid amount first.";
        return;
      }
      if (lot?.minNextBidCents && bidAmount * 100 < Number(lot.minNextBidCents)) {
        input.value = dollars(lot.minNextBidCents);
        els.copy.textContent = `Bid moved. Minimum updated to ${money(lot.minNextBidCents)}.`;
        syncCustomBidWindow();
        return;
      }
      await placeBid({ bidAmount });
      input.value = "";
    });
  }

  refresh();
  heartbeat();
  setInterval(refresh, 2000);
  setInterval(heartbeat, 30000);
})();
