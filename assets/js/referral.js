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
  let turnstileWidgetId = null;
  let authRequestSent = false;
  let authRequestPending = false;
  let authMode = referralCode || qs.get("mode") === "signup" ? "signup" : "signin";
  let accountState = null;
  let welcomeDiscountLoaded = false;
  const authModeCopy = {
    signin: {
      kicker: "Returning collector",
      title: "Sign in to your Profile",
      description: "Enter the email connected to your Crack Packs account. We will send a secure sign-in link.",
      emailLabel: "Account email",
      sendLabel: "Email me a sign-in link",
      modalTitle: "Check inbox for your sign-in link",
      modalCopy: "If this email belongs to a Crack Packs account, open the secure sign-in link within 10 minutes. If nothing arrives, choose Create Account.",
      sentStatus: "If that email matches an account, a secure sign-in link is on the way."
    },
    signup: {
      kicker: "New collector",
      title: "Create your Profile",
      description: "Use an email you can access. We will send a secure link to begin verified account setup. Already registered? Choose Sign In.",
      emailLabel: "Signup email",
      sendLabel: "Send signup link",
      modalTitle: "Check inbox to create your account",
      modalCopy: "Open the secure signup link within 10 minutes to continue account and identity verification.",
      sentStatus: "Signup link sent. Check your inbox to continue."
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
    const submittedReferral = submittedMode === "signup" ? referralCode : "";
    const sendButton = $("[data-send-verification]");
    const emailInput = requestForm.querySelector("input[name='email']");
    authRequestPending = true;
    sendButton.disabled = true;
    sendButton.textContent = "Sending secure link...";
    emailInput.disabled = true;
    authModeButtons.forEach(button => { button.disabled = true; });
    try {
      await request("/auth/request", { method: "POST", body: JSON.stringify({ email, referralCode: submittedReferral, authMode: submittedMode, turnstileToken }) });
      authRequestSent = true;
      resetTurnstile();
      sendButton.textContent = "Check Inbox 10 min code";
      sendButton.disabled = true;
      const copy = authModeCopy[submittedMode];
      $("[data-email-modal-title]").textContent = copy.modalTitle;
      $("[data-email-modal-copy]").textContent = copy.modalCopy;
      $("[data-email-modal]").hidden = false;
      showStatus(copy.sentStatus, "success");
    }
    catch (error) {
      authRequestSent = false;
      resetTurnstile();
      sendButton.textContent = "Complete security check";
      sendButton.disabled = true;
      showStatus(error.message, "error");
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
      const data = await request("/auth/verify-link", { method: "POST", body: JSON.stringify({ token: verificationToken }) });
      token = data.token; localStorage.setItem("cp_rewards_token", token);
      history.replaceState({}, document.title, `${location.pathname}${referralCode ? `?ref=${encodeURIComponent(referralCode)}` : ""}`);
      const accountReady = data.account.deviceVerified && data.account.profileComplete;
      const signedIn = data.authFlow === "signin" || data.authFlow === "admin" || data.authFlow === "legacy";
      showStatus(accountReady ? "Signed in to your Profile." : signedIn ? "Signed in. Continue account verification." : "Email verified. Continue secure account verification.", "success");
      renderAccount(data.account);
    } catch (error) {
      const preserved = new URLSearchParams();
      if (referralCode) preserved.set("ref", referralCode);
      if (authMode === "signup") preserved.set("mode", "signup");
      const query = preserved.toString();
      history.replaceState({}, document.title, `${location.pathname}${query ? `?${query}` : ""}`);
      showStatus(error.message, "error");
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
