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
})();
