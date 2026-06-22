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

## How it works

- `app.py` — Flask routes:
  - `GET /` — the builder page
  - `POST /preview` — returns a rendered HTML fragment of the CV, used for
    the live preview (called automatically as you type)
  - `POST /cv` — returns a full, print-ready CV page (opened in a new tab
    by the "Open print-ready CV" button)
- `templates/index.html` — the builder UI (form + live preview pane)
- `templates/_preview.html` — the shared CV layout, rendered by both
  `/preview` and `/cv`
- `templates/print.html` — wraps `_preview.html` for printing/PDF export
- `static/style.css`, `static/app.js` — styling and the add/remove-row +
  live preview behaviour

## Templates

Pick a look from the swatches at the top of the form — all six read from the
same data, so switching doesn't lose anything you've typed:

- **Colophon** — warm paper, clay accent, typeset margin tabs
- **Ledger** — broadsheet newspaper style, two-column body
- **Atlas** — navy sidebar, connected timeline for experience
- **Mono** — plain single column, ATS-safe (no color/graphics)
- **Studio** — bold colored header band, pill tags
- **MYY** — orange photo sidebar with contact, social links, skills, languages

## Customizing

- Add or remove sections by editing the `fieldset`s and `<template>` blocks
  in `index.html`, the matching fields in `app.py`'s `build_context`, and
  the corresponding markup in `_preview.html`.
- All visual styling lives in `static/style.css` — colors and fonts are
  defined as CSS variables at the top of the file.
