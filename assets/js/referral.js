(() => {
  const root = document.querySelector("[data-rewards-app]");
  if (!root) return;
  const config = window.CRACKPACKS_CONFIG || {};
  const api = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const qs = new URLSearchParams(location.search);
  const requestedPortal = qs.get("portal") === "master" ? "master" : "";
  const referralCode = (qs.get("ref") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const ownerReferralToken = String(qs.get("owner_ref") || "").slice(0, 80);
  const hasAttachedReferral = Boolean(referralCode || ownerReferralToken);
  const verificationToken = String(qs.get("verify") || "");
  const SELLER_ACTIVATION_KEY = "cp_pending_seller_activation";
  const querySellerActivationToken = String(qs.get("seller_activation") || "").slice(0, 120);
  if (querySellerActivationToken) localStorage.setItem(SELLER_ACTIVATION_KEY, querySellerActivationToken);
  const sellerActivationToken = querySellerActivationToken || String(localStorage.getItem(SELLER_ACTIVATION_KEY) || "").slice(0, 120);
  const normalizeOfferToken = value => {
    const candidate = String(value || "").trim().toUpperCase().slice(0, 64);
    return /^OFR[A-HJ-NP-Z2-9]{32}$/.test(candidate) ? candidate : "";
  };
  const queryOfferToken = normalizeOfferToken(qs.get("offer"));
  const malformedOfferToken = qs.has("offer") && !queryOfferToken;
  const storedOfferToken = normalizeOfferToken(localStorage.getItem("cp_campaign_offer_token"));
  if (!storedOfferToken && localStorage.getItem("cp_campaign_offer_token")) localStorage.removeItem("cp_campaign_offer_token");
  if (qs.has("offer") && !queryOfferToken) localStorage.removeItem("cp_campaign_offer_token");
  let offerToken = qs.has("offer") ? queryOfferToken : storedOfferToken;
  if (queryOfferToken) localStorage.setItem("cp_campaign_offer_token", queryOfferToken);
  const $ = selector => document.querySelector(selector);
  const status = $("[data-app-status]");
  const showStatus = (message = "", kind = "") => { status.textContent = message; status.dataset.kind = kind; };
  const showContactStatus = (message = "", kind = "") => { const node = $("[data-contact-status]"); if (node) { node.textContent = message; node.dataset.kind = kind; } };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
  let email = "";
  let turnstileTokenValue = "";
  let turnstileWidgetId = null;
  let authRequestSent = false;
  let authRequestPending = false;
  let authMode = hasAttachedReferral || qs.get("mode") === "signup" ? "signup" : "signin";
  const returnTarget = String(qs.get("return") || "").trim().toLowerCase();
  let accountState = null;
  let welcomeDiscountLoaded = false;
  let attachedReferralValid = !hasAttachedReferral;
  let referralValidationPromise = null;
  let personalQrObjectUrl = "";
  let personalQrInviteUrl = "";
  let activeOffer = null;
  let offerClaimBlocked = false;
  let campaignClockOffset = 0;
  let campaignCountdownTimer = null;
  let streamCreditsNextRefreshTimer = null;
  let streamCreditsLastLoadedAt = 0;
  let streamCreditsRefreshInFlight = false;
  let checkedBuyerUsername = "";
  let checkedSellerUsername = "";
  let pendingSellerIdentityStart = false;
  let portalLauncherShown = false;
  let sellerActivationFinalizePending = false;
  const STREAM_CREDITS_REFRESH_FOCUS_GRACE_MS = 2 * 60 * 1000;
  const SELLER_UPGRADE_KEY = "cp_seller_upgrade_requested";
  if (returnTarget === "seller") sessionStorage.setItem(SELLER_UPGRADE_KEY, "true");
  const authModeCopy = {
    signin: {
      kicker: "Returning collector",
      title: "Sign in to your Profile",
      description: "Enter your Crack Packs email and password.",
      emailLabel: "Account email",
      sendLabel: "Sign in",
      modalTitle: "Check inbox for your sign-in link",
      modalCopy: "If this email belongs to a Crack Packs account, open the secure sign-in link within 10 minutes. If setup is incomplete, the page will continue with password, Buyer ID, and any requested Seller ID verification steps.",
      sentStatus: "If that email matches an account, a secure sign-in link is on the way."
    },
    signup: {
      kicker: "New collector",
      title: "Create your Profile",
      description: "Use an email you can access. We will send a secure link to begin verified account setup. Already registered? Choose Sign In.",
      emailLabel: "Signup email",
      sendLabel: "Send signup link",
      modalTitle: "Check inbox to create your account",
      modalCopy: "Open the secure signup link within 10 minutes. Then create your password, reserve your Buyer ID, and choose whether to start Seller ID verification.",
      sentStatus: "Signup link sent. Check your inbox to create your account."
    }
  };
  function resetTurnstile() {
    turnstileTokenValue = "";
    if (turnstileWidgetId !== null && window.turnstile?.reset) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }
  function setAuthMode(mode, { focus = false } = {}) {
    if (authRequestPending) return;
    const nextMode = mode === "signup" ? "signup" : "signin";
    const changed = nextMode !== authMode;
    authMode = nextMode;
    if (changed) {
      authRequestSent = false;
      resetTurnstile();
    }
    const copy = authModeCopy[authMode];
    document.querySelectorAll("[data-auth-mode]").forEach(button => {
      const active = button.dataset.authMode === authMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    $("[data-request-panel]").setAttribute("aria-labelledby", authMode === "signin" ? "auth-signin-tab" : "auth-signup-tab");
    $("[data-auth-kicker]").textContent = copy.kicker;
    $("[data-auth-title]").textContent = copy.title;
    $("[data-auth-description]").textContent = copy.description;
    $("[data-auth-email-label]").textContent = copy.emailLabel;
    const passwordRow = $("[data-password-login-row]");
    if (passwordRow) passwordRow.hidden = authMode !== "signin";
    const sendButton = $("[data-send-verification]");
    sendButton.textContent = authRequestSent ? "Check Inbox 10 min code" : turnstileTokenValue ? copy.sendLabel : "Complete security check";
    sendButton.disabled = authRequestSent || !turnstileTokenValue;
    showStatus("");
  }
  const authModeButtons = [...document.querySelectorAll("[data-auth-mode]")];
  authModeButtons.forEach((button, index) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = authModeButtons[(index + direction + authModeButtons.length) % authModeButtons.length];
      setAuthMode(next.dataset.authMode, { focus: true });
    });
  });
  setAuthMode(authMode);
  const turnstileNode = $("[data-turnstile]");
  if (turnstileNode && config.turnstileSiteKey) {
    window.cpTurnstileReady = () => { turnstileWidgetId = window.turnstile.render(turnstileNode, {
      sitekey: config.turnstileSiteKey,
      theme: "dark",
      callback: tokenValue => {
        turnstileTokenValue = tokenValue;
        if (authRequestSent) {
          const sendButton = $("[data-send-verification]");
          sendButton.disabled = true;
          sendButton.textContent = "Check Inbox 10 min code";
          return;
        }
        showStatus("");
        const sendButton = $("[data-send-verification]");
        sendButton.disabled = false;
        sendButton.textContent = authModeCopy[authMode].sendLabel;
      },
      "expired-callback": () => {
        turnstileTokenValue = "";
        if (authRequestSent) return;
        const sendButton = $("[data-send-verification]");
        sendButton.disabled = true;
        sendButton.textContent = "Complete security check";
        showStatus("Security check expired. Complete it again.", "error");
      },
      "error-callback": errorCode => {
        turnstileTokenValue = "";
        if (authRequestSent) return;
        const sendButton = $("[data-send-verification]");
        sendButton.disabled = true;
        sendButton.textContent = "Security check unavailable";
        showStatus(`Security check could not load${errorCode ? ` (Cloudflare code ${errorCode})` : ""}. Refresh and try again.`, "error");
      }
    }); };
    const script = document.createElement("script"); script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=cpTurnstileReady&render=explicit"; script.async = true; script.defer = true; document.head.append(script);
  } else if (turnstileNode) {
    turnstileNode.textContent = "Security verification is awaiting its Cloudflare site key.";
  }
  $("[data-request-form] input[name='email']").addEventListener("input", () => {
    if (!authRequestSent) return;
    authRequestSent = false;
    resetTurnstile();
    const sendButton = $("[data-send-verification]");
    sendButton.textContent = "Complete security check";
    sendButton.disabled = true;
    showStatus("");
  });
  let token = localStorage.getItem("cp_rewards_token") || "";

  const safeHttpUrl = value => {
    try {
      const parsed = new URL(String(value || ""));
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch {
      return "";
    }
  };
  const show = (selector, visible) => { $(selector).hidden = !visible; };
  if (hasAttachedReferral) {
    show("[data-referral-banner]", true);
    $("[data-referral-banner]").dataset.state = "checking";
    $("[data-referral-banner-title]").textContent = "Checking referral...";
    $("[data-referral-banner-copy]").textContent = "Confirming that this is the current, valid referral link.";
  }
  const request = async (path, options = {}) => {
    if (!api) throw new Error("Rewards service is not configured yet.");
    const response = await fetch(`${api}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "The rewards service could not complete that request.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };
  const requestBlob = async (path, inviteUrl) => {
    if (!api) throw new Error("Rewards service is not configured yet.");
    const response = await fetch(`${api}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ inviteUrl })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "The referral QR could not be generated.");
    }
    return response.blob();
  };

  const pick = (object, ...keys) => {
    for (const key of keys) if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
    return null;
  };
  const campaignRewardDescription = campaign => {
    const supplied = pick(campaign, "rewardDescription", "reward_description", "description");
    if (supplied) return String(supplied);
    const type = String(pick(campaign, "rewardType", "reward_type") || "");
    if (type === "percent") return `${Number(pick(campaign, "percent") || 0)}% off`;
    if (type === "free_shipping") return "Free shipping";
    if (type === "pick_a_pack") return "Free Pack / Pick a Pack";
    if (type === "pack_draft") return "Choose a Pack #";
    if (type === "free_single") return "Free Holographic Single";
    if (type === "product") return `Product: ${String(pick(campaign, "product")?.name || "Inventory reward")}`;
    return "Campaign reward";
  };
  const campaignNeverExpires = campaign => pick(campaign, "neverExpires", "never_expires") === true || Number(pick(campaign, "neverExpires", "never_expires") || 0) === 1;
  const campaignCountdownLabel = milliseconds => {
    const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
  };
  function clearStoredOffer() {
    localStorage.removeItem("cp_campaign_offer_token");
    offerToken = "";
  }
  function updateCampaignCountdowns() {
    const serverTime = Date.now() + campaignClockOffset;
    document.querySelectorAll("[data-live-campaign-expiry]").forEach(node => {
      if (node.dataset.liveCampaignNeverExpires === "true") {
        node.textContent = "No expiration";
        return;
      }
      const expiresAt = node.dataset.liveCampaignExpiry;
      const remaining = Date.parse(expiresAt) - serverTime;
      node.textContent = remaining <= 0 ? "Expired" : campaignCountdownLabel(remaining);
    });
    if (activeOffer) {
      const expiresAt = String(pick(activeOffer, "expiresAt", "expires_at") || "");
      if (!campaignNeverExpires(activeOffer) && expiresAt && Date.parse(expiresAt) <= serverTime) {
        $("[data-campaign-offer]").dataset.state = "expired";
        $("[data-offer-state]").textContent = "EXPIRED";
        $("[data-offer-claim]").disabled = true;
        $("[data-offer-guidance]").textContent = "This campaign has expired and can no longer be claimed.";
        $("[data-offer-guidance]").dataset.kind = "error";
        offerClaimBlocked = true;
        clearStoredOffer();
      }
    }
  }
  function startCampaignCountdowns() {
    clearInterval(campaignCountdownTimer);
    updateCampaignCountdowns();
    campaignCountdownTimer = setInterval(updateCampaignCountdowns, 30000);
  }
  function availablePackNumbers(campaign) {
    const supplied = pick(campaign, "availablePacks", "available_packs", "availablePackNumbers", "available_pack_numbers");
    if (Array.isArray(supplied)) return supplied.map(Number).filter(number => Number.isInteger(number) && number > 0);
    const count = Math.min(500, Math.max(0, Number(pick(campaign, "packCount", "pack_count") || 0)));
    return Array.from({ length: count }, (_, index) => index + 1);
  }
  function syncOfferClaimAvailability() {
    if (!activeOffer || offerClaimBlocked) return;
    const button = $("[data-offer-claim]");
    const guidance = $("[data-offer-guidance]");
    if (!accountState) {
      button.disabled = true;
      guidance.textContent = "Sign in or create your verified Profile below to claim this offer.";
      return;
    }
    if (accountState.isAdmin) {
      button.disabled = true;
      guidance.textContent = "Owner accounts create and manage campaigns in the Owner Dashboard; they cannot claim their own campaign offers.";
      guidance.dataset.kind = "error";
      return;
    }
    if (!accountState.deviceVerified || !accountState.profileComplete) {
      button.disabled = true;
      guidance.textContent = "Finish identity and passkey verification to claim this campaign reward.";
      return;
    }
    const type = String(pick(activeOffer, "rewardType", "reward_type") || "");
    if (type === "pack_draft" && !$("[data-offer-pack-number]").value) {
      button.disabled = true;
      guidance.textContent = "No pack numbers remain in this campaign.";
      guidance.dataset.kind = "error";
      return;
    }
    button.disabled = false;
    guidance.textContent = type === "pack_draft" ? "Choose an available pack number, then claim it explicitly." : "Your verified Profile is ready. Claim only when you want this weekly reward.";
    guidance.dataset.kind = "";
  }
  function renderOfferCampaign(campaign) {
    activeOffer = campaign;
    offerClaimBlocked = false;
    const panel = $("[data-campaign-offer]");
    panel.hidden = false;
    panel.dataset.state = "active";
    $("[data-offer-title]").textContent = String(pick(campaign, "title") || "Crack Packs campaign");
    $("[data-offer-state]").textContent = "ACTIVE";
    $("[data-offer-description]").textContent = campaignRewardDescription(campaign);
    show("[data-offer-meta]", true);
    const claimed = Number(pick(campaign, "claimedCount", "claimed_count") || 0);
    const cap = Number(pick(campaign, "maxRedemptions", "max_redemptions") || 0);
    const remaining = pick(campaign, "remaining");
    $("[data-offer-remaining]").textContent = String(remaining === null ? Math.max(0, cap - claimed) : remaining);
    const expiresAt = String(pick(campaign, "expiresAt", "expires_at") || "");
    const neverExpires = campaignNeverExpires(campaign);
    const expiry = $("[data-offer-expiry]"); expiry.dateTime = neverExpires ? "" : expiresAt; expiry.dataset.liveCampaignExpiry = expiresAt; expiry.dataset.liveCampaignNeverExpires = String(neverExpires);
    const isPackDraft = String(pick(campaign, "rewardType", "reward_type") || "") === "pack_draft";
    show("[data-offer-pack-choice]", isPackDraft);
    const select = $("[data-offer-pack-number]"); select.replaceChildren();
    if (isPackDraft) {
      availablePackNumbers(campaign).forEach(number => { const option = document.createElement("option"); option.value = String(number); option.textContent = `Pack #${number}`; select.append(option); });
    }
    $("[data-offer-result]").hidden = true;
    syncOfferClaimAvailability();
    startCampaignCountdowns();
  }
  function renderInvalidOffer(message, state = "invalid") {
    activeOffer = null;
    offerClaimBlocked = true;
    const panel = $("[data-campaign-offer]"); panel.hidden = false; panel.dataset.state = state;
    $("[data-offer-title]").textContent = state === "expired" ? "This campaign offer expired" : state === "disabled" ? "This campaign QR was turned off" : "This campaign offer is unavailable";
    $("[data-offer-state]").textContent = state === "disabled" ? "QR OFF" : state.toUpperCase();
    $("[data-offer-description]").textContent = message;
    show("[data-offer-meta]", false); show("[data-offer-pack-choice]", false);
    $("[data-offer-guidance]").textContent = "You can still sign in and view rewards already saved to your campaign wallet.";
    $("[data-offer-guidance]").dataset.kind = "error";
    $("[data-offer-claim]").disabled = true;
    clearStoredOffer();
    if (accountState?.deviceVerified && accountState?.profileComplete && accountState?.referredSignup && !welcomeDiscountLoaded) queueMicrotask(() => renderAccount(accountState));
  }
  async function loadOfferStatus() {
    if (!offerToken) {
      if (malformedOfferToken) renderInvalidOffer("The campaign token format is invalid. Ask for a new campaign link.");
      return;
    }
    $("[data-campaign-offer]").hidden = false;
    try {
      const data = await request("/campaign/status", { method: "POST", body: JSON.stringify({ offerToken }) });
      if (data.serverNow) campaignClockOffset = Date.parse(data.serverNow) - Date.now();
      if (!data.valid || !data.campaign) {
        const offerStatus = String(data.status || "").toLowerCase();
        const expired = offerStatus === "expired";
        const disabled = offerStatus === "disabled";
        const message = expired ? "The claim window has ended." : disabled ? "Crack Packs has stopped this QR and link from accepting new claims." : offerStatus === "full" ? "Every available claim in this campaign has been taken." : "The link was not found or is no longer active.";
        renderInvalidOffer(message, expired ? "expired" : disabled ? "disabled" : "invalid");
        return;
      }
      renderOfferCampaign(data.campaign);
    } catch (error) {
      $("[data-campaign-offer]").hidden = false;
      $("[data-campaign-offer]").dataset.state = "invalid";
      $("[data-offer-title]").textContent = "Offer check unavailable";
      $("[data-offer-state]").textContent = "RETRY";
      $("[data-offer-description]").textContent = "Refresh the page to check this campaign securely.";
      $("[data-offer-claim]").disabled = true;
    }
  }

  async function validateAttachedReferral() {
    if (!hasAttachedReferral) return true;
    const banner = $("[data-referral-banner]");
    const heading = $("[data-referral-banner-title]");
    const copy = $("[data-referral-banner-copy]");
    banner.dataset.state = "checking";
    try {
      const data = await request("/referral/status", {
        method: "POST",
        body: JSON.stringify({ ownerReferralToken, referralCode })
      });
      attachedReferralValid = Boolean(data.valid);
      banner.dataset.state = attachedReferralValid ? "valid" : "invalid";
      if (attachedReferralValid && data.rotating) {
        heading.textContent = "Current owner referral attached - unlock 10% off";
        copy.textContent = `Complete the emailed verification link before ${data.nextBoundaryLabel} to lock in the referral.`;
      } else if (attachedReferralValid) {
        heading.textContent = "Friend referral attached - unlock 10% off";
        copy.textContent = "Complete verified signup to receive a one-time 10% discount code and add +1 to the friend who referred you.";
      } else if (!attachedReferralValid && data.rotating) {
        const disabled = data.reason === "disabled";
        heading.textContent = disabled ? "This owner referral QR was turned off" : "This owner referral window expired";
        copy.textContent = disabled ? "Crack Packs stopped this QR and link from accepting signups. Ask the owner for an active referral." : "Ask the owner for the current QR or referral link. You can still create an account, but this expired link cannot award referral credit.";
        showStatus(disabled ? "This owner referral QR was turned off." : "This rotating owner referral has expired. Ask for the current QR or link.", "error");
      } else {
        heading.textContent = "This referral link is invalid";
        copy.textContent = "Ask your friend for a new referral link. You can still create an account without referral credit.";
        showStatus("This referral link is invalid. Ask for a new link or remove the referral from the address.", "error");
      }
      return attachedReferralValid;
    } catch (error) {
      attachedReferralValid = false;
      banner.dataset.state = "invalid";
      heading.textContent = "Referral check unavailable";
      copy.textContent = "Refresh the page before creating your account so the referral can be checked securely.";
      showStatus("The referral could not be validated. Refresh before creating your account.", "error");
      return false;
    }
  }
  referralValidationPromise = validateAttachedReferral();

  async function loadAccount() {
    if (!token) return;
    try {
      const data = await request("/me");
      renderAccount(data);
    } catch {
      localStorage.removeItem("cp_rewards_token"); token = "";
    }
  }
  function clearPersonalQr() {
    const image = $("[data-personal-qr]");
    image.removeAttribute("src");
    image.classList.remove("is-loading");
    personalQrInviteUrl = "";
    if (personalQrObjectUrl) {
      URL.revokeObjectURL(personalQrObjectUrl);
      personalQrObjectUrl = "";
    }
  }
  function setMemberInviteToolsEnabled(enabled) {
    show("[data-member-invite-tools]", enabled);
    show("[data-member-referral-share]", enabled);
    show("[data-owner-dashboard-referral]", !enabled);
    $("[data-invite-url]").disabled = !enabled;
    $("[data-copy-link]").disabled = !enabled;
    document.querySelectorAll("[data-invite-form] input, [data-invite-form] button, [data-download-qr]").forEach(control => {
      control.disabled = !enabled;
    });
  }
  async function loadPersonalQr(inviteUrl) {
    if (accountState?.ownerReferralDashboardOnly) {
      clearPersonalQr();
      return;
    }
    if (!inviteUrl || inviteUrl === personalQrInviteUrl) return;
    const image = $("[data-personal-qr]");
    let blobUrl = "";
    image.classList.add("is-loading");
    image.removeAttribute("src");
    try {
      blobUrl = URL.createObjectURL(await requestBlob("/profile/referral/qr", inviteUrl));
      if (accountState?.ownerReferralDashboardOnly || accountState?.inviteUrl !== inviteUrl) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      image.src = blobUrl;
      if (image.decode) await image.decode();
      if (personalQrObjectUrl) URL.revokeObjectURL(personalQrObjectUrl);
      personalQrObjectUrl = blobUrl;
      personalQrInviteUrl = inviteUrl;
    } catch (error) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      showStatus(error.message, "error");
    } finally {
      image.classList.remove("is-loading");
    }
  }
  const orderStatusLabel = value => String(value || "processing").replace(/_/g, " ");
  function renderMyOrders(orders) {
    const container = $("[data-orders-list]"); container.replaceChildren();
    if (!orders.length) { const empty = document.createElement("div"); empty.className = "member-orders-empty"; empty.textContent = "No purchases have been attached to this member account yet."; container.append(empty); return; }
    orders.forEach(order => {
      const card = document.createElement("article"); card.className = "member-order-card";
      const content = document.createElement("div"); content.className = "member-order-content";
      const heading = document.createElement("div"); heading.className = "member-order-heading";
      const number = document.createElement("h4"); number.textContent = order.orderNumber || "Crack Packs order";
      const status = document.createElement("span"); status.className = `member-order-status ${order.status || "processing"}`; status.textContent = orderStatusLabel(order.status);
      heading.append(number, status);
      const meta = document.createElement("p"); meta.className = "member-order-meta"; meta.textContent = `${String(order.channel || "order").replace(/^./, value => value.toUpperCase())} · ${new Date(order.placedAt).toLocaleDateString()}`;
      const items = document.createElement("ul");
      (Array.isArray(order.items) ? order.items : []).forEach(item => { const li = document.createElement("li"); li.textContent = `${Number(item.quantity || 1)}× ${item.name}`; items.append(li); });
      content.append(heading, meta, items);
      const action = document.createElement("div"); action.className = "member-order-action";
      if (order.tracking?.url) {
        const latest = document.createElement("small"); latest.textContent = `${order.tracking.carrier || "Carrier"} · ${orderStatusLabel(order.tracking.status)}`;
        const link = document.createElement("a"); link.className = "btn btn-primary btn-small"; link.href = order.tracking.url; link.textContent = "Tracking";
        action.append(latest, link);
      } else {
        const pending = document.createElement("small"); pending.textContent = "Tracking will appear after shipment."; action.append(pending);
      }
      card.append(content, action); container.append(card);
    });
  }
  async function loadMyOrders() {
    if (!token || !accountState?.deviceVerified || !accountState?.profileComplete) return;
    try {
      const data = await request("/orders/mine");
      renderMyOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (error) {
      const container = $("[data-orders-list]"); container.replaceChildren();
      const empty = document.createElement("div"); empty.className = "member-orders-empty"; empty.textContent = error.message; container.append(empty);
    }
  }
  const sellerUpgradeRequested = () => sessionStorage.getItem(SELLER_UPGRADE_KEY) === "true";
  const setSellerUpgradeRequested = value => {
    if (value) sessionStorage.setItem(SELLER_UPGRADE_KEY, "true");
    else sessionStorage.removeItem(SELLER_UPGRADE_KEY);
  };
  const beginSellerUpgradeFlow = (message = "Seller verification started. Reserve a Seller ID first, then complete passkey, legal profile, and Stripe ID verification.") => {
    setSellerUpgradeRequested(true);
    if (accountState) {
      renderAccount(accountState);
      const nextPanel = !accountState.sellerUsername ? $("[data-seller-username-panel]") : (!accountState.deviceVerified ? $("[data-device-panel]") : $("[data-profile-panel]"));
      nextPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    showStatus(message, "success");
  };
  const showBuyerUsernameStatus = (message = "", kind = "") => {
    const node = $("[data-buyer-username-status]");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  };
  const showSellerUsernameStatus = (message = "", kind = "") => {
    const node = $("[data-seller-username-status]");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  };
  const streamCreditStatus = (message = "", kind = "") => {
    const node = $("[data-stream-credits-status]");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  };
  const readStreamCreditForm = () => {
    const form = new FormData($("[data-stream-credits-form]"));
    return {
      averageConcurrentViewers: Number(form.get("averageConcurrentViewers") || 0),
      hoursPerShow: Number(form.get("hoursPerShow") || 0),
      showsPerMonth: Number(form.get("showsPerMonth") || 0),
      recordingRetentionDays: Number(form.get("recordingRetentionDays") || 0) || undefined,
      replayReservePercentage: Number(form.get("replayReservePercentage") || 0) || undefined,
      safetyBufferPercentage: Number(form.get("safetyBufferPercentage") || 0) || undefined
    };
  };
  function renderStreamCreditComparison(result) {
    const container = $("[data-stream-credits-comparison]");
    container.replaceChildren();
    const comparisons = Array.isArray(result?.comparison) ? result.comparison : [];
    comparisons.forEach(plan => {
      const card = document.createElement("article");
      card.className = "campaign-member-claim";
      const main = document.createElement("div");
      const title = document.createElement("h4");
      title.textContent = `${plan.name} - $${Number(plan.monthlyPrice || 0).toFixed(2)}/mo`;
      const reward = document.createElement("p");
      reward.textContent = `${Number(plan.includedCredits || 0).toFixed(2)} included credits`;
      const detail = document.createElement("p");
      detail.textContent = `Overage ${Number(plan.projectedOverageCredits || 0).toFixed(2)} | Rebate $${Number(plan.projectedUnusedRebate || 0).toFixed(2)} | Net $${Number(plan.projectedNetCost || 0).toFixed(2)}`;
      main.append(title, reward, detail);
      if (plan.projectedSavings > 0) {
        const warning = document.createElement("p");
        warning.textContent = `${plan.name} could cost $${Number(plan.projectedSavings).toFixed(2)} more than the recommendation.`;
        main.append(warning);
      }
      card.append(main);
      container.append(card);
    });
  }
  function renderStreamCreditDashboard(data) {
    const dashboard = data?.dashboard;
    const projection = data?.projection;
    const summary = $("[data-stream-credits-summary]");
    if (!dashboard || !projection?.recommendedPlan) {
      summary.hidden = true;
      const meter = $("[data-stream-credit-meter]");
      if (meter) meter.hidden = true;
      return;
    }
    const meter = $("[data-stream-credit-meter]");
    if (meter) {
      const included = Number(dashboard.includedCredits || projection.recommendedPlan.includedCredits || 0);
      const used = Number(dashboard.actualCreditsUsed || 0);
      const remaining = Number(dashboard.creditsRemaining || 0);
      const utilization = included > 0 ? Math.min(100, Math.max(0, (used / included) * 100)) : 0;
      meter.hidden = false;
      $("[data-stream-credits-remaining]").textContent = remaining.toFixed(2);
      $("[data-stream-credits-used]").textContent = used.toFixed(2);
      $("[data-stream-credits-included]").textContent = included.toFixed(2);
      $("[data-stream-credits-utilization]").textContent = `${utilization.toFixed(0)}%`;
      const fill = $("[data-stream-credits-fill]");
      if (fill) fill.style.width = `${utilization}%`;
      meter.dataset.state = utilization >= 100 ? "empty" : utilization >= 90 ? "critical" : utilization >= 75 ? "warning" : "healthy";
    }
    summary.hidden = false;
    $("[data-stream-plan-name]").textContent = projection.recommendedPlan.name;
    $("[data-stream-plan-credits]").textContent = Number(dashboard.includedCredits || projection.recommendedPlan.includedCredits || 0).toFixed(2);
    $("[data-stream-project-base]").textContent = Number(dashboard.projectedEndOfMonthUsage || 0).toFixed(2);
    $("[data-stream-project-buffer]").textContent = Number(projection.metrics?.recommendedCreditCapacity || 0).toFixed(2);
    const panel = $("[data-stream-credits-dashboard]");
    panel.replaceChildren();
    const card = document.createElement("article");
    card.className = "campaign-member-claim";
    const main = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = `Plan: ${projection.recommendedPlan.name}`;
    const lines = [
      `Monthly credits used: ${Number(dashboard.actualCreditsUsed || 0).toFixed(2)}`,
      `Credits remaining: ${Number(dashboard.creditsRemaining || 0).toFixed(2)}`,
      `Projected unused credits: ${Number(dashboard.projectedUnusedCredits || 0).toFixed(2)}`,
      `Projected rebate: $${Number(dashboard.projectedRebate || 0).toFixed(2)}`,
      `Projected overage: ${Number(dashboard.projectedOverage || 0).toFixed(2)}`
    ];
    main.append(title);
    lines.forEach(text => {
      const row = document.createElement("p");
      row.textContent = text;
      main.append(row);
    });
    card.append(main);
    panel.append(card);
    renderStreamCreditComparison({ comparison: projection.comparison });
  }
  function updateStreamCreditSyncNote(message = "", kind = "") {
    const node = $("[data-stream-credits-sync-note]");
    if (!node) return;
    node.textContent = message;
    if (kind) node.dataset.kind = kind;
    else delete node.dataset.kind;
  }
  function clearStreamCreditRefreshTimer() {
    if (!streamCreditsNextRefreshTimer) return;
    clearTimeout(streamCreditsNextRefreshTimer);
    streamCreditsNextRefreshTimer = null;
  }
  function scheduleTopOfHourStreamCreditRefresh() {
    clearStreamCreditRefreshTimer();
    if (!accountState?.sellerAccess && !accountState?.isAdmin) return;
    const panel = $("[data-stream-credits-panel]");
    if (!panel || panel.hidden) return;
    const nowTime = Date.now();
    const nextHour = new Date(nowTime);
    nextHour.setHours(nextHour.getHours() + 1, 0, 5, 0);
    const delay = Math.max(5000, nextHour.getTime() - nowTime);
    const lastSyncLabel = streamCreditsLastLoadedAt
      ? `Last synced ${new Date(streamCreditsLastLoadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
      : "Waiting for first seller credit sync.";
    updateStreamCreditSyncNote(`${lastSyncLabel} Auto-refreshes at the top of every hour or when you return to this tab.`);
    streamCreditsNextRefreshTimer = setTimeout(() => {
      refreshStreamCreditDashboard({ silent: true, trigger: "hourly" });
    }, delay);
  }
  async function refreshStreamCreditDashboard({ silent = false, trigger = "manual" } = {}) {
    if (!accountState?.sellerAccess && !accountState?.isAdmin) return;
    if (streamCreditsRefreshInFlight) return;
    streamCreditsRefreshInFlight = true;
    try {
      if (!silent) streamCreditStatus("Refreshing Credits Remaining...");
      const data = await request("/seller/stream-credits/dashboard");
      const subscription = data.subscription || {};
      const form = $("[data-stream-credits-form]");
      if (form) {
        form.averageConcurrentViewers.value = subscription.averageConcurrentViewers ?? "";
        form.hoursPerShow.value = subscription.hoursPerShow ?? "";
        form.showsPerMonth.value = subscription.showsPerMonth ?? "";
        form.recordingRetentionDays.value = subscription.recordingRetentionDays ?? "";
        form.replayReservePercentage.value = subscription.replayReservePercentage ?? "";
        form.safetyBufferPercentage.value = subscription.safetyBufferPercentage ?? "";
      }
      renderStreamCreditDashboard(data);
      streamCreditsLastLoadedAt = Date.now();
      scheduleTopOfHourStreamCreditRefresh();
      if (!silent) {
        const refreshedAt = new Date(streamCreditsLastLoadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        streamCreditStatus(`Credits Remaining updated at ${refreshedAt}.`, "success");
      } else if (trigger === "hourly") {
        updateStreamCreditSyncNote(`Credits Remaining auto-updated at ${new Date(streamCreditsLastLoadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Next sync is scheduled for the top of the next hour.`);
      }
    } catch (error) {
      streamCreditStatus(error.message, "error");
      updateStreamCreditSyncNote(`Credits Remaining could not refresh automatically. ${error.message}`, "error");
    } finally {
      streamCreditsRefreshInFlight = false;
    }
  }
  function renderAccount(data) {
    accountState = data;
    const sellerAllowed = Boolean(data.sellerAccess);
    const masterCandidate = Boolean(data.isMaster || data.isMasterCandidate || data.isOwnerEmail);
    const needsSellerUpgradeFlow = Boolean(sellerUpgradeRequested());
    const hasSellerLegalProfile = Boolean(data.hasSellerLegalProfile || (data.firstName && data.lastName && data.birthDate));
    const needsBuyerId = !data.buyerUsername;
    const needsSellerId = Boolean(needsSellerUpgradeFlow && !data.sellerUsername);
    const roles = Array.isArray(data.roles) && data.roles.length ? data.roles : (data.isAdmin ? ["buyer", "seller", "master"] : (sellerAllowed ? ["buyer", "seller"] : ["buyer"]));
    localStorage.setItem("cp_can_seller_portal", sellerAllowed ? "true" : "false");
    if (!sellerAllowed && (sessionStorage.getItem("cp_portal_mode") || localStorage.getItem("cp_portal_mode")) === "seller") {
      sessionStorage.setItem("cp_portal_mode", "buyer");
      localStorage.setItem("cp_portal_mode", "buyer");
    }
    show("[data-auth-panel]", false);
    show("[data-seller-upgrade-panel]", !sellerAllowed && !data.isAdmin && !needsSellerUpgradeFlow);
    if (!data.passwordConfigured) {
      show("[data-password-panel]", true);
      show("[data-buyer-username-panel]", false);
      show("[data-device-panel]", false);
      show("[data-profile-panel]", false);
      show("[data-seller-username-panel]", false);
      show("[data-dashboard]", false);
      return;
    }
    show("[data-password-panel]", false);
    if (needsSellerUpgradeFlow && !sellerAllowed && !needsSellerId && !data.deviceVerified) {
      show("[data-buyer-username-panel]", false);
      show("[data-device-panel]", true);
      show("[data-profile-panel]", false);
      show("[data-seller-username-panel]", false);
      show("[data-dashboard]", false);
      return;
    }
    show("[data-device-panel]", false);
    if (needsSellerId) {
      show("[data-buyer-username-panel]", false);
      show("[data-seller-username-panel]", true);
      show("[data-device-panel]", false);
      show("[data-profile-panel]", false);
      show("[data-dashboard]", false);
      $("[data-seller-live-username]").value = data.pendingSellerUsername || data.sellerUsername || "";
      $("[data-save-seller-username]").disabled = true;
      showSellerUsernameStatus("Check a unique Seller ID first. Then continue to passkey, legal profile, and Stripe ID verification.");
      return;
    }
    show("[data-seller-username-panel]", false);
    if (needsSellerUpgradeFlow && !sellerAllowed && (!hasSellerLegalProfile || data.identityStatus !== "verified")) {
      show("[data-buyer-username-panel]", false);
      show("[data-profile-panel]", true);
      show("[data-seller-username-panel]", false);
      show("[data-dashboard]", false);
      const awaitingIdentity = hasSellerLegalProfile && ["pending_identity", "pending_review"].includes(data.identityStatus);
      $("[data-profile-form]").hidden = hasSellerLegalProfile;
      $("[data-stripe-identity-action]").hidden = !hasSellerLegalProfile;
      if (awaitingIdentity) {
        showStatus(data.identityStatus === "pending_review" ? "Seller identity is in manual review. We will unlock Seller Portal as soon as it clears." : "Seller legal profile saved. Complete Stripe Identity or wait for Stripe to finish processing.", awaitingIdentity ? "success" : "");
      }
      return;
    }
    show("[data-profile-panel]", false);
    if (needsSellerUpgradeFlow && data.sellerUsername && data.identityStatus === "verified" && !sellerAllowed && !sellerActivationFinalizePending) {
      sellerActivationFinalizePending = true;
      show("[data-dashboard]", false);
      showStatus("Finalizing Seller access now that your ID verification is complete...", "success");
      request("/profile/live-username", { method: "POST", body: JSON.stringify({ liveUsername: data.sellerUsername, activateSeller: true }) })
        .then(() => loadAccount())
        .catch(error => {
          sellerActivationFinalizePending = false;
          showStatus(error.message, "error");
          show("[data-dashboard]", true);
        });
      return;
    }
    show("[data-seller-username-panel]", false);
    if (needsBuyerId) {
      show("[data-buyer-username-panel]", true);
      show("[data-device-panel]", false);
      show("[data-profile-panel]", false);
      show("[data-dashboard]", false);
      $("[data-buyer-username]").value = data.buyerUsername || "";
      $("[data-save-buyer-username]").disabled = true;
      showBuyerUsernameStatus("Check your Buyer ID before continuing to your Buyer/Seller chooser.");
      return;
    }
    show("[data-buyer-username-panel]", false);
    show("[data-password-panel]", false);
    sellerActivationFinalizePending = false;
    show("[data-dashboard]", true);
    if (sellerAllowed || data.isAdmin) setSellerUpgradeRequested(false);
    $("[data-member-name]").textContent = data.buyerUsername || data.firstName || "Collector";
    const rolesNode = $("[data-account-role-badges]");
    if (rolesNode) rolesNode.innerHTML = roles.map(role => `<span class="account-role-badge" data-role="${escapeHtml(role)}">${escapeHtml(role === "master" ? "Master Account" : role === "seller" ? "Seller Account" : "Buyer Account")}</span>`).join("");
    $("[data-admin-link]").hidden = !data.isAdmin;
    show("[data-portal-choice-panel]", true);
    const sellerChoice = $("[data-portal-seller-choice]");
    if (sellerChoice) {
      sellerChoice.hidden = false;
      sellerChoice.textContent = sellerAllowed ? "Seller Account" : "Create Seller Account";
    }
    const masterChoice = $("[data-portal-master-choice]");
    if (masterChoice) masterChoice.hidden = !masterCandidate;
    const sellerChoiceModal = $("[data-portal-seller-choice-modal]");
    if (sellerChoiceModal) {
      sellerChoiceModal.hidden = false;
      const sellerTitle = sellerChoiceModal.querySelector("strong");
      const sellerCopy = sellerChoiceModal.querySelector("small");
      if (sellerTitle) sellerTitle.textContent = sellerAllowed ? "Seller Account" : "Create Seller Account";
      if (sellerCopy) sellerCopy.textContent = sellerAllowed ? "Go Live, inventory, listings, giveaways, and seller tools." : "Reserve a Seller ID first, then finish passkey, legal profile, and Stripe ID verification.";
    }
    const masterChoiceModal = $("[data-portal-master-choice-modal]");
    if (masterChoiceModal) masterChoiceModal.hidden = !masterCandidate;
    const launcher = $("[data-portal-launcher-modal]");
    if (launcher && !portalLauncherShown) {
      launcher.hidden = false;
      launcher.setAttribute("aria-hidden", "false");
      portalLauncherShown = true;
    }
    document.querySelectorAll("[data-seller-only]").forEach(node => { node.hidden = !sellerAllowed; });
    if (sellerAllowed) scheduleTopOfHourStreamCreditRefresh();
    else {
      clearStreamCreditRefreshTimer();
      updateStreamCreditSyncNote("Credits Remaining updates when you refresh.");
    }
    $("[data-referral-count]").textContent = data.referralCount;
    $("[data-tier-name]").textContent = data.tier.name;
    const ownerDashboardOnly = Boolean(data.ownerReferralDashboardOnly);
    setMemberInviteToolsEnabled(!ownerDashboardOnly);
    if (ownerDashboardOnly) {
      $("[data-invite-code]").textContent = "";
      $("[data-invite-url]").value = "";
      $("[data-invite-code-label]").textContent = "Owner referral protected by passkey";
      clearPersonalQr();
    } else {
      $("[data-invite-code]").textContent = data.inviteDisplayCode || data.inviteCode;
      $("[data-invite-url]").value = data.inviteUrl || "";
      $("[data-invite-code-label]").textContent = "Your personal invite code";
      $("[data-invite-copy-message]").textContent = "Your unique referral is ready to paste into a text, post, bio, or group chat.";
      loadPersonalQr(data.inviteUrl).catch(error => showStatus(error.message, "error"));
    }
    $("[data-live-username]").value = data.buyerUsername || "";
    const shipping = data.shippingAddress || {};
    $("[data-contact-phone]").value = data.phone || "";
    $("[data-shipping-name]").value = shipping.name || data.firstName || "";
    $("[data-shipping-street1]").value = shipping.street1 || "";
    $("[data-shipping-street2]").value = shipping.street2 || "";
    $("[data-shipping-city]").value = shipping.city || "";
    $("[data-shipping-state]").value = shipping.state || "";
    $("[data-shipping-postal]").value = shipping.postalCode || "";
    $("[data-shipping-country]").value = shipping.country || "US";
    $("[data-payment-method-label]").textContent = data.paymentMethod ? `${String(data.paymentMethod.brand || "Card").toUpperCase()} ending in ${data.paymentMethod.last4}` : "No payment method saved";
    $("[data-add-payment-method]").textContent = data.paymentMethod ? "Replace payment method" : "Add payment method";
    if (qs.get("billing") === "success") showContactStatus(data.paymentMethod ? "Payment method saved securely by Stripe." : "Stripe accepted the payment method. Waiting for webhook confirmation; refresh in a moment.", data.paymentMethod ? "success" : "");
    $("[data-next-tier]").textContent = data.nextTier ? `${data.nextTier.remaining} more verified friend${data.nextTier.remaining === 1 ? "" : "s"} to unlock ${data.nextTier.name}: ${data.nextTier.reward}.` : "You have reached the highest published reward tier.";
    const tierTrack = $("[data-tier-track]"); tierTrack.replaceChildren();
    (Array.isArray(data.tiers) ? data.tiers : []).forEach(tier => {
      const node = document.createElement("div"); node.className = `tier-node ${data.referralCount >= Number(tier.threshold) ? "is-earned" : ""}`;
      const threshold = document.createElement("strong"); threshold.textContent = String(tier.threshold); node.append(threshold, document.createElement("br"), document.createTextNode(String(tier.name || "Tier"))); tierTrack.append(node);
    });
    syncOfferClaimAvailability();
    loadMyCampaigns();
    loadMyOrders();
    if (sellerAllowed) refreshStreamCreditDashboard();
    if (data.referredSignup && !welcomeDiscountLoaded && !offerToken && !activeOffer) {
      welcomeDiscountLoaded = true;
      show("[data-discount-panel]", true);
      show("[data-invite-panel]", false);
      claimDiscount({ welcome: true }).catch(error => {
        const weekly = error.status === 429 || /weekly|thursday/i.test(String(error.message || ""));
        welcomeDiscountLoaded = weekly;
        showStatus(weekly ? "Weekly reward limit reached. Review your campaign wallet; eligibility resets Thursday." : error.message, "error");
        if (weekly) loadMyCampaigns();
      });
    }
  }

  document.querySelectorAll("[data-close-portal-launcher]").forEach(button => {
    button.addEventListener("click", () => {
      const launcher = $("[data-portal-launcher-modal]");
      if (!launcher) return;
      launcher.hidden = true;
      launcher.setAttribute("aria-hidden", "true");
    });
  });

  function memberCampaignStatus(claim) {
    if (pick(claim, "redeemedAt", "redeemed_at", "usedAt", "used_at")) return "used";
    const expiresAt = String(pick(claim, "expiresAt", "expires_at") || "");
    if (!campaignNeverExpires(claim) && expiresAt && Date.parse(expiresAt) <= Date.now() + campaignClockOffset) return "expired";
    return "claimed";
  }
  function renderMemberCampaignClaim(claim) {
    const card = document.createElement("article"); card.className = "campaign-member-claim";
    const main = document.createElement("div");
    const title = document.createElement("h4"); title.textContent = String(pick(claim, "campaignTitle", "campaign_title", "title") || "Campaign reward");
    const reward = document.createElement("p"); reward.textContent = campaignRewardDescription(claim);
    const code = document.createElement("p"); code.className = "campaign-member-code"; code.textContent = String(pick(claim, "code") || "No code required");
    const details = document.createElement("p");
    const rank = pick(claim, "rank", "claimRank", "claim_rank"); const pack = pick(claim, "packNumber", "pack_number");
    details.textContent = [rank ? `Claim rank #${rank}` : "", pack ? `Pack #${pack}` : ""].filter(Boolean).join(" - ");
    main.append(title, reward, code); if (details.textContent) main.append(details);
    const side = document.createElement("div");
    const state = memberCampaignStatus(claim); const badge = document.createElement("span"); badge.className = `campaign-member-status ${state}`; badge.textContent = state;
    side.append(badge);
    const expiresAt = String(pick(claim, "expiresAt", "expires_at") || "");
    const neverExpires = campaignNeverExpires(claim);
    if (expiresAt || neverExpires) {
      const expiry = document.createElement("div"); expiry.className = "campaign-member-expiry";
      const label = document.createElement("span"); label.textContent = neverExpires ? "Availability: " : "Expires: ";
      const time = document.createElement("time"); time.dateTime = neverExpires ? "" : expiresAt; time.dataset.liveCampaignExpiry = expiresAt; time.dataset.liveCampaignNeverExpires = String(neverExpires);
      expiry.append(label, time); side.append(expiry);
    }
    card.append(main, side);
    return card;
  }
  function renderMyCampaigns(claims) {
    const container = $("[data-campaign-claims]"); container.replaceChildren();
    if (!claims.length) { const empty = document.createElement("div"); empty.className = "campaign-wallet-empty"; empty.textContent = "No campaign rewards claimed yet."; container.append(empty); return; }
    claims.forEach(claim => container.append(renderMemberCampaignClaim(claim)));
    startCampaignCountdowns();
  }
  async function loadMyCampaigns() {
    if (!token || !accountState?.deviceVerified || !accountState?.profileComplete) return;
    try {
      const data = await request("/campaigns/mine");
      if (data.serverNow) campaignClockOffset = Date.parse(data.serverNow) - Date.now();
      renderMyCampaigns(Array.isArray(data.claims) ? data.claims : []);
    } catch (error) {
      const container = $("[data-campaign-claims]"); container.replaceChildren();
      const message = document.createElement("div"); message.className = "campaign-wallet-empty"; message.textContent = error.message; container.append(message);
    }
  }
  function renderOfferRedemption(redemption, alreadyClaimed = false) {
    const result = $("[data-offer-result]"); result.replaceChildren(); result.hidden = false;
    const heading = document.createElement("strong"); heading.textContent = String(pick(redemption, "code") || "Reward claimed");
    const description = document.createElement("span");
    const rank = pick(redemption, "rank", "claimRank", "claim_rank"); const pack = pick(redemption, "packNumber", "pack_number");
    description.textContent = [alreadyClaimed ? "You already claimed this campaign." : "Campaign reward claimed.", rank ? `Rank #${rank}.` : "", pack ? `Pack #${pack}.` : ""].filter(Boolean).join(" ");
    result.append(heading, description);
    $("[data-campaign-offer]").dataset.state = "claimed";
    $("[data-offer-state]").textContent = alreadyClaimed ? "SAVED" : "CLAIMED";
    $("[data-offer-claim]").disabled = true;
    $("[data-offer-guidance]").textContent = "This reward is saved in your campaign wallet below.";
  }
  async function claimCampaignOffer() {
    if (!offerToken || !activeOffer) throw new Error("This campaign offer is not ready to claim.");
    if (!accountState?.deviceVerified || !accountState?.profileComplete) throw new Error("Complete Profile verification before claiming this offer.");
    if (accountState.isAdmin) throw new Error("Owner accounts cannot claim their own campaign offers.");
    const button = $("[data-offer-claim]"); button.disabled = true; const original = button.textContent; button.textContent = "Claiming...";
    const body = { offerToken };
    if (String(pick(activeOffer, "rewardType", "reward_type") || "") === "pack_draft") body.packNumber = Number($("[data-offer-pack-number]").value);
    try {
      const data = await request("/campaign/claim", { method: "POST", body: JSON.stringify(body) });
      if (data.serverNow) campaignClockOffset = Date.parse(data.serverNow) - Date.now();
      if (!data.redemption) throw new Error("The campaign claim response was incomplete.");
      renderOfferRedemption(data.redemption, Boolean(data.alreadyClaimed));
      offerClaimBlocked = true;
      clearStoredOffer();
      activeOffer = null;
      await loadMyCampaigns();
      showStatus(data.alreadyClaimed ? "This campaign was already saved to your wallet." : "Campaign reward claimed and saved to your wallet.", "success");
    } catch (error) {
      const weekly = error.status === 429 || /weekly|thursday/i.test(String(error.message || ""));
      if (weekly) {
        offerClaimBlocked = true;
        clearStoredOffer();
        $("[data-offer-guidance]").textContent = "Your weekly reward has already been claimed. Eligibility resets Thursday; use the existing code in your campaign wallet below.";
        $("[data-offer-guidance]").dataset.kind = "error";
        await loadMyCampaigns();
      } else if (error.status === 409 && String(pick(activeOffer, "rewardType", "reward_type") || "") === "pack_draft") {
        await loadOfferStatus();
        showStatus("That pack number was just claimed. Available pack choices have been refreshed.", "error");
        return;
      }
      showStatus(weekly ? "Weekly reward limit reached. Review your existing campaign wallet; eligibility resets Thursday." : error.message, "error");
      if (!weekly) syncOfferClaimAvailability();
    } finally { button.textContent = original; if (offerClaimBlocked) button.disabled = true; }
  }

  $("[data-request-form]").addEventListener("submit", async event => {
    event.preventDefault();
    if (authRequestPending || authRequestSent) return;
    const requestForm = event.currentTarget;
    const form = new FormData(requestForm); email = String(form.get("email")).trim().toLowerCase();
    const turnstileToken = turnstileTokenValue || String(form.get("cf-turnstile-response") || "");
    if (!turnstileToken) {
      showStatus("Complete the visible security check above the button.", "error");
      return;
    }
    const submittedMode = authMode;
    const submittedPassword = String(form.get("password") || "");
    const submittedReferral = submittedMode === "signup" ? referralCode : "";
    const submittedOwnerReferral = submittedMode === "signup" ? ownerReferralToken : "";
    const sendButton = $("[data-send-verification]");
    const emailInput = requestForm.querySelector("input[name='email']");
    authRequestPending = true;
    sendButton.disabled = true;
    sendButton.textContent = "Validating referral...";
    emailInput.disabled = true;
    authModeButtons.forEach(button => { button.disabled = true; });
    if (submittedMode === "signup" && hasAttachedReferral) {
      const validReferral = await referralValidationPromise;
      if (!validReferral) {
        authRequestPending = false;
        emailInput.disabled = false;
        authModeButtons.forEach(button => { button.disabled = false; });
        sendButton.disabled = false;
        sendButton.textContent = authModeCopy[submittedMode].sendLabel;
        showStatus("This referral is not current. Ask for a new owner QR or remove the referral from the address.", "error");
        return;
      }
    }
    sendButton.textContent = "Sending secure link...";
    try {
      if (submittedMode === "signin") {
        if (!submittedPassword) throw new Error("Enter your Crack Packs password.");
        sendButton.textContent = "Signing in...";
        const data = await request("/auth/password/login", { method: "POST", body: JSON.stringify({ email, password: submittedPassword, turnstileToken }) });
        token = data.token; localStorage.setItem("cp_rewards_token", token);
        authRequestSent = false;
        resetTurnstile();
        showStatus("Signed in to your Profile.", "success");
        renderAccount(data.account);
        return;
      }
      const authResult = await request("/auth/request", { method: "POST", body: JSON.stringify({ email, referralCode: submittedReferral, ownerReferralToken: submittedOwnerReferral, sellerActivationToken, offerToken, authMode: submittedMode, returnTo: requestedPortal === "master" ? "admin" : "rewards", turnstileToken }) });
      authRequestSent = true;
      resetTurnstile();
      sendButton.textContent = "Check Inbox 10 min code";
      sendButton.disabled = true;
      const deliveredMode = authResult.authFlow === "signin" || authResult.authFlow === "admin" ? "signin" : "signup";
      const copy = authModeCopy[deliveredMode];
      $("[data-email-modal-title]").textContent = copy.modalTitle;
      $("[data-email-modal-copy]").textContent = copy.modalCopy;
      const help = $("[data-email-modal-help]");
      const helpUrl = safeHttpUrl(config.youtubeChannelUrl);
      if (helpUrl) {
        help.href = helpUrl;
        help.hidden = false;
      } else {
        help.hidden = true;
      }
      $("[data-email-modal]").hidden = false;
      showStatus(copy.sentStatus, "success");
    }
    catch (error) {
      authRequestSent = false;
      resetTurnstile();
      sendButton.textContent = "Complete security check";
      sendButton.disabled = true;
      const waitMinutes = Math.ceil(Number(error.payload?.retryAfterSeconds || 0) / 60);
      const retryHelp = error.status === 429 && waitMinutes ? ` Try again in about ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}, or use the newest email already sent.` : "";
      showStatus(`${error.message}${retryHelp}`, "error");
    } finally {
      authRequestPending = false;
      emailInput.disabled = false;
      authModeButtons.forEach(button => { button.disabled = false; });
    }
  });
  document.querySelectorAll("[data-email-modal-close]").forEach(button => button.addEventListener("click", () => { $("[data-email-modal]").hidden = true; }));
  document.querySelectorAll("[data-invite-sent-close]").forEach(button => button.addEventListener("click", () => { $("[data-invite-sent-modal]").hidden = true; }));
  document.querySelectorAll("[data-invite-copy-close]").forEach(button => button.addEventListener("click", () => { $("[data-invite-copy-modal]").hidden = true; }));
  document.querySelectorAll("[data-discount-redeemed-close]").forEach(button => button.addEventListener("click", () => { $("[data-discount-redeemed-modal]").hidden = true; }));
  document.querySelectorAll("[data-seller-identity-close]").forEach(button => button.addEventListener("click", () => {
    pendingSellerIdentityStart = false;
    $("[data-seller-identity-modal]").hidden = true;
  }));
  $("[data-password-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const button = event.submitter;
    if (button) button.disabled = true;
    try {
      const data = await request("/auth/password/set", { method: "POST", body: JSON.stringify(form) });
      localStorage.setItem("cp_can_seller_portal", "false");
      localStorage.setItem("cp_portal_mode", "buyer");
      sessionStorage.setItem("cp_portal_mode", "buyer");
      showStatus("Password saved. Continue account setup.", "success");
      renderAccount(data.account);
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
  $("[data-profile-form]").addEventListener("submit", async event => {
    event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await request("/profile", { method: "POST", body: JSON.stringify(form) });
      renderAccount(data.account);
      pendingSellerIdentityStart = true;
      $("[data-seller-identity-modal]").hidden = false;
      showStatus("Legal profile saved. Continue to the secure Stripe Identity check when ready.", "success");
    }
    catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-seller-identity-continue]")?.addEventListener("click", async () => {
    if (!pendingSellerIdentityStart) return;
    const button = $("[data-seller-identity-continue]");
    button.disabled = true;
    try {
      const identity = await request("/identity/session", { method: "POST", body: "{}" });
      $("[data-seller-identity-modal]").hidden = true;
      pendingSellerIdentityStart = false;
      if (identity.verified) return loadAccount();
      if (!identity.url) throw new Error("Stripe Identity did not return a verification page.");
      location.href = identity.url;
    } catch (error) {
      button.disabled = false;
      showStatus(error.message, "error");
    }
  });
  $("[data-start-stripe-identity]").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const identity = await request("/identity/session", { method: "POST", body: "{}" });
      if (identity.verified) return loadAccount();
      if (!identity.url) throw new Error("Stripe Identity did not return a verification page.");
      location.href = identity.url;
    } catch (error) {
      button.disabled = false;
      showStatus(error.message, "error");
    }
  });
  const toBase64url = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromBase64url = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));
  $("[data-register-passkey]").addEventListener("click", async () => {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("This browser does not support passkeys. Try a current version of Chrome, Edge, Safari, or Firefox.");
      const options = await request("/device/register/options", { method: "POST" });
      options.challenge = fromBase64url(options.challenge); options.user.id = fromBase64url(options.user.id);
      options.excludeCredentials = (options.excludeCredentials || []).map(item => ({ ...item, id: fromBase64url(item.id) }));
      const credential = await navigator.credentials.create({ publicKey: options });
      const payload = { id: credential.id, rawId: toBase64url(credential.rawId), type: credential.type, response: { clientDataJSON: toBase64url(credential.response.clientDataJSON), attestationObject: toBase64url(credential.response.attestationObject), transports: credential.response.getTransports ? credential.response.getTransports() : [] }, clientExtensionResults: credential.getClientExtensionResults() };
      const data = await request("/device/register/verify", { method: "POST", body: JSON.stringify(payload) }); showStatus("Device passkey verified.", "success"); renderAccount(data.account);
    } catch (error) { showStatus(error.message || "Device verification was cancelled.", "error"); }
  });
  $("[data-start-seller-upgrade]")?.addEventListener("click", () => {
    beginSellerUpgradeFlow();
  });
  $("[data-check-buyer-username]")?.addEventListener("click", async () => {
    const input = $("[data-buyer-username]");
    const buyerUsername = String(input?.value || "").trim();
    checkedBuyerUsername = "";
    $("[data-save-buyer-username]").disabled = true;
    try {
      const result = await request("/profile/buyer-username/check", { method: "POST", body: JSON.stringify({ buyerUsername }) });
      checkedBuyerUsername = result.buyerUsername || buyerUsername;
      showBuyerUsernameStatus(`Buyer ID ${checkedBuyerUsername} is available. Click Continue to reserve it.`, "success");
      $("[data-save-buyer-username]").disabled = false;
    } catch (error) {
      showBuyerUsernameStatus(error.message, "error");
    }
  });
  $("[data-buyer-username]")?.addEventListener("input", event => {
    const current = String(event.currentTarget.value || "").trim();
    if (current !== checkedBuyerUsername) {
      $("[data-save-buyer-username]").disabled = true;
      showBuyerUsernameStatus("Check your Buyer ID before continuing.");
    }
  });
  $("[data-buyer-username-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("[data-buyer-username]");
    const buyerUsername = String(input?.value || "").trim();
    if (!buyerUsername || buyerUsername !== checkedBuyerUsername) {
      showBuyerUsernameStatus("Run the Buyer ID check first so Crack Packs can reserve this name securely.", "error");
      return;
    }
    const button = $("[data-save-buyer-username]");
    button.disabled = true;
    try {
      const result = await request("/profile/buyer-username", { method: "POST", body: JSON.stringify({ buyerUsername }) });
      checkedBuyerUsername = "";
      accountState.buyerUsername = result.buyerUsername || buyerUsername;
      showBuyerUsernameStatus("Buyer ID reserved. Choose Buyer, Seller, or Master next.", "success");
      await loadAccount();
    } catch (error) {
      button.disabled = false;
      showBuyerUsernameStatus(error.message, "error");
    }
  });
  $("[data-check-seller-username]")?.addEventListener("click", async () => {
    const input = $("[data-seller-live-username]");
    const liveUsername = String(input?.value || "").trim();
    checkedSellerUsername = "";
    $("[data-save-seller-username]").disabled = true;
    try {
      const result = await request("/profile/live-username/check", { method: "POST", body: JSON.stringify({ liveUsername }) });
      checkedSellerUsername = result.liveUsername || liveUsername;
      showSellerUsernameStatus(`Seller ID ${checkedSellerUsername} is available. Click Continue to reserve it.`, "success");
      $("[data-save-seller-username]").disabled = false;
    } catch (error) {
      showSellerUsernameStatus(error.message, "error");
    }
  });
  $("[data-seller-live-username]")?.addEventListener("input", event => {
    const current = String(event.currentTarget.value || "").trim();
    if (current !== checkedSellerUsername) {
      $("[data-save-seller-username]").disabled = true;
      showSellerUsernameStatus("Check your Seller ID before continuing.");
    }
  });
  $("[data-seller-username-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("[data-seller-live-username]");
    const liveUsername = String(input?.value || "").trim();
    if (!liveUsername || liveUsername !== checkedSellerUsername) {
      showSellerUsernameStatus("Run the Seller ID check first so Crack Packs can reserve this name securely.", "error");
      return;
    }
    const button = $("[data-save-seller-username]");
    button.disabled = true;
    try {
      const activateSeller = Boolean((accountState?.isAdmin || sellerUpgradeRequested()) && accountState?.identityStatus === "verified");
      await request("/profile/live-username", { method: "POST", body: JSON.stringify({ liveUsername, activateSeller }) });
      checkedSellerUsername = "";
      showSellerUsernameStatus(activateSeller ? "Seller account granted. Opening your account now..." : "Seller ID reserved. Continue to legal profile.", "success");
      await loadAccount();
      showStatus(activateSeller ? "Seller account granted. Your referral link is live and the welcome email is on the way." : "Seller ID reserved. Continue to passkey, legal profile, and ID verification.", "success");
    } catch (error) {
      button.disabled = false;
      showSellerUsernameStatus(error.message, "error");
    }
  });
  async function copyInviteLink() {
    if (accountState?.ownerReferralDashboardOnly) throw new Error("Open the Owner Dashboard to copy the current owner referral.");
    const inviteUrl = $("[data-invite-url]").value;
    if (!inviteUrl) throw new Error("Your invite link is not ready yet.");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteUrl);
    } else {
      const input = $("[data-invite-url]");
      input.focus();
      input.select();
      if (!document.execCommand("copy")) throw new Error("Copy was blocked by this browser.");
      input.setSelectionRange(0, 0);
    }
    $("[data-invite-copy-modal]").hidden = false;
    showStatus("Invitation link copied.", "success");
  }
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", async () => {
    const inviteView = button.dataset.view === "invite";
    show("[data-discount-panel]", button.dataset.view === "discount");
    show("[data-invite-panel]", inviteView);
    if (button.dataset.view === "orders") {
      await loadMyOrders();
      $("[data-orders-panel]").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (button.dataset.view === "account") $("[data-account-panel]").scrollIntoView({ behavior: "smooth", block: "start" });
    if (inviteView && !accountState?.ownerReferralDashboardOnly) {
      try { await copyInviteLink(); }
      catch (error) { showStatus(error.message, "error"); }
    }
  }));
  async function claimDiscount({ welcome = false } = {}) {
    const data = await request("/discount/claim", { method: "POST" });
    $("[data-discount-code]").textContent = data.code;
    $("[data-claim-discount]").hidden = true;
    const redeemButton = $("[data-redeem-discount]");
    redeemButton.hidden = false;
    if (data.redeemedAt) {
      redeemButton.disabled = true;
      redeemButton.textContent = "Already redeemed";
    } else if (data.requestedAt) {
      redeemButton.disabled = true;
      redeemButton.textContent = "Redemption requested";
    }
    const prefix = welcome ? "Your referred-friend 10% welcome code is ready. " : "";
    showStatus(`${prefix}${data.description} Expires ${new Date(data.expiresAt).toLocaleDateString()}.`, "success");
    return data;
  }
  $("[data-claim-discount]").addEventListener("click", () => claimDiscount().catch(error => showStatus(error.message, "error")));
  $("[data-redeem-discount]").addEventListener("click", async () => {
    try {
      const data = await request("/discount/redeem", { method: "POST" });
      const redeemButton = $("[data-redeem-discount]");
      redeemButton.disabled = true;
      redeemButton.textContent = "Redemption requested";
      $("[data-discount-redeemed-modal]").hidden = false;
      showStatus(`Redemption requested at ${new Date(data.requestedAt).toLocaleString()}.`, "success");
    } catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-invite-form]").addEventListener("submit", async event => {
    event.preventDefault();
    if (accountState?.ownerReferralDashboardOnly) {
      showStatus("Open the Owner Dashboard to use owner referral tools.", "error");
      return;
    }
    const inviteForm = event.currentTarget;
    const inviteEmail = new FormData(inviteForm).get("email");
    try {
      await request("/invites", { method: "POST", body: JSON.stringify({ email: inviteEmail }) });
      inviteForm.reset();
      $("[data-invite-sent-modal]").hidden = false;
      showStatus("Invitation sent. It counts after your friend verifies and completes signup.", "success");
    }
    catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-copy-link]").addEventListener("click", () => copyInviteLink().catch(error => showStatus(error.message, "error")));
  async function qrPngBlob(image) {
    if (image.decode) await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 1200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The QR PNG could not be prepared.")), "image/png"));
  }
  async function downloadInviteQr(button) {
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Preparing QR...";
    try {
      if (accountState?.ownerReferralDashboardOnly) throw new Error("Open the Owner Dashboard to download the current owner QR.");
      const image = $("[data-personal-qr]");
      if (!image.src) throw new Error("Your QR code is not ready yet.");
      const blobUrl = URL.createObjectURL(await qrPngBlob(image));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `crack-packs-invite-${accountState?.inviteCode || "qr"}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showStatus("Your unique invite QR was downloaded.", "success");
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
  document.querySelectorAll("[data-download-qr]").forEach(button => button.addEventListener("click", () => downloadInviteQr(button)));
  $("[data-username-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const buyerUsername = form.get("buyerUsername") || form.get("liveUsername");
      const data = await request("/profile/buyer-username", { method: "POST", body: JSON.stringify({ buyerUsername }) });
      accountState.buyerUsername = data.buyerUsername;
      $("[data-live-username]").value = data.buyerUsername;
      showStatus("Buyer ID saved. Seller ID remains separate for live tools and brand pages.", "success");
    } catch (error) {
      showStatus(error.message, "error");
    }
  });
  $("[data-contact-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form); const button = event.submitter; button.disabled = true;
    try {
      const payload = await request("/profile/contact", { method: "POST", body: JSON.stringify({
        phone: data.get("phone"),
        shippingAddress: { name: data.get("name"), street1: data.get("street1"), street2: data.get("street2"), city: data.get("city"), state: data.get("state"), postalCode: data.get("postalCode"), country: data.get("country") }
      }) });
      accountState.phone = payload.phone; accountState.shippingAddress = payload.shippingAddress;
      showContactStatus("Checkout profile saved.", "success");
    } catch (error) { showContactStatus(error.message, "error"); }
    finally { button.disabled = false; }
  });
  $("[data-add-payment-method]")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true; showContactStatus("Opening Stripe's secure card setup...");
    try {
      const result = await request("/billing/setup", { method: "POST", body: "{}" });
      if (!result.url) throw new Error("Stripe did not return a secure setup page.");
      location.href = result.url;
    } catch (error) { button.disabled = false; showContactStatus(error.message, "error"); }
  });
  $("[data-stream-credits-refresh]")?.addEventListener("click", () => refreshStreamCreditDashboard());
  $("[data-stream-credits-calculate]")?.addEventListener("click", async () => {
    try {
      streamCreditStatus("Calculating seller plan...");
      const result = await request("/seller/stream-credits/calculate", { method: "POST", body: JSON.stringify(readStreamCreditForm()) });
      renderStreamCreditDashboard({ dashboard: { includedCredits: result.recommendedPlan?.includedCredits || 0, actualCreditsUsed: 0, creditsRemaining: result.recommendedPlan?.includedCredits || 0, projectedEndOfMonthUsage: result.metrics?.projectedBaseCredits || 0, projectedUnusedCredits: Math.max(0, Number(result.recommendedPlan?.includedCredits || 0) - Number(result.metrics?.projectedBaseCredits || 0)), projectedRebate: Math.max(0, Number(result.recommendedPlan?.includedCredits || 0) - Number(result.metrics?.projectedBaseCredits || 0)) * Number(result.config?.unusedCreditRebateRate || 0), projectedOverage: Math.max(0, Number(result.metrics?.projectedBaseCredits || 0) - Number(result.recommendedPlan?.includedCredits || 0)) }, projection: result });
      streamCreditStatus(`Recommended plan: ${result.recommendedPlan?.name || "Unavailable"}.`, "success");
    } catch (error) {
      streamCreditStatus(error.message, "error");
    }
  });
  $("[data-stream-credits-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      streamCreditStatus("Saving seller plan...");
      const base = readStreamCreditForm();
      const recommendation = await request("/seller/stream-credits/calculate", { method: "POST", body: JSON.stringify(base) });
      await request("/seller/stream-credits/subscription", { method: "POST", body: JSON.stringify({ ...base, selectedPlanCode: recommendation.recommendedPlan?.code }) });
      streamCreditStatus(`Saved ${recommendation.recommendedPlan?.name || "seller"} plan inputs.`, "success");
      await refreshStreamCreditDashboard();
    } catch (error) {
      streamCreditStatus(error.message, "error");
    }
  });
  $("[data-stream-plan-checkout]")?.addEventListener("click", async () => {
    try {
      streamCreditStatus("Opening Stripe checkout for your seller plan...");
      const base = readStreamCreditForm();
      const recommendation = await request("/seller/stream-credits/calculate", { method: "POST", body: JSON.stringify(base) });
      const result = await request("/seller/stream-credits/checkout-plan", { method: "POST", body: JSON.stringify({ ...base, selectedPlanCode: recommendation.recommendedPlan?.code }) });
      if (!result.checkoutUrl) throw new Error("Stripe did not return a plan checkout page.");
      location.href = result.checkoutUrl;
    } catch (error) {
      streamCreditStatus(error.message, "error");
    }
  });
  $("[data-stream-credit-buy]")?.addEventListener("click", async () => {
    try {
      streamCreditStatus("Opening Stripe checkout for prepaid Stream Credits...");
      const result = await request("/seller/stream-credits/checkout-credits", { method: "POST", body: JSON.stringify({ creditQuantity: 25 }) });
      if (!result.checkoutUrl) throw new Error("Stripe did not return a prepaid-credit checkout page.");
      location.href = result.checkoutUrl;
    } catch (error) {
      streamCreditStatus(error.message, "error");
    }
  });
  $("[data-sign-out]").addEventListener("click", async () => {
    try { await request("/auth/logout", { method: "POST" }); } catch {}
    clearStreamCreditRefreshTimer();
    sessionStorage.removeItem(SELLER_UPGRADE_KEY);
    localStorage.removeItem("cp_rewards_token");
    sessionStorage.removeItem("cp_admin_token");
    location.href = "referral.html";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (!accountState?.sellerAccess && !accountState?.isAdmin) return;
    if (!streamCreditsLastLoadedAt || (Date.now() - streamCreditsLastLoadedAt) >= STREAM_CREDITS_REFRESH_FOCUS_GRACE_MS) {
      refreshStreamCreditDashboard({ silent: true, trigger: "resume" });
    } else {
      scheduleTopOfHourStreamCreditRefresh();
    }
  });
  async function confirmEmailLink() {
    if (!verificationToken) {
      await loadAccount();
      if (sellerActivationToken && token) {
        try {
          const result = await request("/seller/activate", { method: "POST", body: JSON.stringify({ token: sellerActivationToken }) });
          localStorage.removeItem(SELLER_ACTIVATION_KEY);
          localStorage.setItem("cp_can_seller_portal", "true");
          localStorage.setItem("cp_portal_mode", result.activePortal || "seller");
          sessionStorage.setItem("cp_portal_mode", result.activePortal || "seller");
          history.replaceState({}, document.title, location.pathname);
          showStatus("Seller Portal activated. You can now open seller inventory and show tools.", "success");
          await loadAccount();
        } catch (error) { showStatus(error.message, "error"); }
      } else if (sellerActivationToken) {
        showStatus("Seller activation is attached. Sign in with the invited email, or choose Create Account if that email does not have a Crack Packs account yet.", "success");
      }
      return;
    }
    try {
      const data = await request("/auth/verify-link", { method: "POST", body: JSON.stringify({ token: verificationToken }) });
      token = data.token; localStorage.setItem("cp_rewards_token", token);
      if (offerToken) localStorage.setItem("cp_campaign_offer_token", offerToken);
      history.replaceState({}, document.title, location.pathname);
      const accountReady = true;
      const signedIn = data.authFlow === "signin" || data.authFlow === "admin" || data.authFlow === "legacy";
      showStatus(signedIn ? "Signed in to your Profile." : "Email verified. Your buyer account is ready.", "success");
      renderAccount(data.account);
      if (sellerActivationToken && signedIn) {
        try {
          const activation = await request("/seller/activate", { method: "POST", body: JSON.stringify({ token: sellerActivationToken }) });
          localStorage.removeItem(SELLER_ACTIVATION_KEY);
          localStorage.setItem("cp_can_seller_portal", "true");
          localStorage.setItem("cp_portal_mode", activation.activePortal || "seller");
          sessionStorage.setItem("cp_portal_mode", activation.activePortal || "seller");
          showStatus("Seller Portal activated. Your Seller account is ready.", "success");
          await loadAccount();
        } catch (error) {
          showStatus(error.message, "error");
        }
      }
      if (returnTarget === "store" && signedIn && accountReady) {
        if (data.account.isAdmin || data.account.sellerAccess) {
          localStorage.setItem("cp_portal_mode", "seller");
          sessionStorage.setItem("cp_portal_mode", "seller");
          window.location.replace("streams.html");
          return;
        }
        localStorage.setItem("cp_portal_mode", "buyer");
        sessionStorage.setItem("cp_portal_mode", "buyer");
        window.location.replace("shop.html");
        return;
      }
    } catch (error) {
      const preserved = new URLSearchParams();
      if (ownerReferralToken) preserved.set("owner_ref", ownerReferralToken);
      else if (referralCode) preserved.set("ref", referralCode);
      if (offerToken) preserved.set("offer", offerToken);
      if (authMode === "signup") preserved.set("mode", "signup");
      if (returnTarget) preserved.set("return", returnTarget);
      const query = preserved.toString();
      history.replaceState({}, document.title, `${location.pathname}${query ? `?${query}` : ""}`);
      authRequestSent = false;
      authRequestPending = false;
      show("[data-auth-panel]", true);
      show("[data-device-panel]", false);
      show("[data-seller-username-panel]", false);
      show("[data-profile-panel]", false);
      show("[data-dashboard]", false);
      setAuthMode(authMode);
      showStatus(`${error.message} Use the form below to send a fresh 10-minute link.`, "error");
      $("[data-request-form] input[name='email']")?.focus();
    }
  }
  async function configureSocialLinks() {
    const facebookUrl = safeHttpUrl(config.facebookUrl);
    if (facebookUrl) {
      const facebook = $("[data-facebook-social]");
      facebook.href = facebookUrl;
      facebook.hidden = false;
      $("[data-facebook-pending]").hidden = true;
    }
    let youtubeUrl = safeHttpUrl(config.youtubeChannelUrl);
    if (!youtubeUrl && config.youtubeLiveStatusUrl) {
      try {
        const response = await fetch(config.youtubeLiveStatusUrl, { headers: { Accept: "application/json" } });
        const payload = response.ok ? await response.json() : {};
        youtubeUrl = safeHttpUrl(payload.channelUrl || payload.upcoming?.channelUrl);
      } catch {}
    }
    if (youtubeUrl) {
      const youtube = $("[data-youtube-social]");
      youtube.href = youtubeUrl;
      youtube.hidden = false;
    }
  }
  window.addEventListener("beforeunload", () => {
    clearPersonalQr();
    clearInterval(campaignCountdownTimer);
  });
  $("[data-offer-claim]").addEventListener("click", () => claimCampaignOffer().catch(error => showStatus(error.message, "error")));
  $("[data-offer-pack-number]").addEventListener("change", syncOfferClaimAvailability);
  $("[data-campaign-mine-refresh]").addEventListener("click", () => loadMyCampaigns());
  $("[data-orders-refresh]").addEventListener("click", () => loadMyOrders());
  configureSocialLinks();
  loadOfferStatus();
  confirmEmailLink();
})();
