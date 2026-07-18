(() => {
  const profiles = [...document.querySelectorAll("[data-nav-profile]")];
  profiles.forEach(profile => {
    const trigger = profile.querySelector("[data-profile-trigger]");
    if (!trigger) return;
    const close = () => { profile.classList.remove("is-open"); trigger.setAttribute("aria-expanded", "false"); };
    trigger.addEventListener("click", event => {
      event.stopPropagation();
      const opening = !profile.classList.contains("is-open");
      profiles.forEach(item => { item.classList.remove("is-open"); item.querySelector("[data-profile-trigger]")?.setAttribute("aria-expanded", "false"); });
      if (opening) { profile.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true"); }
    });
    document.addEventListener("click", event => { if (!profile.contains(event.target)) close(); });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && profile.classList.contains("is-open")) {
        close();
        trigger.focus();
      }
    });
  });

  const mountSocialFooter = () => {
    if (!document.body || document.querySelector("[data-crack-packs-social-footer]")) return;

    const footer = document.createElement("footer");
    footer.className = "crack-social-footer";
    footer.dataset.crackPacksSocialFooter = "";
    footer.setAttribute("aria-labelledby", "crack-social-title");
    footer.innerHTML = `
      <div class="crack-social-footer-glow" aria-hidden="true"></div>
      <div class="crack-social-footer-inner">
        <div class="crack-social-cta">
          <p class="crack-social-eyebrow"><span aria-hidden="true">&#10022;</span> The crew never sleeps</p>
          <h2 id="crack-social-title">Keep cracking <span>with us.</span></h2>
          <p>Live breaks, fresh pulls, collector chaos, and first-look drops&mdash;follow Crack Packs wherever you scroll.</p>
          <span class="crack-social-sticker" aria-hidden="true">Tap in &bull; Join the crew</span>
        </div>

        <nav class="crack-social-grid" aria-label="Crack Packs social profiles">
          <a class="crack-social-link crack-social-youtube" href="https://www.youtube.com/@CRACKPACKSdotcom" target="_blank" rel="noopener noreferrer" aria-label="Watch Crack Packs on YouTube (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="M14 20Q15 12 25 11L55 14Q64 15 63 25L61 50Q60 59 50 60L20 57Q10 56 11 46Z"/>
              <path class="crack-social-icon-panel" d="M11 17Q12 9 22 8L52 11Q61 12 60 22L58 47Q57 56 47 57L17 54Q7 53 8 43Z"/>
              <path class="crack-social-icon-mark" d="M29 24 46 34 27 43Z"/>
              <path class="crack-social-icon-spark" d="m59 5 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>YouTube</strong><small>Watch the rips</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-whatnot" href="https://whatnot.com/invite/crackpacksdotcom" target="_blank" rel="noopener noreferrer" aria-label="Shop Crack Packs live on Whatnot (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="M17 17 55 12 63 51 26 61 10 49Z"/>
              <path class="crack-social-icon-panel" d="m14 13 38-5 8 39-37 10L7 45Z"/>
              <path class="crack-social-icon-mark crack-social-whatnot-mark" d="m17 25 8 19 8-17 8 14 9-23"/>
              <path class="crack-social-icon-spark" d="m58 51 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>Whatnot</strong><small>Shop live breaks</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-instagram" href="https://www.instagram.com/crackpacksdotcom/?utm_source=ig_web_button_share_sheet" target="_blank" rel="noopener noreferrer" aria-label="Follow Crack Packs on Instagram (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="M17 10 55 13Q63 14 62 24L59 54Q58 62 48 62L17 58Q8 57 9 47l3-29q1-8 5-8Z"/>
              <path class="crack-social-icon-panel" d="M14 7 52 10Q60 11 59 21L56 51Q55 59 45 59L14 55Q5 54 6 44l3-29q1-8 5-8Z"/>
              <rect class="crack-social-camera-frame" x="19" y="19" width="27" height="27" rx="8" transform="rotate(6 32.5 32.5)"/>
              <circle class="crack-social-camera-lens" cx="32" cy="33" r="7"/>
              <circle class="crack-social-camera-dot" cx="42" cy="23" r="2.5"/>
              <path class="crack-social-icon-spark" d="m59 4 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>Instagram</strong><small>See the heat</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-facebook" href="https://www.facebook.com/CRACKPACKSdotcom" target="_blank" rel="noopener noreferrer" aria-label="Follow Crack Packs on Facebook (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="m20 12 35 2q9 1 8 11l-3 26q-1 9-11 9l-10-1-10 8 1-9-13-2Q8 55 9 45l3-25q1-9 8-8Z"/>
              <path class="crack-social-icon-panel" d="m17 8 35 2q9 1 8 11l-3 26q-1 9-11 9l-10-1-10 8 1-9-13-2Q5 51 6 41l3-25q1-9 8-8Z"/>
              <path class="crack-social-icon-mark crack-social-facebook-mark" d="M38 48 40 34h7l1-8h-7l1-4q0-4 5-3l3-7q-15-4-18 9l-1 5h-6l-1 8h6l-2 14Z"/>
              <path class="crack-social-icon-spark" d="m58 49 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>Facebook</strong><small>Join the crew</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>

          <a class="crack-social-link crack-social-x" href="https://x.com/CRACKPACKS_com" target="_blank" rel="noopener noreferrer" aria-label="Follow Crack Packs on X at CRACKPACKS underscore com (opens in a new tab)">
            <svg class="crack-social-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
              <path class="crack-social-icon-shadow" d="m18 11 38 3 7 37-30 13L9 48Z"/>
              <path class="crack-social-icon-panel" d="m15 7 38 3 7 37-30 13L6 44Z"/>
              <path class="crack-social-icon-mark crack-social-x-mark" d="m23 20 27 32M50 19 22 52"/>
              <path class="crack-social-icon-spark" d="m59 4 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/>
            </svg>
            <span class="crack-social-copy"><strong>X</strong><small>@CRACKPACKS_com</small></span>
            <span class="crack-social-arrow" aria-hidden="true">&#8599;</span>
          </a>
        </nav>
      </div>
      <p class="crack-social-signoff">Crack Packs <span aria-hidden="true">&bull;</span> Rip loud. Collect proud.</p>
    `;

    document.body.append(footer);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountSocialFooter, { once: true });
  } else {
    mountSocialFooter();
  }
})();
