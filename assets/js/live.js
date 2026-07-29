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
    viewers: $("[data-live-viewers]"),
    videoHud: $("[data-video-auction-hud]"),
    videoImage: $("[data-video-auction-image]"),
    videoImagePlaceholder: $("[data-video-auction-image-placeholder]"),
    videoTitle: $("[data-video-auction-title]"),
    videoDetail: $("[data-video-auction-detail]"),
    videoBid: $("[data-video-auction-bid]"),
    videoBidLabel: $("[data-video-auction-bid-label]"),
    videoQuickBid: $("[data-video-auction-quick-bid]"),
    videoCustomToggle: $("[data-video-auction-custom-toggle]"),
    videoCustomForm: $("[data-video-auction-custom-form]"),
    videoCustomInput: $("[data-video-auction-custom-input]"),
    videoStatus: $("[data-video-auction-status]")
  };

  let lot = null;
  let dragging = false;
  let lastRenderedBidCents = 0;
  let activePlaybackUrl = "";
  let refreshInFlight = false;
  let heartbeatInFlight = false;
  let videoHudStateKey = "";
  let showEnded = false;
  let refreshTimer = 0;
  let heartbeatTimer = 0;
  let realtime = null;

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

  const liveChat = window.CrackPacksLiveChat?.create({
    root: $("[data-live-chat]"),
    apiBase,
    token,
    getShowId: () => showId
  });

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

  const setVideoBidStatus = (message, kind = "") => {
    if (!els.videoStatus) return;
    els.videoStatus.textContent = message;
    if (kind) els.videoStatus.dataset.kind = kind;
    else delete els.videoStatus.dataset.kind;
  };

  const closeVideoCustomBid = () => {
    if (els.videoCustomForm) els.videoCustomForm.hidden = true;
    if (els.videoCustomToggle) els.videoCustomToggle.setAttribute("aria-expanded", "false");
  };

  const renderVideoAuctionHud = (nextLot) => {
    if (!els.videoHud) return;
    const scheduled = nextLot?.status === "scheduled";
    const live = nextLot?.status === "live";
    const state = nextLot ? (scheduled ? "scheduled" : live ? "live" : "closed") : "waiting";
    const stateKey = `${nextLot?.id || "none"}:${state}:${nextLot?.viewerBidState || ""}`;
    const title = nextLot?.title || "Waiting for the next item";
    const currentCents = Number(nextLot?.currentBidCents || nextLot?.startingBidCents || 0);
    const minimumCents = Number(nextLot?.minNextBidCents || 0);

    els.videoHud.dataset.state = state;
    if (els.videoTitle) els.videoTitle.textContent = title;
    if (els.videoDetail) {
      els.videoDetail.textContent = nextLot
        ? nextLot.condition || nextLot.description || (scheduled ? "Queued for this show." : "Live auction item.")
        : "The seller has not opened an auction.";
    }
    if (els.videoBidLabel) els.videoBidLabel.textContent = scheduled ? "Starting bid" : "Current bid";
    if (els.videoBid) els.videoBid.textContent = money(currentCents);

    if (els.videoImage && els.videoImagePlaceholder) {
      if (nextLot?.imageUrl) {
        els.videoImage.src = nextLot.imageUrl;
        els.videoImage.alt = `${title} auction item`;
        els.videoImage.hidden = false;
        els.videoImagePlaceholder.hidden = true;
      } else {
        els.videoImage.removeAttribute("src");
        els.videoImage.alt = "";
        els.videoImage.hidden = true;
        els.videoImagePlaceholder.hidden = false;
      }
    }

    if (els.videoQuickBid) {
      els.videoQuickBid.disabled = !live;
      els.videoQuickBid.textContent = live ? `BID ${money(minimumCents)}` : scheduled ? "BIDDING OPENS LIVE" : nextLot ? "AUCTION CLOSED" : "BID";
    }
    if (els.videoCustomToggle) {
      els.videoCustomToggle.disabled = !live;
      if (!live) closeVideoCustomBid();
    }
    if (els.videoCustomInput) {
      els.videoCustomInput.min = String(Math.max(0.01, minimumCents / 100));
      els.videoCustomInput.placeholder = minimumCents ? `Minimum ${money(minimumCents)}` : "Enter custom bid";
      if (live && (!Number.isFinite(Number(els.videoCustomInput.value)) || Number(els.videoCustomInput.value) * 100 < minimumCents)) {
        els.videoCustomInput.value = dollars(minimumCents);
      }
    }

    if (stateKey !== videoHudStateKey) {
      if (!nextLot) setVideoBidStatus("Bidding opens when an item goes live.");
      else if (scheduled) setVideoBidStatus("Bidding opens when the seller starts this item.");
      else if (!live) setVideoBidStatus("This auction has closed.");
      else if (!token()) setVideoBidStatus("Sign in to your Profile before bidding.");
      else if (nextLot.viewerBidState === "winning") setVideoBidStatus("You're currently winning this item.");
      else if (nextLot.viewerBidState === "losing") setVideoBidStatus(`Bid again from ${money(minimumCents)}.`);
      else setVideoBidStatus(`Quick bid places the next bid at ${money(minimumCents)}.`);
      videoHudStateKey = stateKey;
    }
  };

  const render = (nextLot) => {
    lot = nextLot || null;
    if (lot?.status === "live" && lot.playbackUrl) setPlayback(lot.playbackUrl);
    if (!lot) {
      renderVideoAuctionHud(null);
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
    renderVideoAuctionHud(lot);
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
    if (els.showThumbnail) {
      els.showThumbnail.removeAttribute("src");
      els.showThumbnail.alt = "";
      els.showThumbnail.hidden = true;
    }
    if (els.placeholder) els.placeholder.hidden = true;
  };

  const renderShow = show => {
    const title = show?.title || "Crack Packs Live Auction";
    if (els.showTitle) els.showTitle.textContent = title;
    document.title = `${title} | Crack Packs`;
    let structured = document.querySelector("#live-broadcast-data");
    if (!structured) {
      structured = document.createElement("script");
      structured.id = "live-broadcast-data";
      structured.type = "application/ld+json";
      document.head.append(structured);
    }
    structured.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: title,
      description: "Live collectibles show and auction on Crack Packs.",
      thumbnailUrl: show?.imageUrl ? [new URL(show.imageUrl, location.href).href] : undefined,
      uploadDate: show?.startsAt || new Date().toISOString(),
      publication: {
        "@type": "BroadcastEvent",
        isLiveBroadcast: show?.status === "live",
        startDate: show?.startsAt || undefined,
        endDate: show?.status === "ended" ? new Date().toISOString() : undefined
      }
    });
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
    if (els.showThumbnail) {
      els.showThumbnail.removeAttribute("src");
      els.showThumbnail.alt = "";
      els.showThumbnail.hidden = true;
    }
    if (els.placeholder) els.placeholder.hidden = false;
  };

  const endPublicShow = show => {
    if (showEnded) return;
    showEnded = true;
    renderShow(show);
    activePlaybackUrl = "";
    if (els.player) {
      els.player.src = "about:blank";
      els.player.hidden = true;
    }
    if (els.viewers) els.viewers.textContent = "0";
    renderVideoAuctionHud(null);
    setVideoBidStatus("This show has ended.");
    els.card.dataset.state = "ended";
    els.status.textContent = "Show ended.";
    els.title.textContent = show?.title || "This show has ended";
    els.description.textContent = "The seller ended this show. Return to Live Shows to find the next broadcast.";
    if (els.currentLabel) els.currentLabel.textContent = "Final status";
    if (els.nextLabel) els.nextLabel.textContent = "Bidding";
    els.current.textContent = "ENDED";
    els.next.textContent = "CLOSED";
    els.copy.textContent = "This broadcast and its auction queue are closed.";
    els.flash.hidden = true;
    setBiddingEnabled(false);
    closeVideoCustomBid();
    setSlider(0);
    window.clearInterval(refreshTimer);
    window.clearInterval(heartbeatTimer);
    liveChat?.stop();
  };

  const refresh = async () => {
    if (showEnded || refreshInFlight || document.hidden) return;
    refreshInFlight = true;
    try {
      const data = await api(`/live/auction${showId ? `?show=${encodeURIComponent(showId)}` : ""}`, { method: "GET" });
      if (data.ended || (data.show && !["open", "live"].includes(data.show.status))) {
        endPublicShow(data.show);
        return;
      }
      renderShow(data.show);
      if (els.viewers) els.viewers.textContent = String(data.show?.viewerCount ?? data.lot?.viewerCount ?? 0);
      render(data.lot);
    } catch (err) {
      els.status.textContent = err.message;
      if (!token()) els.copy.textContent = "Sign in to your Profile before bidding.";
    } finally {
      refreshInFlight = false;
    }
  };

  const heartbeat = async () => {
    if (showEnded || !showId || heartbeatInFlight || document.hidden) return;
    heartbeatInFlight = true;
    try {
      const data = await api("/live/viewers/heartbeat", { method: "POST", body: JSON.stringify({ showId, clientId: viewerClientId }) });
      if (els.viewers) els.viewers.textContent = String(data.viewers || 0);
    } catch {
    } finally {
      heartbeatInFlight = false;
    }
  };

  const placeBid = async (payload = {}) => {
    if (!lot || lot.status !== "live") {
      setVideoBidStatus("Bidding is not open for this item.", "error");
      return false;
    }
    if (!token()) {
      els.copy.textContent = "Sign in to your Profile before bidding.";
      setVideoBidStatus("Sign in to your Profile before bidding.", "error");
      return false;
    }
    els.copy.textContent = "Sending bid...";
    setVideoBidStatus("Sending bid...");
    try {
      const data = await api(`/live/auction/lots/${lot.id}/bid`, {
        method: "POST",
        headers: { "Idempotency-Key": `bid-${lot.id}-${crypto.randomUUID()}` },
        body: JSON.stringify(payload)
      });
      render(data.lot);
      setVideoBidStatus(`Bid accepted. Current bid is ${money(data.lot.currentBidCents)}.`);
      return true;
    } catch (err) {
      els.copy.textContent = err.message;
      setVideoBidStatus(err.message, "error");
      syncCustomBidWindow();
      setSlider(0);
      return false;
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

  if (els.videoQuickBid) {
    els.videoQuickBid.addEventListener("click", async () => {
      await placeBid();
    });
  }

  if (els.videoCustomToggle && els.videoCustomForm) {
    els.videoCustomToggle.addEventListener("click", () => {
      const shouldOpen = els.videoCustomForm.hidden;
      els.videoCustomForm.hidden = !shouldOpen;
      els.videoCustomToggle.setAttribute("aria-expanded", String(shouldOpen));
      if (shouldOpen) els.videoCustomInput?.focus();
    });

    els.videoCustomForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const bidAmount = Number(els.videoCustomInput?.value);
      const minimumCents = Number(lot?.minNextBidCents || 0);
      if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
        setVideoBidStatus("Enter a valid custom bid amount.", "error");
        return;
      }
      if (minimumCents && Math.round(bidAmount * 100) < minimumCents) {
        if (els.videoCustomInput) els.videoCustomInput.value = dollars(minimumCents);
        setVideoBidStatus(`Minimum bid is now ${money(minimumCents)}.`, "error");
        return;
      }
      if (await placeBid({ bidAmount })) closeVideoCustomBid();
    });
  }

  refresh();
  heartbeat();
  if (showId && window.CrackPacksAuctionRealtime) {
    realtime = window.CrackPacksAuctionRealtime.connect({
      apiBase,
      showId,
      onEvent: () => refresh()
    });
  }
  refreshTimer = window.setInterval(refresh, 15_000);
  heartbeatTimer = window.setInterval(heartbeat, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refresh();
    heartbeat();
  });
  window.addEventListener("pagehide", () => {
    window.clearInterval(refreshTimer);
    window.clearInterval(heartbeatTimer);
    realtime?.close();
    liveChat?.stop();
  }, { once: true });
})();
