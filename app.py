from envfile import load_env
load_env()  # reads .env first, so everything below sees those settings

from flask import Flask, render_template, request, jsonify, Response, g
from functools import wraps
import os
import secrets
from werkzeug.middleware.proxy_fix import ProxyFix
from pathlib import Path
import subprocess
from datetime import datetime
import re
import base64

from resume_parser import parse_resume_text
from ats import keyword_match, health_checks
from pdf_export import html_to_pdf, BrowserNotFound, PdfFailed
from usage_limit import UsageLimiter
import ai_assistant

app = Flask(__name__)
if os.environ.get("TRUST_PROXY"):  # set this when the app runs behind nginx / a hosting proxy
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

# ---- daily limits (rolling 24 hours, per browser, with a higher per-network safety net) ----
PDF_DAILY_LIMIT = max(1, int(os.environ.get("PDF_DAILY_LIMIT", "4")))
AI_DAILY_LIMIT = max(1, int(os.environ.get("AI_DAILY_LIMIT", "10")))
LIMITS = {"pdf": (PDF_DAILY_LIMIT, PDF_DAILY_LIMIT * 5), "ai": (AI_DAILY_LIMIT, AI_DAILY_LIMIT * 5)}
limiter = UsageLimiter()
_CID_RE = re.compile(r"^[0-9a-f]{32}$")
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

# Picker catalogue: key -> (label, categories, number of swatch spans used by its preview tile)
_ORIGINALS = [("colophon", "Colophon", "classic creative", 1), ("ledger", "Ledger", "classic creative", 2),
              ("atlas", "Atlas", "sidebar modern", 2), ("mono", "Mono", "classic", 1),
              ("studio", "Studio", "modern bold", 2), ("myy", "MYY", "sidebar modern", 2)]
_TAGS = {
    "classic": "classic", "executive": "classic", "elegant": "classic creative", "minimal": "modern classic",
    "ribbon": "creative bold", "timeline": "modern creative", "banner": "bold modern", "gradient": "modern bold",
    "bold": "bold", "terminal": "creative bold", "pastel": "creative modern", "monogram": "modern classic",
    "cameo": "sidebar creative", "meridian": "sidebar bold", "profile": "modern", "blueprint": "creative",
    "academic": "classic", "compact": "classic modern", "mosaic": "modern creative", "sunrise": "bold creative",
    "midnight": "bold modern", "brutalist": "bold creative", "spine": "creative modern", "folder": "creative classic",
    "triptych": "modern classic",
}
TEMPLATE_CATALOG = [{"key": k, "label": l, "tags": t, "spans": n} for k, l, t, n in _ORIGINALS] + [
    {"key": k, "label": l, "tags": _TAGS.get(k, "modern"), "spans": 0} for k, l in EXTRA_TEMPLATES]
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


# ------------------------------------------------------------------ visitors & limits
def _client_id():
    cid = request.cookies.get("myy_cid", "")
    if not _CID_RE.match(cid):
        cid = g.get("new_cid") or secrets.token_hex(16)
        g.new_cid = cid
    return cid


@app.after_request
def _remember_visitor(resp):
    cid = g.get("new_cid")
    if cid:
        resp.set_cookie("myy_cid", cid, max_age=365 * 24 * 3600, httponly=True, samesite="Lax")
    return resp


def _reserve(kind):
    limit, ip_limit = LIMITS[kind]
    return limiter.reserve(kind, _client_id(), request.remote_addr or "unknown", limit, ip_limit)


def _peek(kind):
    limit, ip_limit = LIMITS[kind]
    return limiter.peek(kind, _client_id(), request.remote_addr or "unknown", limit, ip_limit)


def _human_wait(seconds):
    minutes = max(1, round(seconds / 60))
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours} hour{'s' if hours != 1 else ''} {minutes} minute{'s' if minutes != 1 else ''}"
    if hours:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def _limit_json(res):
    return jsonify(error="limit", scope=res.scope, **res.public()), 429


@app.route("/api/quota")
def api_quota():
    """What this visitor has left today (does not use anything up)."""
    out = {"ai_status": ai_assistant.status()}
    for kind in ("pdf", "ai"):
        r = _peek(kind)
        out[kind] = {**r.public(), "ok": r.ok, "scope": r.scope}
    return jsonify(out)


@app.route("/")
def index():
    return render_template("index.html", templates=TEMPLATE_CATALOG)


@app.route("/preview", methods=["GET", "POST"])
def preview():
    ctx = build_context(request.values, request.files)
    return render_template("_preview.html", **ctx)


@app.route("/cv", methods=["GET", "POST"])
def cv():
    res = _reserve("pdf")  # the print view is also a way to get a PDF, so it counts toward the same limit
    if not res.ok:
        return render_template("limit.html", limit=res.limit, wait=_human_wait(res.reset_in), scope=res.scope), 429
    ctx = build_context(request.values, request.files)
    return render_template("print.html", **ctx)


@app.route("/api/pdf", methods=["POST"])
def api_pdf():
    """Render the CV to a real A4 PDF and send it back (counts toward the daily limit)."""
    res = _reserve("pdf")
    if not res.ok:
        return _limit_json(res)
    try:
        ctx = build_context(request.form, request.files)
        css = (Path(app.static_folder) / "style.css").read_text(encoding="utf-8")
        html = render_template("print.html", pdf=True, inline_css=css, **ctx)
        pdf = html_to_pdf(html)
    except BrowserNotFound:
        limiter.refund(res.row_id)  # nothing was produced, so it shouldn't cost the visitor a download
        return jsonify(error="no_browser"), 501
    except (PdfFailed, subprocess.SubprocessError, OSError) as exc:
        limiter.refund(res.row_id)
        app.logger.warning("PDF export failed: %s", exc)
        return jsonify(error="failed"), 500
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ctx.get("full_name", "")).strip("-") or "Resume"
    return Response(pdf, mimetype="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{slug}-CV.pdf"',
        "X-Quota-Used": str(res.used), "X-Quota-Limit": str(res.limit), "X-Quota-Remaining": str(res.remaining),
    })


# ------------------------------------------------------------------ AI assistant
def _ai_endpoint(fn):
    """Shared handling: key present, resume not empty, daily AI limit, friendly errors."""
    @wraps(fn)
    def wrapper():
        if not ai_assistant.status()["enabled"]:
            return jsonify(error="no_key"), 503
        ctx = build_context(request.form, {})
        if ai_assistant.is_empty(ctx):
            return jsonify(error="empty"), 400
        res = _reserve("ai")
        if not res.ok:
            return _limit_json(res)
        target = request.form.get("target_role", "").strip()[:200]
        jd = request.form.get("job_description", "").strip()[:6000]
        try:
            result = fn(ctx, target, jd)
        except ai_assistant.AIUnavailable:
            limiter.refund(res.row_id)
            return jsonify(error="no_key"), 503
        except ai_assistant.AIError as exc:
            limiter.refund(res.row_id)  # a failed AI call doesn't cost the visitor anything
            return jsonify(error="ai_failed", code=exc.code), (400 if exc.code == "bad_request" else 502)
        except Exception:  # never leak details of an unexpected failure
            limiter.refund(res.row_id)
            app.logger.exception("AI endpoint crashed")
            return jsonify(error="ai_failed", code="failed"), 500
        return jsonify(result=result, quota=res.public())
    return wrapper


@app.route("/api/ai/analyse", methods=["POST"])
@_ai_endpoint
def api_ai_analyse(ctx, target, jd):
    return ai_assistant.analyse(ctx, target, jd)


@app.route("/api/ai/suggest", methods=["POST"])
@_ai_endpoint
def api_ai_suggest(ctx, target, jd):
    return ai_assistant.suggest(ctx, target, jd)


@app.route("/api/ai/generate", methods=["POST"])
@_ai_endpoint
def api_ai_generate(ctx, target, jd):
    kind = request.form.get("kind", "")
    try:
        index = int(request.form.get("index", "0"))
    except ValueError:
        index = 0
    return ai_assistant.generate(ctx, kind, index, target, jd)


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
    _ai = ai_assistant.status()
    print(f"  AI assistant : {'ON — ' + _ai['provider'] + ' (' + _ai['model'] + ')' if _ai['enabled'] else 'off — add GEMINI_API_KEY to the .env file to turn it on'}")
    print(f"  Daily limits : {PDF_DAILY_LIMIT} PDFs and {AI_DAILY_LIMIT} AI requests per visitor")
    app.run(debug=True, port=5000)
