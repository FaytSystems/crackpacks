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
  const requestBlob = async (path, inviteUrl) => {
    const response = await fetch(`${api}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(memberToken ? { Authorization: `Bearer ${memberToken}` } : {}),
        ...(adminToken ? { "X-Admin-Token": adminToken } : {})
      },
      body: JSON.stringify({ inviteUrl })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || "The owner referral QR could not be generated.");
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
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The owner QR PNG could not be prepared.")), "image/png"));
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
      const percent = document.createElement("p"); percent.innerHTML = `<strong>${Number(claim.percent)}%</strong> discount`;
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
    if (adminToken) await refreshOwnerReferral().catch(() => {});
  }

  $("[data-admin-login-form]").addEventListener("submit", async event => {
    event.preventDefault(); const email = String(new FormData(event.currentTarget).get("email") || "").trim().toLowerCase();
    if (!turnstileToken) { showStatus("Complete the security check.", "error"); return; }
    try { await request("/auth/request", { method: "POST", body: JSON.stringify({ email, turnstileToken, returnTo: "admin" }) }); $("[data-admin-email-modal]").hidden = false; $("[data-admin-send]").disabled = true; $("[data-admin-send]").textContent = "Check inbox"; }
    catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-admin-passkey]").addEventListener("click", async () => {
    try { await stepUp(); show("[data-admin-step-up]", false); show("[data-admin-dashboard]", true); await refreshDashboard(); await refreshOwnerReferral(); showStatus("Owner passkey verified.", "success"); }
    catch (error) { showStatus(error.message || "Owner passkey verification failed.", "error"); }
  });
  document.querySelectorAll("[data-admin-logout]").forEach(button => button.addEventListener("click", async () => {
    try { await request("/admin/logout", { method: "POST" }); } catch {}
    try { await request("/auth/logout", { method: "POST" }); } catch {}
    sessionStorage.removeItem("cp_admin_token"); localStorage.removeItem("cp_rewards_token"); location.href = "admin.html";
  }));
  document.querySelectorAll("[data-admin-email-close]").forEach(button => button.addEventListener("click", () => { $("[data-admin-email-modal]").hidden = true; }));
  $("[data-admin-refresh]").addEventListener("click", () => refreshDashboard().catch(error => showStatus(error.message, "error")));
  $("[data-admin-filter]").addEventListener("change", () => refreshDashboard().catch(error => showStatus(error.message, "error")));
  $("[data-admin-search]").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshDashboard().catch(error => showStatus(error.message, "error")), 250); });
  $("[data-owner-referral-copy]").addEventListener("click", () => copyOwnerReferral().catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-download]").addEventListener("click", event => downloadOwnerReferral(event.currentTarget).catch(error => showStatus(error.message, "error")));
  $("[data-owner-referral-refresh]").addEventListener("click", () => refreshOwnerReferral({ announce: true }).catch(() => {}));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ownerReferralState) refreshOwnerReferral().catch(() => {}); });
  window.addEventListener("focus", () => { if (ownerReferralState) refreshOwnerReferral().catch(() => {}); });
  window.addEventListener("beforeunload", () => { if (ownerReferralQrUrl) URL.revokeObjectURL(ownerReferralQrUrl); });
  setOwnerReferralActionsEnabled(false);
  boot().catch(error => { showStatus(error.message, "error"); show("[data-admin-login]", true); initializeTurnstile(); });
})();
