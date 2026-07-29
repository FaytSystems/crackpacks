/*
Full file:
  D:\crackpacks\crackpacks-github-ready\assets\js\contact-form.js

Crack Packs Contact Form v1.8.0
*/

(() => {
  "use strict";

  const CONTACT_ENDPOINT = "https://contact-api.crackpacks.com/contact";
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MAX_MESSAGE_LENGTH = 4000;

  const modal = document.querySelector("[data-contact-modal]");
  const form = modal?.querySelector("[data-contact-form]");
  const formPanel = modal?.querySelector("[data-contact-form-panel]");
  const successPanel = modal?.querySelector("[data-contact-success]");
  const emailInput = modal?.querySelector("[data-contact-email]");
  const messageInput = modal?.querySelector("[data-contact-message]");
  const statusNode = modal?.querySelector("[data-contact-status]");
  const submitButton = modal?.querySelector("[data-contact-submit]");
  const successOkButton = modal?.querySelector("[data-contact-success-ok]");

  if (!modal || !form || !formPanel || !successPanel || !emailInput ||
      !messageInput || !statusNode || !submitButton || !successOkButton) {
    return;
  }

  let previouslyFocused = null;
  let submitting = false;
  let turnstileWidgetId = null;
  let turnstileToken = "";
  let turnstileLoader = null;
  const turnstileSiteKey = String(window.CRACKPACKS_CONFIG?.turnstileSiteKey || "");
  const turnstileEnabled = Boolean(turnstileSiteKey && /^https?:$/.test(location.protocol));

  const loadTurnstile = () => {
    if (!turnstileEnabled) return Promise.resolve(null);
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", () => resolve(window.turnstile));
      script.addEventListener("error", () => reject(new Error("The security check could not load.")));
      document.head.append(script);
    });
    return turnstileLoader;
  };

  const mountTurnstile = async () => {
    if (!turnstileEnabled) return;
    let container = form.querySelector("[data-contact-turnstile]");
    if (!container) {
      container = document.createElement("div");
      container.className = "contact-turnstile cf-turnstile";
      container.dataset.contactTurnstile = "";
      container.dataset.action = "turnstile-spin-v2";
      container.setAttribute("aria-label", "Security check");
      statusNode.before(container);
    }
    try {
      const turnstile = await loadTurnstile();
      if (!turnstile || turnstileWidgetId !== null) return;
      turnstileWidgetId = turnstile.render(container, {
        sitekey: turnstileSiteKey,
        action: "turnstile-spin-v2",
        theme: "dark",
        callback: token => {
          turnstileToken = String(token || "");
          if (statusNode.dataset.state === "security") setStatus();
        },
        "expired-callback": () => { turnstileToken = ""; },
        "error-callback": () => {
          turnstileToken = "";
          setStatus("The security check could not complete. Refresh it and try again.", "error");
        }
      });
    } catch (error) {
      setStatus(error.message, "error");
    }
  };

  const resetTurnstile = () => {
    turnstileToken = "";
    if (turnstileWidgetId !== null && window.turnstile) {
      try { window.turnstile.reset(turnstileWidgetId); } catch {}
    }
  };

  const setStatus = (message = "", state = "") => {
    statusNode.textContent = message;
    if (state) {
      statusNode.dataset.state = state;
    } else {
      delete statusNode.dataset.state;
    }
  };

  const resetPanels = () => {
    formPanel.hidden = false;
    successPanel.hidden = true;
    form.reset();
    setStatus();
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = "Send Message";
    resetTurnstile();
  };

  const openModal = () => {
    previouslyFocused = document.activeElement;
    resetPanels();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("contact-modal-open");
    mountTurnstile();
    window.setTimeout(() => emailInput.focus(), 20);
  };

  const closeModal = () => {
    if (submitting) {
      return;
    }

    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("contact-modal-open");

    if (previouslyFocused instanceof HTMLElement) {
      previouslyFocused.focus();
    }
  };

  const showSuccess = () => {
    formPanel.hidden = true;
    successPanel.hidden = false;
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = "Send Message";
    successOkButton.focus();
  };

  const parseResponse = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const errorWithReference = (message, reference) => {
    if (!reference) {
      return message;
    }
    return `${message} Reference: ${reference}`;
  };

  document.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-contact-open]");
    if (openButton) {
      event.preventDefault();
      openModal();
      return;
    }

    const closeButton = event.target.closest("[data-contact-close]");
    if (closeButton && !modal.hidden) {
      event.preventDefault();
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  successOkButton.addEventListener("click", closeModal);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const email = emailInput.value.trim();
    const message = messageInput.value.trim();
    const company = String(form.elements.company?.value || "").trim();

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      setStatus("Enter a valid email address.", "error");
      emailInput.focus();
      return;
    }

    if (message.length < 10) {
      setStatus("Enter a message with at least 10 characters.", "error");
      messageInput.focus();
      return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      setStatus(`Keep the message under ${MAX_MESSAGE_LENGTH} characters.`, "error");
      messageInput.focus();
      return;
    }

    if (turnstileEnabled && !turnstileToken) {
      setStatus("Complete the security check before sending your message.", "security");
      form.querySelector("[data-contact-turnstile]")?.scrollIntoView({ block: "center" });
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";
    setStatus("Sending your message securely...");

    try {
      const response = await fetch(CONTACT_ENDPOINT, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          email,
          message,
          company,
          turnstileToken,
          page: window.location.href
        })
      });

      const payload = await parseResponse(response);

      if (!response.ok || payload.ok !== true) {
        const fallback = response.status === 429
          ? "Please wait a minute before sending another message."
          : "The message could not be sent. Please try again.";
        throw new Error(
          errorWithReference(payload.error || fallback, payload.reference)
        );
      }

      showSuccess();
    } catch (error) {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = "Send Message";
      resetTurnstile();

      const isNetworkFailure =
        error instanceof TypeError &&
        /fetch|network|load/i.test(error.message);

      setStatus(
        isNetworkFailure
          ? "The contact service could not be reached. Open this page from https://crackpacks.com and try again."
          : (error instanceof Error
              ? error.message
              : "The message could not be sent."),
        "error"
      );
    }
  });
})();
