(function(){
  const apiBase = (window.CRACKPACKS_CONFIG && window.CRACKPACKS_CONFIG.rewardsApiBase) || "https://rewards-api.crackpacks.com";
  const token = () => localStorage.getItem("cp_rewards_token") || "";
  const $ = (sel) => document.querySelector(sel);
  const els = {
    card: $("[data-live-bid-card]"),
    status: $("[data-live-status]"),
    title: $("[data-lot-title]"),
    description: $("[data-lot-description]"),
    current: $("[data-current-bid]"),
    next: $("[data-next-bid]"),
    copy: $("[data-bid-state-copy]"),
    flash: $("[data-winner-flash]"),
    slider: $("[data-slide-bid]"),
    handle: $("[data-slide-handle]"),
    fill: $("[data-slide-fill]"),
    customForm: $("[data-custom-bid-form]")
  };
  let lot = null;
  let dragging = false;
  const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
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
  const render = (nextLot) => {
    lot = nextLot || null;
    if (!lot) {
      els.card.dataset.state = "ready";
      els.status.textContent = "No auction is live yet. Keep this page open.";
      els.title.textContent = "No live auction yet";
      els.description.textContent = "Waiting for the breaker to open the next lot.";
      els.current.textContent = "$0.00";
      els.next.textContent = "$0.00";
      els.copy.textContent = token() ? "Ready when the next auction starts." : "Sign in to your Profile before bidding.";
      els.flash.hidden = true;
      setSlider(0);
      return;
    }
    els.card.dataset.state = lot.viewerBidState || "ready";
    els.status.textContent = lot.status === "live" ? "Auction live now." : "Auction just closed.";
    els.title.textContent = lot.title || "Live auction";
    els.description.textContent = lot.description || "Slide to bid, or set your own bid amount.";
    els.current.textContent = money(lot.currentBidCents || lot.startingBidCents);
    els.next.textContent = money(lot.minNextBidCents);
    if (!token()) els.copy.textContent = "Sign in to bid. Watching is fine, bidding needs a verified Profile.";
    else if (lot.viewerBidState === "winning") els.copy.textContent = "You’re winning — green means hold the line.";
    else if (lot.viewerBidState === "losing") els.copy.textContent = "You’re losing — red means slide or set a higher bid.";
    else els.copy.textContent = "Slide for the next bid, or use Set Your Bid for your own dollar amount.";
    if (lot.showWinnerBanner) {
      els.flash.textContent = `${lot.winningDisplay || "BUYER/USER ID"} Won ${lot.title || "Auction"}`;
      els.flash.hidden = false;
    } else {
      els.flash.hidden = true;
    }
    setSlider(0);
  };
  const refresh = async () => {
    try {
      const data = await api("/live/auction", { method: "GET" });
      render(data.lot);
    } catch (err) {
      els.status.textContent = err.message;
      if (!token()) els.copy.textContent = "Sign in to your Profile before bidding.";
    }
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
      await placeBid({ bidAmount });
      input.value = "";
    });
  }
  refresh();
  setInterval(refresh, 2000);
})();
