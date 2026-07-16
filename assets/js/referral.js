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

  const qrUrl = value => `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data=${encodeURIComponent(value)}`;
  const stickerUrl = `${config.domain || location.origin}/referral.html`;
  $("[data-sticker-qr]").src = qrUrl(stickerUrl);
  const show = (selector, visible) => { $(selector).hidden = !visible; };
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
    show("[data-auth-panel]", false);
    if (!data.deviceVerified) { show("[data-device-panel]", true); show("[data-profile-panel]", false); show("[data-dashboard]", false); return; }
    show("[data-device-panel]", false);
    if (!data.profileComplete) { show("[data-profile-panel]", true); show("[data-dashboard]", false); return; }
    show("[data-profile-panel]", false); show("[data-dashboard]", true);
    $("[data-member-name]").textContent = data.firstName || "Collector";
    $("[data-referral-count]").textContent = data.referralCount;
    $("[data-tier-name]").textContent = data.tier.name;
    $("[data-invite-code]").textContent = data.inviteCode;
    $("[data-invite-url]").value = data.inviteUrl;
    $("[data-personal-qr]").src = qrUrl(data.inviteUrl);
    $("[data-next-tier]").textContent = data.nextTier ? `${data.nextTier.remaining} more verified friend${data.nextTier.remaining === 1 ? "" : "s"} to unlock ${data.nextTier.name}: ${data.nextTier.reward}.` : "You have reached the highest published reward tier.";
    $("[data-tier-track]").innerHTML = data.tiers.map(t => `<div class="tier-node ${data.referralCount >= t.threshold ? "is-earned" : ""}"><strong>${t.threshold}</strong><br>${t.name}</div>`).join("");
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
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    show("[data-discount-panel]", button.dataset.view === "discount"); show("[data-invite-panel]", button.dataset.view === "invite");
  }));
  $("[data-claim-discount]").addEventListener("click", async () => {
    try { const data = await request("/discount/claim", { method: "POST" }); $("[data-discount-code]").textContent = data.code; showStatus(`${data.description} Expires ${new Date(data.expiresAt).toLocaleDateString()}.`, "success"); }
    catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-invite-form]").addEventListener("submit", async event => {
    event.preventDefault();
    try { await request("/invites", { method: "POST", body: JSON.stringify({ email: new FormData(event.currentTarget).get("email") }) }); event.currentTarget.reset(); showStatus("Invitation sent. It counts after your friend verifies and completes signup.", "success"); }
    catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-copy-link]").addEventListener("click", async () => { await navigator.clipboard.writeText($("[data-invite-url]").value); showStatus("Invitation link copied.", "success"); });
  $("[data-sign-out]").addEventListener("click", () => { localStorage.removeItem("cp_rewards_token"); location.reload(); });
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
  confirmEmailLink();
})();
