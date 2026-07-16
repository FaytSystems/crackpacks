/*
Full file:
  D:\crackpacks\crackpacks-github-ready\assets\js\contact-form.js

Crack Packs Contact Form v1.7.0
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
  };

  const openModal = () => {
    previouslyFocused = document.activeElement;
    resetPanels();
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("contact-modal-open");
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

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";
    setStatus("Sending your message securely...", "");

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
          page: window.location.href
        })
      });

      const payload = await parseResponse(response);

      if (!response.ok || payload.ok !== true) {
        const fallback = response.status === 429
          ? "Please wait a minute before sending another message."
          : "The message could not be sent. Please try again.";
        throw new Error(payload.error || fallback);
      }

      showSuccess();
    } catch (error) {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = "Send Message";
      setStatus(
        error instanceof Error ? error.message : "The message could not be sent.",
        "error"
      );
    }
  });
})();
