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

## The interface

- **Three tabs** keep the form short: **Content** (your details), **Design** (templates and accent colour)
  and **AI & Tools** (AI assistant, CV import, job match, backup).
- **Section chips** at the top of Content jump to any section, show how many entries it has, and follow
  your scroll. Every section can be folded away.
- **Entry cards** (jobs, education, projects...) show a title built from what you typed, can be folded,
  **moved up/down**, and deleted with an **Undo** toast. Long lists arrive folded so they are easy to scan.
- **CV completeness** meter: a live score with a checklist of what would make the CV stronger; click an
  item to jump to the field.
- **Template picker** with style filters (Classic, Modern, Creative, Sidebar, Bold).
- **Preview toolbar**: zoom out/in or fit-to-width, and the page size used for the PDF.
- **On phones** the editor and the preview each get the whole screen, with an Edit / Preview switch.
- Light and dark themes, keyboard-friendly tabs and sections, and non-blocking toasts and dialogs.

## Daily limits

To keep a public site from being drained, each visitor can create a limited number
of PDFs and make a limited number of AI requests per day.

| Setting (put it in `.env`) | Default | Meaning |
|---|---|---|
| `PDF_DAILY_LIMIT` | `4` | PDFs per visitor per day (set `3` for three) |
| `AI_DAILY_LIMIT` | `10` | AI requests per visitor per day |
| `TRUST_PROXY` | off | set to `1` when running behind nginx / a hosting proxy so the real visitor IP is used |
| `USAGE_DB` | `usage.db` | where counts are stored (survives restarts) |

- "Per day" is a rolling 24 hours: a use stops counting 24 hours after it happened.
- Visitors are told how many they have left, and when the next one frees up.
- The print-view fallback counts toward the PDF limit too, so it can't be used to get around it.
- A PDF or AI request that **fails** is not counted.
- There are no accounts, so a "visitor" is a browser (cookie). Clearing cookies gives a fresh
  allowance, but each network address also has a ceiling of 5× the personal limit, which stops
  anyone abusing that. For a strict per-person limit you would need user logins.

## AI assistant (Gemini or Claude)

The **AI assistant** panel can analyse your CV (score, strengths, what to fix, missing
keywords), suggest improvements with one-click **Apply** buttons (summary, bullet points,
skills), and write a summary or bullet points for a role. It sticks to what is in your CV and
uses visible `[placeholders]` (like `[X%]`) instead of inventing numbers.

Turn it on in two steps:

1. Get a free Gemini key at <https://aistudio.google.com/apikey>.
2. Open the **`.env`** file in the project folder, paste the key after `GEMINI_API_KEY=`
   (no quotes), save, and restart the app.

```
GEMINI_API_KEY=paste-your-key-here
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-flash-latest
```

The app prints `AI assistant : ON — Google Gemini (...)` when it starts if the key was found.
Real environment variables (for example from a hosting dashboard) override the `.env` file.
`.env.example` is a clean copy to start from. **Never share or upload your `.env`** once it
contains a key; it is already listed in `.gitignore`.

Prefer Claude instead? Put `ANTHROPIC_API_KEY=...` in `.env`.

Other settings: `AI_PROVIDER` (`gemini` or `anthropic`, if both keys are set), `GEMINI_MODEL`
(default `gemini-flash-latest`), `ANTHROPIC_MODEL` (default `claude-haiku-5-5`). Model names
change over time, so set these if your provider has retired a default. Without a key the
panel simply shows a short setup hint. The key stays on the server and is never sent to the
browser. Your CV text is sent to the chosen provider to produce the answer (the page says so).

## How it works

- `app.py` — Flask routes:
  - `GET /` — the builder page
  - `POST /preview` — returns a rendered HTML fragment of the CV, used for
    the live preview (called automatically as you type)
  - `POST /api/parse-resume` — turns extracted text into form fields
    (`resume_parser.py`)
  - `POST /api/pdf` — renders the CV to an A4 PDF (`pdf_export.py`), counted against the daily limit
  - `POST /api/ai/analyse`, `/api/ai/suggest`, `/api/ai/generate` — AI assistant (`ai_assistant.py`)
  - `GET /api/quota` — what the visitor has left today (`usage_limit.py`)
  - `POST /api/ats-match` — keyword match + health checks (`ats.py`)
  - `POST /cv` — returns a full, print-ready CV page (opened in a new tab
    by the "Open print-ready CV" button)
- `templates/index.html` — the builder UI (form + live preview pane)
- `templates/_preview.html` — the shared CV layout, rendered by both
  `/preview` and `/cv`
- `templates/print.html` — wraps `_preview.html` for printing/PDF export
- `templates/tpl/_blocks.html` — shared section macros used by the 25 added
  templates (add a new look by writing a layout file that calls them, then a
  CSS block and a swatch)
- `static/style.css`, `static/app.js` — styling and the add/remove-row +
  live preview behaviour

## Templates

Pick a look from the swatches at the top of the form. All 31 read from the
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

**Added ten more**

- **Blueprint** — grid-paper background, framed title block with labelled contact details
- **Academic** — serif CV style with dates in a left column
- **Compact** — dense layout for people with a lot to fit on a page
- **Mosaic** — rounded cards flowing in two columns
- **Sunrise** — warm gradient header with a wave edge
- **Midnight** — dark theme with a light accent
- **Brutalist** — thick borders, hard shadows, loud colour
- **Spine** — section names run vertically down the left margin
- **Folder** — file-folder tab for the header and each section
- **Triptych** — three columns: skills, experience, education

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
