(() => {
  const root = document.querySelector("[data-rewards-app]");
  if (!root) return;
  const config = window.CRACKPACKS_CONFIG || {};
  const api = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const qs = new URLSearchParams(location.search);
  const referralCode = (qs.get("ref") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const verificationToken = String(qs.get("verify") || "");
  const $ = selector => document.querySelector(selector);
  const status = $("[data-app-status]");
  const showStatus = (message = "", kind = "") => { status.textContent = message; status.dataset.kind = kind; };
  let email = "";
  let turnstileTokenValue = "";
  let accountState = null;
  let welcomeDiscountLoaded = false;
  const turnstileNode = $("[data-turnstile]");
  if (turnstileNode && config.turnstileSiteKey) {
    window.cpTurnstileReady = () => { window.turnstile.render(turnstileNode, {
      sitekey: config.turnstileSiteKey,
      theme: "dark",
      callback: tokenValue => {
        turnstileTokenValue = tokenValue;
        showStatus("");
        const sendButton = $("[data-send-verification]");
        sendButton.disabled = false;
        sendButton.textContent = "Send verification link";
      },
      "expired-callback": () => {
        turnstileTokenValue = "";
        const sendButton = $("[data-send-verification]");
        sendButton.disabled = true;
        sendButton.textContent = "Complete security check";
        showStatus("Security check expired. Complete it again.", "error");
      },
      "error-callback": errorCode => {
        turnstileTokenValue = "";
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
  let token = localStorage.getItem("cp_rewards_token") || "";

  const qrUrl = value => `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&qzone=4&format=png&data=${encodeURIComponent(value)}`;
  const safeHttpUrl = value => {
    try {
      const parsed = new URL(String(value || ""));
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch {
      return "";
    }
  };
  const show = (selector, visible) => { $(selector).hidden = !visible; };
  if (referralCode) {
    show("[data-referral-banner]", true);
    $("[data-attached-referral]").textContent = referralCode;
  }
  const request = async (path, options = {}) => {
    if (!api) throw new Error("Rewards service is not configured yet.");
    const response = await fetch(`${api}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The rewards service could not complete that request.");
    return payload;
  };

  async function loadAccount() {
    if (!token) return;
    try {
      const data = await request("/me");
      renderAccount(data);
    } catch {
      localStorage.removeItem("cp_rewards_token"); token = "";
    }
  }
  function renderAccount(data) {
    accountState = data;
    show("[data-auth-panel]", false);
    if (!data.deviceVerified) { show("[data-device-panel]", true); show("[data-profile-panel]", false); show("[data-dashboard]", false); return; }
    show("[data-device-panel]", false);
    if (!data.profileComplete) { show("[data-profile-panel]", true); show("[data-dashboard]", false); return; }
    show("[data-profile-panel]", false); show("[data-dashboard]", true);
    $("[data-member-name]").textContent = data.firstName || "Collector";
    $("[data-admin-link]").hidden = !data.isAdmin;
    $("[data-referral-count]").textContent = data.referralCount;
    $("[data-tier-name]").textContent = data.tier.name;
    $("[data-invite-code]").textContent = data.inviteCode;
    $("[data-invite-url]").value = data.inviteUrl;
    $("[data-personal-qr]").src = qrUrl(data.inviteUrl);
    $("[data-whatnot-username]").value = data.whatnotUsername || "";
    $("[data-next-tier]").textContent = data.nextTier ? `${data.nextTier.remaining} more verified friend${data.nextTier.remaining === 1 ? "" : "s"} to unlock ${data.nextTier.name}: ${data.nextTier.reward}.` : "You have reached the highest published reward tier.";
    $("[data-tier-track]").innerHTML = data.tiers.map(t => `<div class="tier-node ${data.referralCount >= t.threshold ? "is-earned" : ""}"><strong>${t.threshold}</strong><br>${t.name}</div>`).join("");
    if (data.referredSignup && !welcomeDiscountLoaded) {
      welcomeDiscountLoaded = true;
      show("[data-discount-panel]", true);
      show("[data-invite-panel]", false);
      claimDiscount({ welcome: true }).catch(error => {
        welcomeDiscountLoaded = false;
        showStatus(error.message, "error");
      });
    }
  }

  $("[data-request-form]").addEventListener("submit", async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); email = String(form.get("email")).trim().toLowerCase();
    const turnstileToken = turnstileTokenValue || String(form.get("cf-turnstile-response") || "");
    if (!turnstileToken) {
      showStatus("Complete the visible security check above the button.", "error");
      return;
    }
    try {
      await request("/auth/request", { method: "POST", body: JSON.stringify({ email, referralCode, turnstileToken }) });
      const sendButton = $("[data-send-verification]");
      sendButton.textContent = "Check Inbox 10 min code";
      sendButton.disabled = true;
      $("[data-email-modal]").hidden = false;
      showStatus("Verification email sent.", "success");
    }
    catch (error) { showStatus(error.message, "error"); }
  });
  document.querySelectorAll("[data-email-modal-close]").forEach(button => button.addEventListener("click", () => { $("[data-email-modal]").hidden = true; }));
  document.querySelectorAll("[data-invite-sent-close]").forEach(button => button.addEventListener("click", () => { $("[data-invite-sent-modal]").hidden = true; }));
  document.querySelectorAll("[data-invite-copy-close]").forEach(button => button.addEventListener("click", () => { $("[data-invite-copy-modal]").hidden = true; }));
  document.querySelectorAll("[data-discount-redeemed-close]").forEach(button => button.addEventListener("click", () => { $("[data-discount-redeemed-modal]").hidden = true; }));
  $("[data-profile-form]").addEventListener("submit", async event => {
    event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget));
    try { const data = await request("/profile", { method: "POST", body: JSON.stringify(form) }); showStatus("Identity profile verified.", "success"); renderAccount(data.account); }
    catch (error) { showStatus(error.message, "error"); }
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
  async function copyInviteLink() {
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
    if (inviteView) {
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
  async function downloadInviteQr(button) {
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Preparing QR...";
    try {
      const imageUrl = $("[data-personal-qr]").src;
      if (!imageUrl) throw new Error("Your QR code is not ready yet.");
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("The QR download could not be prepared.");
      const blobUrl = URL.createObjectURL(await response.blob());
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
      const data = await request("/profile/username", { method: "POST", body: JSON.stringify({ whatnotUsername: form.get("whatnotUsername") }) });
      renderAccount(data.account);
      showStatus("WhatNot User Name saved. It is now searchable in the owner dashboard.", "success");
    } catch (error) {
      showStatus(error.message, "error");
    }
  });
  $("[data-sign-out]").addEventListener("click", async () => {
    try { await request("/auth/logout", { method: "POST" }); } catch {}
    localStorage.removeItem("cp_rewards_token");
    sessionStorage.removeItem("cp_admin_token");
    location.href = "referral.html";
  });
  async function confirmEmailLink() {
    if (!verificationToken) return loadAccount();
    try {
      const data = await request("/auth/verify-link", { method: "POST", body: JSON.stringify({ token: verificationToken, referralCode }) });
      token = data.token; localStorage.setItem("cp_rewards_token", token);
      history.replaceState({}, document.title, `${location.pathname}${referralCode ? `?ref=${encodeURIComponent(referralCode)}` : ""}`);
      showStatus("Email verified. Continue with secure device verification.", "success"); renderAccount(data.account);
    } catch (error) {
      history.replaceState({}, document.title, location.pathname); showStatus(error.message, "error");
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
  configureSocialLinks();
  confirmEmailLink();
})();
