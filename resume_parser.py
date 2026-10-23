"""Turn raw resume text (e.g. from OCR) into the form-field structure the
builder uses.  Heuristic, so the UI always lets the user review the result.
"""
import re

BULLET_RE = re.compile(r"^\s*(?:[•●▪■◦·‣▸►»›>*\-–—]|o(?=\s)|e(?=\s+[A-Z]))\s*")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)")
URL_RE = re.compile(r"(?:https?://)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:/[^\s|,;]*)?", re.I)
LINKEDIN_RE = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/[^\s|,;]+|/in/[\w-]+", re.I)
GITHUB_RE = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[^\s|,;]+", re.I)

MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE = rf"(?:{MONTH}\.?,?\s+)?(?:19|20)\d{{2}}"
DATE_RANGE_RE = re.compile(
    rf"(?P<start>{DATE}|\d{{1,2}}/(?:19|20)\d{{2}})\s*(?:-|–|—|to)\s*"
    rf"(?P<end>{DATE}|\d{{1,2}}/(?:19|20)\d{{2}}|Present|Current|Now|Ongoing|Till\s+date|Date)",
    re.I,
)
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")

SECTION_ALIASES = {
    "summary": ["summary", "profile", "professional summary", "career summary", "objective",
                "career objective", "about", "about me", "personal statement", "professional profile"],
    "experience": ["experience", "work experience", "professional experience", "employment",
                   "employment history", "work history", "career history", "internships", "internship"],
    "education": ["education", "academic background", "academics", "education and training",
                  "academic qualifications", "qualifications", "educational background"],
    "skills": ["skills", "technical skills", "core competencies", "key skills", "skills and tools",
               "competencies", "expertise", "technologies", "tools"],
    "projects": ["projects", "personal projects", "key projects", "academic projects", "selected projects"],
    "certifications": ["certifications", "certificates", "licenses and certifications", "courses",
                       "training", "certifications and courses", "achievements and certifications"],
    "languages": ["languages", "language skills"],
}
HEADING_LOOKUP = {a: sec for sec, names in SECTION_ALIASES.items() for a in names}

SCHOOL_WORDS = re.compile(r"\b(university|college|institute|school|academy|polytechnic|campus)\b", re.I)
DEGREE_WORDS = re.compile(
    r"\b(bachelor|master|b\.?\s?sc?|m\.?\s?sc?|b\.?\s?a|m\.?\s?a|b\.?\s?tech|m\.?\s?tech|bs|ms|bba|mba|ph\.?d|"
    r"diploma|intermediate|matric|fsc|f\.sc|hssc|ssc|a-levels?|o-levels?|associate|degree|doctorate)\b",
    re.I,
)


# --------------------------------------------------------------------- utils
def _clean_lines(text):
    text = text.replace("\r", "\n").replace("\t", " ").replace("\u00a0", " ")
    out = []
    for raw in text.split("\n"):
        line = re.sub(r"[ ]{2,}", " ", raw).strip()
        out.append(line)
    return out


def _heading_of(line):
    """Return the section key if `line` looks like a section heading."""
    stripped = re.sub(r"[^A-Za-z& ]", "", line).strip().lower().replace("&", "and")
    stripped = re.sub(r"\s+", " ", stripped)
    if not stripped or len(stripped) > 40:
        return None
    return HEADING_LOOKUP.get(stripped)


def _split_sections(lines):
    sections = {"header": []}
    current = "header"
    for line in lines:
        key = _heading_of(line) if line else None
        if key:
            current = key
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return sections


def _strip_bullet(line):
    return BULLET_RE.sub("", line, count=1).strip()


def _is_bullet(line):
    return bool(BULLET_RE.match(line)) and len(_strip_bullet(line)) > 0


def _nonblank(lines):
    return [l for l in lines if l.strip()]


# ------------------------------------------------------------------- header
def _parse_header(lines):
    result = {k: "" for k in
              ["full_name", "title", "email", "phone", "location", "website", "linkedin", "github"]}
    blob = "\n".join(lines)

    m = EMAIL_RE.search(blob)
    if m:
        result["email"] = m.group(0)
    m = LINKEDIN_RE.search(blob)
    if m:
        result["linkedin"] = m.group(0).rstrip("/")
    m = GITHUB_RE.search(blob)
    if m:
        result["github"] = m.group(0).rstrip("/")
    for m in PHONE_RE.finditer(blob):
        digits = re.sub(r"\D", "", m.group(0))
        if 9 <= len(digits) <= 15 and not DATE_RANGE_RE.search(m.group(0)):
            result["phone"] = m.group(0).strip()
            break

    # Website: first URL that isn't an email domain / linkedin / github
    blob_no_email = EMAIL_RE.sub(" ", blob)
    for m in URL_RE.finditer(blob_no_email):
        u = m.group(0)
        if re.search(r"linkedin|github", u, re.I):
            continue
        if re.search(r"\.(?:com|net|org|io|dev|me|co|app|pk|info|design|studio)\b", u, re.I) or u.lower().startswith("http"):
            result["website"] = u.rstrip("/.,")
            break

    # Name / title / location from the non-contact lines
    candidates = []
    for line in lines:
        if not line:
            continue
        seg_clean = EMAIL_RE.sub("", line)
        seg_clean = URL_RE.sub("", seg_clean)
        seg_clean = PHONE_RE.sub("", seg_clean)
        seg_clean = re.sub(r"[|•·●▪]", " ", seg_clean).strip(" ,-–—")
        if seg_clean:
            candidates.append((line, seg_clean))

    name = None
    for line, clean in candidates:
        words = clean.split()
        if 1 < len(words) <= 4 and all(re.match(r"^[A-Za-z.'’-]+$", w) for w in words):
            name = clean
            result["full_name"] = clean.title() if clean.isupper() else clean
            break
    if name:
        seen_name = False
        for line, clean in candidates:
            if clean == name:
                seen_name = True
                continue
            if not seen_name:
                continue
            if re.match(r"^[A-Za-z0-9 &/,.+#-]{3,60}$", clean) and "," not in clean:
                result["title"] = clean
                break

    # Location: a "City, Region" style segment
    for line in lines:
        for seg in re.split(r"[|•·●▪]", line):
            seg = seg.strip()
            if not seg or EMAIL_RE.search(seg) or URL_RE.search(seg) or PHONE_RE.search(seg):
                continue
            if re.match(r"^[A-Z][A-Za-z.' -]+,\s*[A-Z][A-Za-z.' -]+$", seg) and len(seg) <= 45 and seg != result["title"]:
                result["location"] = seg
                break
        if result["location"]:
            break
    return result


# -------------------------------------------------------- entry-style blocks
def _parse_entries(lines, allow_single_year=False):
    """Split experience/education lines into entries keyed on date lines.

    Returns a list of {"header": [...], "start": str, "end": str, "bullets": [...]}.
    """
    entries = []
    cur = None
    header_buf = []

    def new_entry(line, match):
        nonlocal cur, header_buf
        rest = (line[:match.start()] + " " + line[match.end():]).strip(" |,-–—•·()")
        header = list(header_buf)
        if rest:
            header.append(rest)
        header_buf = []
        cur = {"header": header, "start": match.group("start").strip(),
               "end": match.group("end").strip(), "bullets": []}
        entries.append(cur)

    for line in lines:
        if not line:
            if cur and cur["bullets"]:
                # blank line after bullets: the next plain line likely starts a new entry
                header_buf = header_buf  # keep as is
            continue

        bullet = _is_bullet(line)
        m = None if bullet else DATE_RANGE_RE.search(line)

        if m:
            new_entry(line, m)
            continue

        if allow_single_year and not bullet and len(line) < 90:
            mm = re.search(r"(?P<end>(?:19|20)\d{2})\)?\s*$", line)
            if mm:
                rest = line[:mm.start()].strip(" |,-–—•·()")
                header = list(header_buf)
                if rest:
                    header.append(rest)
                header_buf = []
                cur = {"header": header, "start": "", "end": mm.group("end"), "bullets": []}
                entries.append(cur)
                continue

        if bullet:
            text = _strip_bullet(line)
            if cur is None:
                continue
            cur["bullets"].append(text)
            header_buf = []
            continue

        # plain text line
        if cur is not None:
            if cur["bullets"]:
                if line[:1].islower() or not cur["bullets"][-1].rstrip().endswith((".", "!", "?", ":")) and line[:1].islower():
                    cur["bullets"][-1] += " " + line
                elif len(line) < 70 and not line.endswith("."):
                    header_buf.append(line)  # probably the next entry's header
                else:
                    cur["bullets"].append(line)
            elif len(cur["header"]) < 2 and len(line) < 80 and not line.endswith("."):
                cur["header"].append(line)
            elif len(line) < 70 and not line.endswith(".") and not cur["bullets"] and len(cur["header"]) >= 2:
                # extra short line under a header => detail line
                cur["bullets"].append(line)
            else:
                cur["bullets"].append(line)
        else:
            header_buf.append(line)

    return entries


def _split_role_company(header):
    role, company, location = "", "", ""
    if not header:
        return role, company, location
    first = header[0]
    parts = re.split(r"\s+\|\s+|\s+@\s+|\s+at\s+|\s+[–—-]\s+", first)
    if len(header) == 1 and len(parts) >= 2:
        role, company = parts[0].strip(), parts[1].strip()
        if len(parts) >= 3:
            location = parts[2].strip()
    else:
        role = parts[0].strip()
        if len(parts) >= 2:
            company = parts[1].strip()
        if len(header) >= 2:
            second = header[1]
            sp = re.split(r"\s+\|\s+|\s+[–—-]\s+", second)
            company = company or sp[0].strip()
            if len(sp) >= 2:
                location = sp[1].strip()
            elif "," in sp[0] and not company == sp[0]:
                pass
    # "Role, Company" on a single line
    if not company and "," in role:
        r, c = role.split(",", 1)
        if r.strip() and c.strip():
            role, company = r.strip(), c.strip()
    # "Company, City" -> split location
    if not location and "," in company:
        c, loc = company.rsplit(",", 1)
        if len(loc.split()) <= 3:
            company, location = c.strip(), loc.strip()
    return role, company, location


def _parse_experience(lines):
    entries = _parse_entries(lines)
    out = []
    for e in entries:
        role, company, location = _split_role_company(e["header"])
        out.append({
            "exp_role": role, "exp_company": company, "exp_location": location,
            "exp_start": e["start"], "exp_end": e["end"],
            "exp_bullets": "\n".join(e["bullets"]),
        })
    return out


_SCHOOL_SPLIT_RE = re.compile(
    r"^(?P<before>.*?)\s+(?P<school>(?:[A-Z][\w.&'’]*\s+){0,3}"
    r"(?:University|College|Institute|School|Academy|Polytechnic))\b(?P<after>.*)$"
)


def _parse_education(lines):
    entries = _parse_entries(lines, allow_single_year=True)
    out = []
    for e in entries:
        degree, school, details = "", "", []
        parts = []
        for h in e["header"]:
            parts += [p.strip() for p in re.split(r",|\s+[|–—-]\s+", h) if p.strip()]
        expanded = []
        for p in parts:
            m = _SCHOOL_SPLIT_RE.match(p)
            if m and m.group("before").strip() and DEGREE_WORDS.search(m.group("before")):
                expanded += [m.group("before").strip(), (m.group("school") + m.group("after")).strip()]
            else:
                expanded.append(p)
        for p in expanded:
            if not school and SCHOOL_WORDS.search(p):
                school = p
            elif not degree:
                degree = p
            elif not school:
                school = p
            else:
                details.append(p)
        details += e["bullets"]
        out.append({
            "edu_degree": degree, "edu_school": school, "edu_location": "",
            "edu_start": e["start"], "edu_end": e["end"],
            "edu_details": "; ".join(details),
        })
    return out


# ---------------------------------------------------------------- the rest
def _parse_skills(lines):
    groups = []
    loose = []
    for line in _nonblank(lines):
        text = _strip_bullet(line)
        if ":" in text:
            label, items = text.split(":", 1)
            if 0 < len(label) <= 40 and items.strip():
                groups.append({"skill_group": label.strip(),
                               "skill_items": ", ".join(s.strip() for s in re.split(r"[,;|•·]", items) if s.strip())})
                continue
        loose += [s.strip() for s in re.split(r"[,;|•·]", text) if s.strip()]
    if loose:
        groups.append({"skill_group": "Skills", "skill_items": ", ".join(loose)})
    return groups


def _parse_languages(lines):
    out = []
    for line in _nonblank(lines):
        for part in re.split(r"[,;|•·]", _strip_bullet(line)):
            part = part.strip()
            if not part:
                continue
            m = re.match(r"^([A-Za-z]+(?: [A-Za-z]+)?)\s*(?:[(\-–—:]\s*)?([A-Za-z ]+?)?\)?$", part)
            if m:
                out.append({"lang_name": m.group(1).strip(), "lang_level": (m.group(2) or "").strip()})
            else:
                out.append({"lang_name": part, "lang_level": ""})
    return out


def _blocks(lines):
    block, blocks = [], []
    for line in lines:
        if line:
            block.append(line)
        elif block:
            blocks.append(block)
            block = []
    if block:
        blocks.append(block)
    return blocks


def _parse_projects(lines):
    out = []
    # Bullet/blank-separated: a non-bullet short line starts a project, the rest is description.
    cur = None
    for line in _nonblank(lines):
        if _is_bullet(line) and not cur:
            cur = {"proj_name": _strip_bullet(line), "proj_desc": "", "proj_link": ""}
            out.append(cur)
            continue
        if _is_bullet(line):
            cur["proj_desc"] = (cur["proj_desc"] + " " + _strip_bullet(line)).strip()
        elif cur is None or (len(line) < 60 and not line.endswith(".") and cur["proj_desc"]):
            cur = {"proj_name": line, "proj_desc": "", "proj_link": ""}
            out.append(cur)
        else:
            cur["proj_desc"] = (cur["proj_desc"] + " " + line).strip()
    for p in out:
        m = URL_RE.search(p["proj_desc"] + " " + p["proj_name"])
        if m and "." in m.group(0) and re.search(r"https?://|github|\.com|\.io|\.app", m.group(0), re.I):
            p["proj_link"] = m.group(0)
    return out


def _parse_certs(lines):
    out = []
    for line in _nonblank(lines):
        text = _strip_bullet(line)
        year = ""
        ym = YEAR_RE.search(text)
        if ym:
            year = ym.group(0)
            text = (text[:ym.start()] + text[ym.end():]).strip(" ()-–—,|")
        parts = re.split(r"\s+[|–—-]\s+|,\s+", text, maxsplit=1)
        out.append({"cert_name": parts[0].strip(), "cert_org": parts[1].strip() if len(parts) > 1 else "",
                    "cert_year": year})
    return [c for c in out if c["cert_name"]]


def parse_resume_text(text):
    """Return {"fields": {...form field names -> str | list[str]...}, "found": [...], "raw": text}."""
    lines = _clean_lines(text or "")
    sections = _split_sections(lines)

    header = _parse_header(sections.get("header", [])[:15] or lines[:15])
    # Fall back: contact info sometimes sits just after the name block, inside "header" only.
    fields = dict(header)

    summary_lines = _nonblank(sections.get("summary", []))
    fields["summary"] = " ".join(_strip_bullet(l) for l in summary_lines)

    exp = _parse_experience(sections.get("experience", []))
    edu = _parse_education(sections.get("education", []))
    skills = _parse_skills(sections.get("skills", []))
    langs = _parse_languages(sections.get("languages", []))
    projs = _parse_projects(sections.get("projects", []))
    certs = _parse_certs(sections.get("certifications", []))

    def columns(rows, keys):
        return {k: [r.get(k, "") for r in rows] for k in keys} if rows else {}

    fields.update(columns(exp, ["exp_role", "exp_company", "exp_location", "exp_start", "exp_end", "exp_bullets"]))
    fields.update(columns(edu, ["edu_degree", "edu_school", "edu_location", "edu_start", "edu_end", "edu_details"]))
    fields.update(columns(skills, ["skill_group", "skill_items"]))
    fields.update(columns(langs, ["lang_name", "lang_level"]))
    fields.update(columns(projs, ["proj_name", "proj_link", "proj_desc"]))
    fields.update(columns(certs, ["cert_name", "cert_org", "cert_year"]))

    found = [label for label, ok in [
        ("name", fields.get("full_name")), ("email", fields.get("email")), ("phone", fields.get("phone")),
        ("summary", fields.get("summary")), ("experience", exp), ("education", edu),
        ("skills", skills), ("languages", langs), ("projects", projs), ("certifications", certs),
    ] if ok]
    return {"fields": fields, "found": found}
