(() => {
  const app = document.querySelector("[data-admin-app]");
  if (!app) return;
  const config = window.CRACKPACKS_CONFIG || {};
  const api = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const params = new URLSearchParams(location.search);
  const verificationToken = String(params.get("verify") || "");
  const $ = selector => document.querySelector(selector);
  const statusNode = $("[data-admin-status]");
  const showStatus = (message = "", kind = "") => { statusNode.textContent = message; statusNode.dataset.kind = kind; };
  const show = (selector, visible) => { document.querySelectorAll(selector).forEach(node => { node.hidden = !visible; }); };
  let memberToken = localStorage.getItem("cp_rewards_token") || "";
  let adminToken = sessionStorage.getItem("cp_admin_token") || "";
  let turnstileToken = "";
  let searchTimer = null;
  let ownerReferralState = null;
  let ownerReferralQrUrl = "";
  let ownerReferralQrInviteUrl = "";
  let ownerReferralTimer = null;
  let ownerReferralCountdownTimer = null;
  let ownerReferralClockOffset = 0;
  let ownerReferralRefreshPromise = null;
  let generatedCampaign = null;
  let campaignQrObjectUrl = "";
  let campaignQrCampaignId = "";
  let campaignCountdownTimer = null;
  let campaignModalLastFocus = null;
  let campaignClockOffset = 0;
  let campaignListState = [];
  let legacyClaimsState = [];
  let legacySummaryState = { total: 0, issued: 0, requested: 0, redeemed: 0, expired: 0 };
  let emailAudience = "";
  const selectedEmailMembers = new Map();
  let emailMemberSearchTimer = null;
  let campaignShareState = null;
  let campaignShareLastFocus = null;
  let campaignShareRenderPromise = null;
  let inventoryItems = [];
  let inventorySearchTimer = null;
  let inventoryRequestSequence = 0;
  let inventoryModalLastFocus = null;
  let editingInventoryId = "";
  let campaignInventoryOptions = [];
  let campaignInventorySearchTimer = null;
  let campaignInventoryActiveIndex = -1;
  let campaignInventoryRequestSequence = 0;
  let selectedTrackingMember = null;
  let trackingMemberSearchTimer = null;
  let trackingOrderSearchTimer = null;
  let streamConfigState = null;
  const menuButton = $(".menu-toggle");
  const navigation = $("#admin-site-nav");
  menuButton?.addEventListener("click", () => {
    const open = navigation?.classList.toggle("is-open") ?? false;
    menuButton.setAttribute("aria-expanded", String(open));
  });
  navigation?.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
    navigation.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
  }));
  function openMasterSection(section) {
    document.querySelectorAll("[data-master-section]").forEach(node => { node.hidden = node.dataset.masterSection !== section; });
    document.querySelectorAll("[data-master-section-button]").forEach(button => {
      const active = button.dataset.masterSectionButton === section;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    if (section === "signups") refreshCampaigns().catch(error => showStatus(error.message, "error"));
    if (section === "redeemed") Promise.all([refreshDashboard(), refreshCampaigns()]).catch(error => showStatus(error.message, "error"));
    if (section === "inventory") refreshInventory().catch(error => setInventoryStatus(error.message, "error"));
    if (section === "tracking") Promise.all([searchTrackingMembers(), refreshAdminOrders()]).catch(error => setTrackingStatus(error.message, "error"));
    if (section === "identity") refreshIdentityReviews().catch(error => setIdentityReviewStatus(error.message, "error"));
    if (section === "sellers") refreshAdminReorders().catch(error => setAdminReordersStatus(error.message, "error"));
    if (section === "streaming") refreshStreamConfig().catch(error => setStreamConfigStatus(error.message, "error"));
  }

  const request = async (path, options = {}) => {
    const response = await fetch(`${api}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(memberToken ? { Authorization: `Bearer ${memberToken}` } : {}),
        ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "The owner dashboard request failed.");
      error.status = response.status;
      if (adminToken && path.startsWith("/admin/") && !path.startsWith("/admin/auth/") && (response.status === 401 || response.status === 403)) {
        requireFreshOwnerVerification();
      }
      throw error;
    }
    return payload;
  };
  const requestBlob = async (path, payload) => {
    const hasPayload = payload !== undefined;
    const response = await fetch(`${api}${path}`, {
      method: "POST",
      headers: {
        ...(hasPayload ? { "Content-Type": "application/json" } : {}),
        ...(memberToken ? { Authorization: `Bearer ${memberToken}` } : {}),
        ...(adminToken ? { "X-Admin-Token": adminToken } : {})
      },
      ...(hasPayload ? { body: JSON.stringify(typeof payload === "string" ? { inviteUrl: payload } : payload) } : {})
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || "The QR code could not be generated.");
      error.status = response.status;
      throw error;
    }
    return response.blob();
  };
  const toBase64url = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromBase64url = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));

  function setIdentityReviewStatus(message = "", kind = "") {
    const node = $("[data-identity-review-status]");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  }
  async function refreshIdentityReviews() {
    const payload = await request("/admin/identity-reviews");
    const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    const list = $("[data-identity-review-list]");
    list.replaceChildren();
    if (!reviews.length) {
      const empty = document.createElement("div"); empty.className = "inventory-empty"; empty.textContent = "No identity collisions are waiting for review."; list.append(empty);
      setIdentityReviewStatus("Identity queue is clear.", "success");
      return;
    }
    reviews.forEach(review => {
      const card = document.createElement("article"); card.className = "admin-result-card";
      const heading = document.createElement("h3"); heading.textContent = review.live_username ? `@${review.live_username}` : review.email;
      const detail = document.createElement("p"); detail.textContent = `${review.first_name || ""} ${review.last_name || ""} · DOB ${review.birth_date || "not supplied"} · ${review.email}`.trim();
      const collision = document.createElement("p"); collision.textContent = `Collision: ${review.reason} · existing ${review.conflicting_username ? `@${review.conflicting_username}` : review.conflicting_email || "account"}`;
      const actions = document.createElement("div"); actions.className = "admin-result-actions";
      const approve = document.createElement("button"); approve.type = "button"; approve.className = "btn btn-primary btn-small"; approve.dataset.identityDecision = "approve"; approve.dataset.reviewId = review.id; approve.textContent = "Approve account";
      const approveSeller = document.createElement("button"); approveSeller.type = "button"; approveSeller.className = "btn btn-primary btn-small"; approveSeller.dataset.identityDecision = "approve_seller"; approveSeller.dataset.reviewId = review.id; approveSeller.textContent = "Approve as normal Seller (one available)";
      const reject = document.createElement("button"); reject.type = "button"; reject.className = "btn btn-danger btn-small"; reject.dataset.identityDecision = "reject"; reject.dataset.reviewId = review.id; reject.textContent = "Reject account";
      actions.append(approve, approveSeller, reject); card.append(heading, detail, collision, actions); list.append(card);
    });
    setIdentityReviewStatus(`${reviews.length} collision${reviews.length === 1 ? "" : "s"} require an owner decision.`);
  }

  function setSellerActivationStatus(message = "", kind = "") {
    const node = $("[data-seller-activation-status]");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  }

  async function createSellerActivation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("[data-seller-activation-submit]");
    const data = new FormData(form);
    submit.disabled = true;
    setSellerActivationStatus("Creating protected activation link...");
    try {
      const result = await request("/admin/sellers/activation", {
        method: "POST",
        body: JSON.stringify({ email: data.get("email"), note: data.get("note") })
      });
      $("[data-seller-activation-url]").value = result.activationUrl;
      $("[data-seller-activation-expires]").textContent = new Date(result.expiresAt).toLocaleString();
      $("[data-seller-activation-result]").hidden = false;
      setSellerActivationStatus("Activation link created. It can be used once by the matching account.", "success");
    } catch (error) {
      setSellerActivationStatus(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  }

  function setAdminReordersStatus(message = "", kind = "") { const node = $("[data-admin-reorders-status]"); if (node) { node.textContent = message; node.dataset.kind = kind; } }
  function setStreamConfigStatus(message = "", kind = "") { const node = $("[data-stream-config-status]"); if (node) { node.textContent = message; node.dataset.kind = kind; } }
  function setStreamConfigForm(payload) {
    streamConfigState = payload;
    const config = payload?.config || {};
    const form = $("[data-stream-config-form]");
    if (!form) return;
    form.deliveryMinutesPerCredit.value = config.deliveryMinutesPerCredit ?? 1000;
    form.storageMinutesPerCredit.value = config.storageMinutesPerCredit ?? 200;
    form.replayReservePercentage.value = config.replayReservePercentage ?? 0.10;
    form.safetyBufferPercentage.value = config.safetyBufferPercentage ?? 0.20;
    form.recordingRetentionDays.value = config.recordingRetentionDays ?? 90;
    form.finalizationDelayHours.value = config.finalizationDelayHours ?? 72;
    form.streamCreditUnderlyingValue.value = config.streamCreditUnderlyingValue ?? 1;
    form.prepaidExtraCreditPrice.value = config.prepaidExtraCreditPrice ?? 1.85;
    form.paygOveragePrice.value = config.paygOveragePrice ?? 2.25;
    form.unusedCreditRebateRate.value = config.unusedCreditRebateRate ?? 1;
    form.cashOutThreshold.value = config.cashOutThreshold ?? 25;
    form.spendingLimitDefault.value = config.spendingLimitDefault ?? 250;
    const planByCode = Object.fromEntries((payload?.plans || []).map(plan => [String(plan.code || "").toLowerCase(), plan]));
    form.starterPrice.value = planByCode.starter?.monthlyPrice ?? 49;
    form.starterCredits.value = planByCode.starter?.includedCredits ?? 30;
    form.growthPrice.value = planByCode.growth?.monthlyPrice ?? 109;
    form.growthCredits.value = planByCode.growth?.includedCredits ?? 65;
    form.proPrice.value = planByCode.pro?.monthlyPrice ?? 219;
    form.proCredits.value = planByCode.pro?.includedCredits ?? 130;
    form.powerPrice.value = planByCode.power?.monthlyPrice ?? 439;
    form.powerCredits.value = planByCode.power?.includedCredits ?? 260;
  }
  async function refreshStreamConfig() {
    const payload = await request("/admin/stream-credits/config");
    setStreamConfigForm(payload);
    setStreamConfigStatus(`Loaded pricing version${payload.config?.effectiveAt ? ` effective ${new Date(payload.config.effectiveAt).toLocaleString()}` : ""}.`, "success");
  }
  async function saveStreamConfig(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const configPayload = {
      deliveryMinutesPerCredit: Number(data.get("deliveryMinutesPerCredit") || 0),
      storageMinutesPerCredit: Number(data.get("storageMinutesPerCredit") || 0),
      replayReservePercentage: Number(data.get("replayReservePercentage") || 0),
      safetyBufferPercentage: Number(data.get("safetyBufferPercentage") || 0),
      recordingRetentionDays: Number(data.get("recordingRetentionDays") || 0),
      finalizationDelayHours: Number(data.get("finalizationDelayHours") || 0),
      streamCreditUnderlyingValue: Number(data.get("streamCreditUnderlyingValue") || 0),
      prepaidExtraCreditPrice: Number(data.get("prepaidExtraCreditPrice") || 0),
      paygOveragePrice: Number(data.get("paygOveragePrice") || 0),
      unusedCreditRebateRate: Number(data.get("unusedCreditRebateRate") || 0),
      cashOutThreshold: Number(data.get("cashOutThreshold") || 0),
      spendingLimitDefault: Number(data.get("spendingLimitDefault") || 0)
    };
    const plans = [
      { code: "starter", name: "Starter", monthlyPrice: Number(data.get("starterPrice") || 0), includedCredits: Number(data.get("starterCredits") || 0), sortOrder: 1, isPublic: true },
      { code: "growth", name: "Growth", monthlyPrice: Number(data.get("growthPrice") || 0), includedCredits: Number(data.get("growthCredits") || 0), sortOrder: 2, isPublic: true },
      { code: "pro", name: "Pro", monthlyPrice: Number(data.get("proPrice") || 0), includedCredits: Number(data.get("proCredits") || 0), sortOrder: 3, isPublic: true },
      { code: "power", name: "Power", monthlyPrice: Number(data.get("powerPrice") || 0), includedCredits: Number(data.get("powerCredits") || 0), sortOrder: 4, isPublic: true },
      { code: "enterprise", name: "Enterprise", monthlyPrice: null, includedCredits: null, sortOrder: 5, isPublic: true }
    ];
    setStreamConfigStatus("Saving a new versioned pricing set...");
    try {
      await request("/admin/stream-credits/config", { method: "POST", body: JSON.stringify({ config: configPayload, plans, notes: data.get("notes") }) });
      setStreamConfigStatus("New streaming-pricing version saved.", "success");
      await refreshStreamConfig();
    } catch (error) {
      setStreamConfigStatus(error.message, "error");
    }
  }
  async function refreshAdminReorders() {
    const payload = await request("/admin/reorders"); const rows = payload.reorders || []; const list = $("[data-admin-reorders-list]"); list.replaceChildren();
    if (!rows.length) { const empty = document.createElement("div"); empty.className = "inventory-empty"; empty.textContent = "No seller reorders are waiting."; list.append(empty); return; }
    rows.forEach(row => {
      const card = document.createElement("article"); card.className = "admin-result-card";
      const title = document.createElement("h3"); title.textContent = row.product_name;
      const detail = document.createElement("p"); detail.textContent = `${row.live_username ? `@${row.live_username}` : row.email} · ${Number(row.requested_quantity)} ${row.unit_type} · PAR ${Number(row.par_quantity)} · stock trigger ${Number(row.trigger_quantity)}`;
      const actions = document.createElement("div"); actions.className = "admin-result-actions";
      [["approved","Approve"],["ordered","Mark ordered"],["rejected","Reject"]].forEach(([status,label]) => { const button = document.createElement("button"); button.type = "button"; button.className = status === "rejected" ? "btn btn-danger btn-small" : "btn btn-outline btn-small"; button.dataset.reorderId = row.id; button.dataset.reorderStatus = status; button.textContent = label; actions.append(button); });
      card.append(title, detail, actions); list.append(card);
    });
    setAdminReordersStatus(`${rows.length} seller reorder request${rows.length === 1 ? "" : "s"} waiting.`);
  }

  function initializeTurnstile() {
    const node = $("[data-admin-turnstile]");
    if (!node || !config.turnstileSiteKey) return;
    window.cpAdminTurnstileReady = () => window.turnstile.render(node, {
      sitekey: config.turnstileSiteKey,
      theme: "dark",
      callback: value => { turnstileToken = value; const button = $("[data-admin-send]"); button.disabled = false; button.textContent = "Send owner login link"; showStatus(""); },
      "expired-callback": () => { turnstileToken = ""; const button = $("[data-admin-send]"); button.disabled = true; button.textContent = "Complete security check"; },
      "error-callback": code => showStatus(`Security check unavailable${code ? ` (${code})` : ""}.`, "error")
    });
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=cpAdminTurnstileReady&render=explicit";
    script.async = true; script.defer = true; document.head.append(script);
  }

  async function confirmMagicLink() {
    if (!verificationToken) return;
    const data = await request("/auth/verify-link", { method: "POST", body: JSON.stringify({ token: verificationToken }) });
    memberToken = data.token; localStorage.setItem("cp_rewards_token", memberToken);
    history.replaceState({}, document.title, location.pathname);
    showStatus("Owner email verified. Confirm your registered passkey.", "success");
  }

  async function stepUp() {
    if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("This browser does not support passkeys.");
    const options = await request("/admin/auth/options", { method: "POST" });
    options.challenge = fromBase64url(options.challenge);
    options.allowCredentials = (options.allowCredentials || []).map(item => ({ ...item, id: fromBase64url(item.id) }));
    const credential = await navigator.credentials.get({ publicKey: options });
    const payload = {
      id: credential.id, rawId: toBase64url(credential.rawId), type: credential.type,
      response: {
        clientDataJSON: toBase64url(credential.response.clientDataJSON),
        authenticatorData: toBase64url(credential.response.authenticatorData),
        signature: toBase64url(credential.response.signature),
        userHandle: credential.response.userHandle ? toBase64url(credential.response.userHandle) : null
      },
      clientExtensionResults: credential.getClientExtensionResults()
    };
    const verified = await request("/admin/auth/verify", { method: "POST", body: JSON.stringify(payload) });
    adminToken = verified.adminToken; sessionStorage.setItem("cp_admin_token", adminToken);
  }

  const countdownLabel = milliseconds => {
    const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
  };
  function setOwnerReferralActionsEnabled(enabled) {
    ["[data-owner-referral-copy]", "[data-owner-referral-download]", "[data-owner-referral-share]"].forEach(selector => {
      const button = $(selector);
      if (button) button.disabled = !enabled;
    });
    const toggle = $("[data-owner-referral-toggle]");
    if (toggle) toggle.disabled = !adminToken || !ownerReferralState;
  }
  function clearOwnerReferralDisplay(message = "Verify the owner passkey to load the current window.") {
    clearTimeout(ownerReferralTimer);
    clearInterval(ownerReferralCountdownTimer);
    ownerReferralState = null;
    ownerReferralQrInviteUrl = "";
    const input = $("[data-owner-referral-url]");
    if (input) input.value = "";
    const windowNode = $("[data-owner-referral-window]");
    if (windowNode) windowNode.textContent = message;
    const countdownNode = $("[data-owner-referral-countdown]");
    if (countdownNode) countdownNode.textContent = "";
    const expiresNode = $("[data-owner-referral-expires]");
    if (expiresNode) expiresNode.textContent = "—";
    const image = $("[data-owner-referral-qr]");
    if (image) image.removeAttribute("src");
    if (ownerReferralQrUrl) URL.revokeObjectURL(ownerReferralQrUrl);
    ownerReferralQrUrl = "";
    setOwnerReferralActionsEnabled(false);
  }
  function requireFreshOwnerVerification() {
    sessionStorage.removeItem("cp_admin_token");
    adminToken = "";
    clearOwnerReferralDisplay("Owner verification expired.");
    show("[data-admin-dashboard]", false);
    show("[data-admin-step-up]", true);
  }
  function updateOwnerReferralCountdown() {
    if (!ownerReferralState?.expiresAt) return;
    const remaining = Date.parse(ownerReferralState.expiresAt) - (Date.now() + ownerReferralClockOffset);
    $("[data-owner-referral-countdown]").textContent = countdownLabel(remaining);
    if (remaining <= 0) setOwnerReferralActionsEnabled(false);
  }
  async function loadOwnerReferralQr(inviteUrl) {
    if (!inviteUrl || inviteUrl === ownerReferralQrInviteUrl) return;
    const image = $("[data-owner-referral-qr]");
    let nextUrl = "";
    image.classList.add("is-loading");
    image.removeAttribute("src");
    try {
      nextUrl = URL.createObjectURL(await requestBlob("/admin/referral/qr", inviteUrl));
      image.src = nextUrl;
      if (image.decode) await image.decode();
      if (ownerReferralQrUrl) URL.revokeObjectURL(ownerReferralQrUrl);
      ownerReferralQrUrl = nextUrl;
      ownerReferralQrInviteUrl = inviteUrl;
    } catch (error) {
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      throw error;
    } finally {
      image.classList.remove("is-loading");
    }
  }
  async function renderOwnerReferral(data) {
    if (!data?.url || !data?.expiresAt || !data?.serverNow) throw new Error("The current owner referral response was incomplete.");
    await loadOwnerReferralQr(data.url);
    ownerReferralState = data;
    ownerReferralClockOffset = Date.parse(data.serverNow) - Date.now();
    $("[data-owner-referral-url]").value = data.url;
    $("[data-owner-referral-window]").textContent = data.windowLabel;
    $("[data-owner-referral-expires]").textContent = data.nextBoundaryLabel;
    const isActive = data.isActive !== false;
    const toggle = $("[data-owner-referral-toggle]");
    toggle.textContent = isActive ? "Turn Off Current QR" : "Turn On Current QR";
    toggle.classList.toggle("btn-danger", isActive);
    toggle.classList.toggle("btn-primary", !isActive);
    $("[data-owner-referral-qr-status]").textContent = isActive ? "ACTIVE QR" : "QR TURNED OFF";
    $("[data-owner-referral]").classList.toggle("is-qr-disabled", !isActive);
    clearTimeout(ownerReferralTimer);
    clearInterval(ownerReferralCountdownTimer);
    updateOwnerReferralCountdown();
    ownerReferralCountdownTimer = setInterval(updateOwnerReferralCountdown, 30000);
    const delay = Math.max(1000, Date.parse(data.expiresAt) - Date.parse(data.serverNow) + 1200);
    ownerReferralTimer = setTimeout(() => refreshOwnerReferral({ announce: true }).catch(() => {}), delay);
    setOwnerReferralActionsEnabled(isActive);
  }
  async function toggleOwnerReferral() {
    if (!ownerReferralState) await refreshOwnerReferral();
    const active = ownerReferralState?.isActive !== false;
    if (active && !confirm("Turn off the current owner referral QR? Every saved copy and link for this 12-hour window will stop accepting signups immediately.")) return;
    const button = $("[data-owner-referral-toggle]");
    button.disabled = true;
    try {
      const data = await request("/admin/referral/status", { method: "POST", body: JSON.stringify({ active: !active }) });
      await renderOwnerReferral(data.current);
      showStatus(!active ? "Current owner referral QR turned on." : "Current owner referral QR turned off. Saved copies and links are now blocked.", "success");
    } finally {
      button.disabled = false;
    }
  }
  async function refreshOwnerReferral({ announce = false } = {}) {
    if (!memberToken || !adminToken) throw new Error("Verify the owner passkey to load the current referral.");
    if (ownerReferralRefreshPromise) return ownerReferralRefreshPromise;
    const previousUrl = ownerReferralState?.url || "";
    setOwnerReferralActionsEnabled(false);
    ownerReferralRefreshPromise = (async () => {
      const data = await request("/admin/referral/current");
      await renderOwnerReferral(data);
      if (announce && previousUrl && previousUrl !== data.url) showStatus("The new 12-hour owner referral link and QR are active.", "success");
      return data;
    })().catch(error => {
      clearOwnerReferralDisplay(error.status === 401 || error.status === 403 ? "Owner verification expired." : "Current referral unavailable. Refresh to retry.");
      if (error.status === 401 || error.status === 403) {
        requireFreshOwnerVerification();
        showStatus("Owner verification expired. Confirm your passkey again before copying or downloading a referral.", "error");
      } else {
        showStatus(error.message, "error");
        if (adminToken) ownerReferralTimer = setTimeout(() => refreshOwnerReferral().catch(() => {}), 60000);
      }
      throw error;
    }).finally(() => { ownerReferralRefreshPromise = null; });
    return ownerReferralRefreshPromise;
  }
  async function ensureCurrentOwnerReferral() {
    if (ownerReferralRefreshPromise) await ownerReferralRefreshPromise;
    return refreshOwnerReferral({ announce: Boolean(ownerReferralState) });
  }
  async function copyOwnerReferral() {
    await ensureCurrentOwnerReferral();
    if (ownerReferralState?.isActive === false) throw new Error("Turn the current owner referral QR on before copying its link.");
    const value = $("[data-owner-referral-url]").value;
    if (!value) throw new Error("The current owner referral is not ready.");
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const input = $("[data-owner-referral-url]"); input.focus(); input.select();
      if (!document.execCommand("copy")) throw new Error("Copy was blocked by this browser.");
      input.setSelectionRange(0, 0);
    }
    showStatus(`Current owner referral copied. It changes at ${ownerReferralState.nextBoundaryLabel}.`, "success");
  }
  async function qrPngBlob(image) {
    if (image.decode) await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 1200;
    const context = canvas.getContext("2d"); context.fillStyle = "#ffffff"; context.fillRect(0, 0, 1200, 1200); context.drawImage(image, 0, 0, 1200, 1200);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The QR PNG could not be prepared.")), "image/png"));
  }
  async function downloadOwnerReferral(button) {
    button.disabled = true; const original = button.textContent; button.textContent = "Preparing current QR...";
    try {
      await ensureCurrentOwnerReferral();
      if (ownerReferralState?.isActive === false) throw new Error("Turn the current owner referral QR on before downloading it.");
      const image = $("[data-owner-referral-qr]");
      if (!image.src) throw new Error("The current owner QR is not ready.");
      const blobUrl = URL.createObjectURL(await qrPngBlob(image));
      const link = document.createElement("a"); link.href = blobUrl; link.download = "crack-packs-owner-referral-current-12h.png";
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showStatus("The current 12-hour owner QR was downloaded.", "success");
    } finally {
      button.textContent = original;
      button.disabled = !ownerReferralState || !adminToken;
    }
  }

  const pick = (object, ...keys) => {
    for (const key of keys) if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
    return null;
  };
  const formatMoney = centsValue => centsValue === null || centsValue === undefined || !Number.isFinite(Number(centsValue)) ? "Not configured" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(centsValue) / 100);
  const moneyInputValue = centsValue => centsValue === null || centsValue === undefined || !Number.isFinite(Number(centsValue)) ? "" : (Number(centsValue) / 100).toFixed(2);
  const optionalInputNumber = value => value === null || value === undefined || value === "" ? "" : String(value);
  const pricingFloor = (components, denominatorPermille) => components.every(value => Number.isFinite(value) && value >= 0)
    ? Math.ceil((components.reduce((total, value) => total + value, 0) * 1000) / denominatorPermille)
    : null;
  const channelPricingFromValues = values => ({
    retail: pricingFloor([values.cogs, values.overhead, values.retailFixedFee], 723),
    websiteUs: pricingFloor([values.cogs, values.usShipping, values.packaging, values.overhead, 30], 771),
    websiteInternational: pricingFloor([values.cogs, values.packaging, values.overhead, 30], 771),
    live: pricingFloor([values.cogs, values.packaging, values.overhead, 30], 700),
    wholesaleSmall: pricingFloor([values.cogs, values.wholesaleHandling], 850),
    wholesaleCase: pricingFloor([values.cogs, values.wholesaleHandling], 880),
    wholesalePallet: pricingFloor([values.cogs, values.wholesaleHandling], 900)
  });
  function setInventoryStatus(message = "", kind = "") {
    const node = $("[data-inventory-status]");
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
  }
  function setInventoryFormStatus(message = "", kind = "") {
    const node = $("[data-inventory-form-status]");
    node.textContent = message;
    node.dataset.kind = kind;
  }
  function renderInventory() {
    const container = $("[data-inventory-list]");
    container.replaceChildren();
    const filter = $("[data-inventory-status-filter]").value;
    const visible = inventoryItems.filter(item => {
      if (filter === "active") return item.isActive;
      if (filter === "inactive") return !item.isActive;
      if (filter === "in_stock") return item.isActive && Number(item.quantity || 0) > 0;
      if (filter === "needs_pricing") return item.channelPricing?.prices?.websiteUs === null || item.channelPricing?.prices?.retail === null || item.channelPricing?.prices?.live === null;
      return true;
    });
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "inventory-empty";
      const heading = document.createElement("strong");
      heading.textContent = inventoryItems.length ? "No products match this view." : "Inventory is empty.";
      const detail = document.createElement("span");
      detail.textContent = inventoryItems.length ? "Change the filter or search for another name or UPC." : "Add a product or import the researched starter catalog. Imported items begin with zero stock until you enter your actual quantity and costs.";
      empty.append(heading, detail);
      container.append(empty);
      return;
    }
    visible.forEach(item => {
      const card = document.createElement("article");
      card.className = `inventory-card${item.isActive ? "" : " is-inactive"}`;
      const head = document.createElement("div");
      head.className = "inventory-card-head";
      const identity = document.createElement("div");
      const category = document.createElement("span");
      category.className = "inventory-category";
      category.textContent = item.category || "Uncategorized";
      const title = document.createElement("h3");
      title.textContent = item.name || "Unnamed product";
      const code = document.createElement("p");
      code.textContent = item.upc ? `UPC ${item.upc}` : "UPC not entered";
      identity.append(category, title, code);
      const state = document.createElement("span");
      state.className = `inventory-state ${item.isActive ? item.campaignReady ? "ready" : "empty" : "inactive"}`;
      state.textContent = item.isActive ? item.campaignReady ? "Campaign ready" : Number(item.quantity || 0) > 0 ? "Fully reserved" : "No stock" : "Deactivated";
      head.append(identity, state);

      const metrics = document.createElement("div");
      metrics.className = "inventory-card-metrics";
      [["On hand", String(Number(item.quantity || 0))], ["Campaign reserved", String(Number(item.committedUnits || 0))], ["Reference", formatMoney(item.averageMsrpCents)], ["Retail", formatMoney(item.channelPricing?.prices?.retail)], ["USA website", formatMoney(item.channelPricing?.prices?.websiteUs)], ["Live auction", formatMoney(item.channelPricing?.prices?.live)], ["Wholesale small", formatMoney(item.channelPricing?.prices?.wholesaleSmall)], ["Case", formatMoney(item.channelPricing?.prices?.wholesaleCase)], ["Pallet / large", formatMoney(item.channelPricing?.prices?.wholesalePallet)]].forEach(([labelText, valueText]) => {
        const metric = document.createElement("div");
        const label = document.createElement("span"); label.textContent = labelText;
        const value = document.createElement("strong"); value.textContent = valueText;
        metric.append(label, value); metrics.append(metric);
      });

      const details = document.createElement("p");
      details.className = "inventory-card-detail";
      const packageParts = [item.weightOz ? `${item.weightOz} oz` : "", item.lengthIn && item.widthIn && item.heightIn ? `${item.lengthIn} × ${item.widthIn} × ${item.heightIn} in` : ""].filter(Boolean);
      details.textContent = [item.isStoreVisible ? "Store visible" : "Hidden from store", packageParts.length ? packageParts.join(" · ") : "Package details incomplete", item.updatedAt ? `Updated ${new Date(item.updatedAt).toLocaleDateString()}` : ""].filter(Boolean).join(" · ");

      const actions = document.createElement("div");
      actions.className = "inventory-card-actions";
      if (item.sourceUrl) {
        const source = document.createElement("a");
        source.className = "btn btn-outline btn-small";
        source.href = item.sourceUrl;
        source.target = "_blank";
        source.rel = "noopener noreferrer";
        source.textContent = "View price source";
        actions.append(source);
      }
      const edit = document.createElement("button");
      edit.className = "btn btn-primary btn-small"; edit.type = "button"; edit.textContent = "Edit Product";
      edit.addEventListener("click", () => openInventoryModal(item));
      const toggle = document.createElement("button");
      toggle.className = `btn ${item.isActive ? "btn-danger" : "btn-outline"} btn-small`; toggle.type = "button"; toggle.textContent = item.isActive ? "Deactivate" : "Reactivate";
      toggle.addEventListener("click", () => toggleInventoryItem(item, toggle));
      actions.append(edit, toggle);
      card.append(head, metrics, details, actions);
      container.append(card);
    });
  }
  async function refreshInventory({ announce = false } = {}) {
    if (!memberToken || !adminToken) return;
    const sequence = ++inventoryRequestSequence;
    const query = encodeURIComponent($("[data-inventory-search]").value.trim());
    const data = await request(`/admin/inventory?q=${query}`);
    if (sequence !== inventoryRequestSequence) return;
    inventoryItems = Array.isArray(data.inventory) ? data.inventory : [];
    renderInventory();
    if (announce) setInventoryStatus(`${inventoryItems.length} inventory product${inventoryItems.length === 1 ? "" : "s"} loaded.`, "success");
  }
  const setInventoryField = (form, name, value) => { const input = form.elements.namedItem(name); if (input) input.value = value ?? ""; };
  function updateInventoryPricePreview() {
    const form = $("[data-inventory-form]");
    const readMoney = name => {
      const raw = String(form.elements.namedItem(name)?.value || "").trim();
      return raw === "" || !Number.isFinite(Number(raw)) ? null : Math.round(Number(raw) * 100);
    };
    const floors = channelPricingFromValues({
      cogs: readMoney("cogs"),
      usShipping: readMoney("usShipping"),
      packaging: readMoney("packaging"),
      overhead: readMoney("overhead"),
      retailFixedFee: readMoney("retailFixedFee"),
      wholesaleHandling: readMoney("wholesaleHandling")
    });
    const previewFields = {
      retail: "[data-inventory-retail-floor]",
      websiteUs: "[data-inventory-website-floor]",
      websiteInternational: "[data-inventory-international-floor]",
      live: "[data-inventory-live-floor]",
      wholesaleSmall: "[data-inventory-wholesale-small-floor]",
      wholesaleCase: "[data-inventory-wholesale-case-floor]",
      wholesalePallet: "[data-inventory-wholesale-pallet-floor]"
    };
    Object.entries(previewFields).forEach(([channel, selector]) => { $(selector).textContent = floors[channel] === null ? "Needs cost inputs" : formatMoney(floors[channel]); });
    const overrideFields = {
      retail: "retailListPrice",
      websiteUs: "websiteListPrice",
      websiteInternational: "internationalListPrice",
      live: "liveListPrice",
      wholesaleSmall: "wholesaleSmallListPrice",
      wholesaleCase: "wholesaleCaseListPrice",
      wholesalePallet: "wholesalePalletListPrice"
    };
    Object.entries(overrideFields).forEach(([channel, name]) => {
      const input = form.elements.namedItem(name);
      const override = readMoney(name);
      input.min = floors[channel] === null ? "0" : (floors[channel] / 100).toFixed(2);
      input.setCustomValidity(override === null ? "" : floors[channel] === null
        ? "Enter every required channel cost before setting a list price."
        : override < floors[channel] ? `Enter at least ${formatMoney(floors[channel])} for this channel.` : "");
    });
    $("[data-inventory-deactivate-note]").hidden = form.elements.namedItem("isActive").checked;
  }
  function openInventoryModal(item = null) {
    inventoryModalLastFocus = document.activeElement;
    editingInventoryId = String(item?.id || "");
    const form = $("[data-inventory-form]");
    form.reset();
    setInventoryFormStatus("");
    form.elements.namedItem("storeTarget").value = item ? "seller_store" : "buyer_store";
    setInventoryField(form, "id", editingInventoryId);
    setInventoryField(form, "name", item?.name || "");
    setInventoryField(form, "upc", item?.upc || "");
    setInventoryField(form, "category", item?.category || "");
    setInventoryField(form, "quantity", item ? Number(item.quantity || 0) : 0);
    setInventoryField(form, "imageUrl", item?.imageUrl || "");
    setInventoryField(form, "description", item?.description || "");
    setInventoryField(form, "averageMsrp", moneyInputValue(item?.averageMsrpCents));
    setInventoryField(form, "referencePriceLabel", item?.referencePriceLabel || "Retail reference price");
    setInventoryField(form, "referencePriceObservedAt", item?.referencePriceObservedAt || "");
    setInventoryField(form, "sourceUrl", item?.sourceUrl || "");
    setInventoryField(form, "cogs", moneyInputValue(item?.cogsCents));
    setInventoryField(form, "usShipping", moneyInputValue(item?.usShippingCents));
    setInventoryField(form, "packaging", moneyInputValue(item?.packagingCents));
    setInventoryField(form, "overhead", moneyInputValue(item?.overheadCents));
    setInventoryField(form, "retailFixedFee", moneyInputValue(item?.retailFixedFeeCents));
    setInventoryField(form, "wholesaleHandling", moneyInputValue(item?.wholesaleHandlingCents));
    setInventoryField(form, "retailListPrice", moneyInputValue(item?.retailListPriceCents));
    setInventoryField(form, "websiteListPrice", moneyInputValue(item?.websiteListPriceCents));
    setInventoryField(form, "internationalListPrice", moneyInputValue(item?.internationalListPriceCents));
    setInventoryField(form, "liveListPrice", moneyInputValue(item?.liveListPriceCents));
    setInventoryField(form, "series", item?.series || "pokemon");
    setInventoryField(form, "wholesaleSmallListPrice", moneyInputValue(item?.wholesaleSmallListPriceCents));
    setInventoryField(form, "wholesaleCaseListPrice", moneyInputValue(item?.wholesaleCaseListPriceCents));
    setInventoryField(form, "wholesalePalletListPrice", moneyInputValue(item?.wholesalePalletListPriceCents));
    setInventoryField(form, "weightOz", optionalInputNumber(item?.weightOz));
    setInventoryField(form, "lengthIn", optionalInputNumber(item?.lengthIn));
    setInventoryField(form, "widthIn", optionalInputNumber(item?.widthIn));
    setInventoryField(form, "heightIn", optionalInputNumber(item?.heightIn));
    setInventoryField(form, "originCountry", item?.originCountry || "");
    setInventoryField(form, "hsCode", item?.hsCode || "");
    setInventoryField(form, "packingNotes", item?.packingNotes || "");
    form.elements.namedItem("isStoreVisible").checked = item ? item.isStoreVisible !== false : true;
    form.elements.namedItem("isActive").checked = item ? item.isActive !== false : true;
    setInventoryField(form, "buyerTitle", item?.name || "");
    setInventoryField(form, "buyerPrice", moneyInputValue(item?.websiteListPriceCents));
    setInventoryField(form, "buyerCondition", "");
    setInventoryField(form, "buyerDescription", item?.description || "");
    form.elements.namedItem("buyerShippingPayer").value = "buyer";
    form.elements.namedItem("buyerSeries").value = item?.series || "pokemon";
    form.elements.namedItem("buyerSaleType").value = "singles";
    form.elements.namedItem("buyerQuantity").value = item ? Math.max(1, Number(item.quantity || 1)) : 1;
    setInventoryField(form, "buyerImageUrl", item?.imageUrl || "");
    $("[data-inventory-modal-title]").textContent = item ? "Edit inventory product" : "Add an inventory product";
    $("[data-inventory-save]").textContent = item ? "Save Changes" : "Save Product";
    $("[data-inventory-modal]").hidden = false;
    syncInventoryTargetUi();
    updateInventoryPricePreview();
    (form.elements.namedItem(form.elements.namedItem("storeTarget").value === "buyer_store" ? "buyerTitle" : "name"))?.focus();
  }
  function closeInventoryModal() {
    $("[data-inventory-modal]").hidden = true;
    setInventoryFormStatus("");
    inventoryModalLastFocus?.focus?.();
  }
  const inventoryNumber = (form, name) => {
    const raw = String(form.elements.namedItem(name)?.value || "").trim();
    return raw === "" ? null : Number(raw);
  };
  const inventoryMoneyCents = (form, name) => {
    const value = inventoryNumber(form, name);
    return value === null ? null : Math.round(value * 100);
  };
  function syncInventoryTargetUi() {
    const form = $("[data-inventory-form]");
    if (!form) return;
    const buyerStore = String(form.elements.namedItem("storeTarget")?.value || "buyer_store") === "buyer_store";
    document.querySelectorAll("[data-inventory-buyer-simple]").forEach(node => { node.hidden = !buyerStore; });
    document.querySelectorAll("[data-inventory-seller-fields]").forEach(node => { node.hidden = buyerStore; });
    ["name","upc","category","quantity","imageUrl","series","description","averageMsrp","referencePriceLabel","referencePriceObservedAt","sourceUrl","cogs","usShipping","packaging","overhead","retailFixedFee","wholesaleHandling","retailListPrice","websiteListPrice","internationalListPrice","liveListPrice","wholesaleSmallListPrice","wholesaleCaseListPrice","wholesalePalletListPrice","weightOz","lengthIn","widthIn","heightIn","originCountry","hsCode","packingNotes","isStoreVisible","isActive"].forEach(name => {
      const field = form.elements.namedItem(name);
      if (field) field.disabled = buyerStore;
    });
    ["buyerTitle","buyerPrice","buyerCondition","buyerDescription","buyerShippingPayer","buyerSeries","buyerSaleType","buyerQuantity","buyerImageUrl"].forEach(name => {
      const field = form.elements.namedItem(name);
      if (field) field.disabled = !buyerStore;
    });
    form.elements.namedItem("name").required = !buyerStore;
    form.elements.namedItem("quantity").required = !buyerStore;
    form.elements.namedItem("buyerTitle").required = buyerStore;
    form.elements.namedItem("buyerPrice").required = buyerStore;
    form.elements.namedItem("buyerCondition").required = buyerStore;
    form.elements.namedItem("buyerDescription").required = buyerStore;
    $("[data-inventory-modal-title]").textContent = buyerStore ? "Add a Buyer Store product" : (editingInventoryId ? "Edit inventory product" : "Add an inventory product");
    $("[data-inventory-save]").textContent = buyerStore ? "Post to Buyer Store" : (editingInventoryId ? "Save Changes" : "Save Product");
  }
  function inventoryPayloadFromForm(form) {
    return {
      name: String(form.elements.namedItem("name").value || "").trim(),
      upc: String(form.elements.namedItem("upc").value || "").trim(),
      category: String(form.elements.namedItem("category").value || "").trim(),
      series: String(form.elements.namedItem("series").value || "pokemon").trim().toLowerCase(),
      quantity: Number(form.elements.namedItem("quantity").value || 0),
      imageUrl: String(form.elements.namedItem("imageUrl").value || "").trim(),
      description: String(form.elements.namedItem("description").value || "").trim(),
      averageMsrpCents: inventoryMoneyCents(form, "averageMsrp"),
      referencePriceLabel: String(form.elements.namedItem("referencePriceLabel").value || "").trim(),
      referencePriceObservedAt: String(form.elements.namedItem("referencePriceObservedAt").value || ""),
      sourceUrl: String(form.elements.namedItem("sourceUrl").value || "").trim(),
      cogsCents: inventoryMoneyCents(form, "cogs"),
      usShippingCents: inventoryMoneyCents(form, "usShipping"),
      packagingCents: inventoryMoneyCents(form, "packaging"),
      overheadCents: inventoryMoneyCents(form, "overhead"),
      retailFixedFeeCents: inventoryMoneyCents(form, "retailFixedFee"),
      wholesaleHandlingCents: inventoryMoneyCents(form, "wholesaleHandling"),
      retailListPriceCents: inventoryMoneyCents(form, "retailListPrice"),
      websiteListPriceCents: inventoryMoneyCents(form, "websiteListPrice"),
      internationalListPriceCents: inventoryMoneyCents(form, "internationalListPrice"),
      liveListPriceCents: inventoryMoneyCents(form, "liveListPrice"),
      wholesaleSmallListPriceCents: inventoryMoneyCents(form, "wholesaleSmallListPrice"),
      wholesaleCaseListPriceCents: inventoryMoneyCents(form, "wholesaleCaseListPrice"),
      wholesalePalletListPriceCents: inventoryMoneyCents(form, "wholesalePalletListPrice"),
      weightOz: inventoryNumber(form, "weightOz"),
      lengthIn: inventoryNumber(form, "lengthIn"),
      widthIn: inventoryNumber(form, "widthIn"),
      heightIn: inventoryNumber(form, "heightIn"),
    originCountry: String(form.elements.namedItem("originCountry").value || "").trim().toUpperCase(),
      hsCode: String(form.elements.namedItem("hsCode").value || "").trim(),
      packingNotes: String(form.elements.namedItem("packingNotes").value || "").trim(),
      isStoreVisible: form.elements.namedItem("isStoreVisible").checked,
      isActive: form.elements.namedItem("isActive").checked
    };
  }
  function buyerStorePayloadFromForm(form) {
    return {
      title: String(form.elements.namedItem("buyerTitle").value || "").trim(),
      price: inventoryNumber(form, "buyerPrice"),
      condition: String(form.elements.namedItem("buyerCondition").value || "").trim(),
      description: String(form.elements.namedItem("buyerDescription").value || "").trim(),
      shippingPayer: String(form.elements.namedItem("buyerShippingPayer").value || "buyer"),
      series: String(form.elements.namedItem("buyerSeries").value || "pokemon").trim().toLowerCase(),
      saleType: String(form.elements.namedItem("buyerSaleType").value || "singles").trim(),
      quantity: Number(form.elements.namedItem("buyerQuantity").value || 1),
      imageUrl: String(form.elements.namedItem("buyerImageUrl").value || "").trim()
    };
  }
  const inventoryPayloadFromItem = (item, overrides = {}) => ({
    name: item.name, upc: item.upc || "", category: item.category || "", series: item.series || "pokemon", quantity: Number(item.quantity || 0), imageUrl: item.imageUrl || "", description: item.description || "",
    averageMsrpCents: item.averageMsrpCents ?? null, referencePriceLabel: item.referencePriceLabel || "Retail reference price", referencePriceObservedAt: item.referencePriceObservedAt || "", sourceUrl: item.sourceUrl || "",
    cogsCents: item.cogsCents ?? null, usShippingCents: item.usShippingCents ?? null, profitCents: item.profitCents ?? 1000,
    packagingCents: item.packagingCents ?? null, overheadCents: item.overheadCents ?? null, retailFixedFeeCents: item.retailFixedFeeCents ?? null, wholesaleHandlingCents: item.wholesaleHandlingCents ?? null,
    retailListPriceCents: item.retailListPriceCents ?? null, websiteListPriceCents: item.websiteListPriceCents ?? null, internationalListPriceCents: item.internationalListPriceCents ?? null, liveListPriceCents: item.liveListPriceCents ?? null,
    wholesaleSmallListPriceCents: item.wholesaleSmallListPriceCents ?? null, wholesaleCaseListPriceCents: item.wholesaleCaseListPriceCents ?? null, wholesalePalletListPriceCents: item.wholesalePalletListPriceCents ?? null,
    weightOz: item.weightOz ?? null, lengthIn: item.lengthIn ?? null, widthIn: item.widthIn ?? null, heightIn: item.heightIn ?? null,
    originCountry: item.originCountry || "", hsCode: item.hsCode || "", packingNotes: item.packingNotes || "", isStoreVisible: item.isStoreVisible !== false, isActive: item.isActive !== false,
    ...overrides
  });
  async function toggleInventoryItem(item, button) {
    const activate = !item.isActive;
    if (!activate && !confirm(`Deactivate “${item.name}”? It will be removed from new product campaigns and the public catalog, while existing campaign records remain intact.`)) return;
    button.disabled = true;
    button.textContent = activate ? "Reactivating..." : "Deactivating...";
    try {
      await request(`/admin/inventory/${encodeURIComponent(item.id)}`, { method: "POST", body: JSON.stringify(inventoryPayloadFromItem(item, { isActive: activate })) });
      await refreshInventory();
      await refreshCampaignInventory("").catch(() => {});
      closeCampaignInventoryOptions();
      setInventoryStatus(`${item.name} ${activate ? "reactivated" : "deactivated"}.`, "success");
    } catch (error) {
      setInventoryStatus(error.message, "error");
      button.disabled = false;
      button.textContent = activate ? "Reactivate" : "Deactivate";
    }
  }
  async function importStarterInventory() {
    const button = $("[data-inventory-import]");
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Importing...";
    setInventoryStatus("");
    try {
      const data = await request("/admin/inventory/catalog/import", { method: "POST", body: "{}" });
      inventoryRequestSequence += 1;
      inventoryItems = Array.isArray(data.inventory) ? data.inventory : [];
      renderInventory();
      await refreshCampaignInventory("").catch(() => {});
      closeCampaignInventoryOptions();
      const imported = Number(data.imported || 0);
      setInventoryStatus(imported ? `${imported} starter product${imported === 1 ? "" : "s"} imported. Enter your actual stock, COGS, and packed dimensions before selling.` : "The starter catalog is already imported. No duplicates were added.", "success");
    } catch (error) { setInventoryStatus(error.message, "error"); }
    finally { button.disabled = false; button.textContent = original; }
  }
  async function testEasyPost(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Testing...";
    setInventoryStatus("Requesting test-mode carrier rates. No label will be purchased.");
    try {
      const data = await request("/admin/shipping/test", { method: "POST", body: "{}" });
      const rates = Array.isArray(data.rates) ? data.rates : [];
      const cheapest = rates[0];
      const summary = cheapest ? ` Cheapest sample rate: ${cheapest.carrier} ${cheapest.service} at ${formatMoney(cheapest.amountCents)}.` : "";
      setInventoryStatus(`EasyPost test passed in TEST mode. ${rates.length} carrier rate${rates.length === 1 ? "" : "s"} returned.${summary} No label was purchased.`, "success");
    } catch (error) {
      setInventoryStatus(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  const campaignProduct = campaign => pick(campaign, "product") || null;
  const campaignRewardDescription = campaign => {
    const product = campaignProduct(campaign);
    if (product?.name) return `Product — ${String(product.name)}`;
    const supplied = pick(campaign, "rewardDescription", "reward_description", "description");
    if (supplied) return String(supplied);
    const type = String(pick(campaign, "rewardType", "reward_type") || "");
    if (type === "percent") return `${Number(pick(campaign, "percent") || 0)}% off`;
    if (type === "free_shipping") return "Free shipping";
    if (type === "pick_a_pack") return "Free Pack / Pick a Pack";
    if (type === "pack_draft") return "Choose a Pack #";
    if (type === "free_single") return "Free Holographic Single";
    if (type === "product") return "Inventory product";
    return "Campaign reward";
  };
  const campaignIsActive = campaign => pick(campaign, "isActive", "is_active") !== false && Number(pick(campaign, "isActive", "is_active") ?? 1) !== 0;
  const campaignWeeklyError = error => {
    const message = String(error?.message || "");
    if (error?.status === 429 || /weekly|thursday/i.test(message)) return "The weekly campaign limit has been reached. Campaign availability resets Thursday; existing campaigns remain listed below.";
    return message || "The campaign request could not be completed.";
  };
  function updateCampaignCountdowns() {
    document.querySelectorAll("[data-campaign-expires-at]").forEach(node => {
      if (node.dataset.campaignNeverExpires === "true") {
        node.textContent = "No expiration";
        return;
      }
      const expiresAt = node.dataset.campaignExpiresAt;
      const remaining = Date.parse(expiresAt) - (Date.now() + campaignClockOffset);
      node.textContent = remaining <= 0 ? `Expired ${new Date(expiresAt).toLocaleString()}` : `${countdownLabel(remaining)} - ${new Date(expiresAt).toLocaleString()}`;
      const card = node.closest("[data-campaign-card]");
      if (card && remaining <= 0) {
        card.classList.add("is-expired");
        const chip = card.querySelector("[data-campaign-status]");
        if (chip) { chip.textContent = "Expired"; chip.className = "campaign-status-chip expired"; }
        card.querySelectorAll(".campaign-redemption .btn").forEach(button => button.remove());
      }
    });
    document.querySelectorAll("[data-admin-claim-expires-at]").forEach(node => {
      if (node.dataset.adminClaimNeverExpires === "true") { node.textContent = "No expiration"; return; }
      const expiresAt = node.dataset.adminClaimExpiresAt;
      const remaining = Date.parse(expiresAt) - (Date.now() + campaignClockOffset);
      node.textContent = remaining <= 0 ? `Expired ${new Date(expiresAt).toLocaleString()}` : `${countdownLabel(remaining)} - expires ${new Date(expiresAt).toLocaleString()}`;
    });
  }
  function startCampaignCountdowns() {
    clearInterval(campaignCountdownTimer);
    updateCampaignCountdowns();
    campaignCountdownTimer = setInterval(updateCampaignCountdowns, 30000);
  }
  function setCampaignFormStatus(message = "", kind = "") {
    const node = $("[data-campaign-form-status]");
    node.textContent = message;
    node.dataset.kind = kind;
  }
  function closeCampaignInventoryOptions() {
    const input = $("[data-campaign-inventory-search]");
    const list = $("[data-campaign-inventory-options]");
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    campaignInventoryActiveIndex = -1;
  }
  function activateCampaignInventoryOption(index) {
    const buttons = [...$("[data-campaign-inventory-options]").querySelectorAll("[role='option']")];
    if (!buttons.length) return;
    campaignInventoryActiveIndex = Math.max(0, Math.min(index, buttons.length - 1));
    buttons.forEach((button, optionIndex) => {
      const active = optionIndex === campaignInventoryActiveIndex;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const active = buttons[campaignInventoryActiveIndex];
    $("[data-campaign-inventory-search]").setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  }
  function selectCampaignInventory(item) {
    const input = $("[data-campaign-inventory-search]");
    const hidden = $("[data-campaign-inventory-id]");
    input.value = item.name;
    hidden.value = item.id;
    const available = Number(item.availableQuantity ?? item.quantity ?? 0);
    $("[data-campaign-inventory-selection]").textContent = `${item.name}${item.upc ? ` · UPC ${item.upc}` : ""} · ${available} on hand`;
    const maxInput = $("[data-campaign-form] input[name='maxRedemptions']");
    maxInput.max = String(Math.min(500, Math.max(1, available)));
    if (Number(maxInput.value) > available) maxInput.value = String(available);
    closeCampaignInventoryOptions();
  }
  function clearCampaignInventorySelection(message = "Choose an active product with available stock.") {
    $("[data-campaign-inventory-id]").value = "";
    $("[data-campaign-inventory-selection]").textContent = message;
    $("[data-campaign-form] input[name='maxRedemptions']").max = "500";
  }
  function renderCampaignInventoryOptions({ open = true } = {}) {
    const list = $("[data-campaign-inventory-options]");
    const input = $("[data-campaign-inventory-search]");
    list.replaceChildren();
    campaignInventoryActiveIndex = -1;
    if (!campaignInventoryOptions.length) {
      const empty = document.createElement("div");
      empty.className = "inventory-combobox-empty";
      empty.textContent = "No active in-stock products match. Add stock in Inventory first.";
      list.append(empty);
    } else {
      campaignInventoryOptions.forEach((item, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.id = `campaign-inventory-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        const identity = document.createElement("span");
        const name = document.createElement("strong"); name.textContent = item.name;
        const meta = document.createElement("small"); meta.textContent = [item.upc ? `UPC ${item.upc}` : "No UPC", item.category || "Uncategorized"].join(" · ");
        identity.append(name, meta);
        const stock = document.createElement("b"); stock.textContent = `${Number(item.availableQuantity ?? item.quantity ?? 0)} available`;
        option.append(identity, stock);
        option.addEventListener("pointerdown", event => event.preventDefault());
        option.addEventListener("click", () => selectCampaignInventory(item));
        list.append(option);
      });
    }
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  }
  async function refreshCampaignInventory(query = null) {
    if (!memberToken || !adminToken) return;
    const sequence = ++campaignInventoryRequestSequence;
    const input = $("[data-campaign-inventory-search]");
    const search = query === null ? input.value.trim() : String(query || "").trim();
    const data = await request(`/admin/inventory?available=1&q=${encodeURIComponent(search)}`);
    if (sequence !== campaignInventoryRequestSequence) return;
    campaignInventoryOptions = Array.isArray(data.inventory) ? data.inventory : [];
    const selectedId = $("[data-campaign-inventory-id]").value;
    if (selectedId && !campaignInventoryOptions.some(item => String(item.id) === selectedId)) clearCampaignInventorySelection("That product is no longer active with stock. Choose another inventory result.");
    const shouldOpen = !$("[data-campaign-modal]").hidden && !$("[data-campaign-product-field]").hidden && document.activeElement === input;
    renderCampaignInventoryOptions({ open: shouldOpen });
  }
  function syncCampaignFields() {
    const type = $("[data-campaign-reward-type]").value;
    const percentField = $("[data-campaign-percent-field]");
    const packField = $("[data-campaign-pack-field]");
    const productField = $("[data-campaign-product-field]");
    const percentInput = percentField.querySelector("input");
    const packInput = packField.querySelector("input");
    const needsPacks = type === "pack_draft";
    const needsProduct = type === "product";
    $("[data-campaign-single-help]").hidden = type !== "free_single";
    percentField.hidden = type !== "percent";
    percentInput.required = type === "percent";
    packField.hidden = !needsPacks;
    packInput.required = needsPacks;
    productField.hidden = !needsProduct;
    $("[data-campaign-inventory-search]").required = needsProduct;
    if (!needsProduct) {
      closeCampaignInventoryOptions();
      if ($("[data-campaign-inventory-id]").value) {
        $("[data-campaign-inventory-search]").value = "";
        clearCampaignInventorySelection();
      }
    }
    if (type === "pack_draft") {
      const maxInput = $("[data-campaign-form] input[name='maxRedemptions']");
      if (Number(maxInput.value) > Number(packInput.value)) maxInput.value = packInput.value;
    }
    if (type === "free_single") {
      const maxInput = $("[data-campaign-form] input[name='maxRedemptions']");
      if (!maxInput.value || Number(maxInput.value) === 25) maxInput.value = "50";
      const titleInput = $("[data-campaign-form] input[name='title']");
      if (!titleInput.value) titleInput.placeholder = "First Show Holographic Singles";
    } else if (type === "product") {
      const titleInput = $("[data-campaign-form] input[name='title']");
      if (!titleInput.value) titleInput.placeholder = "Featured Product Giveaway";
    } else {
      const titleInput = $("[data-campaign-form] input[name='title']");
      if (!titleInput.value) titleInput.placeholder = "Friday Night Rip Bonus";
    }
  }
  function syncCampaignExpiryUnit({ convert = false } = {}) {
    const unitInput = $("[data-campaign-expiry-unit]");
    const valueInput = $("[data-campaign-form] input[name='expiresInValue']");
    const help = $("[data-campaign-expiry-help]");
    const unit = ["days", "indefinite"].includes(unitInput.value) ? unitInput.value : "hours";
    const previousUnit = unitInput.dataset.previousUnit || unit;
    let value = Number(valueInput.value);
    if (convert && Number.isFinite(value) && previousUnit !== unit && previousUnit !== "indefinite" && unit !== "indefinite") value = unit === "days" ? value / 24 : value * 24;
    const min = 1;
    const max = unit === "days" ? 7 : 168;
    valueInput.disabled = unit === "indefinite";
    valueInput.min = String(min);
    valueInput.max = String(max);
    valueInput.step = "0.001";
    if (unit !== "indefinite" && Number.isFinite(value)) valueInput.value = String(Math.min(max, Math.max(min, Number(value.toFixed(3)))));
    help.textContent = unit === "indefinite" ? "No time expiration. The QR remains active until its claim limit is reached." : unit === "days" ? "Enter 1–7 days; decimals are allowed to 0.001 (for example, 3.05)." : "Enter 1–168 hours.";
    unitInput.dataset.previousUnit = unit;
  }
  function openCampaignModal() {
    campaignModalLastFocus = document.activeElement;
    $("[data-campaign-modal]").hidden = false;
    setCampaignFormStatus("");
    syncCampaignFields();
    syncCampaignExpiryUnit();
    refreshCampaignInventory("").catch(error => setCampaignFormStatus(error.message, "error"));
    $("[data-campaign-form] input[name='title']").focus();
  }
  function closeCampaignModal() {
    closeCampaignInventoryOptions();
    $("[data-campaign-modal]").hidden = true;
    campaignModalLastFocus?.focus?.();
  }
  async function loadCampaignQr(campaign) {
    const campaignId = String(pick(campaign, "id") || "");
    if (!campaignId) throw new Error("The generated campaign did not include an ID.");
    if (campaignQrCampaignId === campaignId && $("[data-campaign-generated-qr]").src) return;
    const image = $("[data-campaign-generated-qr]");
    image.classList.add("is-loading");
    image.removeAttribute("src");
    let nextUrl = "";
    try {
      nextUrl = URL.createObjectURL(await requestBlob(`/admin/campaigns/${encodeURIComponent(campaignId)}/qr`));
      image.src = nextUrl;
      if (image.decode) await image.decode();
      if (campaignQrObjectUrl) URL.revokeObjectURL(campaignQrObjectUrl);
      campaignQrObjectUrl = nextUrl;
      campaignQrCampaignId = campaignId;
    } catch (error) {
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      throw error;
    } finally {
      image.classList.remove("is-loading");
    }
  }
  async function renderGeneratedCampaign(campaign) {
    generatedCampaign = campaign;
    $("[data-campaign-generated-title]").textContent = String(pick(campaign, "title") || "Campaign");
    $("[data-campaign-generated-description]").textContent = campaignRewardDescription(campaign);
    $("[data-campaign-generated-url]").value = String(pick(campaign, "url") || "");
    const expiry = $("[data-campaign-generated-expiry]");
    const expiresAt = String(pick(campaign, "expiresAt", "expires_at") || "");
    const neverExpires = pick(campaign, "neverExpires", "never_expires") === true || Number(pick(campaign, "neverExpires", "never_expires") || 0) === 1;
    expiry.dateTime = neverExpires ? "" : expiresAt;
    expiry.dataset.campaignExpiresAt = expiresAt;
    expiry.dataset.campaignNeverExpires = String(neverExpires);
    show("[data-campaign-generated]", true);
    updateGeneratedCampaignControls(campaign);
    startCampaignCountdowns();
    if (campaignIsActive(campaign)) await loadCampaignQr(campaign);
  }
  function updateGeneratedCampaignControls(campaign) {
    const active = campaignIsActive(campaign);
    ["[data-campaign-copy]", "[data-campaign-download]", "[data-campaign-share]"].forEach(selector => { $(selector).disabled = !active; });
    const toggle = $("[data-campaign-generated-toggle]");
    toggle.textContent = active ? "Turn Off QR" : "Turn On QR";
    toggle.classList.toggle("btn-danger", active);
    toggle.classList.toggle("btn-primary", !active);
    $("[data-campaign-generated]").classList.toggle("is-qr-disabled", !active);
    $("[data-campaign-generated] .campaign-live-chip").textContent = active ? "CAMPAIGN READY" : "QR TURNED OFF";
    if (!active) $("[data-campaign-generated-qr]").removeAttribute("src");
  }
  async function toggleCampaign(campaign, button) {
    const campaignId = String(pick(campaign, "id") || "");
    if (!campaignId) throw new Error("Campaign ID is missing.");
    const active = campaignIsActive(campaign);
    if (active && !confirm(`Turn off \"${String(pick(campaign, "title") || "this campaign")}\"? Saved QR images and copied links will stop accepting new claims immediately.`)) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = active ? "Turning off..." : "Turning on...";
    try {
      const data = await request(`/admin/campaigns/${encodeURIComponent(campaignId)}/status`, { method: "POST", body: JSON.stringify({ active: !active }) });
      if (!data.campaign) throw new Error("The campaign status response was incomplete.");
      if (generatedCampaign && String(pick(generatedCampaign, "id") || "") === campaignId) {
        generatedCampaign = data.campaign;
        campaignQrCampaignId = "";
        updateGeneratedCampaignControls(generatedCampaign);
        if (campaignIsActive(generatedCampaign)) await loadCampaignQr(generatedCampaign);
      }
      await refreshCampaigns();
      showStatus(active ? "Campaign QR turned off. Saved images and links are now blocked." : "Campaign QR turned on and ready to share.", "success");
    } finally {
      button.disabled = false;
      if (button.matches("[data-campaign-generated-toggle]") && generatedCampaign) updateGeneratedCampaignControls(generatedCampaign);
      else button.textContent = original;
    }
  }
  async function copyGeneratedCampaign() {
    if (!campaignIsActive(generatedCampaign)) throw new Error("Turn this campaign QR on before copying its link.");
    const value = $("[data-campaign-generated-url]").value;
    if (!value) throw new Error("Generate a campaign before copying its link.");
    await copyCampaignText(value);
    showStatus("Campaign link copied.", "success");
  }
  async function copyCampaignText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const input = document.createElement("textarea"); input.value = value; input.readOnly = true; input.style.position = "fixed"; input.style.opacity = "0";
    document.body.append(input); input.select();
    const copied = document.execCommand("copy"); input.remove();
    if (!copied) throw new Error("Copy was blocked by this browser.");
  }
  async function downloadCampaignQr(button) {
    if (!generatedCampaign) throw new Error("Generate a campaign before downloading its QR.");
    button.disabled = true; const original = button.textContent; button.textContent = "Preparing QR...";
    try {
      await loadCampaignQr(generatedCampaign);
      const image = $("[data-campaign-generated-qr]");
      if (!image.src) throw new Error("The campaign QR is not ready.");
      const blobUrl = URL.createObjectURL(await qrPngBlob(image));
      const id = String(pick(generatedCampaign, "id") || "campaign").slice(0, 18).replace(/[^a-z0-9-]/gi, "-");
      const link = document.createElement("a"); link.href = blobUrl; link.download = `crack-packs-campaign-${id}.png`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showStatus("Campaign QR downloaded.", "success");
    } finally { button.disabled = false; button.textContent = original; }
  }
  const loadShareImage = source => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A share-card image could not load."));
    image.src = source;
  });
  function roundedCanvasRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }
  function drawContained(context, image, x, y, width, height) {
    const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * ratio;
    const drawHeight = image.naturalHeight * ratio;
    context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }
  function fitCanvasText(context, text, maxWidth, startSize, minimumSize = 20) {
    let size = startSize;
    do {
      context.font = `900 ${size}px Arial Black, Arial, sans-serif`;
      if (context.measureText(text).width <= maxWidth) return size;
      size -= 2;
    } while (size >= minimumSize);
    return minimumSize;
  }
  const shareCaption = state => `${state.title}\n${state.reward}\n\nScan or claim here: ${state.url}\n\nWhere pack crackin' is happenin'\nCRACKPACKSdotcom`;
  const shareFilename = state => `crackpacks-${state.kind === "owner-referral" ? "current-referral" : "campaign"}-qr.png`;
  async function renderCampaignShareCard(state) {
    const canvas = $("[data-campaign-share-canvas]");
    const context = canvas.getContext("2d");
    const [background, logo, icon, qr] = await Promise.all([
      loadShareImage("assets/images/crackpacks-share-card-bg-v1.png"),
      loadShareImage("assets/images/logo.svg"),
      loadShareImage("assets/images/favicon.svg"),
      loadShareImage(state.qrSrc)
    ]);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(background, 0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(4,8,35,.58)";
    roundedCanvasRect(context, 145, 42, 790, 996, 44); context.fill();
    drawContained(context, logo, 235, 52, 610, 120);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#f8ff46";
    context.font = "900 38px Arial Black, Arial, sans-serif";
    context.fillText("SCAN • JOIN • INVITE", 540, 188);
    const title = String(state.title || "CRACK PACKS REWARD").toUpperCase();
    fitCanvasText(context, title, 740, 44, 24);
    context.fillStyle = "#ffffff";
    context.fillText(title, 540, 238);
    const reward = String(state.reward || "FREE REWARDS + FRIEND INVITES").toUpperCase();
    fitCanvasText(context, reward, 730, 30, 20);
    context.fillStyle = "#50e7ff";
    context.fillText(reward, 540, 280);
    context.fillStyle = "#ffffff";
    context.shadowColor = "rgba(0,0,0,.45)"; context.shadowBlur = 24;
    roundedCanvasRect(context, 214, 312, 652, 652, 46); context.fill();
    context.shadowBlur = 0;
    context.drawImage(qr, 252, 350, 576, 576);
    context.fillStyle = "#ffffff";
    context.shadowColor = "rgba(0,0,0,.28)"; context.shadowBlur = 14;
    roundedCanvasRect(context, 470, 568, 140, 140, 30); context.fill();
    context.shadowBlur = 0;
    drawContained(context, icon, 488, 586, 104, 104);
    context.fillStyle = "#ffffff";
    fitCanvasText(context, "Where pack crackin' is happenin'", 780, 34, 23);
    context.fillText("Where pack crackin' is happenin'", 540, 997);
    context.fillStyle = "#f8ff46";
    context.font = "900 31px Arial Black, Arial, sans-serif";
    context.fillText("CRACKPACKSdotcom", 540, 1036);
    $("[data-campaign-share-preview]").classList.add("is-ready");
  }
  async function openCampaignShare(campaign) {
    const campaignId = String(pick(campaign, "id") || "");
    const url = String(pick(campaign, "url") || "");
    if (!campaignId || !url) throw new Error("This campaign is missing its share link.");
    campaignShareLastFocus = document.activeElement;
    campaignShareState = { kind: "campaign", title: String(pick(campaign, "title") || "Crack Packs Reward"), reward: campaignRewardDescription(campaign), url, qrSrc: "" };
    $("[data-campaign-share-modal]").hidden = false;
    $("[data-campaign-share-preview]").classList.remove("is-ready");
    $("[data-campaign-share-description]").textContent = `${campaignShareState.reward} • ${pick(campaign, "neverExpires", "never_expires") ? "No expiration" : "Time-limited campaign"}`;
    const qrObjectUrl = URL.createObjectURL(await requestBlob(`/admin/campaigns/${encodeURIComponent(campaignId)}/qr`));
    campaignShareState.qrSrc = qrObjectUrl;
    campaignShareRenderPromise = renderCampaignShareCard(campaignShareState).finally(() => URL.revokeObjectURL(qrObjectUrl));
    await campaignShareRenderPromise;
  }
  async function openOwnerReferralShare() {
    if (!ownerReferralState || !ownerReferralQrUrl) await refreshOwnerReferral();
    if (ownerReferralState?.isActive === false) throw new Error("Turn the current owner referral QR on before sharing it.");
    const url = String(ownerReferralState?.inviteUrl || ownerReferralState?.url || $("[data-owner-referral-url]").value || "");
    const qrSrc = ownerReferralQrUrl || $("[data-owner-referral-qr]").src;
    if (!url || !qrSrc) throw new Error("The current owner referral QR is not ready.");
    campaignShareLastFocus = document.activeElement;
    campaignShareState = { kind: "owner-referral", title: "Join the Crack Packs Crew", reward: "Free Rewards + Friend Invites", url, qrSrc };
    $("[data-campaign-share-modal]").hidden = false;
    $("[data-campaign-share-preview]").classList.remove("is-ready");
    $("[data-campaign-share-description]").textContent = "Current 12-hour owner referral QR. Share it before the displayed 7 AM or 7 PM Eastern boundary.";
    campaignShareRenderPromise = renderCampaignShareCard(campaignShareState);
    await campaignShareRenderPromise;
  }
  function closeCampaignShare() {
    $("[data-campaign-share-modal]").hidden = true;
    campaignShareLastFocus?.focus?.();
  }
  async function campaignShareBlob() {
    if (!campaignShareState || !campaignShareRenderPromise) throw new Error("Open a campaign share card first.");
    await campaignShareRenderPromise;
    return new Promise((resolve, reject) => $("[data-campaign-share-canvas]").toBlob(blob => blob ? resolve(blob) : reject(new Error("The share graphic could not be created.")), "image/png"));
  }
  async function downloadCampaignShare() {
    const blobUrl = URL.createObjectURL(await campaignShareBlob());
    const link = document.createElement("a"); link.href = blobUrl; link.download = shareFilename(campaignShareState);
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    showStatus("Branded QR graphic downloaded.", "success");
  }
  async function nativeCampaignShare() {
    if (!campaignShareState) throw new Error("Open a campaign share card first.");
    const caption = shareCaption(campaignShareState);
    const blob = await campaignShareBlob();
    const file = new File([blob], shareFilename(campaignShareState), { type: "image/png" });
    if (navigator.share) {
      const payload = navigator.canShare?.({ files: [file] }) ? { title: campaignShareState.title, text: caption, files: [file] } : { title: campaignShareState.title, text: caption, url: campaignShareState.url };
      await navigator.share(payload);
      return;
    }
    await copyCampaignText(caption);
    showStatus("Sharing apps are unavailable here, so the caption and link were copied.", "success");
  }
  async function shareCampaignToSocial(platform) {
    if (!campaignShareState) throw new Error("Open a campaign share card first.");
    const caption = shareCaption(campaignShareState);
    const destinations = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(campaignShareState.url)}`,
      x: `https://x.com/intent/post?text=${encodeURIComponent(caption)}`,
      instagram: "https://www.instagram.com/crackpacksdotcom/",
      youtube: "https://www.youtube.com/@CRACKPACKSdotcom",
      live: "streams.html"
    };
    const destination = destinations[platform];
    if (!destination) throw new Error("That social destination is unavailable.");
    window.open(destination, "_blank", "noopener,noreferrer");
    await Promise.all([copyCampaignText(caption), downloadCampaignShare()]);
    showStatus(`${platform === "x" ? "X" : platform[0].toUpperCase() + platform.slice(1)} opened. The caption was copied and the QR graphic was downloaded.`, "success");
  }
  function redemptionStatus(redemption) {
    if (pick(redemption, "redeemedAt", "redeemed_at", "usedAt", "used_at")) return "used";
    const expiresAt = String(pick(redemption, "expiresAt", "expires_at") || "");
    if (expiresAt && Date.parse(expiresAt) <= Date.now() + campaignClockOffset) return "expired";
    return "claimed";
  }
  function renderCampaignRedemption(redemption) {
    const row = document.createElement("article"); row.className = "campaign-redemption";
    const main = document.createElement("div"); main.className = "campaign-redemption-main";
    const identity = document.createElement("strong");
    const email = String(pick(redemption, "email") || "Unknown email");
    const username = String(pick(redemption, "liveUsername", "live_username") || "");
    identity.textContent = username ? `${email} - @${username}` : email;
    const code = document.createElement("span"); code.className = "campaign-redemption-code"; code.textContent = String(pick(redemption, "code") || "No code");
    main.append(identity, code);
    const meta = document.createElement("div"); meta.className = "campaign-redemption-meta";
    const rank = pick(redemption, "rank", "claimRank", "claim_rank");
    const pack = pick(redemption, "packNumber", "pack_number");
    const state = redemptionStatus(redemption);
    meta.textContent = [rank ? `Rank #${rank}` : "", pack ? `Pack #${pack}` : "", state === "used" ? "Used" : state === "expired" ? "Expired" : "Claimed"].filter(Boolean).join(" - ");
    row.append(main, meta);
    if (state === "claimed") {
      const button = document.createElement("button"); button.className = "btn btn-primary btn-small"; button.type = "button"; button.textContent = "Mark used";
      button.addEventListener("click", async () => {
        const redemptionId = String(pick(redemption, "id") || "");
        if (!redemptionId || !confirm(`Mark ${String(pick(redemption, "code") || "this reward")} used? This cannot be undone.`)) return;
        button.disabled = true;
        try {
          await request(`/admin/campaign-redemptions/${encodeURIComponent(redemptionId)}/redeem`, { method: "POST" });
          showStatus("Campaign reward marked used.", "success");
          await refreshCampaigns();
        } catch (error) { button.disabled = false; showStatus(error.message, "error"); }
      });
      row.append(button);
    }
    return row;
  }
  function renderCampaign(campaign, visibleRedemptions = null) {
    const expiresAt = String(pick(campaign, "expiresAt", "expires_at") || "");
    const neverExpires = pick(campaign, "neverExpires", "never_expires") === true || Number(pick(campaign, "neverExpires", "never_expires") || 0) === 1;
    const active = campaignIsActive(campaign);
    const expired = !neverExpires && (String(pick(campaign, "status") || "").toLowerCase() === "expired" || (expiresAt && Date.parse(expiresAt) <= Date.now() + campaignClockOffset));
    const remaining = Math.max(0, Number(pick(campaign, "remaining") || 0));
    const full = !expired && remaining === 0;
    const card = document.createElement("article"); card.className = `admin-campaign${expired ? " is-expired" : ""}${!active ? " is-qr-disabled" : ""}`; card.dataset.campaignCard = "";
    const head = document.createElement("div"); head.className = "admin-campaign-head";
    const heading = document.createElement("div"); const title = document.createElement("h3"); title.textContent = String(pick(campaign, "title") || "Untitled campaign");
    const description = document.createElement("p"); description.className = "admin-campaign-description"; description.textContent = campaignRewardDescription(campaign); heading.append(title, description);
    const chip = document.createElement("span"); chip.dataset.campaignStatus = ""; chip.className = `campaign-status-chip${expired || !active ? " expired" : ""}`; chip.textContent = !active ? "QR Off" : expired ? "Expired" : full ? "Full" : "Active"; head.append(heading, chip);
    const metrics = document.createElement("div"); metrics.className = "admin-campaign-metrics";
    const claimed = Number(pick(campaign, "claimedCount", "claimed_count") || 0); const cap = Number(pick(campaign, "maxRedemptions", "max_redemptions") || claimed + remaining);
    for (const value of [`Claimed ${claimed}/${cap}`, `${remaining} remaining`]) { const item = document.createElement("strong"); item.textContent = value; metrics.append(item); }
    const expiry = document.createElement("time"); expiry.dateTime = neverExpires ? "" : expiresAt; expiry.dataset.campaignExpiresAt = expiresAt; expiry.dataset.campaignNeverExpires = String(neverExpires); metrics.append(expiry);
    const actions = document.createElement("div"); actions.className = "campaign-card-actions";
    const campaignUrl = String(pick(campaign, "url") || "");
    if (campaignUrl && active) {
      const copyButton = document.createElement("button"); copyButton.className = "btn btn-outline btn-small"; copyButton.type = "button"; copyButton.textContent = "Copy Link";
      copyButton.addEventListener("click", async () => {
        try { await copyCampaignText(campaignUrl); showStatus("Campaign link copied.", "success"); }
        catch (error) { showStatus(error.message, "error"); }
      });
      const downloadButton = document.createElement("button"); downloadButton.className = "btn btn-primary btn-small"; downloadButton.type = "button"; downloadButton.textContent = "Download QR";
      downloadButton.addEventListener("click", async () => {
        try { await renderGeneratedCampaign(campaign); await downloadCampaignQr(downloadButton); }
        catch (error) { showStatus(error.message, "error"); }
      });
      const shareButton = document.createElement("button"); shareButton.className = "btn btn-outline btn-small"; shareButton.type = "button"; shareButton.textContent = "Share";
      shareButton.addEventListener("click", () => openCampaignShare(campaign).catch(error => showStatus(error.message, "error")));
      actions.append(copyButton, downloadButton, shareButton);
    }
    const toggleButton = document.createElement("button"); toggleButton.className = `btn ${active ? "btn-danger" : "btn-primary"} btn-small`; toggleButton.type = "button"; toggleButton.textContent = active ? "Turn Off QR" : "Turn On QR";
    toggleButton.addEventListener("click", () => toggleCampaign(campaign, toggleButton).catch(error => { toggleButton.disabled = false; showStatus(error.message, "error"); }));
    actions.append(toggleButton);
    const redemptions = document.createElement("div"); redemptions.className = "campaign-redemptions";
    const list = visibleRedemptions || (Array.isArray(campaign.redemptions) ? campaign.redemptions : []);
    const peopleHeading = document.createElement("h4"); peopleHeading.className = "campaign-people-title"; peopleHeading.textContent = `Signed up / claimed collectors (${list.length})`;
    if (list.length) list.forEach(item => redemptions.append(renderCampaignRedemption(item)));
    else { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No verified claims yet."; redemptions.append(empty); }
    card.append(head, metrics, actions, peopleHeading, redemptions);
    return card;
  }
  function renderCampaigns(campaigns, filter = "") {
    campaignListState = campaigns;
    const container = $("[data-admin-campaigns]"); container.replaceChildren();
    if (!campaigns.length) { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No campaigns yet. Create one for the next live show."; container.append(empty); return; }
    const query = String(filter || "").trim().toLowerCase();
    const rewardTypeFilter = $("[data-campaign-type-filter]").value;
    const dateFrom = $("[data-campaign-date-from]").value;
    const dateTo = $("[data-campaign-date-to]").value;
    const ordered = [...campaigns].sort((a, b) => Date.parse(String(pick(b, "createdAt", "created_at", "expiresAt", "expires_at") || 0)) - Date.parse(String(pick(a, "createdAt", "created_at", "expiresAt", "expires_at") || 0)));
    let matches = 0;
    ordered.forEach(campaign => {
      const rewardType = String(pick(campaign, "rewardType", "reward_type") || "");
      if (rewardTypeFilter !== "all" && rewardType !== rewardTypeFilter) return;
      const allRedemptions = Array.isArray(campaign.redemptions) ? campaign.redemptions : [];
      const easternDate = value => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "";
      const dateMatches = value => {
        const date = easternDate(value);
        return Boolean(date) && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
      };
      const hasDateFilter = Boolean(dateFrom || dateTo);
      const dateFilteredRedemptions = hasDateFilter ? allRedemptions.filter(redemption => dateMatches(pick(redemption, "claimedAt", "claimed_at"))) : allRedemptions;
      const campaignCreatedMatches = hasDateFilter && dateMatches(pick(campaign, "createdAt", "created_at"));
      if (hasDateFilter && !campaignCreatedMatches && !dateFilteredRedemptions.length) return;
      const product = campaignProduct(campaign);
      const campaignMatches = query && [pick(campaign, "title"), campaignRewardDescription(campaign), rewardType, pick(campaign, "url"), product?.name, product?.upc].some(value => String(value || "").toLowerCase().includes(query));
      const visible = !query || campaignMatches ? dateFilteredRedemptions : dateFilteredRedemptions.filter(redemption => [pick(redemption, "code"), pick(redemption, "email"), pick(redemption, "liveUsername", "live_username")].some(value => String(value || "").toLowerCase().includes(query)));
      if (query && !campaignMatches && !visible.length) return;
      matches += 1;
      container.append(renderCampaign(campaign, visible));
    });
    if (!matches) { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No campaigns or claimants match those filters."; container.append(empty); }
    startCampaignCountdowns();
  }
  async function refreshCampaigns() {
    if (!memberToken || !adminToken) return;
    const data = await request("/admin/campaigns");
    if (data.serverNow) campaignClockOffset = Date.parse(data.serverNow) - Date.now();
    renderCampaigns(Array.isArray(data.campaigns) ? data.campaigns : [], $("[data-campaign-search]").value);
    renderClaims(legacyClaimsState);
    updateCombinedPromotionSummary();
  }

  function claimStatus(claim) {
    if (claim.redeemed_at) return "redeemed";
    if (new Date(claim.expires_at).getTime() <= Date.now()) return "expired";
    if (claim.redemption_requested_at) return "requested";
    return "issued";
  }
  function renderClaims(claims) {
    const container = $("[data-admin-results]"); container.replaceChildren();
    const query = $("[data-admin-search]").value.trim().toLowerCase();
    const statusFilter = $("[data-admin-filter]").value;
    const dateFrom = $("[data-admin-date-from]").value;
    const dateTo = $("[data-admin-date-to]").value;
    const dateMatches = value => {
      if (!dateFrom && !dateTo) return true;
      if (!value) return false;
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    };
    let rendered = 0;
    claims.filter(claim => dateMatches(claim.created_at)).forEach(claim => {
      const state = claimStatus(claim); const card = document.createElement("article"); card.className = "admin-claim";
      const identity = document.createElement("div"); const code = document.createElement("h3"); code.textContent = claim.code;
      const member = document.createElement("p"); member.textContent = `${claim.first_name || ""} ${claim.last_name || ""}`.trim() || "Unnamed member";
      const email = document.createElement("p"); email.textContent = claim.email;
      const username = document.createElement("p"); username.textContent = claim.live_username ? `@${claim.live_username}` : "No collector username";
      identity.append(code, member, email, username);
      const details = document.createElement("div"); const badge = document.createElement("span"); badge.className = `admin-claim-status ${state}`; badge.textContent = state;
      const percent = document.createElement("p"); const percentValue = document.createElement("strong"); percentValue.textContent = `${Number(claim.percent)}%`; percent.append(percentValue, " discount");
      const timing = document.createElement("p"); timing.textContent = claim.redeemed_at ? `Redeemed ${new Date(claim.redeemed_at).toLocaleString()}` : claim.redemption_requested_at ? `Requested ${new Date(claim.redemption_requested_at).toLocaleString()}` : `Issued ${new Date(claim.created_at).toLocaleDateString()}`;
      const expiry = document.createElement("time"); expiry.dataset.adminClaimExpiresAt = claim.expires_at; expiry.dataset.adminClaimNeverExpires = "false";
      details.append(badge, percent, timing, expiry);
      const actions = document.createElement("div"); actions.className = "admin-claim-actions";
      if (state !== "redeemed" && state !== "expired") {
        const button = document.createElement("button"); button.className = "btn btn-primary btn-small"; button.type = "button"; button.textContent = "Mark redeemed";
        button.addEventListener("click", async () => {
          if (!confirm(`Mark ${claim.code} redeemed? This cannot be undone.`)) return;
          button.disabled = true;
          try { await request(`/admin/discounts/${claim.id}/redeem`, { method: "POST" }); showStatus(`${claim.code} marked redeemed.`, "success"); await refreshDashboard(); }
          catch (error) { button.disabled = false; showStatus(error.message, "error"); }
        });
        actions.append(button);
      }
      card.append(identity, details, actions); container.append(card); rendered += 1;
    });
    campaignListState.forEach(campaign => {
      const campaignExpiresAt = String(pick(campaign, "expiresAt", "expires_at") || "");
      const neverExpires = pick(campaign, "neverExpires", "never_expires") === true || Number(pick(campaign, "neverExpires", "never_expires") || 0) === 1;
      (Array.isArray(campaign.redemptions) ? campaign.redemptions : []).forEach(redemption => {
        const claimedAt = String(pick(redemption, "claimedAt", "claimed_at") || "");
        if (!dateMatches(claimedAt)) return;
        const redeemedAt = String(pick(redemption, "redeemedAt", "redeemed_at") || "");
        const state = redeemedAt ? "redeemed" : !neverExpires && campaignExpiresAt && Date.parse(campaignExpiresAt) <= Date.now() + campaignClockOffset ? "expired" : "issued";
        if (statusFilter !== "all" && statusFilter !== state) return;
        const codeValue = String(pick(redemption, "code") || "");
        const emailValue = String(pick(redemption, "email") || "");
        const usernameValue = String(pick(redemption, "liveUsername", "live_username") || "");
        if (query && ![codeValue, emailValue, usernameValue, pick(campaign, "title"), campaignRewardDescription(campaign), campaignProduct(campaign)?.upc].some(value => String(value || "").toLowerCase().includes(query))) return;
        const card = document.createElement("article"); card.className = "admin-claim";
        const identity = document.createElement("div");
        const code = document.createElement("h3"); code.textContent = codeValue;
        const title = document.createElement("p"); title.textContent = String(pick(campaign, "title") || "Campaign reward");
        const email = document.createElement("p"); email.textContent = emailValue;
        const username = document.createElement("p"); username.textContent = usernameValue ? `@${usernameValue}` : "No collector username";
        identity.append(code, title, email, username);
        const details = document.createElement("div");
        const badge = document.createElement("span"); badge.className = `admin-claim-status ${state}`; badge.textContent = state;
        const reward = document.createElement("p"); const rewardStrong = document.createElement("strong"); rewardStrong.textContent = campaignRewardDescription(campaign); reward.append(rewardStrong);
        const timing = document.createElement("p"); timing.textContent = redeemedAt ? `Redeemed ${new Date(redeemedAt).toLocaleString()}` : `Claimed ${new Date(claimedAt).toLocaleString()}`;
        const expiry = document.createElement("time"); expiry.dataset.adminClaimExpiresAt = campaignExpiresAt; expiry.dataset.adminClaimNeverExpires = String(neverExpires);
        details.append(badge, reward, timing, expiry);
        const actions = document.createElement("div"); actions.className = "admin-claim-actions";
        if (state === "issued") {
          const button = document.createElement("button"); button.className = "btn btn-primary btn-small"; button.type = "button"; button.textContent = "Mark redeemed";
          button.addEventListener("click", async () => {
            if (!confirm(`Confirm ${codeValue} was gifted or used? This cannot be undone.`)) return;
            button.disabled = true;
            try { await request(`/admin/campaign-redemptions/${encodeURIComponent(String(pick(redemption, "id") || ""))}/redeem`, { method: "POST" }); showStatus(`${codeValue} marked redeemed.`, "success"); await refreshCampaigns(); }
            catch (error) { button.disabled = false; showStatus(error.message, "error"); }
          });
          actions.append(button);
        }
        card.append(identity, details, actions); container.append(card); rendered += 1;
      });
    });
    if (!rendered) { const empty = document.createElement("div"); empty.className = "admin-empty"; empty.textContent = "No promotional rewards match these filters."; container.append(empty); }
    startCampaignCountdowns();
  }
  function updateCombinedPromotionSummary() {
    const combined = { ...legacySummaryState };
    campaignListState.forEach(campaign => {
      const expiresAt = String(pick(campaign, "expiresAt", "expires_at") || "");
      const neverExpires = pick(campaign, "neverExpires", "never_expires") === true || Number(pick(campaign, "neverExpires", "never_expires") || 0) === 1;
      (Array.isArray(campaign.redemptions) ? campaign.redemptions : []).forEach(redemption => {
        combined.total += 1;
        if (pick(redemption, "redeemedAt", "redeemed_at")) combined.redeemed += 1;
        else if (!neverExpires && expiresAt && Date.parse(expiresAt) <= Date.now() + campaignClockOffset) combined.expired += 1;
        else combined.issued += 1;
      });
    });
    Object.entries(combined).forEach(([key, value]) => { const node = $(`[data-count-${key}]`); if (node) node.textContent = value; });
  }
  async function refreshDashboard() {
    const query = encodeURIComponent($("[data-admin-search]").value.trim());
    const filter = encodeURIComponent($("[data-admin-filter]").value);
    const [summaryData, claimsData] = await Promise.all([request("/admin/summary"), request(`/admin/discounts?q=${query}&status=${filter}`)]);
    legacySummaryState = { ...legacySummaryState, ...(summaryData.summary || {}) };
    updateCombinedPromotionSummary();
    legacyClaimsState = Array.isArray(claimsData.claims) ? claimsData.claims : [];
    renderClaims(legacyClaimsState);
  }

  function setMasterEmailStatus(message = "", kind = "") {
    const node = $("[data-master-email-status]"); node.textContent = message; node.dataset.kind = kind;
  }
  function syncEmailComposer() {
    const count = selectedEmailMembers.size;
    const summary = $("[data-email-recipient-summary]");
    summary.textContent = emailAudience === "all" ? "Audience: every verified Crack Packs member (up to 100 per send)." : emailAudience === "tier" ? `Audience: ${$("[data-email-tier]").selectedOptions[0].textContent}.` : emailAudience === "selected" ? `Audience: ${count} selected member${count === 1 ? "" : "s"}.` : "No audience selected.";
    const chips = $("[data-email-selected-chips]"); chips.replaceChildren();
    if (emailAudience === "selected") selectedEmailMembers.forEach(member => {
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "email-recipient-chip"; chip.textContent = `${member.liveUsername ? `@${member.liveUsername}` : member.email} ×`;
      chip.title = `Remove ${member.email}`;
      chip.addEventListener("click", () => { selectedEmailMembers.delete(member.id); syncEmailComposer(); });
      chips.append(chip);
    });
    $("[data-email-send]").disabled = !emailAudience || (emailAudience === "selected" && !count);
    $("[data-email-selection-count]").textContent = `${count} selected`;
  }
  async function searchEmailMembers() {
    const query = encodeURIComponent($("[data-email-member-search]").value.trim());
    const data = await request(`/admin/members?q=${query}&excludeOwner=1`);
    const container = $("[data-email-member-results]"); container.replaceChildren();
    const members = Array.isArray(data.members) ? data.members : [];
    if (!members.length) { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No verified members match that search."; container.append(empty); return; }
    members.forEach(member => {
      const row = document.createElement("article"); row.className = "email-member-row";
      const identity = document.createElement("div"); const name = document.createElement("strong"); name.textContent = `${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email;
      const detail = document.createElement("span"); detail.textContent = [member.liveUsername ? `@${member.liveUsername}` : "", member.email].filter(Boolean).join(" · "); identity.append(name, detail);
      const button = document.createElement("button"); button.type = "button"; button.className = `btn ${selectedEmailMembers.has(member.id) ? "btn-danger" : "btn-outline"} btn-small`; button.textContent = selectedEmailMembers.has(member.id) ? "Remove" : "Add";
      button.addEventListener("click", () => {
        if (selectedEmailMembers.has(member.id)) selectedEmailMembers.delete(member.id); else selectedEmailMembers.set(member.id, member);
        emailAudience = "selected"; syncEmailComposer(); searchEmailMembers().catch(error => showStatus(error.message, "error"));
      });
      row.append(identity, button); container.append(row);
    });
  }
  function openEmailMemberSelection() {
    emailAudience = "selected";
    $("[data-email-select-modal]").hidden = false;
    $("[data-email-member-search]").focus();
    syncEmailComposer();
    searchEmailMembers().catch(error => showStatus(error.message, "error"));
  }
  function closeEmailMemberSelection() { $("[data-email-select-modal]").hidden = true; }
  function resetMasterEmail() {
    emailAudience = ""; selectedEmailMembers.clear(); $("[data-master-email-form]").reset(); setMasterEmailStatus(""); syncEmailComposer();
  }

  function setTrackingStatus(message = "", kind = "") {
    const node = $("[data-tracking-status]");
    node.textContent = message;
    node.dataset.kind = kind;
  }
  function showTrackingListError(selector, error) {
    const container = $(selector); container.replaceChildren();
    const message = document.createElement("div"); message.className = "campaign-empty"; message.textContent = error.message; container.append(message);
    setTrackingStatus(error.message, "error");
  }
  function selectTrackingMember(member) {
    selectedTrackingMember = member;
    $("[data-tracking-member-id]").value = member?.id || "";
    const selected = $("[data-tracking-member-selected]");
    selected.textContent = member ? `Selected: ${member.liveUsername ? `@${member.liveUsername} · ` : ""}${member.email}` : "No member selected.";
    selected.classList.toggle("is-selected", Boolean(member));
    $("[data-tracking-member-results]").replaceChildren();
  }
  async function searchTrackingMembers() {
    if (!memberToken || !adminToken) return;
    const query = encodeURIComponent($("[data-tracking-member-search]").value.trim());
    const container = $("[data-tracking-member-results]"); container.replaceChildren();
    const loading = document.createElement("div"); loading.className = "campaign-empty"; loading.textContent = "Searching verified members..."; container.append(loading);
    const data = await request(`/admin/members?q=${query}&includeOwner=1`);
    container.replaceChildren();
    const members = Array.isArray(data.members) ? data.members.slice(0, 12) : [];
    if (!members.length) { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No verified members match that search."; container.append(empty); return; }
    members.forEach(member => {
      const button = document.createElement("button"); button.type = "button"; button.className = "tracking-member-option";
      const name = document.createElement("strong"); name.textContent = `${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email;
      const detail = document.createElement("span"); detail.textContent = [member.isOwner ? "OWNER / TEST ACCOUNT" : "", member.liveUsername ? `@${member.liveUsername}` : "", member.email].filter(Boolean).join(" · ");
      button.append(name, detail); button.addEventListener("click", () => selectTrackingMember(member)); container.append(button);
    });
  }
  function adminOrderStatusLabel(value) { return String(value || "unknown").replace(/_/g, " "); }
  function renderAdminOrders(orders) {
    const container = $("[data-admin-order-list]"); container.replaceChildren();
    if (!orders.length) { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = $("[data-tracking-order-search]").value.trim() ? "No tracked member orders match this search." : "No orders exist yet. Create the first order with the form on the left, then it will appear here."; container.append(empty); return; }
    orders.forEach(order => {
      const card = document.createElement("article"); card.className = "admin-order-card";
      const head = document.createElement("div"); head.className = "admin-order-head";
      const titleWrap = document.createElement("div"); const title = document.createElement("h3"); title.textContent = order.orderNumber;
      const member = document.createElement("p"); member.textContent = [order.member?.liveUsername ? `@${order.member.liveUsername}` : "", order.member?.email].filter(Boolean).join(" · "); titleWrap.append(title, member);
      const badge = document.createElement("span"); badge.className = `order-status-chip ${order.status || "processing"}`; badge.textContent = adminOrderStatusLabel(order.status);
      const payment = document.createElement("span"); payment.className = `order-status-chip ${order.paymentStatus === "paid" ? "delivered" : "cancelled"}`; payment.textContent = order.paymentStatus === "paid" ? "PAID" : "UNPAID";
      head.append(titleWrap, payment, badge);
      const items = document.createElement("ul"); items.className = "admin-order-items";
      (Array.isArray(order.items) ? order.items : []).forEach(item => { const li = document.createElement("li"); li.textContent = `${Number(item.quantity || 1)}× ${item.name}`; items.append(li); });
      const tracking = document.createElement("div"); tracking.className = "admin-order-tracking";
      const carrier = document.createElement("strong"); carrier.textContent = `${order.tracking?.carrier || "Carrier"} · ${order.tracking?.trackingCode || "No tracking"}`;
      const state = document.createElement("span"); state.textContent = `Latest: ${adminOrderStatusLabel(order.tracking?.status)}${order.tracking?.mode === "test" ? " · TEST" : ""}`;
      tracking.append(carrier, state);
      if (order.tracking?.url) { const link = document.createElement("a"); link.className = "btn btn-outline btn-small"; link.href = order.tracking.url; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Open Tracking"; tracking.append(link); }
      if (order.label?.ordered) {
        const ordered = document.createElement("span"); ordered.className = "order-status-chip processing"; ordered.textContent = "Label ordered"; ordered.title = order.label.purchasedAt ? new Date(order.label.purchasedAt).toLocaleString() : "Label ordered"; tracking.append(ordered);
        if (order.label.url) { const labelLink = document.createElement("a"); labelLink.className = "btn btn-outline btn-small"; labelLink.href = order.label.url; labelLink.target = "_blank"; labelLink.rel = "noopener"; labelLink.textContent = "Print Label"; tracking.append(labelLink); }
      } else {
        const labelButton = document.createElement("button"); labelButton.type = "button"; labelButton.className = "btn btn-primary btn-small"; labelButton.dataset.orderLabel = order.id; labelButton.textContent = "Order Label"; labelButton.disabled = order.paymentStatus !== "paid"; labelButton.title = labelButton.disabled ? "Payment must be marked paid first" : "Purchase the saved EasyPost rate"; tracking.append(labelButton);
      }
      card.append(head, items, tracking); container.append(card);
    });
  }
  async function refreshAdminOrders() {
    if (!memberToken || !adminToken) return;
    const query = encodeURIComponent($("[data-tracking-order-search]").value.trim());
    const container = $("[data-admin-order-list]"); container.replaceChildren();
    const loading = document.createElement("div"); loading.className = "campaign-empty"; loading.textContent = "Searching orders..."; container.append(loading);
    const data = await request(`/admin/orders?q=${query}`);
    renderAdminOrders(Array.isArray(data.orders) ? data.orders : []);
  }
  async function saveInventoryProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("[data-inventory-save]");
    button.disabled = true;
    setInventoryFormStatus("Saving product...");
    try {
      const buyerStore = String(form.elements.namedItem("storeTarget")?.value || "buyer_store") === "buyer_store";
      if (buyerStore) {
        const payload = buyerStorePayloadFromForm(form);
        await request("/admin/store-listings", { method: "POST", body: JSON.stringify(payload) });
        setInventoryStatus(`Buyer Store listing “${payload.title}” published.`, "success");
      } else {
        const payload = inventoryPayloadFromForm(form);
        const path = editingInventoryId ? `/admin/inventory/${encodeURIComponent(editingInventoryId)}` : "/admin/inventory";
        await request(path, { method: "POST", body: JSON.stringify(payload) });
        setInventoryStatus(`Seller Store product “${payload.name}” saved.`, "success");
        await refreshInventory();
      }
      closeInventoryModal();
    } catch (error) {
      setInventoryFormStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
  $("[data-admin-order-list]").addEventListener("click", async event => {
    const button = event.target.closest("[data-order-label]");
    if (!button) return;
    if (!confirm("Are you sure you want to purchase this EasyPost shipping label?")) return;
    button.disabled = true; button.textContent = "Ordering...";
    try {
      const result = await request(`/admin/orders/${encodeURIComponent(button.dataset.orderLabel)}/label`, { method: "POST", body: "{}" });
      await refreshAdminOrders();
      if (result.labelUrl) window.open(result.labelUrl, "_blank", "noopener");
      setTrackingStatus("Label ordered. The printable label opened in a new tab.", "success");
    } catch (error) { button.disabled = false; button.textContent = "Order Label"; setTrackingStatus(error.message, "error"); }
  });
  function trackingItemsFromText(value) {
    return String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const match = /^(\d{1,3})\s*[x×]\s*(.+)$/i.exec(line);
      return match ? { quantity: Number(match[1]), name: match[2].trim() } : { quantity: 1, name: line };
    });
  }

  async function boot() {
    show("[data-admin-login]", false); show("[data-admin-setup]", false); show("[data-admin-step-up]", false); show("[data-admin-denied]", false); show("[data-admin-dashboard]", false);
    if (verificationToken) await confirmMagicLink();
    if (!memberToken) { show("[data-admin-login]", true); initializeTurnstile(); return; }
    let account;
    try { account = await request("/me"); } catch { localStorage.removeItem("cp_rewards_token"); memberToken = ""; show("[data-admin-login]", true); initializeTurnstile(); return; }
    if (!account.deviceVerified || !account.profileComplete) { show("[data-admin-setup]", true); return; }
    if (!account.isAdmin) { show("[data-admin-denied]", true); return; }
    if (!adminToken) { show("[data-admin-step-up]", true); return; }
    try { await refreshDashboard(); show("[data-admin-dashboard]", true); }
    catch (error) {
      if (error.status === 401 || error.status === 403) { requireFreshOwnerVerification(); return; }
      show("[data-admin-dashboard]", true);
      showStatus(error.message, "error");
    }
    if (adminToken) {
      await refreshOwnerReferral().catch(() => {});
      await refreshCampaigns().catch(error => showStatus(error.message, "error"));
    }
  }

  $("[data-admin-login-form]").addEventListener("submit", async event => {
    event.preventDefault(); const email = String(new FormData(event.currentTarget).get("email") || "").trim().toLowerCase();
    if (!turnstileToken) { showStatus("Complete the security check.", "error"); return; }
    try { await request("/auth/request", { method: "POST", body: JSON.stringify({ email, turnstileToken, returnTo: "admin" }) }); $("[data-admin-email-modal]").hidden = false; $("[data-admin-send]").disabled = true; $("[data-admin-send]").textContent = "Check inbox"; }
    catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-admin-passkey]").addEventListener("click", async () => {
    try { await stepUp(); show("[data-admin-step-up]", false); show("[data-admin-dashboard]", true); await refreshDashboard(); await refreshOwnerReferral(); await refreshCampaigns(); showStatus("Owner passkey verified.", "success"); }
    catch (error) { showStatus(error.message || "Owner passkey verification failed.", "error"); }
  });
  document.querySelectorAll("[data-admin-logout]").forEach(button => button.addEventListener("click", async () => {
    try { await request("/admin/logout", { method: "POST" }); } catch {}
    try { await request("/auth/logout", { method: "POST" }); } catch {}
    sessionStorage.removeItem("cp_admin_token"); localStorage.removeItem("cp_rewards_token"); location.href = "admin.html";
  }));
  document.querySelectorAll("[data-admin-email-close]").forEach(button => button.addEventListener("click", () => { $("[data-admin-email-modal]").hidden = true; }));
  document.querySelectorAll("[data-master-section-button]").forEach(button => button.addEventListener("click", () => openMasterSection(button.dataset.masterSectionButton)));
  $("[data-stream-config-refresh]")?.addEventListener("click", () => refreshStreamConfig().catch(error => setStreamConfigStatus(error.message, "error")));
  $("[data-stream-config-form]")?.addEventListener("submit", saveStreamConfig);
  $("[data-stream-cycle-run]")?.addEventListener("click", async () => {
    try {
      setStreamConfigStatus("Running stream-credit alerts and finalization...");
      const result = await request("/admin/stream-credits/run-cycle", { method: "POST", body: "{}" });
      setStreamConfigStatus(`Cycle finished. Finalized ${Number(result.finalizedUsageCount || 0)} usage month(s) and sent ${Number(result.alertsSent || 0)} alert batch(es).`, "success");
    } catch (error) {
      setStreamConfigStatus(error.message, "error");
    }
  });
  $("[data-seller-activation-form]")?.addEventListener("submit", createSellerActivation);
  $("[data-seller-activation-copy]")?.addEventListener("click", async () => {
    const value = $("[data-seller-activation-url]")?.value || "";
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setSellerActivationStatus("Activation link copied.", "success"); }
    catch { $("[data-seller-activation-url]").select(); document.execCommand("copy"); setSellerActivationStatus("Activation link copied.", "success"); }
  });
  $("[data-admin-reorders-refresh]")?.addEventListener("click", () => refreshAdminReorders().catch(error => setAdminReordersStatus(error.message, "error")));
  $("[data-admin-reorders-list]")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-reorder-id]"); if (!button) return; button.disabled = true;
    try { await request(`/admin/reorders/${encodeURIComponent(button.dataset.reorderId)}`, { method: "POST", body: JSON.stringify({ status: button.dataset.reorderStatus }) }); await refreshAdminReorders(); }
    catch (error) { button.disabled = false; setAdminReordersStatus(error.message, "error"); }
  });
  $("[data-identity-review-refresh]").addEventListener("click", () => refreshIdentityReviews().catch(error => setIdentityReviewStatus(error.message, "error")));
  $("[data-identity-review-list]").addEventListener("click", async event => {
    const button = event.target.closest("[data-identity-decision]");
    if (!button) return;
    const decision = button.dataset.identityDecision;
    const confirmation = decision === "approve_seller"
      ? "Use the one Master-authorized duplicate-identity exception and activate this as a normal Seller account? This account will not receive Master access."
      : `${decision === "approve" ? "Approve" : "Reject"} this identity collision?`;
    if (!confirm(confirmation)) return;
    button.disabled = true;
    try {
      await request(`/admin/identity-reviews/${encodeURIComponent(button.dataset.reviewId)}`, { method: "POST", body: JSON.stringify({ decision }) });
      await refreshIdentityReviews();
    } catch (error) { button.disabled = false; setIdentityReviewStatus(error.message, "error"); }
  });
  $("[data-inventory-new]").addEventListener("click", () => openInventoryModal());
  $("[data-inventory-shipping-test]").addEventListener("click", event => testEasyPost(event.currentTarget));
  $("[data-inventory-import]").addEventListener("click", importStarterInventory);
  $("[data-inventory-refresh]").addEventListener("click", () => refreshInventory({ announce: true }).catch(error => setInventoryStatus(error.message, "error")));
  $("[data-inventory-search]").addEventListener("input", () => {
    clearTimeout(inventorySearchTimer);
    inventorySearchTimer = setTimeout(() => refreshInventory().catch(error => setInventoryStatus(error.message, "error")), 220);
  });
  $("[data-inventory-status-filter]").addEventListener("change", renderInventory);
  $("[data-tracking-member-search]").addEventListener("input", () => { clearTimeout(trackingMemberSearchTimer); trackingMemberSearchTimer = setTimeout(() => searchTrackingMembers().catch(error => showTrackingListError("[data-tracking-member-results]", error)), 220); });
  $("[data-tracking-member-search]").addEventListener("keydown", event => { if (event.key !== "Enter") return; event.preventDefault(); clearTimeout(trackingMemberSearchTimer); searchTrackingMembers().catch(error => showTrackingListError("[data-tracking-member-results]", error)); });
  $("[data-tracking-member-search-button]").addEventListener("click", () => searchTrackingMembers().catch(error => showTrackingListError("[data-tracking-member-results]", error)));
  $("[data-tracking-order-search]").addEventListener("input", () => { clearTimeout(trackingOrderSearchTimer); trackingOrderSearchTimer = setTimeout(() => refreshAdminOrders().catch(error => showTrackingListError("[data-admin-order-list]", error)), 220); });
  $("[data-tracking-order-search]").addEventListener("keydown", event => { if (event.key !== "Enter") return; event.preventDefault(); clearTimeout(trackingOrderSearchTimer); refreshAdminOrders().catch(error => showTrackingListError("[data-admin-order-list]", error)); });
  $("[data-tracking-order-search-button]").addEventListener("click", () => refreshAdminOrders().catch(error => showTrackingListError("[data-admin-order-list]", error)));
  $("[data-tracking-refresh]").addEventListener("click", () => refreshAdminOrders().then(() => setTrackingStatus("Orders refreshed.", "success")).catch(error => setTrackingStatus(error.message, "error")));
  $("[data-tracking-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      memberId: selectedTrackingMember?.id || "",
      orderNumber: String(values.get("orderNumber") || "").trim(),
      channel: String(values.get("channel") || "manual"),
      items: trackingItemsFromText(values.get("items")),
      carrier: String(values.get("carrier") || ""),
      trackingCode: String(values.get("trackingCode") || "").trim()
    };
    if (!payload.memberId) { setTrackingStatus("Choose a verified member from the search results first.", "error"); $("[data-tracking-member-search]").focus(); return; }
    const button = $("[data-tracking-submit]"); button.disabled = true; button.textContent = "Creating Tracker..."; setTrackingStatus("");
    try {
      const data = await request("/admin/orders", { method: "POST", body: JSON.stringify(payload) });
      const savedMember = selectedTrackingMember;
      form.reset(); selectTrackingMember(null); $("[data-tracking-member-search]").value = "";
      setTrackingStatus(`${data.order?.orderNumber || payload.orderNumber} is now visible under ${savedMember?.liveUsername ? `@${savedMember.liveUsername}` : savedMember?.email}'s Orders.`, "success");
      await refreshAdminOrders();
    } catch (error) { setTrackingStatus(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "Create Order + Tracking"; }
  });
  document.querySelectorAll("[data-inventory-close]").forEach(button => button.addEventListener("click", closeInventoryModal));
  ["cogs", "usShipping", "packaging", "overhead", "retailFixedFee", "wholesaleHandling", "retailListPrice", "websiteListPrice", "internationalListPrice", "liveListPrice", "wholesaleSmallListPrice", "wholesaleCaseListPrice", "wholesalePalletListPrice"].forEach(name => $("[data-inventory-form]").elements.namedItem(name)?.addEventListener("input", updateInventoryPricePreview));
  $("[data-inventory-form]").elements.namedItem("isActive").addEventListener("change", updateInventoryPricePreview);
  $("[data-inventory-form]").elements.namedItem("storeTarget")?.addEventListener("change", syncInventoryTargetUi);
  $("[data-inventory-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const buyerStore = String(form.elements.namedItem("storeTarget")?.value || "buyer_store") === "buyer_store";
    const payload = buyerStore ? buyerStorePayloadFromForm(form) : inventoryPayloadFromForm(form);
    const previous = buyerStore ? null : inventoryItems.find(item => String(item.id) === editingInventoryId);
    if (previous?.isActive && !payload.isActive && !confirm(`Deactivate “${previous.name}”? It will stop appearing in new product campaigns and the public catalog.`)) return;
    const button = $("[data-inventory-save]");
    button.disabled = true; button.textContent = "Saving..."; setInventoryFormStatus("");
    try {
      const path = buyerStore ? "/admin/store-listings" : (editingInventoryId ? `/admin/inventory/${encodeURIComponent(editingInventoryId)}` : "/admin/inventory");
      const data = await request(path, { method: "POST", body: JSON.stringify(payload) });
      const savedName = String(data.item?.name || data.item?.title || payload.name || payload.title || "Product");
      closeInventoryModal();
      if (!buyerStore) {
        await refreshInventory();
        await refreshCampaignInventory("").catch(() => {});
        closeCampaignInventoryOptions();
        setInventoryStatus(`${savedName} saved. Product campaign search is now up to date.`, "success");
      } else {
        setInventoryStatus(`${savedName} posted to Buyer Store.`, "success");
      }
    } catch (error) { setInventoryFormStatus(error.message, "error"); }
    finally { button.disabled = false; button.textContent = buyerStore ? "Post to Buyer Store" : (editingInventoryId ? "Save Changes" : "Save Product"); }
  });
  $("[data-email-all]").addEventListener("click", () => { emailAudience = "all"; selectedEmailMembers.clear(); syncEmailComposer(); setMasterEmailStatus("Message All selected. Review your subject and message before sending.", "success"); });
  $("[data-email-tier-select]").addEventListener("click", () => { emailAudience = "tier"; selectedEmailMembers.clear(); syncEmailComposer(); setMasterEmailStatus(`Referral tier ${$("[data-email-tier]").selectedOptions[0].textContent} selected.`, "success"); });
  $("[data-email-select-open]").addEventListener("click", openEmailMemberSelection);
  document.querySelectorAll("[data-email-select-close]").forEach(button => button.addEventListener("click", closeEmailMemberSelection));
  $("[data-email-select-finished]").addEventListener("click", () => { closeEmailMemberSelection(); syncEmailComposer(); $("[data-master-email-form] input[name='subject']").focus(); });
  $("[data-email-member-search]").addEventListener("input", () => { clearTimeout(emailMemberSearchTimer); emailMemberSearchTimer = setTimeout(() => searchEmailMembers().catch(error => showStatus(error.message, "error")), 220); });
  $("[data-email-cancel]").addEventListener("click", resetMasterEmail);
  $("[data-master-email-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { audience: emailAudience, tierName: $("[data-email-tier]").value, fromAddress: String(form.get("fromAddress") || "rewards@crackpacks.com"), subject: String(form.get("subject") || "").trim(), message: String(form.get("message") || "").trim() };
    if (emailAudience === "selected") payload.memberIds = [...selectedEmailMembers.keys()];
    const audienceLabel = emailAudience === "all" ? "every verified member" : emailAudience === "tier" ? `${payload.tierName} referral-tier members` : `${selectedEmailMembers.size} selected member${selectedEmailMembers.size === 1 ? "" : "s"}`;
    if (!emailAudience || (emailAudience === "selected" && !selectedEmailMembers.size)) { setMasterEmailStatus("Choose Message All or Select Few first.", "error"); return; }
    if (!confirm(`Send \"${payload.subject}\" to ${audienceLabel}?`)) return;
    const button = $("[data-email-send]"); button.disabled = true; button.textContent = "Sending..."; setMasterEmailStatus("");
    try {
      const data = await request("/admin/email", { method: "POST", body: JSON.stringify(payload) });
      setMasterEmailStatus(`Email queued for ${Number(data.recipientCount || 0)} member${Number(data.recipientCount || 0) === 1 ? "" : "s"}.`, "success");
      event.currentTarget.reset(); emailAudience = ""; selectedEmailMembers.clear(); syncEmailComposer();
    } catch (error) { setMasterEmailStatus(error.message, "error"); }
    finally { button.textContent = "Send"; syncEmailComposer(); }
  });
  $("[data-campaign-open]").addEventListener("click", openCampaignModal);
  document.querySelectorAll("[data-campaign-close]").forEach(button => button.addEventListener("click", closeCampaignModal));
  $("[data-campaign-reward-type]").addEventListener("change", () => {
    syncCampaignFields();
    if ($("[data-campaign-reward-type]").value === "product") refreshCampaignInventory("").catch(error => setCampaignFormStatus(error.message, "error"));
  });
  $("[data-campaign-inventory-search]").addEventListener("focus", () => refreshCampaignInventory().catch(error => setCampaignFormStatus(error.message, "error")));
  $("[data-campaign-inventory-search]").addEventListener("input", event => {
    clearCampaignInventorySelection("Select a matching inventory result; typed text alone cannot attach a product.");
    clearTimeout(campaignInventorySearchTimer);
    campaignInventorySearchTimer = setTimeout(() => refreshCampaignInventory(event.currentTarget.value).catch(error => setCampaignFormStatus(error.message, "error")), 180);
  });
  $("[data-campaign-inventory-search]").addEventListener("blur", () => setTimeout(closeCampaignInventoryOptions, 140));
  $("[data-campaign-inventory-search]").addEventListener("keydown", event => {
    const list = $("[data-campaign-inventory-options]");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) { refreshCampaignInventory().catch(error => setCampaignFormStatus(error.message, "error")); return; }
      activateCampaignInventoryOption(campaignInventoryActiveIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && campaignInventoryActiveIndex >= 0) {
      event.preventDefault();
      selectCampaignInventory(campaignInventoryOptions[campaignInventoryActiveIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault(); closeCampaignInventoryOptions();
    }
  });
  $("[data-campaign-expiry-unit]").addEventListener("change", () => syncCampaignExpiryUnit({ convert: true }));
  $("[data-campaign-pack-field] input").addEventListener("input", event => {
    if ($("[data-campaign-reward-type]").value !== "pack_draft") return;
    const maxInput = $("[data-campaign-form] input[name='maxRedemptions']");
    if (Number(maxInput.value) > Number(event.currentTarget.value)) maxInput.value = event.currentTarget.value;
  });
  $("[data-campaign-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const rewardType = String(form.get("rewardType") || "");
    const packCount = Number(form.get("packCount") || 0);
    const maxRedemptions = Number(form.get("maxRedemptions") || 0);
    const expiresInValue = Number(form.get("expiresInValue"));
    const expiresInUnit = String(form.get("expiresInUnit") || "hours");
    const neverExpires = expiresInUnit === "indefinite";
    const expiresInHours = expiresInUnit === "days" ? expiresInValue * 24 : expiresInValue;
    const inventoryItemId = String(form.get("inventoryItemId") || "");
    if (rewardType === "pack_draft" && packCount < maxRedemptions) {
      setCampaignFormStatus("Choose a Pack # needs at least one unique pack number per person. Increase packs or lower maximum people.", "error");
      $("[data-campaign-pack-field] input").focus();
      return;
    }
    if (!neverExpires && (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 168 || (expiresInUnit === "days" && (expiresInValue < 1 || expiresInValue > 7)))) {
      setCampaignFormStatus("Time to Expire must be 1–168 hours or 1–7 days.", "error");
      $("[data-campaign-form] input[name='expiresInValue']").focus();
      return;
    }
    if (rewardType === "product" && !inventoryItemId) {
      setCampaignFormStatus("Choose a product from the inventory search results before generating this campaign.", "error");
      $("[data-campaign-inventory-search]").focus();
      return;
    }
    const payload = {
      title: String(form.get("title") || "").trim(),
      rewardType,
      neverExpires,
      maxRedemptions
    };
    if (!neverExpires) payload.expiresInHours = Number(expiresInHours.toFixed(6));
    if (rewardType === "percent") payload.percent = Number(form.get("percent"));
    if (rewardType === "pack_draft") payload.packCount = packCount;
    if (rewardType === "product") payload.inventoryItemId = inventoryItemId;
    const submit = $("[data-campaign-submit]"); submit.disabled = true; submit.textContent = "Generating..."; setCampaignFormStatus("");
    try {
      const data = await request("/admin/campaigns", { method: "POST", body: JSON.stringify(payload) });
      if (data.serverNow) campaignClockOffset = Date.parse(data.serverNow) - Date.now();
      if (!data.campaign) throw new Error("The campaign response was incomplete.");
      formElement.reset(); clearCampaignInventorySelection(); syncCampaignFields(); syncCampaignExpiryUnit(); closeCampaignModal();
      try { await renderGeneratedCampaign(data.campaign); }
      catch (qrError) { showStatus(`Campaign created, but its QR could not load: ${qrError.message}`, "error"); }
      await refreshCampaigns();
      if ($("[data-campaign-generated-qr]").src) showStatus("Campaign created. Its link and QR are ready.", "success");
    } catch (error) {
      const message = campaignWeeklyError(error);
      setCampaignFormStatus(message, "error");
      showStatus(message, "error");
    } finally { submit.disabled = false; submit.textContent = "Generate Discount + QR"; }
  });
  $("[data-campaign-copy]").addEventListener("click", () => copyGeneratedCampaign().catch(error => showStatus(error.message, "error")));
  $("[data-campaign-download]").addEventListener("click", event => downloadCampaignQr(event.currentTarget).catch(error => showStatus(error.message, "error")));
  $("[data-campaign-share]").addEventListener("click", () => generatedCampaign ? openCampaignShare(generatedCampaign).catch(error => showStatus(error.message, "error")) : showStatus("Generate a campaign before sharing it.", "error"));
  $("[data-campaign-generated-toggle]").addEventListener("click", event => generatedCampaign ? toggleCampaign(generatedCampaign, event.currentTarget).catch(error => showStatus(error.message, "error")) : showStatus("Generate a campaign before changing its QR status.", "error"));
  $("[data-campaign-refresh]").addEventListener("click", () => refreshCampaigns().catch(error => showStatus(error.message, "error")));
  $("[data-campaign-search]").addEventListener("input", event => renderCampaigns(campaignListState, event.currentTarget.value));
  ["[data-campaign-type-filter]", "[data-campaign-date-from]", "[data-campaign-date-to]"].forEach(selector => $(selector).addEventListener("change", () => renderCampaigns(campaignListState, $("[data-campaign-search]").value)));
  $("[data-campaign-filters-clear]").addEventListener("click", () => {
    $("[data-campaign-search]").value = ""; $("[data-campaign-type-filter]").value = "all"; $("[data-campaign-date-from]").value = ""; $("[data-campaign-date-to]").value = "";
    renderCampaigns(campaignListState);
  });
  document.querySelectorAll("[data-campaign-share-close]").forEach(button => button.addEventListener("click", closeCampaignShare));
  $("[data-campaign-share-download]").addEventListener("click", () => downloadCampaignShare().catch(error => showStatus(error.message, "error")));
  $("[data-campaign-share-copy]").addEventListener("click", () => campaignShareState ? copyCampaignText(shareCaption(campaignShareState)).then(() => showStatus("Share caption and link copied.", "success")).catch(error => showStatus(error.message, "error")) : showStatus("Open a share card first.", "error"));
  $("[data-campaign-share-native]").addEventListener("click", () => nativeCampaignShare().catch(error => { if (error.name !== "AbortError") showStatus(error.message, "error"); }));
  document.querySelectorAll("[data-campaign-share-social]").forEach(button => button.addEventListener("click", () => shareCampaignToSocial(button.dataset.campaignShareSocial).catch(error => showStatus(error.message, "error"))));
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!$("[data-inventory-modal]").hidden) closeInventoryModal();
    else if (!$("[data-email-select-modal]").hidden) closeEmailMemberSelection();
    else if (!$("[data-campaign-share-modal]").hidden) closeCampaignShare();
    else if (!$("[data-campaign-modal]").hidden) closeCampaignModal();
  });
  $("[data-admin-refresh]").addEventListener("click", () => Promise.all([refreshDashboard(), refreshCampaigns(), refreshInventory(), refreshAdminOrders()]).catch(error => showStatus(error.message, "error")));
  $("[data-admin-filter]").addEventListener("change", () => refreshDashboard().catch(error => showStatus(error.message, "error")));
  $("[data-admin-search]").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshDashboard().catch(error => showStatus(error.message, "error")), 250); });
  ["[data-admin-date-from]", "[data-admin-date-to]"].forEach(selector => $(selector).addEventListener("change", () => renderClaims(legacyClaimsState)));
  $("[data-owner-referral-copy]").addEventListener("click", () => copyOwnerReferral().catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-download]").addEventListener("click", event => downloadOwnerReferral(event.currentTarget).catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-share]").addEventListener("click", () => openOwnerReferralShare().catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-toggle]").addEventListener("click", () => toggleOwnerReferral().catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-refresh]").addEventListener("click", () => refreshOwnerReferral({ announce: true }).catch(() => {}));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ownerReferralState) refreshOwnerReferral().catch(() => {}); });
  window.addEventListener("focus", () => { if (ownerReferralState) refreshOwnerReferral().catch(() => {}); });
  window.addEventListener("beforeunload", () => {
    if (ownerReferralQrUrl) URL.revokeObjectURL(ownerReferralQrUrl);
    if (campaignQrObjectUrl) URL.revokeObjectURL(campaignQrObjectUrl);
    clearInterval(campaignCountdownTimer);
    clearTimeout(inventorySearchTimer);
    clearTimeout(campaignInventorySearchTimer);
    clearTimeout(trackingMemberSearchTimer);
    clearTimeout(trackingOrderSearchTimer);
  });
  setOwnerReferralActionsEnabled(false);
  syncCampaignFields();
  syncCampaignExpiryUnit();
  syncEmailComposer();
  openMasterSection("create_link");
  boot().catch(error => { showStatus(error.message, "error"); show("[data-admin-login]", true); initializeTurnstile(); });
})();
