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
    ["[data-owner-referral-copy]", "[data-owner-referral-download]"].forEach(selector => {
      const button = $(selector);
      if (button) button.disabled = !enabled;
    });
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
    clearTimeout(ownerReferralTimer);
    clearInterval(ownerReferralCountdownTimer);
    updateOwnerReferralCountdown();
    ownerReferralCountdownTimer = setInterval(updateOwnerReferralCountdown, 30000);
    const delay = Math.max(1000, Date.parse(data.expiresAt) - Date.parse(data.serverNow) + 1200);
    ownerReferralTimer = setTimeout(() => refreshOwnerReferral({ announce: true }).catch(() => {}), delay);
    setOwnerReferralActionsEnabled(true);
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
  const campaignRewardDescription = campaign => {
    const supplied = pick(campaign, "rewardDescription", "reward_description", "description");
    if (supplied) return String(supplied);
    const type = String(pick(campaign, "rewardType", "reward_type") || "");
    if (type === "percent") return `${Number(pick(campaign, "percent") || 0)}% off`;
    if (type === "free_shipping") return "Free shipping";
    if (type === "pick_a_pack") return "Pick a Pack";
    if (type === "pack_draft") return "Choose a Pack #";
    return "Campaign reward";
  };
  const campaignWeeklyError = error => {
    const message = String(error?.message || "");
    if (error?.status === 429 || /weekly|thursday/i.test(message)) return "The weekly campaign limit has been reached. Campaign availability resets Thursday; existing campaigns remain listed below.";
    return message || "The campaign request could not be completed.";
  };
  function updateCampaignCountdowns() {
    document.querySelectorAll("[data-campaign-expires-at]").forEach(node => {
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
  function syncCampaignFields() {
    const type = $("[data-campaign-reward-type]").value;
    const percentField = $("[data-campaign-percent-field]");
    const packField = $("[data-campaign-pack-field]");
    const percentInput = percentField.querySelector("input");
    const packInput = packField.querySelector("input");
    const needsPacks = type === "pack_draft";
    percentField.hidden = type !== "percent";
    percentInput.required = type === "percent";
    packField.hidden = !needsPacks;
    packInput.required = needsPacks;
    if (type === "pack_draft") {
      const maxInput = $("[data-campaign-form] input[name='maxRedemptions']");
      if (Number(maxInput.value) > Number(packInput.value)) maxInput.value = packInput.value;
    }
  }
  function syncCampaignExpiryUnit({ convert = false } = {}) {
    const unitInput = $("[data-campaign-expiry-unit]");
    const valueInput = $("[data-campaign-form] input[name='expiresInValue']");
    const help = $("[data-campaign-expiry-help]");
    const unit = unitInput.value === "days" ? "days" : "hours";
    const previousUnit = unitInput.dataset.previousUnit || unit;
    let value = Number(valueInput.value);
    if (convert && Number.isFinite(value) && previousUnit !== unit) value = unit === "days" ? value / 24 : value * 24;
    const min = 1;
    const max = unit === "days" ? 7 : 168;
    valueInput.min = String(min);
    valueInput.max = String(max);
    valueInput.step = "0.001";
    if (Number.isFinite(value)) valueInput.value = String(Math.min(max, Math.max(min, Number(value.toFixed(3)))));
    help.textContent = unit === "days" ? "Enter 1–7 days; decimals are allowed to 0.001 (for example, 3.05)." : "Enter 1–168 hours.";
    unitInput.dataset.previousUnit = unit;
  }
  function openCampaignModal() {
    campaignModalLastFocus = document.activeElement;
    $("[data-campaign-modal]").hidden = false;
    setCampaignFormStatus("");
    syncCampaignFields();
    syncCampaignExpiryUnit();
    $("[data-campaign-form] input[name='title']").focus();
  }
  function closeCampaignModal() {
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
    expiry.dateTime = expiresAt;
    expiry.dataset.campaignExpiresAt = expiresAt;
    show("[data-campaign-generated]", true);
    startCampaignCountdowns();
    await loadCampaignQr(campaign);
  }
  async function copyGeneratedCampaign() {
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
    const username = String(pick(redemption, "whatnotUsername", "whatnot_username") || "");
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
    const expired = String(pick(campaign, "status") || "").toLowerCase() === "expired" || (expiresAt && Date.parse(expiresAt) <= Date.now() + campaignClockOffset);
    const remaining = Math.max(0, Number(pick(campaign, "remaining") || 0));
    const full = !expired && remaining === 0;
    const card = document.createElement("article"); card.className = `admin-campaign${expired ? " is-expired" : ""}`; card.dataset.campaignCard = "";
    const head = document.createElement("div"); head.className = "admin-campaign-head";
    const heading = document.createElement("div"); const title = document.createElement("h3"); title.textContent = String(pick(campaign, "title") || "Untitled campaign");
    const description = document.createElement("p"); description.className = "admin-campaign-description"; description.textContent = campaignRewardDescription(campaign); heading.append(title, description);
    const chip = document.createElement("span"); chip.dataset.campaignStatus = ""; chip.className = `campaign-status-chip${expired ? " expired" : ""}`; chip.textContent = expired ? "Expired" : full ? "Full" : "Active"; head.append(heading, chip);
    const metrics = document.createElement("div"); metrics.className = "admin-campaign-metrics";
    const claimed = Number(pick(campaign, "claimedCount", "claimed_count") || 0); const cap = Number(pick(campaign, "maxRedemptions", "max_redemptions") || claimed + remaining);
    for (const value of [`Claimed ${claimed}/${cap}`, `${remaining} remaining`]) { const item = document.createElement("strong"); item.textContent = value; metrics.append(item); }
    const expiry = document.createElement("time"); expiry.dateTime = expiresAt; expiry.dataset.campaignExpiresAt = expiresAt; metrics.append(expiry);
    const actions = document.createElement("div"); actions.className = "campaign-card-actions";
    const campaignUrl = String(pick(campaign, "url") || "");
    if (campaignUrl) {
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
      actions.append(copyButton, downloadButton);
    }
    const redemptions = document.createElement("div"); redemptions.className = "campaign-redemptions";
    const list = visibleRedemptions || (Array.isArray(campaign.redemptions) ? campaign.redemptions : []);
    if (list.length) list.forEach(item => redemptions.append(renderCampaignRedemption(item)));
    else { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No verified claims yet."; redemptions.append(empty); }
    card.append(head, metrics, actions, redemptions);
    return card;
  }
  function renderCampaigns(campaigns, filter = "") {
    campaignListState = campaigns;
    const container = $("[data-admin-campaigns]"); container.replaceChildren();
    if (!campaigns.length) { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No campaigns yet. Create one for the next live show."; container.append(empty); return; }
    const query = String(filter || "").trim().toLowerCase();
    const ordered = [...campaigns].sort((a, b) => Date.parse(String(pick(b, "createdAt", "created_at", "expiresAt", "expires_at") || 0)) - Date.parse(String(pick(a, "createdAt", "created_at", "expiresAt", "expires_at") || 0)));
    let matches = 0;
    ordered.forEach(campaign => {
      const allRedemptions = Array.isArray(campaign.redemptions) ? campaign.redemptions : [];
      const visible = query ? allRedemptions.filter(redemption => [pick(redemption, "code"), pick(redemption, "email"), pick(redemption, "whatnotUsername", "whatnot_username")].some(value => String(value || "").toLowerCase().includes(query))) : allRedemptions;
      if (query && !visible.length) return;
      matches += 1;
      container.append(renderCampaign(campaign, visible));
    });
    if (!matches) { const empty = document.createElement("div"); empty.className = "campaign-empty"; empty.textContent = "No campaign claimants match that search."; container.append(empty); }
    startCampaignCountdowns();
  }
  async function refreshCampaigns() {
    if (!memberToken || !adminToken) return;
    const data = await request("/admin/campaigns");
    if (data.serverNow) campaignClockOffset = Date.parse(data.serverNow) - Date.now();
    renderCampaigns(Array.isArray(data.campaigns) ? data.campaigns : [], $("[data-campaign-search]").value);
  }

  function claimStatus(claim) {
    if (claim.redeemed_at) return "redeemed";
    if (new Date(claim.expires_at).getTime() <= Date.now()) return "expired";
    if (claim.redemption_requested_at) return "requested";
    return "issued";
  }
  function renderClaims(claims) {
    const container = $("[data-admin-results]"); container.replaceChildren();
    if (!claims.length) { const empty = document.createElement("div"); empty.className = "admin-empty"; empty.textContent = "No matching discount codes."; container.append(empty); return; }
    claims.forEach(claim => {
      const state = claimStatus(claim); const card = document.createElement("article"); card.className = "admin-claim";
      const identity = document.createElement("div"); const code = document.createElement("h3"); code.textContent = claim.code;
      const member = document.createElement("p"); member.textContent = `${claim.first_name || ""} ${claim.last_name || ""}`.trim() || "Unnamed member";
      const email = document.createElement("p"); email.textContent = claim.email;
      const username = document.createElement("p"); username.textContent = claim.whatnot_username ? `@${claim.whatnot_username}` : "No collector username";
      identity.append(code, member, email, username);
      const details = document.createElement("div"); const badge = document.createElement("span"); badge.className = `admin-claim-status ${state}`; badge.textContent = state;
      const percent = document.createElement("p"); const percentValue = document.createElement("strong"); percentValue.textContent = `${Number(claim.percent)}%`; percent.append(percentValue, " discount");
      const timing = document.createElement("p"); timing.textContent = claim.redeemed_at ? `Redeemed ${new Date(claim.redeemed_at).toLocaleString()}` : claim.redemption_requested_at ? `Requested ${new Date(claim.redemption_requested_at).toLocaleString()}` : `Issued ${new Date(claim.created_at).toLocaleDateString()}`;
      details.append(badge, percent, timing);
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
      card.append(identity, details, actions); container.append(card);
    });
  }
  async function refreshDashboard() {
    const query = encodeURIComponent($("[data-admin-search]").value.trim());
    const filter = encodeURIComponent($("[data-admin-filter]").value);
    const [summaryData, claimsData] = await Promise.all([request("/admin/summary"), request(`/admin/discounts?q=${query}&status=${filter}`)]);
    Object.entries(summaryData.summary).forEach(([key, value]) => { const node = $(`[data-count-${key}]`); if (node) node.textContent = value; });
    renderClaims(claimsData.claims);
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
  $("[data-campaign-open]").addEventListener("click", openCampaignModal);
  document.querySelectorAll("[data-campaign-close]").forEach(button => button.addEventListener("click", closeCampaignModal));
  $("[data-campaign-reward-type]").addEventListener("change", syncCampaignFields);
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
    const expiresInHours = expiresInUnit === "days" ? expiresInValue * 24 : expiresInValue;
    if (rewardType === "pack_draft" && packCount < maxRedemptions) {
      setCampaignFormStatus("Choose a Pack # needs at least one unique pack number per person. Increase packs or lower maximum people.", "error");
      $("[data-campaign-pack-field] input").focus();
      return;
    }
    if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 168 || (expiresInUnit === "days" && (expiresInValue < 1 || expiresInValue > 7))) {
      setCampaignFormStatus("Time to Expire must be 1–168 hours or 1–7 days.", "error");
      $("[data-campaign-form] input[name='expiresInValue']").focus();
      return;
    }
    const payload = {
      title: String(form.get("title") || "").trim(),
      rewardType,
      expiresInHours: Number(expiresInHours.toFixed(6)),
      maxRedemptions
    };
    if (rewardType === "percent") payload.percent = Number(form.get("percent"));
    if (rewardType === "pack_draft") payload.packCount = packCount;
    const submit = $("[data-campaign-submit]"); submit.disabled = true; submit.textContent = "Generating..."; setCampaignFormStatus("");
    try {
      const data = await request("/admin/campaigns", { method: "POST", body: JSON.stringify(payload) });
      if (data.serverNow) campaignClockOffset = Date.parse(data.serverNow) - Date.now();
      if (!data.campaign) throw new Error("The campaign response was incomplete.");
      formElement.reset(); syncCampaignFields(); syncCampaignExpiryUnit(); closeCampaignModal();
      try { await renderGeneratedCampaign(data.campaign); }
      catch (qrError) { showStatus(`Campaign created, but its QR could not load: ${qrError.message}`, "error"); }
      await refreshCampaigns();
      if ($("[data-campaign-generated-qr]").src) showStatus("Campaign created. Its link and QR are ready.", "success");
    } catch (error) {
      const message = campaignWeeklyError(error);
      setCampaignFormStatus(message, "error");
      showStatus(message, "error");
    } finally { submit.disabled = false; submit.textContent = "Generate Discount"; }
  });
  $("[data-campaign-copy]").addEventListener("click", () => copyGeneratedCampaign().catch(error => showStatus(error.message, "error")));
  $("[data-campaign-download]").addEventListener("click", event => downloadCampaignQr(event.currentTarget).catch(error => showStatus(error.message, "error")));
  $("[data-campaign-refresh]").addEventListener("click", () => refreshCampaigns().catch(error => showStatus(error.message, "error")));
  $("[data-campaign-search]").addEventListener("input", event => renderCampaigns(campaignListState, event.currentTarget.value));
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("[data-campaign-modal]").hidden) closeCampaignModal(); });
  $("[data-admin-refresh]").addEventListener("click", () => Promise.all([refreshDashboard(), refreshCampaigns()]).catch(error => showStatus(error.message, "error")));
  $("[data-admin-filter]").addEventListener("change", () => refreshDashboard().catch(error => showStatus(error.message, "error")));
  $("[data-admin-search]").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshDashboard().catch(error => showStatus(error.message, "error")), 250); });
  $("[data-owner-referral-copy]").addEventListener("click", () => copyOwnerReferral().catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-download]").addEventListener("click", event => downloadOwnerReferral(event.currentTarget).catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-refresh]").addEventListener("click", () => refreshOwnerReferral({ announce: true }).catch(() => {}));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ownerReferralState) refreshOwnerReferral().catch(() => {}); });
  window.addEventListener("focus", () => { if (ownerReferralState) refreshOwnerReferral().catch(() => {}); });
  window.addEventListener("beforeunload", () => {
    if (ownerReferralQrUrl) URL.revokeObjectURL(ownerReferralQrUrl);
    if (campaignQrObjectUrl) URL.revokeObjectURL(campaignQrObjectUrl);
    clearInterval(campaignCountdownTimer);
  });
  setOwnerReferralActionsEnabled(false);
  syncCampaignFields();
  syncCampaignExpiryUnit();
  boot().catch(error => { showStatus(error.message, "error"); show("[data-admin-login]", true); initializeTurnstile(); });
})();
