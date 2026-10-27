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
      const row = target.lastElementChild; // bring the new entry into view, ready to type
      requestAnimationFrame(() => {
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        const first = row.querySelector("input, textarea");
        if (first) first.focus({ preventScroll: true });
      });
    });
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".remove-row");
    const row = btn && btn.closest("[data-row]");
    if (!row) return;
    const holder = row.parentElement, next = row.nextElementSibling, label = rowTitle(row);
    row.remove();
    requestPreview();
    toast(label ? "Removed \u201c" + label + "\u201d" : "Entry removed", {
      action: "Undo",
      onAction: () => {
        if (next && next.parentElement === holder) holder.insertBefore(row, next);
        else holder.appendChild(row);
        requestPreview();
      },
    });
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
    renderStrength();
    refreshGenOptions(); // keep the AI "what to write" list in step with the experience rows
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
  ["import-box", "ats-box", "ai-box", "backup-box"].forEach((id) => {
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
      if (hasContent(collectState()) && !(await confirmDialog("This replaces what is currently in the form with the contents of the file.", { title: "Load this backup?", confirmText: "Replace" }))) return;
      applyState(state);
      toast("Backup loaded", { kind: "ok" });
    } catch (e) {
      alert("That doesn't look like a MYY Resume backup (.json) file.");
    }
  });

  document.getElementById("clear-form").addEventListener("click", async () => {
    if (!(await confirmDialog("Every field will be emptied. This can't be undone.", { title: "Clear everything?", confirmText: "Clear all", danger: true }))) return;
    applyState({ fields: {} });
    toast("Cleared. You're starting fresh.");
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
    toast("CV imported. Review every field: OCR can misread characters.", { kind: "ok", action: "Review", onAction: () => showTab("content") });
  }

  ocrBtn.addEventListener("click", async () => {
    const file = ocrFile.files[0];
    if (!file) {
      setOcr("Choose a file first.", null, "error");
      return;
    }
    if (hasContent(collectState()) && !(await confirmDialog("The text found in your file will replace what is currently in the form.", { title: "Import this CV?", confirmText: "Replace" }))) return;
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
  const pdfQuotaEl = document.getElementById("pdf-quota");
  let pdfUrl = null;
  let pdfJob = 0; // bumps on every reset so a stale, late response is ignored

  // ---- daily limits (what this visitor has left; the server enforces them) ----
  const quota = { pdf: null, ai: null, aiStatus: null };

  function fmtWait(sec) {
    const m = Math.max(1, Math.round(sec / 60)), h = Math.floor(m / 60), mm = m % 60;
    if (h && mm) return h + " h " + mm + " min";
    return h ? h + " h" : mm + " min";
  }
  function pdfBlocked() {
    return !!quota.pdf && (!quota.pdf.ok || quota.pdf.remaining <= 0);
  }
  function renderPdfQuota() {
    const q = quota.pdf;
    if (!q) return;
    pdfQuotaEl.hidden = false;
    pdfQuotaEl.classList.toggle("is-out", pdfBlocked());
    pdfQuotaEl.classList.toggle("is-low", !pdfBlocked() && q.remaining === 1);
    pdfQuotaEl.textContent = pdfBlocked()
      ? "Daily PDF limit reached. You can create another in " + fmtWait(q.reset_in) + "."
      : q.remaining + " of " + q.limit + " PDF" + (q.limit === 1 ? "" : "s") + " left today";
  }
  async function loadQuota() {
    try {
      const q = await (await fetch("/api/quota")).json();
      quota.pdf = q.pdf;
      quota.ai = q.ai;
      quota.aiStatus = q.ai_status;
      renderPdfQuota();
      if (!pdfUrl) pdfBtn.disabled = pdfBlocked();
      renderAiNote();
    } catch (e) { /* quota display is optional */ }
  }

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
    pdfBtn.disabled = pdfBlocked();
    renderPdfQuota();
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
      if (job !== pdfJob) { loadQuota(); return; } // the form changed while we were working
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) quota.pdf = { ...err, ok: false, remaining: 0 };
        throw Object.assign(new Error(err.error || "failed"), { code: err.error, data: err });
      }
      const blob = await res.blob();
      if (job !== pdfJob) { loadQuota(); return; }
      pdfUrl = URL.createObjectURL(blob);
      pdfDownload.href = pdfUrl;
      pdfDownload.download = pdfFileName();
      pdfStatus.hidden = true;
      pdfBtn.hidden = true;
      pdfDownload.hidden = false;
      pdfNote.textContent = "PDF ready · A4 · " + Math.max(1, Math.round(blob.size / 1024)) + " KB";
      pdfNote.hidden = false;
      loadQuota(); // refresh "N left today"
    } catch (err) {
      if (job !== pdfJob) return;
      pdfStatus.classList.add("is-error");
      if (err.code === "limit") {
        pdfStatusText.textContent = err.data.scope === "ip"
          ? "Too many PDFs have been created from your network today. Try again in " + fmtWait(err.data.reset_in) + "."
          : "You've used all " + err.data.limit + " PDFs for today. Try again in " + fmtWait(err.data.reset_in) + ".";
        pdfBtn.disabled = true;
        renderPdfQuota();
        return;
      }
      pdfBtn.disabled = false;
      pdfStatusText.textContent =
        err.code === "no_browser"
          ? "PDF creation needs Google Chrome or Microsoft Edge installed on this computer. You can use the print view instead."
          : "Couldn't create the PDF. Try again, or use the print view.";
      pdfFallback.hidden = false;
    }
  });

  // --- AI assistant: analyse, suggest, write ---------------------------------
  const aiNote = document.getElementById("ai-note");
  const aiTarget = document.getElementById("ai-target");
  const aiAnalyse = document.getElementById("ai-analyse");
  const aiSuggest = document.getElementById("ai-suggest");
  const aiGenerate = document.getElementById("ai-generate");
  const aiGenSel = document.getElementById("ai-gen-target");
  const aiStatus = document.getElementById("ai-status");
  const aiStatusText = document.getElementById("ai-status-text");
  const aiResult = document.getElementById("ai-result");
  const aiPrivacy = document.getElementById("ai-privacy");
  const aiButtons = [aiAnalyse, aiSuggest, aiGenerate];
  let aiBusy = false;

  function aiAvailable() {
    return !!(quota.aiStatus && quota.aiStatus.enabled);
  }
  function aiBlocked() {
    return !!quota.ai && (!quota.ai.ok || quota.ai.remaining <= 0);
  }
  function renderAiNote() {
    const st = quota.aiStatus;
    if (!st) return;
    if (!st.enabled) {
      aiNote.textContent = "AI isn't set up on this server yet. The site owner needs to paste a Gemini API key into the .env file (GEMINI_API_KEY=…) and restart the app.";
      aiPrivacy.hidden = true;
    } else {
      const q = quota.ai;
      aiNote.textContent = "Powered by " + st.provider + "." + (q
        ? (aiBlocked()
            ? " Daily AI limit reached — try again in " + fmtWait(q.reset_in) + "."
            : " " + q.remaining + " of " + q.limit + " AI requests left today.")
        : "");
      aiPrivacy.textContent = "Your CV text is sent to " + st.provider + " to produce these results. AI can make mistakes: check every line, and replace any [placeholders] with your real numbers.";
      aiPrivacy.hidden = false;
    }
    setAiBusy(aiBusy);
  }
  function setAiBusy(on, msg) {
    aiBusy = on;
    aiButtons.forEach((b) => (b.disabled = on || !aiAvailable() || aiBlocked()));
    aiGenSel.disabled = on || !aiAvailable();
    if (on) {
      aiStatus.classList.remove("is-error");
      aiStatusText.textContent = msg || "Thinking…";
      aiStatus.hidden = false;
    } else if (!aiStatus.classList.contains("is-error")) {
      aiStatus.hidden = true;
    }
  }
  function aiError(err) {
    const d = err.data || {}, code = d.code;
    let msg = "Something went wrong with the AI request. Please try again.";
    if (err.message === "no_key") msg = "AI isn't set up on this server yet.";
    else if (err.message === "empty") msg = "Add some details to your CV first (a summary, experience or skills).";
    else if (err.message === "limit") {
      msg = d.scope === "ip"
        ? "Too many AI requests from your network today. Try again in " + fmtWait(d.reset_in) + "."
        : "You've used all " + d.limit + " AI requests for today. Try again in " + fmtWait(d.reset_in) + ".";
    } else if (code === "auth") msg = "The server's AI key was rejected. The site owner needs to check it.";
    else if (code === "model") msg = "The configured AI model wasn't found. The site owner needs to check the model name.";
    else if (code === "provider_busy") msg = "The AI service is busy right now. Try again in a minute.";
    else if (code === "network" || code === "provider_down") msg = "Couldn't reach the AI service. Try again shortly.";
    else if (code === "blocked" || code === "unreadable") msg = "The AI couldn't produce a usable answer. Try again.";
    aiStatus.classList.add("is-error");
    aiStatusText.textContent = msg;
    aiStatus.hidden = false;
  }

  async function aiCall(path, extra) {
    const fd = new FormData(form);
    fd.delete("photo_file"); // photos never go to the AI
    fd.set("job_description", jdText.value);
    fd.set("target_role", aiTarget.value.trim());
    Object.entries(extra || {}).forEach(([k, v]) => fd.set(k, v));
    const res = await fetch(path, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429) quota.ai = { ...data, ok: false, remaining: 0 };
      throw Object.assign(new Error(data.error || "failed"), { data });
    }
    quota.ai = { ...data.quota, ok: data.quota.remaining > 0 };
    return data.result;
  }

  async function runAi(path, extra, render, message) {
    if (aiBusy) return;
    aiResult.hidden = true;
    setAiBusy(true, message);
    try {
      const result = await aiCall(path, extra);
      aiStatus.classList.remove("is-error");
      aiStatus.hidden = true;
      aiResult.innerHTML = "";
      render(result);
      aiResult.hidden = false;
    } catch (err) {
      aiError(err);
    } finally {
      setAiBusy(false);
      await loadQuota(); // fetch the real remaining count and reset time from the server
    }
  }

  // ---- applying suggestions to the form ----
  function touchForm() {
    form.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function expRows() {
    return [...document.querySelectorAll("#exp-rows [data-row]")];
  }
  function expLabel(i) {
    const row = expRows()[i];
    if (!row) return "Experience #" + (i + 1);
    const role = row.querySelector('[name="exp_role"]').value.trim();
    const co = row.querySelector('[name="exp_company"]').value.trim();
    return (role || "Role " + (i + 1)) + (co ? " · " + co : "");
  }
  function applySummary(text) {
    form.elements["summary"].value = text;
    touchForm();
  }
  function applyBullets(i, bullets, mode) {
    const row = expRows()[i];
    if (!row) return false;
    const box = row.querySelector('[name="exp_bullets"]');
    const existing = box.value.trim();
    box.value = mode === "add" && existing ? existing + "\n" + bullets.join("\n") : bullets.join("\n");
    touchForm();
    return true;
  }
  function addSkill(name) {
    let boxes = form.querySelectorAll('[name="skill_items"]');
    if (!boxes.length) {
      document.querySelector('.add-row[data-target="skill-rows"]').click();
      boxes = form.querySelectorAll('[name="skill_items"]');
    }
    const box = boxes[boxes.length - 1];
    const have = box.value.split(",").map((s) => s.trim().toLowerCase());
    if (!have.includes(name.toLowerCase())) {
      box.value = box.value.trim() ? box.value.trim().replace(/,\s*$/, "") + ", " + name : name;
      touchForm();
    }
  }

  function card(title) {
    const c = el("div", "ai-card");
    if (title) c.appendChild(el("h4", null, title));
    aiResult.appendChild(c);
    return c;
  }
  function applyButton(label, onClick) {
    const b = el("button", "secondary ai-apply", label);
    b.type = "button";
    b.addEventListener("click", () => {
      if (onClick() !== false) {
        b.textContent = "Applied ✓";
        b.classList.add("is-done");
        toast("Applied to your CV", { kind: "ok", action: "View", onAction: () => showTab("content") });
      }
    });
    return b;
  }
  function bulletList(items) {
    const ul = el("ul");
    items.forEach((t) => ul.appendChild(el("li", null, t)));
    return ul;
  }

  function renderAnalysis(a) {
    const top = card("Overall");
    if (a.score != null) {
      const s = el("div", "ai-score");
      s.appendChild(el("b", null, String(a.score)));
      s.appendChild(el("span", null, "/ 100"));
      top.appendChild(s);
    }
    if (a.verdict) top.appendChild(el("p", null, a.verdict));
    if (a.strengths.length) {
      const c = card("Strengths");
      c.appendChild(bulletList(a.strengths));
    }
    if (a.issues.length) {
      const c = card("What to fix");
      a.issues.forEach((it) => {
        const row = el("div", "ai-issue");
        const head = el("p");
        head.appendChild(el("span", "ai-sev " + it.severity, it.severity));
        head.appendChild(el("span", "ai-sec", it.section));
        row.appendChild(head);
        row.appendChild(el("p", null, it.problem));
        if (it.fix) row.appendChild(el("p", "ai-fix", it.fix));
        c.appendChild(row);
      });
    }
    if (a.missing_keywords.length) {
      const c = card("Missing keywords");
      const chips = el("div", "chips");
      a.missing_keywords.forEach((k) => chips.appendChild(el("span", "chip miss", k)));
      c.appendChild(chips);
    }
    if (a.ats_tips.length) {
      const c = card("ATS tips");
      c.appendChild(bulletList(a.ats_tips));
    }
  }

  function renderSuggestions(s) {
    let shown = false;
    if (s.summary.text) {
      shown = true;
      const c = card("Suggested summary");
      c.appendChild(el("p", null, s.summary.text));
      if (s.summary.why) c.appendChild(el("p", "ai-why", s.summary.why));
      c.appendChild(applyButton("Use this summary", () => applySummary(s.summary.text)));
    }
    s.experience.forEach((e) => {
      shown = true;
      const c = card("Better bullets — " + expLabel(e.index));
      c.appendChild(bulletList(e.bullets));
      if (e.why) c.appendChild(el("p", "ai-why", e.why));
      c.appendChild(applyButton("Replace bullets", () => applyBullets(e.index, e.bullets, "replace")));
      c.appendChild(applyButton("Add to existing", () => applyBullets(e.index, e.bullets, "add")));
    });
    if (s.skills_to_add.length) {
      shown = true;
      const c = card("Skills to consider");
      const chips = el("div", "chips");
      s.skills_to_add.forEach((k) => {
        const b = el("button", "chip", "+ " + k);
        b.type = "button";
        b.addEventListener("click", () => {
          addSkill(k);
          b.textContent = "✓ " + k;
          b.classList.add("is-done");
        });
        chips.appendChild(b);
      });
      c.appendChild(chips);
      c.appendChild(el("p", "ai-why", "Only add skills you really have."));
    }
    if (s.other.length) {
      shown = true;
      card("Other tips").appendChild(bulletList(s.other));
    }
    if (!shown) card("").appendChild(el("p", null, "No changes suggested — your CV looks good as it is."));
  }

  function renderGenerated(g) {
    if (g.kind === "summary") {
      const c = card("New summary");
      c.appendChild(el("p", null, g.text));
      c.appendChild(applyButton("Use this summary", () => applySummary(g.text)));
    } else {
      const c = card("New bullets — " + expLabel(g.index));
      c.appendChild(bulletList(g.bullets));
      c.appendChild(applyButton("Replace bullets", () => applyBullets(g.index, g.bullets, "replace")));
      c.appendChild(applyButton("Add to existing", () => applyBullets(g.index, g.bullets, "add")));
    }
  }

  function refreshGenOptions() {
    const keep = aiGenSel.value;
    aiGenSel.innerHTML = "";
    const add = (v, t) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      aiGenSel.appendChild(o);
    };
    add("summary", "Write my summary");
    expRows().forEach((_, i) => add("bullets:" + i, "Write bullets: " + expLabel(i)));
    if ([...aiGenSel.options].some((o) => o.value === keep)) aiGenSel.value = keep;
  }
  ["focus", "mousedown"].forEach((ev) => aiGenSel.addEventListener(ev, refreshGenOptions));

  aiAnalyse.addEventListener("click", () =>
    runAi("/api/ai/analyse", {}, renderAnalysis, "Analysing your CV…"));
  aiSuggest.addEventListener("click", () =>
    runAi("/api/ai/suggest", {}, renderSuggestions, "Looking for improvements…"));
  aiGenerate.addEventListener("click", () => {
    refreshGenOptions();
    const [kind, idx] = aiGenSel.value.split(":");
    runAi("/api/ai/generate", { kind, index: idx || "0" }, renderGenerated, "Writing…");
  });

  // =====================================================================
  // UI v2: tabs, collapsible sections & entries, filters, zoom, meter, toasts
  // =====================================================================
  const $ = (id) => document.getElementById(id);

  // ---- toasts (small, non-blocking messages; optional action button) ----
  function toast(message, opts) {
    opts = opts || {};
    const box = $("toasts");
    const t = document.createElement("div");
    t.className = "toast" + (opts.kind ? " is-" + opts.kind : "");
    const span = document.createElement("span");
    span.textContent = message;
    t.appendChild(span);
    let timer;
    const close = () => {
      clearTimeout(timer);
      t.classList.add("is-leaving");
      setTimeout(() => t.remove(), 220);
    };
    if (opts.action) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = opts.action;
      b.addEventListener("click", () => {
        if (opts.onAction) opts.onAction();
        close();
      });
      t.appendChild(b);
    }
    box.appendChild(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    timer = setTimeout(close, opts.duration || (opts.action ? 6000 : 3200));
    return close;
  }

  // ---- confirmation dialog (replaces the browser's confirm()) ----
  function confirmDialog(message, o) {
    o = o || {};
    const dlg = $("confirm-dialog");
    if (typeof dlg.showModal !== "function") return Promise.resolve(window.confirm(message));
    $("confirm-title").textContent = o.title || "Are you sure?";
    $("confirm-text").textContent = message;
    const ok = $("confirm-ok"), cancel = $("confirm-cancel");
    ok.textContent = o.confirmText || "Continue";
    ok.classList.toggle("is-danger", !!o.danger);
    return new Promise((resolve) => {
      const finish = (v) => {
        ok.removeEventListener("click", yes);
        cancel.removeEventListener("click", no);
        dlg.removeEventListener("cancel", no);
        dlg.removeEventListener("click", backdrop);
        if (dlg.open) dlg.close();
        resolve(v);
      };
      const yes = () => finish(true), no = () => finish(false);
      const backdrop = (e) => { if (e.target === dlg) finish(false); };
      ok.addEventListener("click", yes);
      cancel.addEventListener("click", no);
      dlg.addEventListener("cancel", no);
      dlg.addEventListener("click", backdrop);
      dlg.showModal();
      cancel.focus();
    });
  }

  // ---- tabs ----
  const tabEls = [...document.querySelectorAll(".tabs [role=tab]")];
  function showTab(name, o) {
    tabEls.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (!o || o.scrollTop !== false) form.scrollTop = 0;
    updateJumpActive();
  }
  tabEls.forEach((t, i) => {
    t.addEventListener("click", () => showTab(t.dataset.tab));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabEls[(i + (e.key === "ArrowRight" ? 1 : -1) + tabEls.length) % tabEls.length];
      n.focus();
      showTab(n.dataset.tab);
      e.preventDefault();
    });
  });

  // make any field visible: right tab, section and entry open, scrolled into view
  function reveal(el, o) {
    if (!el) return;
    const panel = el.closest(".tab-panel");
    if (panel && panel.hidden) showTab(panel.dataset.panel, { scrollTop: false });
    const fs = el.closest("fieldset");
    if (fs) setSectionCollapsed(fs, false);
    const row = el.closest(".row");
    if (row) setRowCollapsed(row, false);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (o && o.focus && el.focus) el.focus({ preventScroll: true });
  }

  // ---- collapsible sections ----
  const CHEVRON = '<svg class="sec-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  function setSectionCollapsed(fs, collapsed) {
    fs.classList.toggle("is-collapsed", collapsed);
    const b = fs.querySelector(":scope > legend .sec-toggle");
    if (b) b.setAttribute("aria-expanded", String(!collapsed));
  }
  document.querySelectorAll(".desk-form fieldset").forEach((fs) => {
    const legend = fs.querySelector(":scope > legend");
    if (!legend) return;
    const title = document.createElement("span");
    title.className = "sec-title";
    title.innerHTML = legend.innerHTML;
    if (fs.dataset.count) {
      const c = document.createElement("span");
      c.className = "sec-count";
      c.dataset.for = fs.dataset.count;
      title.appendChild(c);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sec-toggle";
    btn.setAttribute("aria-expanded", "true");
    btn.appendChild(title);
    btn.insertAdjacentHTML("beforeend", CHEVRON);
    legend.textContent = "";
    legend.appendChild(btn);
    btn.addEventListener("click", () => setSectionCollapsed(fs, !fs.classList.contains("is-collapsed")));
  });

  // ---- "jump to section" chips with live counts + scroll-spy ----
  const jump = $("jump");
  const contentSections = [...document.querySelectorAll("#panel-content fieldset[data-section]")];
  contentSections.forEach((fs) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.target = fs.id;
    const label = document.createElement("span");
    label.textContent = fs.dataset.section;
    b.appendChild(label);
    if (fs.dataset.count) {
      const n = document.createElement("b");
      n.dataset.for = fs.dataset.count;
      n.textContent = "0";
      b.appendChild(n);
    }
    b.addEventListener("click", () => {
      setSectionCollapsed(fs, false);
      form.scrollTo({ top: Math.max(0, fs.offsetTop - 58), behavior: "smooth" });
    });
    jump.appendChild(b);
  });
  function updateCounts() {
    document.querySelectorAll("[data-for]").forEach((el) => {
      const c = document.getElementById(el.dataset.for);
      const n = c ? c.querySelectorAll(":scope > .row").length : 0;
      el.textContent = String(n);
      if (el.classList.contains("sec-count")) el.hidden = n === 0;
    });
  }
  function updateJumpActive() {
    if ($("panel-content").hidden) return;
    const line = form.getBoundingClientRect().top + 90;
    let active = contentSections[0];
    contentSections.forEach((fs) => { if (fs.getBoundingClientRect().top <= line) active = fs; });
    if (form.scrollTop + form.clientHeight >= form.scrollHeight - 4) active = contentSections[contentSections.length - 1];
    jump.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.target === active.id;
      b.classList.toggle("is-active", on);
      if (on) {
        const jr = jump.getBoundingClientRect(), br = b.getBoundingClientRect();
        if (br.left < jr.left || br.right > jr.right) jump.scrollTo({ left: b.offsetLeft - 24, behavior: "smooth" });
      }
    });
  }
  let spyTick = false;
  form.addEventListener("scroll", () => {
    if (spyTick) return;
    spyTick = true;
    requestAnimationFrame(() => { spyTick = false; updateJumpActive(); });
  }, { passive: true });

  // ---- entry cards: titled header, fold/unfold, move up/down ----
  const ROW_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  function rowTitle(row) {
    const v = (n) => { const e = row.querySelector('[name="' + n + '"]'); return e ? e.value.trim() : ""; };
    switch (row.parentElement && row.parentElement.id) {
      case "exp-rows": return [v("exp_role"), v("exp_company")].filter(Boolean).join(" · ");
      case "edu-rows": return [v("edu_degree"), v("edu_school")].filter(Boolean).join(" · ");
      case "skill-rows": return v("skill_group") || v("skill_items");
      case "proj-rows": return v("proj_name");
      case "lang-rows": return [v("lang_name"), v("lang_level")].filter(Boolean).join(" — ");
      case "cert-rows": return v("cert_name");
    }
    return "";
  }
  function updateRowTitle(row) {
    const el = row.querySelector(".row-title");
    if (!el) return;
    const t = rowTitle(row);
    el.textContent = t || "Untitled entry";
    el.classList.toggle("is-empty", !t);
  }
  function setRowCollapsed(row, collapsed) {
    row.classList.toggle("is-collapsed", collapsed);
    const b = row.querySelector(".row-toggle");
    if (b) b.setAttribute("aria-expanded", String(!collapsed));
  }
  function updateMoveButtons(container) {
    const rows = [...container.querySelectorAll(":scope > .row")];
    rows.forEach((r, i) => {
      const up = r.querySelector('.row-move[data-dir="-1"]'), down = r.querySelector('.row-move[data-dir="1"]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === rows.length - 1;
    });
  }
  function enhanceRow(row) {
    if (row.dataset.enhanced) return;
    row.dataset.enhanced = "1";
    const remove = row.querySelector(":scope > .remove-row");
    const body = document.createElement("div");
    body.className = "row-body";
    [...row.children].forEach((c) => { if (c !== remove) body.appendChild(c); });
    const head = document.createElement("div");
    head.className = "row-head";
    head.innerHTML =
      '<button type="button" class="row-toggle" aria-expanded="true">' + ROW_CHEVRON + '<span class="row-title"></span></button>' +
      '<span class="row-actions">' +
      '<button type="button" class="row-move" data-dir="-1" aria-label="Move up" title="Move up">↑</button>' +
      '<button type="button" class="row-move" data-dir="1" aria-label="Move down" title="Move down">↓</button></span>';
    if (remove) head.querySelector(".row-actions").appendChild(remove);
    row.append(head, body);
    updateRowTitle(row);
  }
  const FOLDABLE = ["exp-rows", "edu-rows", "proj-rows"];
  const rowObserver = new MutationObserver((muts) => {
    const added = new Map();
    muts.forEach((m) => {
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.matches("[data-row]")) {
          enhanceRow(n);
          added.set(m.target, (added.get(m.target) || 0) + 1);
        }
      });
    });
    added.forEach((count, container) => {
      // many entries arriving at once (import / backup): fold all but the first so the list stays scannable
      if (count >= 3 && FOLDABLE.includes(container.id)) {
        [...container.querySelectorAll(":scope > .row")].forEach((r, i) => { if (i > 0) setRowCollapsed(r, true); });
      }
    });
    new Set(muts.map((m) => m.target)).forEach(updateMoveButtons);
    updateCounts();
  });
  document.querySelectorAll(".rows").forEach((c) => rowObserver.observe(c, { childList: true }));
  form.addEventListener("input", (e) => {
    const row = e.target.closest && e.target.closest(".row");
    if (row) updateRowTitle(row);
  });
  form.addEventListener("click", (e) => {
    const tog = e.target.closest(".row-toggle");
    if (tog) {
      const row = tog.closest(".row");
      setRowCollapsed(row, !row.classList.contains("is-collapsed"));
      return;
    }
    const mv = e.target.closest(".row-move");
    if (mv && !mv.disabled) {
      const row = mv.closest(".row");
      const dir = Number(mv.dataset.dir);
      const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
      if (!sib) return;
      if (dir < 0) sib.before(row); else sib.after(row);
      updateMoveButtons(row.parentElement);
      touchForm();
      (mv.disabled ? row.querySelector(".row-toggle") : mv).focus();
    }
  });

  // ---- template filter ----
  const tplCards = [...document.querySelectorAll(".tpl-card")];
  function filterTemplates(tag) {
    let n = 0;
    tplCards.forEach((c) => {
      const show = tag === "all" || c.dataset.tags.split(" ").includes(tag);
      c.hidden = !show;
      if (show) n++;
    });
    $("tpl-count").textContent = n + (n === 1 ? " template" : " templates");
    document.querySelectorAll("#tpl-filter .fchip").forEach((b) => b.classList.toggle("is-active", b.dataset.tag === tag));
  }
  $("tpl-filter").addEventListener("click", (e) => {
    const b = e.target.closest(".fchip");
    if (b) filterTemplates(b.dataset.tag);
  });

  // ---- preview zoom ----
  const canvasScroll = $("canvas-scroll"), zoomLabel = $("zoom-label");
  let zoomFit = true, zoomLevel = 1;
  function applyZoom() {
    if (!canvasScroll.clientWidth) return; // pane is hidden (mobile edit view)
    const fit = Math.max(0.35, Math.min(1, (canvasScroll.clientWidth - 56) / 740));
    const z = zoomFit ? fit : zoomLevel;
    preview.style.zoom = String(z);
    zoomLabel.textContent = Math.round(z * 100) + "%";
  }
  function stepZoom(delta) {
    const current = parseFloat(preview.style.zoom) || 1;
    zoomFit = false;
    zoomLevel = Math.max(0.4, Math.min(1.6, Math.round((current + delta) * 10) / 10));
    applyZoom();
  }
  $("zoom-out").addEventListener("click", () => stepZoom(-0.1));
  $("zoom-in").addEventListener("click", () => stepZoom(0.1));
  $("zoom-fit").addEventListener("click", () => { zoomFit = true; applyZoom(); });
  if (window.ResizeObserver) new ResizeObserver(() => { if (zoomFit) applyZoom(); }).observe(canvasScroll);

  // ---- mobile: edit / preview switch ----
  const appEl = $("app");
  function setView(v) {
    appEl.dataset.view = v;
    document.querySelectorAll("#mobile-nav button").forEach((x) => x.classList.toggle("is-active", x.dataset.view === v));
    if (v === "preview") requestAnimationFrame(applyZoom);
  }
  document.querySelectorAll("#mobile-nav button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

  // ---- CV completeness meter ----
  const strengthBtn = $("strength-btn"), strengthPop = $("strength-pop");
  function computeStrength() {
    const f = collectState().fields;
    const list = (n) => (Array.isArray(f[n]) ? f[n] : []);
    const filled = (a) => a.filter((x) => x && x.trim());
    const text = (n) => (f[n] || "").trim();
    const bullets = list("exp_bullets").flatMap((b) => b.split("\n").map((s) => s.trim()).filter(Boolean));
    const numeric = bullets.filter((b) => /\d/.test(b));
    const skills = list("skill_items").flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    const addBtn = (t) => document.querySelector('.add-row[data-target="' + t + '"]');
    const first = (n, t) => form.querySelector('[name="' + n + '"]') || addBtn(t);
    const items = [
      { ok: !!text("full_name"), pts: 10, label: "Add your name", go: () => form.elements["full_name"] },
      { ok: !!text("title"), pts: 5, label: "Add a role or headline", go: () => form.elements["title"] },
      { ok: !!text("email") && !!text("phone"), pts: 10, label: "Add your email and phone", go: () => (text("email") ? form.elements["phone"] : form.elements["email"]) },
      { ok: ["linkedin", "github", "website"].some(text), pts: 5, label: "Link a profile (LinkedIn, GitHub or website)", go: () => form.elements["linkedin"] },
      { ok: text("summary").length >= 60, pts: 15, label: "Write a short summary (a couple of sentences)", go: () => form.elements["summary"] },
      { ok: filled(list("exp_role")).length >= 1, pts: 15, label: "Add at least one role", go: () => first("exp_role", "exp-rows") },
      { ok: bullets.length >= 3, pts: 10, label: "Add 3 or more highlights under your roles", go: () => first("exp_bullets", "exp-rows") },
      { ok: bullets.length > 0 && numeric.length / bullets.length >= 0.3, pts: 10, label: "Use numbers in your highlights (%, users, time saved)", go: () => first("exp_bullets", "exp-rows") },
      { ok: filled(list("edu_degree")).length >= 1, pts: 10, label: "Add your education", go: () => first("edu_degree", "edu-rows") },
      { ok: skills.length >= 5, pts: 10, label: "List at least 5 skills", go: () => first("skill_items", "skill-rows") },
    ];
    return { items, score: items.reduce((s, i) => s + (i.ok ? i.pts : 0), 0) };
  }
  function renderStrengthPop(items, score) {
    strengthPop.innerHTML = "";
    strengthPop.appendChild(el("h3", null, score >= 90 ? "Looking great" : "Make it stronger"));
    const ul = el("ul");
    items.slice().sort((a, b) => a.ok - b.ok).forEach((it) => {
      const li = el("li", it.ok ? "is-ok" : "is-todo");
      li.appendChild(el("span", "tick", it.ok ? "✓" : ""));
      li.appendChild(el("span", null, it.label));
      li.appendChild(el("span", "pts", "+" + it.pts));
      if (!it.ok) li.addEventListener("click", () => { setStrengthPop(false); reveal(it.go(), { focus: true }); });
      ul.appendChild(li);
    });
    strengthPop.appendChild(ul);
  }
  function renderStrength() {
    const { items, score } = computeStrength();
    $("strength-val").textContent = score + "%";
    $("strength-fill").style.width = score + "%";
    strengthBtn.dataset.level = score < 40 ? "low" : score < 75 ? "mid" : "high";
    if (!strengthPop.hidden) renderStrengthPop(items, score);
  }
  function setStrengthPop(open) {
    strengthPop.hidden = !open;
    strengthBtn.setAttribute("aria-expanded", String(open));
    if (open) renderStrength();
  }
  strengthBtn.addEventListener("click", (e) => { e.stopPropagation(); setStrengthPop(strengthPop.hidden); });
  document.addEventListener("click", (e) => { if (!strengthPop.hidden && !strengthPop.contains(e.target)) setStrengthPop(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !strengthPop.hidden) { setStrengthPop(false); strengthBtn.focus(); } });

  // --- Start-up: always begin with a blank form (one starter row per section) ----
  try { localStorage.removeItem("myy-cv-state-v1"); } catch (e) { /* storage unavailable */ }
  applyState({ fields: {} });
  refreshGenOptions();
  filterTemplates("all");
  applyZoom();
  updateCounts();
  renderStrength();
  loadQuota();
})();
