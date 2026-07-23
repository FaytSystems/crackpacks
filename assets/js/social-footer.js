(() => {
  "use strict";
  const mount = () => {
    if (document.querySelector("[data-crackpacks-social-footer]")) return;
    const config = window.CRACKPACKS_CONFIG || {};
    const links = [
      { key: "youtube", label: "YouTube", icon: "▶", url: config.youtubeChannelUrl },
      { key: "facebook", label: "Facebook", icon: "f", url: config.facebookUrl },
      { key: "instagram", label: "Instagram", icon: "◎", url: config.instagramUrl },
      { key: "x", label: "X", icon: "X", url: config.xUrl },
      { key: "live", label: "Live Hub", icon: "⚡", url: config.liveHubUrl || "streams.html", internal: true }
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
      if (!link.internal) { anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; }
      const icon = document.createElement("span"); icon.textContent = link.icon;
      const label = document.createElement("strong"); label.textContent = link.label;
      anchor.append(icon, label); nav.append(anchor);
    });
    section.append(title, nav);
    const footer = document.querySelector(".site-footer");
    if (footer) footer.append(section); else document.body.append(section);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
