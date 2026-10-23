# MYY Resume — CV Builder

A small Flask app for building a CV: fill in a form on the left, watch it
typeset itself live on the right, then open a print-ready page to save as PDF
(via your browser's print dialog → "Save as PDF").

## Run it

```bash
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5000 in your browser.

## New features

- **OCR import** — upload a photo, scan or PDF of an existing CV and the form is
  filled in automatically. Runs in the browser with Tesseract.js (images and
  scanned PDFs) and pdf.js (PDFs that already contain text). The libraries are
  loaded from a CDN on first use, so an internet connection is needed for that
  step. Always review the result: OCR can misread characters.
- **Job match (ATS check)** — paste a job description to see which keywords your
  CV is missing, plus a quick resume-health checklist.
- **Backup** — the form always starts blank. Download your data as a `.json`
  file and load it back whenever you want (the photo is not included).

## Layout, download page and loader

- **Main page:** the form column scrolls on its own while the preview stays in
  place. The preview only scrolls (independently) if the CV is taller than the
  screen. On narrow screens the two stack and scroll normally.
- **Download page:** shows a true A4 sheet (210 × 297 mm) with 10 mm page
  margins, and prints at the same size, so what you see is what you get. Longer
  CVs flow onto further A4 pages with the same margins.
- **Create PDF, then download:** click **Create PDF** in the bar at the bottom of
  the form. A real A4 PDF (selectable text, 10 mm margins) is generated on the
  server; when it's ready a green **Download PDF** button appears. Editing the
  form afterwards discards the PDF, so you can't download an out-of-date copy.
  PDF creation uses **Google Chrome or Microsoft Edge** already installed on the
  computer running the app (nothing to pip install). If it isn't found
  automatically, set `CHROME_PATH` to the browser's executable. If no browser is
  available the app offers the browser's print view instead.
- **Loader:** the MYY logo animates while the page loads (`static/loader-icon.png`,
  `static/loader-word.png`, styles under "LOGO LOADER" in `style.css`).

## How it works

- `app.py` — Flask routes:
  - `GET /` — the builder page
  - `POST /preview` — returns a rendered HTML fragment of the CV, used for
    the live preview (called automatically as you type)
  - `POST /api/parse-resume` — turns extracted text into form fields
    (`resume_parser.py`)
  - `POST /api/pdf` — renders the CV to an A4 PDF (`pdf_export.py`)
  - `POST /api/ats-match` — keyword match + health checks (`ats.py`)
  - `POST /cv` — returns a full, print-ready CV page (opened in a new tab
    by the "Open print-ready CV" button)
- `templates/index.html` — the builder UI (form + live preview pane)
- `templates/_preview.html` — the shared CV layout, rendered by both
  `/preview` and `/cv`
- `templates/print.html` — wraps `_preview.html` for printing/PDF export
- `templates/tpl/_blocks.html` — shared section macros used by the 15 added
  templates (add a new look by writing a layout file that calls them, then a
  CSS block and a swatch)
- `static/style.css`, `static/app.js` — styling and the add/remove-row +
  live preview behaviour

## Templates

Pick a look from the swatches at the top of the form. All 21 read from the
same data, so switching doesn't lose anything you've typed.

**Original six**

- **Colophon** — warm paper, clay accent, typeset margin tabs
- **Ledger** — broadsheet newspaper style, two-column body
- **Atlas** — navy sidebar, connected timeline for experience
- **Mono** — plain single column, ATS-safe (no color/graphics)
- **Studio** — bold colored header band, pill tags
- **MYY** — orange photo sidebar with contact, social links, skills, languages

**Added fifteen**

- **Classic** — centered serif, ruled headings; the traditional, ATS-friendly look
- **Executive** — navy and gold, name left / contact right, double rule
- **Elegant** — centered italic serif with ornamental dividers
- **Minimal** — airy single column with section labels in a left gutter
- **Ribbon** — arrow-shaped section ribbons running in from the page edge
- **Timeline** — one vertical line with dots for every section and role
- **Banner** — bold angled header band (shows your photo if you add one)
- **Gradient** — gradient name and pill-shaped section labels
- **Bold** — heavy black type, highlighted job title and dates
- **Terminal** — monospace, `##` headings, for developer CVs
- **Pastel** — soft rounded cards on a warm background
- **Monogram** — initials badge, centered header, two balanced columns
- **Cameo** — tinted left sidebar with a round photo
- **Meridian** — dark right-hand sidebar with about, contact and skills
- **Profile** — photo header, then a main column and a side column

The accent colour picker works with every template.

## Adding another template

1. Create `templates/tpl/<key>.html` (copy `classic.html` as a starting point)
   and call the `b.*` macros from `_blocks.html` with your own class prefix.
2. Add `("<key>", "Label")` to `EXTRA_TEMPLATES` in `app.py`.
3. Add CSS for your prefix, plus a `.swatch-<key>` rule for the picker, in
   `static/style.css`.

## Customizing

- Add or remove sections by editing the `fieldset`s and `<template>` blocks
  in `index.html`, the matching fields in `app.py`'s `build_context`, and
  the corresponding markup in `_preview.html`.
- All visual styling lives in `static/style.css` — colors and fonts are
  defined as CSS variables at the top of the file.
