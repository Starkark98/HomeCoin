"""Updates from the GitHub releases of HomeCoin, signed by the maintainer.

Only published releases count (never single commits). Every release carries a manifest (version, files, size, SHA-256)
signed with the maintainer's Ed25519 key; the public key is below. Nothing is installed unless the signature matches,
the version is newer than the running one and every downloaded byte matches the manifest. A compromised GitHub account,
a tampered download or a redirect elsewhere therefore cannot install code: the worst they can do is stop updates.

Network: one HTTPS request to the GitHub API (the latest release; nothing about you or your data is sent), plus the
manifest, its signature and, only when you click Update, the installer or ZIP. Redirects only to GitHub's own hosts.

How it is applied:
- installed version (installer): the new signed-off installer runs silently and reopens HomeCoin;
- ZIP version (.venv): the program files are replaced in place, with a copy of the old ones to roll back to;
- a development copy (git working tree) is never touched.
The data folder is never part of an update; an encrypted database backup is made first anyway.
"""
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from . import db as dbm
from . import i18n

REPO = "Starkark98/HomeCoin"
API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
RELEASE_PAGE = f"https://github.com/{REPO}/releases"
DOWNLOAD_PREFIX = f"https://github.com/{REPO}/releases/download/"
PUBLIC_KEY = "AdJJ5IzA9CK9SZedooXNVycLXF+npsWXE0C/wZT9ezw="  # Ed25519, release\keys\update-signing.key (maintainer)
ALLOWED_HOSTS = {"api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"}
MAX_ASSET = 200 * 1024 * 1024
TIMEOUT = 15
# files of the program replaced by a ZIP update; anything else in the folder (.venv, data of old versions, demo-data) stays
CODE_DIRS = ("homecoin", "static", "icon", "docs")


class UpdateError(Exception):
    pass


def parse_version(s):
    m = re.fullmatch(r"v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})", str(s or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


# ------------------------------------------------------------------ network

class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
            raise UpdateError(i18n.t("Download redirected to an unexpected address ({hostname})", hostname=u.hostname))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_Redirects)


def _get(url, limit, accept="application/octet-stream", to_file=None, not_found=None):
    """HTTPS GET of a GitHub address, at most `limit` bytes: the bytes, or the file written (with its SHA-256).
    `not_found`: the message when GitHub answers 404 (a missing release, or a file not attached to it)."""
    not_found = not_found or i18n.t("No published release found on GitHub")
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
        raise UpdateError(i18n.t("Unexpected download address"))
    from .app import VERSION
    req = urllib.request.Request(url, headers={"User-Agent": f"HomeCoin/{VERSION}", "Accept": accept})
    try:
        with _opener.open(req, timeout=TIMEOUT) as r:
            h, size, out = hashlib.sha256(), 0, [] if to_file is None else open(to_file, "wb")
            try:
                while chunk := r.read(1 << 16):
                    size += len(chunk)
                    if size > limit:
                        raise UpdateError(i18n.t("The download is larger than expected"))
                    h.update(chunk)
                    out.append(chunk) if to_file is None else out.write(chunk)
            finally:
                if to_file is not None:
                    out.close()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise UpdateError(not_found) from e
        if e.code in (403, 429):
            raise UpdateError(i18n.t("GitHub refused the request for now (rate limit): try again later")) from e
        raise UpdateError(i18n.t("GitHub answered {code}", code=e.code)) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise UpdateError(i18n.t("No connection to GitHub: check the internet connection")) from e
    return (b"".join(out), size, h.hexdigest()) if to_file is None else (to_file, size, h.hexdigest())


# ------------------------------------------------------------------ check

def verify_manifest(data, sig_b64, public_key=None):
    """The manifest dict, only if its signature is the maintainer's."""
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key or PUBLIC_KEY))
        key.verify(base64.b64decode(sig_b64.strip(), validate=True), data)
    except (InvalidSignature, ValueError, TypeError) as e:
        raise UpdateError(i18n.t("The release signature is not valid: update refused")) from e
    try:
        m = json.loads(data)
        assert m["app"] == "HomeCoin" and parse_version(m["version"])
        for f in m["files"].values():
            assert re.fullmatch(r"[\w.-]{1,100}", f["name"]) and re.fullmatch(r"[0-9a-f]{64}", f["sha256"])
            assert isinstance(f["size"], int) and 0 < f["size"] <= MAX_ASSET
    except (ValueError, KeyError, TypeError, AssertionError, AttributeError) as e:
        raise UpdateError(i18n.t("Invalid release manifest")) from e
    return m


def check(current):
    """Latest published release: {latest, available, notes, url, manifest}. Raises UpdateError."""
    raw, _, _ = _get(API_LATEST, 1024 * 1024, accept="application/vnd.github+json")
    try:
        rel = json.loads(raw)
        tag, assets = rel["tag_name"], {a["name"]: a for a in rel.get("assets") or []}
    except (ValueError, KeyError, TypeError) as e:
        raise UpdateError(i18n.t("Unexpected answer from GitHub")) from e
    latest = parse_version(tag)
    if not latest:
        raise UpdateError(i18n.t("Unexpected release name on GitHub: {tag}", tag=tag))
    ver = ".".join(map(str, latest))
    info = {"latest": ver, "available": latest > parse_version(current),
            "notes": str(rel.get("body") or "")[:4000], "url": f"{RELEASE_PAGE}/tag/v{ver}", "manifest": None,
            "assets": sorted(assets)}  # names of the files attached to the release
    if not info["available"]:
        return info
    names = (f"HomeCoin-{ver}.manifest.json", f"HomeCoin-{ver}.manifest.sig")
    if not all(n in assets for n in names):
        raise UpdateError(i18n.t("Version {ver} is published without a signature: install it by hand from GitHub", ver=ver))
    data, _, _ = _get(_asset_url(assets[names[0]]), 64 * 1024)
    sig, _, _ = _get(_asset_url(assets[names[1]]), 1024)
    m = verify_manifest(data, sig)
    if m["version"] != ver:
        raise UpdateError(i18n.t("The signed manifest is for another version: update refused"))
    info["manifest"] = m
    return info


def _asset_url(asset):
    url = str(asset.get("browser_download_url") or "")
    if not url.startswith(DOWNLOAD_PREFIX):
        raise UpdateError(i18n.t("Unexpected download address"))
    return url


# ------------------------------------------------------------------ apply

def install_kind(base=None):
    """installer | zip | dev | unknown: how this copy of HomeCoin was installed."""
    base = Path(base or dbm.BASE_DIR)
    if (base / ".git").exists():
        return "dev"
    if (base / "python" / "pythonw.exe").exists() and any(base.glob("unins*.exe")):
        return "installer"
    if (base / ".venv").exists() and (base / "run.py").exists():
        return "zip"
    return "unknown"


def updates_dir():
    d = dbm.DATA_DIR.parent / "updates"
    d.mkdir(parents=True, exist_ok=True)
    return d


def download(manifest, kind, assets=None):
    """Downloads the file of this installation type into the updates folder and checks size and SHA-256.
    `assets`: names of the files attached to the release (from check()), to say clearly which one is missing."""
    f = manifest["files"].get("installer" if kind == "installer" else "zip")
    if not f:
        raise UpdateError(i18n.t("The release has no file for this installation"))
    missing = i18n.t("{name} is not attached to the release v{version} on GitHub: install this version by hand, "
                     "or try again once the file has been added", name=f["name"], version=manifest["version"])
    if assets is not None and f["name"] not in assets:
        raise UpdateError(missing)
    url = f"{DOWNLOAD_PREFIX}v{manifest['version']}/{f['name']}"
    for old in updates_dir().glob("HomeCoin-*"):  # files of earlier updates
        old.unlink(missing_ok=True)
    target = updates_dir() / f["name"]
    part = target.with_suffix(target.suffix + ".part")
    try:
        _, size, digest = _get(url, f["size"], to_file=part, not_found=missing)
        if size != f["size"] or digest != f["sha256"]:
            raise UpdateError(i18n.t("The downloaded file does not match the signed release (SHA-256): update refused"))
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)
    return target


def _safe_members(zf, top="HomeCoin/"):
    """Names in the ZIP, all inside the HomeCoin/ folder: no absolute paths, no '..', no data or environments."""
    out, total = [], 0
    for info in zf.infolist():
        n = info.filename.replace("\\", "/")
        parts = n.split("/")
        if not n.startswith(top) or n.startswith("/") or ":" in n or ".." in parts:
            raise UpdateError(i18n.t("Unexpected path in the ZIP: {n}", n=n))
        rel = n[len(top):]
        if parts[1] in ("data", ".venv", "demo-data", ".git") or parts[1].startswith("data."):
            raise UpdateError(i18n.t("Unexpected folder in the ZIP: {value}", value=parts[1]))
        total += info.file_size
        if total > 100 * 1024 * 1024:
            raise UpdateError(i18n.t("The ZIP is larger than expected"))
        if rel and not info.is_dir():
            out.append((info, rel))
    if not any(rel == "run.py" for _, rel in out) or not any(rel == "homecoin/app.py" for _, rel in out):
        raise UpdateError(i18n.t("The ZIP does not contain HomeCoin"))
    return out


def apply_zip(zip_path, base=None, python=None, run=subprocess.run):
    """Replaces the program files of a ZIP installation with those of the verified ZIP. Libraries are installed first
    (with --require-hashes) if requirements.lock changed. On any error the previous files are put back."""
    base = Path(base or dbm.BASE_DIR)
    for old in updates_dir().glob("previous-*"):  # only the copy of the version just replaced is kept
        shutil.rmtree(old, ignore_errors=True)
    stage = Path(updates_dir() / f"stage-{int(time.time())}")
    rollback = stage.with_name(stage.name.replace("stage-", "previous-"))
    try:
        with zipfile.ZipFile(zip_path) as zf:
            members = _safe_members(zf)
            for info, rel in members:
                dst = stage / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dst, "wb") as out:
                    shutil.copyfileobj(src, out)
        new_lock, old_lock = stage / "requirements.lock", base / "requirements.lock"
        if new_lock.exists() and (not old_lock.exists() or new_lock.read_bytes() != old_lock.read_bytes()):
            py = python or str(base / ".venv" / "Scripts" / "python.exe")
            r = run([py, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--require-hashes",
                     "--only-binary=:all:", "-r", str(new_lock)], capture_output=True, text=True, timeout=900,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode:
                raise UpdateError(i18n.t("The new libraries could not be installed: nothing was changed. {details}",
                                         details=(r.stderr or r.stdout or "").strip()[-300:]))
        new_files = {rel for _, rel in members}
        # old code files that the new version no longer has (in the code folders only) go away too
        stale = [p.relative_to(base).as_posix() for d in CODE_DIRS if (base / d).is_dir()
                 for p in (base / d).rglob("*") if p.is_file() and "__pycache__" not in p.parts]
        stale = [rel for rel in stale if rel not in new_files]
        done = []
        try:
            for rel in sorted(new_files) + stale:
                cur = base / rel
                if cur.exists():
                    (rollback / rel).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(cur, rollback / rel)
                done.append(rel)
                if rel in new_files:
                    cur.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(stage / rel, cur)
                else:
                    cur.unlink()
        except Exception as e:
            for rel in reversed(done):  # put back what was there
                old, cur = rollback / rel, base / rel
                if old.exists():
                    shutil.copy2(old, cur)
                elif rel in new_files:
                    cur.unlink(missing_ok=True)
            raise UpdateError(i18n.t("Update interrupted, previous files restored: {e}", e=e)) from e
        for d in CODE_DIRS:
            for c in (base / d).rglob("__pycache__") if (base / d).is_dir() else []:
                shutil.rmtree(c, ignore_errors=True)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return rollback


def launch_installer(exe):
    """Runs the verified installer silently; it closes this HomeCoin and opens the new one. Returns once it is running."""
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    p = subprocess.Popen([str(exe), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
                          "/FORCECLOSEAPPLICATIONS", "/HCUPDATE=1"], creationflags=flags, close_fds=True)
    for _ in range(30):  # blocked by an antivirus or by policy: it ends at once and HomeCoin keeps running
        time.sleep(0.1)
        if p.poll() is not None:
            raise UpdateError(i18n.t("Windows did not let the installer run (code {returncode}). Download it from GitHub and run it by hand.", returncode=p.returncode))
    return p


def restart(base=None, port=8765):
    """Starts the updated HomeCoin (it waits for this one to free the port) without opening a new browser tab."""
    base = Path(base or dbm.BASE_DIR)
    exe = Path(sys.executable)
    windowless = exe.name.lower() == "pythonw.exe"
    flags = (getattr(subprocess, "DETACHED_PROCESS", 0) if windowless else getattr(subprocess, "CREATE_NEW_CONSOLE", 0)) \
        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen([str(exe), str(base / "run.py"), "--port", str(port), "--no-browser", "--wait-port"],
                     cwd=str(base), creationflags=flags, close_fds=True)
