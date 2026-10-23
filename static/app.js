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
  // GROUPS maps a rows container id -> its <template> id and the field names inside a row.
  const GROUPS = {};
  const SEEDED = new Set(["exp-rows", "edu-rows", "skill-rows", "lang-rows"]);

  document.querySelectorAll(".add-row").forEach((btn) => {
    const tpl = document.getElementById(btn.dataset.template);
    GROUPS[btn.dataset.target] = {
      tpl: btn.dataset.template,
      names: [...tpl.content.querySelectorAll("[name]")].map((n) => n.name),
    };
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      target.appendChild(tpl.content.cloneNode(true));
      requestPreview();
    });
  });

  document.addEventListener("click", (e) => {
    if (e.target.matches(".remove-row")) {
      e.target.closest("[data-row]").remove();
      requestPreview();
    }
  });

  // --- Form state: collect / apply (used by backup and OCR) ----
  function repeatedNames() {
    return new Set(Object.values(GROUPS).flatMap((g) => g.names));
  }

  function collectState() {
    const repeated = repeatedNames();
    const fields = {};
    for (const [k, v] of new FormData(form).entries()) {
      if (v instanceof File) continue;
      if (repeated.has(k)) (fields[k] = fields[k] || []).push(v);
      else fields[k] = v;
    }
    return { version: 1, fields };
  }

  function applyState(state) {
    const f = (state && state.fields) || {};
    const repeated = repeatedNames();

    // Repeatable sections: rebuild the rows.
    Object.entries(GROUPS).forEach(([targetId, g]) => {
      const target = document.getElementById(targetId);
      const tpl = document.getElementById(g.tpl);
      target.innerHTML = "";
      const longest = Math.max(0, ...g.names.map((n) => (Array.isArray(f[n]) ? f[n].length : 0)));
      const count = longest || (SEEDED.has(targetId) ? 1 : 0);
      for (let i = 0; i < count; i++) target.appendChild(tpl.content.cloneNode(true));
      g.names.forEach((n) => {
        const vals = Array.isArray(f[n]) ? f[n] : [];
        target.querySelectorAll('[name="' + n + '"]').forEach((el, i) => {
          el.value = vals[i] != null ? vals[i] : "";
        });
      });
    });

    // Plain fields.
    [...form.elements].forEach((el) => {
      if (!el.name || repeated.has(el.name) || el.type === "file" || el.type === "radio") return;
      const v = f[el.name];
      el.value = typeof v === "string" ? v : "";
    });

    // Radio groups (template, accent colour): only touch if the state has a value.
    ["template", "accent_color"].forEach((name) => {
      if (typeof f[name] !== "string") return;
      form.querySelectorAll('input[type="radio"][name="' + name + '"]').forEach((r) => {
        r.checked = r.value === f[name];
      });
    });

    requestPreview();
  }

  function hasContent(state) {
    return Object.values(state.fields).some((v) =>
      Array.isArray(v) ? v.some((x) => x && x.trim()) : false
    ) || ["full_name", "title", "email", "phone", "summary"].some((k) => (state.fields[k] || "").trim());
  }

  // --- Live preview -----------------------------------------------------
  let timer = null;
  let previewSeq = 0; // only the newest request is allowed to update the page
  function requestPreview() {
    resetPdf(); // any edit makes an already-created PDF out of date
    clearTimeout(timer);
    const mine = ++previewSeq; // invalidates any response still in flight
    status.textContent = "Typesetting…";
    spinner.classList.add("is-active");
    timer = setTimeout(async () => {
      try {
        const formData = new FormData(form);
        const res = await fetch("/preview", { method: "POST", body: formData });
        if (!res.ok) throw new Error("preview failed");
        const html = await res.text();
        if (mine !== previewSeq) return; // a newer edit superseded this response
        preview.innerHTML = html;
        status.textContent = "Up to date.";
      } catch (err) {
        if (mine === previewSeq) status.textContent = "Couldn't refresh the preview — keep typing.";
      } finally {
        if (mine === previewSeq) spinner.classList.remove("is-active");
      }
    }, 350);
  }

  form.addEventListener("submit", (e) => e.preventDefault()); // Enter must never navigate away
  form.addEventListener("input", requestPreview);
  form.addEventListener("change", requestPreview);

  // Side panels (import / job match / backup) shouldn't trigger a preview refresh.
  ["import-box", "ats-box", "backup-box"].forEach((id) => {
    const box = document.getElementById(id);
    ["input", "change"].forEach((ev) => box.addEventListener(ev, (e) => e.stopPropagation()));
  });

  // --- Backup: export / import JSON / clear -------------------------------
  document.getElementById("export-json").addEventListener("click", () => {
    const state = collectState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const who = (state.fields.full_name || "resume").trim().replace(/[^\w-]+/g, "-").toLowerCase();
    a.href = URL.createObjectURL(blob);
    a.download = "myy-" + (who || "resume") + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const importJson = document.getElementById("import-json");
  document.getElementById("import-json-btn").addEventListener("click", () => importJson.click());
  importJson.addEventListener("change", async () => {
    const file = importJson.files[0];
    importJson.value = "";
    if (!file) return;
    try {
      const state = JSON.parse(await file.text());
      if (!state || typeof state.fields !== "object") throw new Error("bad file");
      if (hasContent(collectState()) && !confirm("Replace what's in the form with this file?")) return;
      applyState(state);
    } catch (e) {
      alert("That doesn't look like a MYY Resume backup (.json) file.");
    }
  });

  document.getElementById("clear-form").addEventListener("click", () => {
    if (!confirm("Clear every field? This can't be undone.")) return;
    applyState({ fields: {} });
  });

  // --- OCR import -------------------------------------------------------
  const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const MAX_PDF_PAGES = 4;

  const ocrFile = document.getElementById("ocr-file");
  const ocrBtn = document.getElementById("ocr-btn");
  const ocrStatus = document.getElementById("ocr-status");
  const ocrProgress = document.getElementById("ocr-progress");
  const ocrBar = document.getElementById("ocr-bar");
  const ocrRaw = document.getElementById("ocr-raw");
  const ocrText = document.getElementById("ocr-text");

  const loadedScripts = {};
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        delete loadedScripts[src];
        reject(new Error("Couldn't download the OCR library. Check your internet connection."));
      };
      document.head.appendChild(s);
    });
    return loadedScripts[src];
  }

  function setOcr(msg, pct, kind) {
    ocrStatus.textContent = msg;
    ocrStatus.className = "ocr-status" + (kind ? " is-" + kind : "");
    if (typeof pct === "number") {
      ocrProgress.hidden = false;
      ocrBar.style.width = Math.round(Math.max(0, Math.min(1, pct)) * 100) + "%";
    }
  }

  // Draw an image file onto a canvas, scaled to a size Tesseract likes, in greyscale.
  async function imageToCanvas(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch (e) {
      throw new Error("Couldn't open that image. Try a JPG or PNG.");
    }
    const longest = Math.max(bmp.width, bmp.height);
    let scale = 1;
    if (longest < 1600) scale = Math.min(3, 1600 / longest);
    else if (longest > 3500) scale = 3500 / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.filter = "grayscale(1) contrast(1.2)"; // ignored by browsers without canvas filters
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function itemsToLines(items) {
    const rows = [];
    items.forEach((it) => {
      if (!it.str || !it.str.trim()) return;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) {
        row = { y, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x, s: it.str });
    });
    rows.sort((a, b) => b.y - a.y);
    return rows
      .map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" "))
      .join("\n");
  }

  // Returns {text} for PDFs with a text layer, or {canvases} for scanned PDFs.
  async function readPdf(file) {
    await loadScript(PDFJS_SRC);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);

    let text = "";
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      text += itemsToLines((await page.getTextContent()).items) + "\n";
    }
    if (text.replace(/\s/g, "").length >= 150) return { text };

    // Scanned PDF: render each page to a canvas and OCR it.
    const canvases = [];
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      canvases.push(canvas);
    }
    return { canvases };
  }

  async function ocrCanvases(canvases) {
    setOcr("Loading OCR engine (first time can take a moment)…", 0);
    await loadScript(TESSERACT_SRC);
    let pageIndex = 0;
    const worker = await window.Tesseract.createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          setOcr(
            "Reading text… page " + (pageIndex + 1) + " of " + canvases.length,
            (pageIndex + m.progress) / canvases.length
          );
        } else if (m.progress != null && /load|initiali/i.test(m.status)) {
          setOcr("Preparing OCR engine…", 0);
        }
      },
    });
    try {
      let text = "";
      for (pageIndex = 0; pageIndex < canvases.length; pageIndex++) {
        const { data } = await worker.recognize(canvases[pageIndex]);
        text += data.text + "\n";
      }
      return text;
    } finally {
      await worker.terminate();
    }
  }

  async function importResume(file) {
    let text = "";
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      setOcr("Opening PDF…", 0);
      const r = await readPdf(file);
      text = r.text != null ? r.text : await ocrCanvases(r.canvases);
    } else if (file.type.startsWith("image/")) {
      setOcr("Preparing image…", 0);
      text = await ocrCanvases([await imageToCanvas(file)]);
    } else {
      throw new Error("Please choose an image (JPG, PNG) or a PDF.");
    }

    if (text.trim().length < 20) {
      throw new Error("Couldn't find readable text. Try a sharper, well-lit, straight-on photo.");
    }
    ocrText.value = text;
    ocrRaw.hidden = false;

    setOcr("Sorting text into sections…", 1);
    const res = await fetch("/api/parse-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't parse the text.");

    applyState({ fields: data.fields });
    const found = data.found.length ? data.found.join(", ") : "nothing recognisable";
    setOcr("Done. Filled in: " + found + ". Please review every field — OCR can misread characters.", 1, "ok");
  }

  ocrBtn.addEventListener("click", async () => {
    const file = ocrFile.files[0];
    if (!file) {
      setOcr("Choose a file first.", null, "error");
      return;
    }
    if (hasContent(collectState()) && !confirm("This will replace what's currently in the form. Continue?")) return;
    ocrBtn.disabled = true;
    try {
      await importResume(file);
    } catch (err) {
      setOcr(err.message || "Something went wrong while reading the file.", null, "error");
    } finally {
      ocrBtn.disabled = false;
    }
  });

  // --- Job match / ATS check --------------------------------------------
  const atsBtn = document.getElementById("ats-btn");
  const atsResult = document.getElementById("ats-result");
  const jdText = document.getElementById("jd-text");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderAts(data) {
    atsResult.innerHTML = "";
    if (data.match) {
      atsResult.appendChild(el("p", "ats-score", data.match.score + "%"));
      atsResult.appendChild(
        el("p", "ats-sub", "keyword match (" + data.match.matched.length + " of " + data.match.total + " top keywords found)")
      );
      if (data.match.missing.length) {
        atsResult.appendChild(el("p", "ats-heading", "Missing — add if they're true for you"));
        const c = el("div", "chips");
        data.match.missing.forEach((k) => c.appendChild(el("span", "chip miss", k)));
        atsResult.appendChild(c);
      }
      if (data.match.matched.length) {
        atsResult.appendChild(el("p", "ats-heading", "Already covered"));
        const c = el("div", "chips");
        data.match.matched.forEach((k) => c.appendChild(el("span", "chip ok", k)));
        atsResult.appendChild(c);
      }
    }
    atsResult.appendChild(el("p", "ats-heading", "Resume health"));
    const ul = el("ul", "ats-checks");
    data.checks.forEach((c) => {
      const li = el("li", c.ok ? "" : "fail", c.label);
      if (!c.ok && c.tip) li.appendChild(el("span", "tip", c.tip));
      ul.appendChild(li);
    });
    atsResult.appendChild(ul);
    atsResult.hidden = false;
  }

  atsBtn.addEventListener("click", async () => {
    atsBtn.disabled = true;
    try {
      const fd = new FormData(form);
      fd.delete("photo_file");
      fd.append("job_description", jdText.value);
      const res = await fetch("/api/ats-match", { method: "POST", body: fd });
      if (!res.ok) throw new Error("check failed");
      renderAts(await res.json());
    } catch (e) {
      atsResult.innerHTML = "";
      atsResult.appendChild(el("p", "ats-sub", "Couldn't run the check. Is the server still running?"));
      atsResult.hidden = false;
    } finally {
      atsBtn.disabled = false;
    }
  });

  // --- PDF: create first, then offer the download ----------------------------
  const pdfBtn = document.getElementById("pdf-create");
  const pdfStatus = document.getElementById("pdf-status");
  const pdfStatusText = document.getElementById("pdf-status-text");
  const pdfDownload = document.getElementById("pdf-download");
  const pdfNote = document.getElementById("pdf-note");
  const pdfFallback = document.getElementById("pdf-fallback");
  let pdfUrl = null;
  let pdfJob = 0; // bumps on every reset so a stale, late response is ignored

  function resetPdf() {
    pdfJob++;
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      pdfUrl = null;
    }
    pdfDownload.hidden = true;
    pdfDownload.removeAttribute("href");
    pdfStatus.hidden = true;
    pdfStatus.classList.remove("is-error");
    pdfNote.hidden = true;
    pdfBtn.hidden = false;
    pdfBtn.disabled = false;
  }

  function pdfFileName() {
    const name = (form.elements["full_name"].value || "").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-");
    return (name || "Resume") + "-CV.pdf";
  }

  // Fallback when the server has no Chrome/Edge: open the browser's own print view.
  pdfFallback.addEventListener("click", () => {
    const prevAction = form.action, prevTarget = form.target;
    form.action = "/cv";
    form.target = "_blank";
    form.submit(); // form.submit() doesn't fire the submit event, so the guard above is bypassed on purpose
    form.action = prevAction;
    form.target = prevTarget;
  });

  pdfBtn.addEventListener("click", async () => {
    const job = ++pdfJob;
    pdfBtn.disabled = true;
    pdfStatus.classList.remove("is-error");
    pdfStatusText.textContent = "Creating your PDF…";
    pdfStatus.hidden = false;
    pdfNote.hidden = true;
    try {
      const res = await fetch("/api/pdf", { method: "POST", body: new FormData(form) });
      if (job !== pdfJob) return; // the form changed while we were working
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err.error || "failed"), { code: err.error });
      }
      const blob = await res.blob();
      if (job !== pdfJob) return;
      pdfUrl = URL.createObjectURL(blob);
      pdfDownload.href = pdfUrl;
      pdfDownload.download = pdfFileName();
      pdfStatus.hidden = true;
      pdfBtn.hidden = true;
      pdfDownload.hidden = false;
      pdfNote.textContent = "PDF ready · A4 · " + Math.max(1, Math.round(blob.size / 1024)) + " KB";
      pdfNote.hidden = false;
    } catch (err) {
      if (job !== pdfJob) return;
      pdfBtn.disabled = false;
      pdfStatus.classList.add("is-error");
      pdfStatusText.textContent =
        err.code === "no_browser"
          ? "PDF creation needs Google Chrome or Microsoft Edge installed on this computer. You can use the print view instead."
          : "Couldn't create the PDF. Try again, or use the print view.";
      pdfFallback.hidden = false;
    }
  });

  // --- Start-up: always begin with a blank form (one starter row per section) ----
  try { localStorage.removeItem("myy-cv-state-v1"); } catch (e) { /* storage unavailable */ }
  applyState({ fields: {} });
})();
