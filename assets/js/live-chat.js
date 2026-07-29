(() => {
  "use strict";

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);

  const messageTime = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  };

  function create({ root, apiBase, token, getShowId, pollMs = 4000 } = {}) {
    if (!root || !apiBase || typeof token !== "function" || typeof getShowId !== "function") return null;
    const list = root.querySelector("[data-chat-messages]");
    const form = root.querySelector("[data-chat-form]");
    const input = root.querySelector("[data-chat-input]");
    const submit = root.querySelector("[data-chat-submit]");
    const status = root.querySelector("[data-chat-status]");
    const count = root.querySelector("[data-chat-count]");
    let activeShowId = "";
    let activeShowStatus = "";
    let refreshPending = false;
    let stopped = false;
    let messageFingerprint = "";

    const setStatus = (message = "", kind = "") => {
      if (!status) return;
      status.textContent = message;
      status.dataset.kind = kind;
    };

    const syncComposer = () => {
      const signedIn = Boolean(token());
      const writable = Boolean(activeShowId && ["open", "live"].includes(activeShowStatus));
      if (input) {
        input.disabled = !signedIn || !writable;
        input.placeholder = !activeShowId
          ? "Choose a show to open chat"
          : !signedIn
          ? "Sign in to join the show chat"
          : writable
          ? "Message the live room"
          : "Chat is read-only";
      }
      if (submit) submit.disabled = !signedIn || !writable;
      if (!signedIn && activeShowId) setStatus("Sign in to your Profile to join chat.");
    };

    const renderMessages = messages => {
      if (!list) return;
      const nextFingerprint = messages.map(message => message.id).join("|");
      if (nextFingerprint === messageFingerprint) return;
      const shouldFollow = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      messageFingerprint = nextFingerprint;
      if (count) count.textContent = String(messages.length);
      list.innerHTML = messages.length ? messages.map(message => `
        <article class="live-chat-message${message.isSeller ? " is-seller" : ""}${message.isOwn ? " is-own" : ""}">
          <header>
            <strong>@${escapeHtml(message.username || "Collector")}</strong>
            ${message.isSeller ? "<span>SELLER</span>" : ""}
            <time datetime="${escapeHtml(message.createdAt || "")}">${escapeHtml(messageTime(message.createdAt))}</time>
          </header>
          <p>${escapeHtml(message.message || "")}</p>
        </article>
      `).join("") : `
        <div class="live-chat-empty">
          <strong>Chat is ready.</strong>
          <span>Start the conversation when the show begins.</span>
        </div>
      `;
      if (shouldFollow || messages.some(message => message.isOwn)) list.scrollTop = list.scrollHeight;
    };

    const request = async (path, options = {}) => {
      const auth = token();
      const response = await fetch(`${apiBase}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Show chat could not update.");
      return payload;
    };

    const refresh = async ({ force = false } = {}) => {
      if (stopped || refreshPending || document.hidden) return;
      const showId = String(getShowId() || "");
      if (showId !== activeShowId) {
        activeShowId = showId;
        activeShowStatus = "";
        messageFingerprint = "__reset__";
        renderMessages([]);
        setStatus(showId ? "Loading show chat..." : "Choose a show to open chat.");
        syncComposer();
      }
      if (!activeShowId) return;
      refreshPending = true;
      try {
        const payload = await request(`/live/shows/${encodeURIComponent(activeShowId)}/chat`);
        activeShowStatus = String(payload.status || "");
        renderMessages(payload.messages || []);
        if (force || status?.dataset.kind === "error") setStatus("");
        syncComposer();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        refreshPending = false;
      }
    };

    form?.addEventListener("submit", async event => {
      event.preventDefault();
      const message = String(input?.value || "").trim();
      if (!activeShowId || !message || !submit) return;
      submit.disabled = true;
      setStatus("Sending...");
      try {
        await request(`/live/shows/${encodeURIComponent(activeShowId)}/chat`, {
          method: "POST",
          body: JSON.stringify({ message })
        });
        input.value = "";
        messageFingerprint = "";
        await refresh({ force: true });
        input.focus();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        syncComposer();
      }
    });

    const visibilityHandler = () => {
      if (!document.hidden) refresh({ force: true });
    };
    document.addEventListener("visibilitychange", visibilityHandler);
    const timer = window.setInterval(refresh, Math.max(2500, Number(pollMs) || 4000));
    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
    window.addEventListener("pagehide", stop, { once: true });
    syncComposer();
    refresh({ force: true });
    return { refresh, stop };
  }

  window.CrackPacksLiveChat = { create };
})();
