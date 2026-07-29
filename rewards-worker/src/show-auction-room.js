export class ShowAuctionRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required.", { status: 426 });
      }
      if (this.ctx.getWebSockets().length >= 500) {
        return new Response("This show has reached its live update connection limit.", { status: 503 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const sequence = Number(await this.ctx.storage.get("sequence") || 0);
      server.send(JSON.stringify({ type: "connected", sequence, serverNow: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      const raw = await request.text();
      if (raw.length > 16_000) return new Response("Event is too large.", { status: 413 });
      let event;
      try {
        event = JSON.parse(raw || "{}");
      } catch {
        return new Response("Invalid event.", { status: 400 });
      }
      const sequence = Number(await this.ctx.storage.get("sequence") || 0) + 1;
      await this.ctx.storage.put("sequence", sequence);
      const message = JSON.stringify({
        type: String(event.type || "refresh").slice(0, 64),
        showId: String(event.showId || "").slice(0, 80),
        sequence,
        serverNow: new Date().toISOString(),
        payload: event.payload && typeof event.payload === "object" ? event.payload : {}
      });
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
        } catch {
          try { socket.close(1011, "Live update delivery failed."); } catch {}
        }
      }
      return Response.json({ ok: true, sequence });
    }

    return new Response("Not found.", { status: 404 });
  }

  webSocketMessage(socket, message) {
    if (String(message || "") === "ping") {
      socket.send(JSON.stringify({ type: "pong", serverNow: new Date().toISOString() }));
    }
  }

  webSocketClose() {}
  webSocketError() {}
}
