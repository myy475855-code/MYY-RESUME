"""Tiny .env loader (no extra packages).

Reads KEY=value lines from a ".env" file next to app.py and puts them into the process
environment. Real environment variables always win over the file, so hosting platforms
that set variables themselves keep working. Use ENV_FILE=/path/to/file to read another file.
"""
import os
import re
from pathlib import Path

_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def load_env(path=None):
    p = Path(path or os.environ.get("ENV_FILE") or Path(__file__).with_name(".env"))
    if not p.is_file():
        return False
    for raw in p.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not _KEY_RE.match(key):
            continue
        if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()  # drop a trailing " # comment"
        os.environ.setdefault(key, value)
    return True
