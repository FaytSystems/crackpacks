// D:\crackpacks\crackpacks-github-ready\assets\js\youtube-live.js

(() => {
  "use strict";

  const config = window.CRACKPACKS_CONFIG || {};
  const root = document.querySelector("[data-youtube-live]");

  if (!root) return;

  const elements = {
    kicker: root.querySelector("[data-live-kicker]"),
    badge: root.querySelector("[data-live-badge]"),
    viewers: root.querySelector("[data-live-viewers]"),
    player: root.querySelector("[data-live-player]"),
    carousel: root.querySelector("[data-offline-carousel]"),
    message: root.querySelector("[data-live-message]"),
    title: root.querySelector("[data-live-title]"),
    description: root.querySelector("[data-live-description]"),
    watchLink: root.querySelector("[data-youtube-watch]"),
    channelLink: root.querySelector("[data-youtube-channel]"),
    upcoming: root.querySelector("[data-live-upcoming]"),
    upcomingTitle: root.querySelector("[data-upcoming-title]"),
    upcomingTime: root.querySelector("[data-upcoming-time]"),
    previousButton: root.querySelector("[data-slide-previous]"),
    nextButton: root.querySelector("[data-slide-next]"),
    dots: root.querySelector("[data-slide-dots]")
  };

  const slides = Array.from(root.querySelectorAll("[data-offline-slide]"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
  const defaultRefreshMs = 60_000;
  const minimumRefreshMs = 30_000;
  const maximumRefreshMs = 10 * 60_000;
  const defaultSlideshowMs = 6_500;
  const minimumSlideshowMs = 3_000;
  const maximumSlideshowMs = 30_000;
  const defaultTimeoutMs = 8_000;

  let currentSlide = 0;
  let slideshowTimer = null;
  let statusTimer = null;
  let currentVideoId = "";
  let activeController = null;
  let dots = [];

  function boundedNumber(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, minimum), maximum);
  }

  const refreshMs = boundedNumber(
    config.youtubeStatusRefreshMs,
    defaultRefreshMs,
    minimumRefreshMs,
    maximumRefreshMs
  );

  const slideshowMs = boundedNumber(
    config.youtubeSlideshowMs,
    defaultSlideshowMs,
    minimumSlideshowMs,
    maximumSlideshowMs
  );

  const timeoutMs = boundedNumber(
    config.youtubeRequestTimeoutMs,
    defaultTimeoutMs,
    3_000,
    30_000
  );

  function text(element, value) {
    if (element) element.textContent = String(value ?? "");
  }

  function normalizeVideoId(value) {
    const candidate = String(value || "").trim();
    return videoIdPattern.test(candidate) ? candidate : "";
  }

  function safeHttpUrl(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return "";

    try {
      const parsed = new URL(candidate, window.location.href);
      const localDevelopment = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol === "https:" || (parsed.protocol === "http:" && localDevelopment)) {
        return parsed.toString();
      }
    } catch {
      return "";
    }

    return "";
  }

  function setLink(element, url, visible = true) {
    if (!element) return;

    const safeUrl = safeHttpUrl(url);
    if (!visible || !safeUrl) {
      element.hidden = true;
      element.removeAttribute("href");
      return;
    }

    element.href = safeUrl;
    element.hidden = false;
  }

  function setState(state) {
    root.dataset.state = state;
  }

  function formatViewerCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return "";
    return `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(parsed)} watching`;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date);
  }

  function removePlayer() {
    currentVideoId = "";
    if (!elements.player) return;
    elements.player.replaceChildren();
    elements.player.hidden = true;
  }

  function createPlayer(videoId, title) {
    const validVideoId = normalizeVideoId(videoId);
    if (!elements.player || !validVideoId) return false;

    if (currentVideoId === validVideoId && elements.player.querySelector("iframe")) {
      elements.player.hidden = false;
      return true;
    }

    const iframe = document.createElement("iframe");
    const origin = encodeURIComponent(window.location.origin);
    const params = [
      "autoplay=1",
      "mute=1",
      "playsinline=1",
      "rel=0",
      "modestbranding=1",
      `origin=${origin}`
    ].join("&");

    iframe.src = `https://www.youtube.com/embed/${validVideoId}?${params}`;
    iframe.title = title ? `Crack Packs live stream: ${title}` : "Crack Packs live stream";
    iframe.loading = "eager";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allowFullscreen = true;

    elements.player.replaceChildren(iframe);
    elements.player.hidden = false;
    currentVideoId = validVideoId;
    return true;
  }

  function showCarousel() {
    if (elements.carousel) elements.carousel.hidden = false;
    startSlideshow();
  }

  function hideCarousel() {
    stopSlideshow();
    if (elements.carousel) elements.carousel.hidden = true;
  }

  function showUpcoming(upcoming) {
    if (!elements.upcoming) return;

    const upcomingTitle = String(upcoming?.title || "Upcoming Crack Packs stream").trim();
    const scheduledText = formatDateTime(upcoming?.scheduledStartTime);

    if (!scheduledText) {
      elements.upcoming.hidden = true;
      return;
    }

    text(elements.upcomingTitle, upcomingTitle);
    text(elements.upcomingTime, scheduledText);
    if (elements.upcomingTime) elements.upcomingTime.dateTime = String(upcoming.scheduledStartTime);
    elements.upcoming.hidden = false;
  }

  function hideUpcoming() {
    if (elements.upcoming) elements.upcoming.hidden = true;
  }

  function channelUrlFrom(payload) {
    return safeHttpUrl(payload?.channelUrl) || safeHttpUrl(config.youtubeChannelUrl);
  }

  function watchUrlFor(videoId, payload) {
    return safeHttpUrl(payload?.watchUrl) || `https://www.youtube.com/watch?v=${videoId}`;
  }

  function renderLoading() {
    setState("loading");
    showCarousel();
    text(elements.kicker, "Checking YouTube status");
    text(elements.badge, "Checking");
    text(elements.message, "Checking whether Crack Packs is live on YouTube.");
    text(elements.title, "Live stream status loading…");
    text(elements.description, "The artwork slideshow remains visible whenever the channel is offline.");
    if (elements.viewers) elements.viewers.hidden = true;
    setLink(elements.watchLink, "", false);
    setLink(elements.channelLink, safeHttpUrl(config.youtubeChannelUrl));
    hideUpcoming();
  }

  function renderLive(payload) {
    const videoId = normalizeVideoId(payload.videoId);
    if (!videoId || !createPlayer(videoId, payload.title)) {
      renderError("The live stream was found, but its video ID was invalid.");
      return;
    }

    setState("live");
    hideCarousel();
    text(elements.kicker, "Crack Packs is live on YouTube");
    text(elements.badge, "Live now");
    text(elements.message, "The live room is open");
    text(elements.title, payload.title || "Crack Packs is live now.");
    text(
      elements.description,
      payload.description || "Watch the current rip, claim sale, pack opening, or collector stream directly on CrackPacks.com."
    );

    const viewerText = formatViewerCount(payload.concurrentViewers);
    if (elements.viewers) {
      text(elements.viewers, viewerText);
      elements.viewers.hidden = !viewerText;
    }

    setLink(elements.watchLink, watchUrlFor(videoId, payload));
    setLink(elements.channelLink, channelUrlFrom(payload));
    hideUpcoming();
  }

  function renderOffline(payload = {}) {
    removePlayer();
    showCarousel();

    const upcoming = payload.upcoming && typeof payload.upcoming === "object" ? payload.upcoming : null;
    const hasUpcoming = Boolean(upcoming?.scheduledStartTime);
    setState(hasUpcoming ? "upcoming" : "offline");

    text(elements.kicker, hasUpcoming ? "Next YouTube stream scheduled" : "YouTube channel is offline");
    text(elements.badge, hasUpcoming ? "Upcoming" : "Offline");
    text(elements.message, hasUpcoming ? "A new Crack Packs stream is scheduled" : "The live room is resting");
    text(
      elements.title,
      hasUpcoming ? upcoming.title || "The next Crack Packs stream is scheduled." : "The chase returns on the next live show."
    );
    text(
      elements.description,
      hasUpcoming
        ? "The original Crack Packs artwork stays on screen until the scheduled YouTube broadcast goes live."
        : "Browse the original Crack Packs artwork, check inventory, search card prices, or follow the channel before the next stream begins."
    );

    if (elements.viewers) elements.viewers.hidden = true;
    setLink(elements.watchLink, hasUpcoming ? upcoming.watchUrl : "", hasUpcoming);
    setLink(elements.channelLink, channelUrlFrom(payload));

    if (hasUpcoming) showUpcoming(upcoming);
    else hideUpcoming();
  }

  function renderUnconfigured(payload = {}) {
    removePlayer();
    showCarousel();
    setState("unconfigured");
    text(elements.kicker, "YouTube connection ready for setup");
    text(elements.badge, "Setup needed");
    text(elements.message, "The offline showcase is active");
    text(elements.title, "Crack Packs Live Room is installed.");
    text(
      elements.description,
      "Add the YouTube API key and channel ID to the Cloudflare Worker to activate automatic live-stream detection."
    );
    if (elements.viewers) elements.viewers.hidden = true;
    setLink(elements.watchLink, "", false);
    setLink(elements.channelLink, channelUrlFrom(payload));
    hideUpcoming();
  }

  function renderError(message) {
    removePlayer();
    showCarousel();
    setState("error");
    text(elements.kicker, "YouTube status temporarily unavailable");
    text(elements.badge, "Offline art");
    text(elements.message, "The artwork showcase is still running");
    text(elements.title, "The live-status check could not complete.");
    text(
      elements.description,
      message || "The website will automatically check again. The rest of CrackPacks.com remains available."
    );
    if (elements.viewers) elements.viewers.hidden = true;
    setLink(elements.watchLink, "", false);
    setLink(elements.channelLink, safeHttpUrl(config.youtubeChannelUrl));
    hideUpcoming();
  }

  function renderStatus(payload) {
    if (!payload || typeof payload !== "object") {
      renderError("The live-status service returned an invalid response.");
      return;
    }

    if (payload.configured === false) {
      renderUnconfigured(payload);
      return;
    }

    if (payload.live === true) {
      renderLive(payload);
      return;
    }

    renderOffline(payload);
  }

  async function fetchStatus() {
    const manualVideoId = normalizeVideoId(config.youtubeManualVideoId);
    if (manualVideoId) {
      renderLive({
        configured: true,
        live: true,
        videoId: manualVideoId,
        title: "Crack Packs live-player test",
        description: "Manual test mode is active in assets/js/config.js.",
        channelUrl: config.youtubeChannelUrl
      });
      return;
    }

    const endpoint = safeHttpUrl(config.youtubeLiveStatusUrl);
    if (!endpoint) {
      renderUnconfigured();
      return;
    }

    if (activeController) activeController.abort();
    activeController = new AbortController();
    const timeout = window.setTimeout(() => activeController.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: activeController.signal
      });

      if (!response.ok) {
        throw new Error(`Live-status service returned HTTP ${response.status}.`);
      }

      const payload = await response.json();
      renderStatus(payload);
    } catch (error) {
      if (error?.name === "AbortError") {
        renderError("The YouTube status request timed out. The website will check again automatically.");
      } else {
        renderError("The YouTube status service is temporarily unreachable. The website will check again automatically.");
      }
    } finally {
      window.clearTimeout(timeout);
      activeController = null;
    }
  }

  function scheduleStatusCheck() {
    window.clearInterval(statusTimer);
    statusTimer = window.setInterval(fetchStatus, refreshMs);
  }

  function showSlide(index, { restart = true } = {}) {
    if (!slides.length) return;

    currentSlide = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === currentSlide;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", active ? "false" : "true");
    });

    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === currentSlide;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-current", active ? "true" : "false");
    });

    if (restart) startSlideshow();
  }

  function stopSlideshow() {
    window.clearInterval(slideshowTimer);
    slideshowTimer = null;
  }

  function startSlideshow() {
    stopSlideshow();
    if (slides.length < 2 || reducedMotion.matches || root.dataset.state === "live" || document.hidden) return;
    slideshowTimer = window.setInterval(() => showSlide(currentSlide + 1, { restart: false }), slideshowMs);
  }

  function buildDots() {
    if (!elements.dots || !slides.length) return;
    elements.dots.replaceChildren();

    dots = slides.map((_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "offline-dot";
      dot.setAttribute("aria-label", `Show offline artwork ${index + 1}`);
      dot.addEventListener("click", () => showSlide(index));
      elements.dots.appendChild(dot);
      return dot;
    });
  }

  function bindSlideshowControls() {
    elements.previousButton?.addEventListener("click", () => showSlide(currentSlide - 1));
    elements.nextButton?.addEventListener("click", () => showSlide(currentSlide + 1));

    elements.carousel?.addEventListener("mouseenter", stopSlideshow);
    elements.carousel?.addEventListener("mouseleave", startSlideshow);
    elements.carousel?.addEventListener("focusin", stopSlideshow);
    elements.carousel?.addEventListener("focusout", startSlideshow);

    reducedMotion.addEventListener?.("change", startSlideshow);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopSlideshow();
      else {
        startSlideshow();
        fetchStatus();
      }
    });
  }

  function cleanup() {
    window.clearInterval(statusTimer);
    stopSlideshow();
    activeController?.abort();
  }

  buildDots();
  bindSlideshowControls();
  showSlide(0, { restart: false });
  renderLoading();
  fetchStatus();
  scheduleStatusCheck();
  window.addEventListener("pagehide", cleanup, { once: true });
})();
