"""Turn a rendered HTML page into a real (selectable-text) A4 PDF.

Uses a Chromium-based browser that is already installed on the machine running the
app (Google Chrome, Microsoft Edge, Chromium or Brave) in headless mode, so no extra
Python packages are needed. Set the CHROME_PATH environment variable to point at a
specific browser executable if auto-detection doesn't find one.
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path


class BrowserNotFound(RuntimeError):
    pass


class PdfFailed(RuntimeError):
    pass


_slots = threading.Semaphore(2)  # at most two browsers running at once


def find_browser():
    env = os.environ.get("CHROME_PATH")
    if env and Path(env).exists():
        return env

    candidates = []
    if sys.platform.startswith("win"):
        for var in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            root = os.environ.get(var)
            if root:
                candidates += [
                    rf"{root}\Google\Chrome\Application\chrome.exe",
                    rf"{root}\Microsoft\Edge\Application\msedge.exe",
                    rf"{root}\BraveSoftware\Brave-Browser\Application\brave.exe",
                    rf"{root}\Chromium\Application\chrome.exe",
                ]
    elif sys.platform == "darwin":
        candidates += [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
    for c in candidates:
        if os.path.exists(c):
            return c

    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                 "microsoft-edge", "microsoft-edge-stable", "brave-browser", "chrome", "msedge"):
        found = shutil.which(name)
        if found:
            return found

    # Browsers installed by Playwright (only used if present)
    base = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(Path.home() / ".cache" / "ms-playwright")
    for pattern in ("chromium-*/chrome-linux/chrome", "chromium_headless_shell-*/chrome-linux/headless_shell"):
        hits = sorted(glob.glob(os.path.join(base, pattern)))
        if hits:
            return hits[-1]
    raise BrowserNotFound("No Chrome/Edge/Chromium browser was found.")


def _run(exe, html_path, out_path, profile_dir, wait_for_assets, timeout):
    args = [
        exe, "--headless", "--disable-gpu", "--hide-scrollbars",
        "--no-first-run", "--no-default-browser-check",
        "--no-pdf-header-footer", "--print-to-pdf-no-header",
        f"--user-data-dir={profile_dir}",
    ]
    if hasattr(os, "geteuid") and os.geteuid() == 0:  # running as root (e.g. in Docker)
        args.append("--no-sandbox")
    if wait_for_assets:
        args.append("--virtual-time-budget=4000")  # give web fonts a moment to arrive
    args += [f"--print-to-pdf={out_path}", Path(html_path).as_uri()]
    subprocess.run(args, capture_output=True, timeout=timeout)


def html_to_pdf(html, timeout=40):
    exe = find_browser()
    with _slots, tempfile.TemporaryDirectory(prefix="myy-pdf-") as tmp:
        html_path = Path(tmp) / "cv.html"
        out_path = Path(tmp) / "cv.pdf"
        html_path.write_text(html, encoding="utf-8")
        last_error = None
        for wait_for_assets in (True, False):  # retry once without the font-wait flag
            try:
                _run(exe, html_path, out_path, Path(tmp) / "profile", wait_for_assets, timeout)
            except subprocess.TimeoutExpired as e:
                last_error = e
                continue
            if out_path.exists() and out_path.stat().st_size > 500:
                return out_path.read_bytes()
        raise PdfFailed(f"The browser didn't produce a PDF ({last_error or 'no output'}).")
