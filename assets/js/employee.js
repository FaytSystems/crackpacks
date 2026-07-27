(() => {
  const app = document.querySelector("[data-employee-app]");
  if (!app) return;
  const config = window.CRACKPACKS_CONFIG || {};
  const api = String(config.rewardsApiUrl || "").replace(/\/$/, "");
  const token = localStorage.getItem("cp_rewards_token") || "";
  const $ = selector => document.querySelector(selector);
  const params = new URLSearchParams(location.search);
  let dashboard = null;

  const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
  const setStatus = (message = "", kind = "") => {
    const node = $("[data-employee-status]");
    node.textContent = message;
    node.dataset.kind = kind;
  };
  const setTimeStatus = (message = "", kind = "") => {
    const node = $("[data-employee-time-status]");
    node.textContent = message;
    node.dataset.kind = kind;
  };
  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "The employee account request failed.");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function requestedView() {
    const value = String(params.get("view") || location.hash.replace(/^#/, "") || "hours");
    return ["hours", "pay", "deposit"].includes(value) ? value : "hours";
  }
  function openView(view, updateUrl = true) {
    document.querySelectorAll("[data-employee-view]").forEach(node => { node.hidden = node.dataset.employeeView !== view; });
    document.querySelectorAll("[data-employee-view-button]").forEach(button => {
      const active = button.dataset.employeeViewButton === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    if (updateUrl) history.replaceState({}, document.title, `${location.pathname}?view=${encodeURIComponent(view)}#${encodeURIComponent(view)}`);
  }
  function appendEmpty(container, message) {
    const empty = document.createElement("div");
    empty.className = "employee-empty";
    empty.textContent = message;
    container.append(empty);
  }
  function renderTimeEntries(entries) {
    const container = $("[data-employee-time-list]");
    container.replaceChildren();
    if (!entries.length) {
      appendEmpty(container, "No hours submitted yet.");
      return;
    }
    entries.forEach(entry => {
      const row = document.createElement("article");
      row.className = "employee-time-row";
      const details = document.createElement("div");
      const title = document.createElement("h4");
      title.textContent = `${entry.workDate} | ${entry.startTime}-${entry.endTime}`;
      const summary = document.createElement("p");
      summary.textContent = `${Number(entry.hoursWorked || 0).toFixed(2)} hours | ${entry.breakMinutes} minute break`;
      const pay = document.createElement("strong");
      pay.textContent = `${money(entry.expectedPayCents)} expected`;
      const note = document.createElement("p");
      note.textContent = entry.note || "No shift note.";
      details.append(title, summary, pay, note);
      const state = document.createElement("span");
      state.className = `employee-time-state ${entry.status || ""}`;
      state.textContent = entry.status || "unknown";
      row.append(details, state);
      container.append(row);
    });
  }
  function summaryValue(summary, key) {
    if (summary && typeof summary[key] === "object") return summary[key];
    return {
      hours: Number(summary?.[`${key}Hours`] || 0),
      payCents: Number(summary?.[`${key}PayCents`] || 0)
    };
  }
  function renderPay(summary, disclaimer) {
    [
      ["submitted", "[data-pay-submitted-hours]", "[data-pay-submitted-money]"],
      ["approved", "[data-pay-approved-hours]", "[data-pay-approved-money]"],
      ["paid", "[data-pay-paid-hours]", "[data-pay-paid-money]"]
    ].forEach(([key, hoursSelector, paySelector]) => {
      const value = summaryValue(summary, key);
      $(hoursSelector).textContent = `${Number(value.hours || 0).toFixed(2)} hr`;
      $(paySelector).textContent = money(value.payCents);
    });
    $("[data-employee-pay-disclaimer]").textContent = disclaimer || "";
  }
  function renderDeposit(payout) {
    const ready = Boolean(payout?.payoutsEnabled);
    const submitted = Boolean(payout?.detailsSubmitted);
    const state = $("[data-employee-deposit-state]");
    state.classList.toggle("is-ready", ready);
    state.textContent = ready ? "Ready" : submitted ? "Stripe review" : "Setup required";
    $("[data-employee-deposit-title]").textContent = ready
      ? "Direct deposit account is ready"
      : submitted
        ? "Stripe has your details"
        : "Connect a payout account with Stripe";
    $("[data-employee-deposit-copy]").textContent = ready
      ? "Open Stripe to review your payout details."
      : submitted
        ? `${Number(payout.requirementsDue || 0)} Stripe requirement(s) currently need attention.`
        : "Bank, identity, and tax details are entered only in Stripe's hosted onboarding.";
    $("[data-employee-deposit-button]").textContent = ready ? "Open Stripe Dashboard" : submitted ? "Review Stripe Requirements" : "Set Up Direct Deposit";
  }
  function render(data) {
    dashboard = data;
    const employee = data.employee || {};
    $("[data-employee-heading-copy]").textContent = `${employee.name || employee.email} | ${employee.email}`;
    $("[data-employee-id]").textContent = employee.employeeId || "Pending";
    $("[data-employee-job-title]").textContent = employee.jobTitle || "Employee";
    $("[data-employee-rate]").textContent = `${money(employee.hourlyRateCents)}/hr`;
    $("[data-employee-account-state]").textContent = employee.status || "unknown";
    renderTimeEntries(Array.isArray(data.entries) ? data.entries : []);
    renderPay(data.summary, data.payDisclaimer);
    renderDeposit(employee.payout);
    $("[data-employee-logout]").hidden = false;
    $("[data-employee-dashboard]").hidden = false;
    $("[data-employee-access]").hidden = true;
    openView(requestedView(), false);
  }
  async function refresh() {
    if (!token) {
      $("[data-employee-access]").hidden = false;
      $("[data-employee-dashboard]").hidden = true;
      $("[data-employee-heading-copy]").textContent = "Sign in with an activated employee account.";
      return;
    }
    try {
      const [data, portal] = await Promise.all([
        request("/employee/dashboard"),
        request("/portal/status").catch(() => ({}))
      ]);
      render(data);
      $("[data-employee-seller-link]").hidden = !portal.sellerAccess;
      $("[data-employee-master-link]").hidden = !portal.masterAccess;
      setStatus("");
    } catch (error) {
      $("[data-employee-access]").hidden = false;
      $("[data-employee-dashboard]").hidden = true;
      $("[data-employee-heading-copy]").textContent = "Employee access is not active for this account.";
      setStatus(error.message, "error");
    }
  }
  async function openStripePayout() {
    const button = $("[data-employee-deposit-button]");
    button.disabled = true;
    setStatus("Opening secure Stripe direct-deposit setup...");
    try {
      const data = await request("/employee/payout/onboarding", { method: "POST", body: "{}" });
      if (!data.url) throw new Error("Stripe did not return a secure setup link.");
      location.href = data.url;
    } catch (error) {
      setStatus(error.message, "error");
      button.disabled = false;
    }
  }

  document.querySelectorAll("[data-employee-view-button]").forEach(button => button.addEventListener("click", () => openView(button.dataset.employeeViewButton)));
  $("[data-employee-refresh]").addEventListener("click", () => refresh().then(() => setStatus("Employee dashboard refreshed.", "success")).catch(error => setStatus(error.message, "error")));
  $("[data-employee-deposit-button]").addEventListener("click", openStripePayout);
  $("[data-employee-time-form]").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const button = $("[data-employee-time-submit]");
    const payload = {
      workDate: String(values.get("workDate") || ""),
      startTime: String(values.get("startTime") || ""),
      endTime: String(values.get("endTime") || ""),
      breakMinutes: Number(values.get("breakMinutes") || 0),
      note: String(values.get("note") || "").trim()
    };
    button.disabled = true;
    setTimeStatus("Submitting hours...");
    try {
      await request("/employee/time-entries", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      form.elements.namedItem("workDate").value = new Date().toISOString().slice(0, 10);
      form.elements.namedItem("breakMinutes").value = "0";
      await refresh();
      setTimeStatus("Hours submitted for Master account review.", "success");
    } catch (error) {
      setTimeStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  $("[data-employee-logout]").addEventListener("click", async () => {
    try { await request("/auth/logout", { method: "POST", body: "{}" }); } catch {}
    localStorage.removeItem("cp_rewards_token");
    location.href = "referral.html?return=employee";
  });
  const menuButton = $(".menu-toggle");
  const navigation = $("#employee-site-nav");
  menuButton?.addEventListener("click", () => {
    const open = navigation?.classList.toggle("is-open") ?? false;
    menuButton.setAttribute("aria-expanded", String(open));
  });
  navigation?.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
    navigation.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
  }));
  $("[data-employee-time-form]").elements.namedItem("workDate").value = new Date().toISOString().slice(0, 10);
  refresh().then(() => {
    if (params.get("connect") === "refresh") openStripePayout();
    else if (params.get("connect") === "return") setStatus("Stripe returned to Crack Packs. Your payout status has been refreshed.", "success");
  });
})();
