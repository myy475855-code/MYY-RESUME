"""Tiny ATS helper: compare a resume against a job description and run a few
sanity checks. Pure Python, no external services."""
import re
from collections import Counter

STOPWORDS = set("""
a about above after again all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how i
if in into is it its just me more most my no nor not now of off on once only or other our out over own same she should
so some such than that the their them then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours able across etc including within using use
used work working works role roles team teams years year experience experienced strong ability looking join candidate
candidates required requirements preferred responsibilities responsible must plus good great excellent knowledge skills
skill company position job new need needs want help well based related relevant ensure support
""".split())

TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+#.\-]*[a-zA-Z0-9+#]|[a-zA-Z]")


def _stem(w):
    w = w.lower().strip(".-")
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _resume_text(ctx):
    parts = []

    def walk(v):
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x)

    skip = {"photo_data_uri", "accent_color", "template", "generated_on"}
    walk({k: v for k, v in ctx.items() if k not in skip})
    return "\n".join(parts)


def keyword_match(ctx, job_description, top_n=25):
    jd_tokens = [t for t in TOKEN_RE.findall(job_description or "")]
    counts = Counter()
    display = {}
    for t in jd_tokens:
        low = t.lower().strip(".-")
        if len(low) < 3 and low not in {"c", "r", "go", "ai", "ml", "qa", "ui", "ux", "sql"}:
            continue
        if low in STOPWORDS:
            continue
        stem = _stem(low)
        counts[stem] += 1
        display.setdefault(stem, t.strip(".-"))
    keywords = [k for k, _ in counts.most_common(top_n)]

    resume_stems = {_stem(t) for t in TOKEN_RE.findall(_resume_text(ctx))}
    matched = [display[k] for k in keywords if k in resume_stems]
    missing = [display[k] for k in keywords if k not in resume_stems]
    score = round(100 * len(matched) / len(keywords)) if keywords else 0
    return {"score": score, "matched": matched, "missing": missing, "total": len(keywords)}


def health_checks(ctx):
    checks = []

    def add(ok, label, tip=""):
        checks.append({"ok": bool(ok), "label": label, "tip": tip})

    add(ctx.get("full_name"), "Name present")
    add(ctx.get("email"), "Email present", "Recruiters and ATS parsers need an email address.")
    add(ctx.get("phone"), "Phone present", "Add a phone number.")
    summary = ctx.get("summary", "")
    add(30 <= len(summary) <= 600, "Summary is 30–600 characters",
        "Aim for 2–3 sentences." if summary else "Add a short profile summary.")
    exp = ctx.get("experience", [])
    add(exp, "Has work experience", "Add at least one role (internships count).")
    bullets = [b for e in exp for b in e.get("bullets", [])]
    with_numbers = [b for b in bullets if re.search(r"\d", b)]
    if bullets:
        add(len(with_numbers) / len(bullets) >= 0.3, "Bullets include numbers/metrics",
            "Quantify results (%, users, revenue, time saved).")
        long_b = [b for b in bullets if len(b) > 220]
        add(not long_b, "Bullets are concise (under ~220 chars)", "Shorten the longest bullets.")
    add(ctx.get("skill_groups"), "Skills section present", "List the tools and technologies you use.")
    add(ctx.get("education"), "Education present")
    return checks
