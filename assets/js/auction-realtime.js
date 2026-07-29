(() => {
  "use strict";

  function socketUrl(apiBase, showId) {
    const url = new URL(`${String(apiBase || "").replace(/\/$/, "")}/live/shows/${encodeURIComponent(showId)}/socket`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  }

  function connect({ apiBase, showId, onEvent, onState } = {}) {
    let socket = null;
    let reconnectTimer = 0;
    let heartbeatTimer = 0;
    let retry = 0;
    let closed = false;

    const updateState = value => {
      if (typeof onState === "function") onState(value);
    };
    const scheduleReconnect = () => {
      if (closed || reconnectTimer) return;
      const delay = Math.min(15_000, 750 * (2 ** Math.min(retry, 5)));
      retry += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0;
        open();
      }, delay);
    };
    const open = () => {
      if (closed || !apiBase || !showId || document.hidden) return;
      updateState("connecting");
      try {
        socket = new WebSocket(socketUrl(apiBase, showId));
      } catch {
        updateState("fallback");
        scheduleReconnect();
        return;
      }
      socket.addEventListener("open", () => {
        retry = 0;
        updateState("connected");
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, 25_000);
      });
      socket.addEventListener("message", event => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        if (payload.type === "connected" || payload.type === "pong") return;
        if (typeof onEvent === "function") onEvent(payload);
        document.dispatchEvent(new CustomEvent("crackpacks:auction-event", { detail: payload }));
      });
      socket.addEventListener("close", () => {
        window.clearInterval(heartbeatTimer);
        updateState("fallback");
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        try { socket.close(); } catch {}
      });
    };
    const visibility = () => {
      if (document.hidden) {
        try { socket?.close(1000, "Page hidden"); } catch {}
      } else if (!closed) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = 0;
        open();
      }
    };

    document.addEventListener("visibilitychange", visibility);
    open();
    return {
      close() {
        closed = true;
        window.clearTimeout(reconnectTimer);
        window.clearInterval(heartbeatTimer);
        document.removeEventListener("visibilitychange", visibility);
        try { socket?.close(1000, "Page closed"); } catch {}
      }
    };
  }

  window.CrackPacksAuctionRealtime = { connect };
})();
