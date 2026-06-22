(function () {
  const form = document.getElementById("cv-form");
  const preview = document.getElementById("preview");
  const status = document.getElementById("status");
  const spinner = document.getElementById("spinner");
  const themeToggle = document.getElementById("theme-toggle");

  // --- Light / dark mode ------------------------------------------------
  themeToggle.addEventListener("click", () => {
    const isLight = document.documentElement.classList.toggle("light-theme");
    localStorage.setItem("myy-theme", isLight ? "light" : "dark");
  });

  // --- Repeatable row handling ---------------------------------------
  document.querySelectorAll(".add-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tpl = document.getElementById(btn.dataset.template);
      const target = document.getElementById(btn.dataset.target);
      const clone = tpl.content.cloneNode(true);
      target.appendChild(clone);
      requestPreview();
    });
  });

  document.addEventListener("click", (e) => {
    if (e.target.matches(".remove-row")) {
      e.target.closest("[data-row]").remove();
      requestPreview();
    }
  });

  // Seed one starter row per repeatable section so the form isn't empty.
  ["exp-template:exp-rows", "edu-template:edu-rows", "skill-template:skill-rows", "lang-template:lang-rows"].forEach(
    (pair) => {
      const [tplId, targetId] = pair.split(":");
      const tpl = document.getElementById(tplId);
      const target = document.getElementById(targetId);
      target.appendChild(tpl.content.cloneNode(true));
    }
  );

  // --- Live preview -----------------------------------------------------
  let timer = null;
  function requestPreview() {
    clearTimeout(timer);
    status.textContent = "Typesetting…";
    spinner.classList.add("is-active");
    timer = setTimeout(async () => {
      try {
        const formData = new FormData(form);
        const res = await fetch("/preview", { method: "POST", body: formData });
        if (!res.ok) throw new Error("preview failed");
        preview.innerHTML = await res.text();
        status.textContent = "Up to date.";
      } catch (err) {
        status.textContent = "Couldn't refresh the preview — keep typing.";
      } finally {
        spinner.classList.remove("is-active");
      }
    }, 350);
  }

  form.addEventListener("input", requestPreview);
  form.addEventListener("change", requestPreview);
  form.addEventListener("submit", (e) => {
    // The print-ready button submits to /cv in a new tab; let it pass through.
  });

  // Initial render so the seeded rows show up in the preview.
  requestPreview();
})();
