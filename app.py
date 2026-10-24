from flask import Flask, render_template, request, jsonify, Response
from pathlib import Path
import subprocess
from datetime import datetime
import re
import base64

from resume_parser import parse_resume_text
from ats import keyword_match, health_checks
from pdf_export import html_to_pdf, BrowserNotFound, PdfFailed

app = Flask(__name__)
MAX_PHOTO_BYTES = 3 * 1024 * 1024  # 3 MB


def _zip_fields(form, *names):
    """Zip several same-length getlist() fields into a list of dicts."""
    lists = [form.getlist(n) for n in names]
    length = max((len(l) for l in lists), default=0)
    rows = []
    for i in range(length):
        row = {}
        for n, l in zip(names, lists):
            row[n] = l[i] if i < len(l) else ""
        rows.append(row)
    return rows


EXTRA_TEMPLATES = [
    ("classic", "Classic"), ("executive", "Executive"), ("elegant", "Elegant"),
    ("minimal", "Minimal"), ("ribbon", "Ribbon"), ("timeline", "Timeline"),
    ("banner", "Banner"), ("gradient", "Gradient"), ("bold", "Bold"),
    ("terminal", "Terminal"), ("pastel", "Pastel"), ("monogram", "Monogram"),
    ("cameo", "Cameo"), ("meridian", "Meridian"), ("profile", "Profile"),
    ("blueprint", "Blueprint"), ("academic", "Academic"), ("compact", "Compact"),
    ("mosaic", "Mosaic"), ("sunrise", "Sunrise"), ("midnight", "Midnight"),
    ("brutalist", "Brutalist"), ("spine", "Spine"), ("folder", "Folder"),
    ("triptych", "Triptych"),
]
VALID_TEMPLATES = {"colophon", "ledger", "atlas", "mono", "studio", "myy"} | {k for k, _ in EXTRA_TEMPLATES}
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _photo_data_uri(files):
    """Read an uploaded image file and return it as a data: URI, or None."""
    photo = files.get("photo_file")
    if not photo or not photo.filename:
        return None
    mimetype = photo.mimetype or ""
    if not mimetype.startswith("image/"):
        return None
    data = photo.read()
    if not data or len(data) > MAX_PHOTO_BYTES:
        return None
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mimetype};base64,{encoded}"


def build_context(form, files=None):
    files = files if files is not None else {}
    experience = _zip_fields(
        form, "exp_role", "exp_company", "exp_location", "exp_start", "exp_end", "exp_bullets"
    )
    for row in experience:
        row["bullets"] = [b.strip() for b in row.get("exp_bullets", "").split("\n") if b.strip()]

    education = _zip_fields(
        form, "edu_degree", "edu_school", "edu_location", "edu_start", "edu_end", "edu_details"
    )

    projects = _zip_fields(form, "proj_name", "proj_desc", "proj_link")
    projects = [p for p in projects if p.get("proj_name") or p.get("proj_desc")]

    certifications = _zip_fields(form, "cert_name", "cert_org", "cert_year")
    certifications = [c for c in certifications if c.get("cert_name")]

    languages = _zip_fields(form, "lang_name", "lang_level")
    languages = [l for l in languages if l.get("lang_name")]

    skill_groups = _zip_fields(form, "skill_group", "skill_items")
    skill_groups = [
        {
            "skill_group": g["skill_group"],
            "skills": [s.strip() for s in g["skill_items"].split(",") if s.strip()],
        }
        for g in skill_groups
        if g.get("skill_group") or g.get("skill_items")
    ]

    experience = [e for e in experience if e.get("exp_role") or e.get("exp_company")]
    education = [e for e in education if e.get("edu_degree") or e.get("edu_school")]

    accent_color = form.get("accent_color", "").strip()
    if not HEX_COLOR_RE.match(accent_color):
        accent_color = ""

    return {
        "template": form.get("template", "colophon") if form.get("template", "colophon") in VALID_TEMPLATES else "colophon",
        "accent_color": accent_color,
        "full_name": form.get("full_name", "").strip(),
        "title": form.get("title", "").strip(),
        "photo_data_uri": _photo_data_uri(files),
        "email": form.get("email", "").strip(),
        "phone": form.get("phone", "").strip(),
        "location": form.get("location", "").strip(),
        "website": form.get("website", "").strip(),
        "linkedin": form.get("linkedin", "").strip(),
        "github": form.get("github", "").strip(),
        "summary": form.get("summary", "").strip(),
        "experience": experience,
        "education": education,
        "skill_groups": skill_groups,
        "projects": projects,
        "certifications": certifications,
        "languages": languages,
        "generated_on": datetime.now().strftime("%d %b %Y"),
    }


@app.route("/")
def index():
    return render_template("index.html", extra_templates=EXTRA_TEMPLATES)


@app.route("/preview", methods=["GET", "POST"])
def preview():
    ctx = build_context(request.values, request.files)
    return render_template("_preview.html", **ctx)


@app.route("/cv", methods=["GET", "POST"])
def cv():
    ctx = build_context(request.values, request.files)
    return render_template("print.html", **ctx)


@app.route("/api/pdf", methods=["POST"])
def api_pdf():
    """Render the CV to a real A4 PDF and send it back."""
    ctx = build_context(request.form, request.files)
    css = (Path(app.static_folder) / "style.css").read_text(encoding="utf-8")
    html = render_template("print.html", pdf=True, inline_css=css, **ctx)
    try:
        pdf = html_to_pdf(html)
    except BrowserNotFound:
        return jsonify(error="no_browser"), 501
    except (PdfFailed, subprocess.SubprocessError, OSError) as exc:
        app.logger.warning("PDF export failed: %s", exc)
        return jsonify(error="failed"), 500
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ctx.get("full_name", "")).strip("-") or "Resume"
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{slug}-CV.pdf"'})


@app.route("/api/parse-resume", methods=["POST"])
def api_parse_resume():
    """Turn OCR'd / extracted resume text into form fields."""
    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")
    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "No text received."}), 400
    if len(text) > 200_000:
        return jsonify({"error": "Text too long."}), 413
    return jsonify(parse_resume_text(text))


@app.route("/api/ats-match", methods=["POST"])
def api_ats_match():
    """Compare the current form data against a pasted job description."""
    ctx = build_context(request.form, {})
    jd = request.form.get("job_description", "")
    return jsonify({
        "match": keyword_match(ctx, jd) if jd.strip() else None,
        "checks": health_checks(ctx),
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
