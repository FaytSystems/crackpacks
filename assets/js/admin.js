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
    if (!response.ok) throw new Error(payload.error || "The owner dashboard request failed.");
    return payload;
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
    catch { sessionStorage.removeItem("cp_admin_token"); adminToken = ""; show("[data-admin-step-up]", true); }
  }

  $("[data-admin-login-form]").addEventListener("submit", async event => {
    event.preventDefault(); const email = String(new FormData(event.currentTarget).get("email") || "").trim().toLowerCase();
    if (!turnstileToken) { showStatus("Complete the security check.", "error"); return; }
    try { await request("/auth/request", { method: "POST", body: JSON.stringify({ email, turnstileToken, returnTo: "admin" }) }); $("[data-admin-email-modal]").hidden = false; $("[data-admin-send]").disabled = true; $("[data-admin-send]").textContent = "Check inbox"; }
    catch (error) { showStatus(error.message, "error"); }
  });
  $("[data-admin-passkey]").addEventListener("click", async () => {
    try { await stepUp(); show("[data-admin-step-up]", false); show("[data-admin-dashboard]", true); await refreshDashboard(); showStatus("Owner passkey verified.", "success"); }
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
  boot().catch(error => { showStatus(error.message, "error"); show("[data-admin-login]", true); initializeTurnstile(); });
})();
