(() => {
  "use strict";

  const legalLinks = [
    { label: "Terms & Conditions", url: "terms.html" },
    { label: "Privacy Policy", url: "privacy.html" },
    { label: "Shipping Policy", url: "shipping-policy.html" },
    { label: "Return Policy", url: "returns-policy.html" },
    { label: "Refund Policy", url: "refund-policy.html" }
  ];

  const mountLegalFooter = () => {
    if (!document.body) return;
    let footer = document.querySelector("[data-site-legal-footer]");
    if (!footer) {
      footer = document.createElement("footer");
      footer.className = "site-legal-footer";
      footer.dataset.siteLegalFooter = "";
      footer.innerHTML = `
        <div class="container site-legal-footer-inner">
          <div class="site-legal-footer-heading">
            <strong>Crack Packs policies</strong>
            <span>Clear terms for collectors, buyers, and sellers.</span>
          </div>
          <nav class="site-legal-links" aria-label="Legal and store policies">
            ${legalLinks.map(link => `<a href="${link.url}">${link.label}</a>`).join("")}
          </nav>
          <p class="site-legal-privacy">Crack Packs does not sell personal information. Limited account, verification-status, order, and shipping data is handled only as described in the Privacy Policy.</p>
          <p class="site-legal-billing">Subscription charges are non-refundable after a billing period begins. Eligible unused included credits are reconciled to the account rebate balance after usage finalization under the Refund Policy.</p>
          <p class="site-legal-copyright">&copy; ${new Date().getFullYear()} Crack Packs / Fayt Systems. All rights reserved.</p>
        </div>
      `;
    }
    document.body.append(footer);
  };

  window.CRACKPACKS_MOUNT_LEGAL_FOOTER = mountLegalFooter;

  const mount = () => {
    if (!document.body) return;
    const existingSocialFooter = document.querySelector(
      "[data-crackpacks-social-footer], [data-crack-packs-social-footer]"
    );
    if (!existingSocialFooter) {
      const config = window.CRACKPACKS_CONFIG || {};
      const links = [
        { key: "youtube", label: "YouTube", icon: "\u25b6", url: config.youtubeChannelUrl },
        { key: "facebook", label: "Facebook", icon: "f", url: config.facebookUrl },
        { key: "instagram", label: "Instagram", icon: "\u25ce", url: config.instagramUrl },
        { key: "x", label: "X", icon: "X", url: config.xUrl },
        { key: "live", label: "Live Shows", icon: "\u26a1", url: config.liveHubUrl || "live-shows.html", internal: true }
      ].filter(link => link.url);
      const section = document.createElement("section");
      section.className = "crackpacks-social-footer";
      section.dataset.crackpacksSocialFooter = "";
      section.setAttribute("aria-label", "Crack Packs social links");
      const title = document.createElement("div");
      title.className = "crackpacks-social-footer-title";
      title.innerHTML = `<strong>CRACKPACKSdotcom</strong><span>Where the pack crackin' is happenin'</span>`;
      const nav = document.createElement("nav");
      nav.className = "crackpacks-social-footer-links";
      links.forEach(link => {
        const anchor = document.createElement("a");
        anchor.className = `crackpacks-social-icon ${link.key}`;
        anchor.href = link.url;
        anchor.setAttribute("aria-label", link.label);
        if (!link.internal) {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
        const icon = document.createElement("span");
        icon.textContent = link.icon;
        const label = document.createElement("strong");
        label.textContent = link.label;
        anchor.append(icon, label);
        nav.append(anchor);
      });
      section.append(title, nav);
      const staticFooter = document.querySelector(".site-footer");
      if (staticFooter) staticFooter.append(section);
      else document.body.append(section);
    }
    mountLegalFooter();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
