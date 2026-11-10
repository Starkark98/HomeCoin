"""Security: password, data encryption key, sessions and auto-lock.

The data key (DEK, 32 random bytes) encrypts the database with SQLCipher. It is never written unencrypted:
data/keystore.json holds it encrypted (AES-256-GCM) with a key derived from the password (scrypt) and,
separately, with one derived from the recovery key. The password is not stored: it is verified by
trying to decrypt the DEK. Changing the password re-encrypts only the DEK; the database stays as it is.
"""
import base64
import datetime as dt
import hashlib
import json
import os
import secrets
import threading
import time
import unicodedata
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import db as dbm
from . import i18n

KEYSTORE = dbm.DATA_DIR / "keystore.json"
COOKIE = "hc_session"
MIN_PASSWORD = 8
# scrypt N=2^17 (≈128 MB, OWASP recommendation): each offline attempt on the keystore costs ~4 times the early development versions (N=2^15);
# keys created with weaker parameters are re-encrypted automatically at the first sign-in
SCRYPT = {"n": 2 ** 17, "r": 8, "p": 1}
WEAK_PASSWORDS = {"password", "password1", "12345678", "123456789", "1234567890", "qwertyui", "qwerty123", "homecoin",
                  "homecoin1", "iloveyou", "00000000", "11111111", "abcdefgh", "abc12345", "password123", "passw0rd"}
AUTO_LOCK_DEFAULT = 15  # minutes of inactivity before auto-lock
AUTO_LOCK_CHOICES = (5, 15, 30, 60, 120)
FREE_ATTEMPTS = 3       # wrong attempts without waiting; then 5 s, 10 s, 20 s... up to 5 minutes
MAX_DELAY = 300
IMPORT_TOKEN_MINUTES = 15
IMPORT_TOKEN_CHOICES = (15, 60, 240, 480)
AAD = b"homecoin-dek-v1"
RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O and 1/I


class AuthError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra


b64 = lambda b: base64.b64encode(b).decode("ascii")
unb64 = lambda s: base64.b64decode(s.encode("ascii"))


def _norm_password(pw):
    return unicodedata.normalize("NFC", pw or "").encode("utf-8")


def norm_recovery(code):
    return "".join(ch for ch in (code or "").upper() if ch in RECOVERY_ALPHABET)


def new_recovery_key():
    raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(30))  # ~150 bit
    return "-".join(raw[i:i + 5] for i in range(0, 30, 5))


def _kek(secret, salt, params):
    return hashlib.scrypt(secret, salt=salt, n=params["n"], r=params["r"], p=params["p"],
                          maxmem=256 * 1024 * 1024, dklen=32)


def wrap(secret, dek):
    salt, nonce = os.urandom(16), os.urandom(12)
    box = AESGCM(_kek(secret, salt, SCRYPT)).encrypt(nonce, dek, AAD)
    return {"kdf": "scrypt", **SCRYPT, "salt": b64(salt), "nonce": b64(nonce), "box": b64(box)}


def unwrap(secret, w):
    """Decrypted DEK, or None if the secret is wrong."""
    try:
        kek = _kek(secret, unb64(w["salt"]), w)
        return AESGCM(kek).decrypt(unb64(w["nonce"]), unb64(w["box"]), AAD)
    except (InvalidTag, KeyError, ValueError):
        return None


def seal(dek, data):
    """Encrypt arbitrary data with the DEK (used for downloadable backups)."""
    nonce = os.urandom(12)
    return {"nonce": b64(nonce), "data": b64(AESGCM(dek).encrypt(nonce, data, b"homecoin-backup-v1"))}


def unseal(dek, box):
    try:
        return AESGCM(dek).decrypt(unb64(box["nonce"]), unb64(box["data"]), b"homecoin-backup-v1")
    except (InvalidTag, KeyError, ValueError):
        return None


# ------------------------------------------------------------------ keystore

# On Windows a file cannot be replaced while another thread has it open (PermissionError): reads and writes of the
# keystore go through one lock, and a parsed copy is kept while the file is unchanged (it is read on every request).
# Short retries cover other programs (antivirus, backup tools) that open the file for a moment.
_KS_LOCK = threading.RLock()
_ks_cache = (None, None)  # (stat signature, parsed keystore)


def _retry(fn, tries=20):
    for i in range(tries):
        try:
            return fn()
        except PermissionError:
            if i == tries - 1:
                raise
            time.sleep(0.05)


def read_keystore():
    global _ks_cache
    with _KS_LOCK:
        try:
            st = KEYSTORE.stat()
        except FileNotFoundError:
            return None
        sig = (st.st_mtime_ns, st.st_size)
        if _ks_cache[0] != sig:
            _ks_cache = (sig, json.loads(_retry(lambda: KEYSTORE.read_text("utf-8"))))
        return json.loads(json.dumps(_ks_cache[1]))  # callers modify it before writing


def write_keystore(ks):
    global _ks_cache
    with _KS_LOCK:
        KEYSTORE.parent.mkdir(parents=True, exist_ok=True)
        tmp = KEYSTORE.with_suffix(".tmp")
        tmp.write_text(json.dumps(ks, indent=1), "utf-8")
        _retry(lambda: os.replace(tmp, KEYSTORE))
        _ks_cache = (None, None)


def check_password(pw):
    if len(pw or "") < MIN_PASSWORD:
        raise AuthError(i18n.t("The password must be at least {min_password} characters long", min_password=MIN_PASSWORD))
    if (pw or "").strip() != pw:
        raise AuthError(i18n.t("The password cannot start or end with a space"))
    if pw.lower() in WEAK_PASSWORDS or len(set(pw)) <= 2:
        raise AuthError(i18n.t("Password too easy to guess: use a phrase or a mix of words, numbers and symbols"))


# ------------------------------------------------- data folder permissions (Windows)
# Done with the Windows tools icacls and whoami, not PowerShell: on PCs where a company policy runs PowerShell in
# "constrained language mode" (common on work PCs) the PowerShell way failed and the check said "cannot be checked".
# SIDs are independent of the Windows language. SDDL short names and SIDs of the trusted accounts: SYSTEM,
# Administrators, and "creator owner" / "owner rights" (they stand for the owner, i.e. your user)
_TRUSTED_SIDS = {"S-1-5-18", "S-1-5-32-544", "S-1-3-0", "S-1-3-4"}
_SDDL_SIDS = {"SY": "S-1-5-18", "BA": "S-1-5-32-544", "CO": "S-1-3-0", "OW": "S-1-3-4", "WD": "S-1-1-0",
              "AU": "S-1-5-11", "BU": "S-1-5-32-545", "IU": "S-1-5-4", "NS": "S-1-5-20", "LS": "S-1-5-19",
              "PU": "S-1-5-32-547", "BG": "S-1-5-32-546", "AN": "S-1-5-7"}
_SID_NAMES = {"S-1-1-0": "Everyone", "S-1-5-11": "Authenticated Users", "S-1-5-32-545": "Users", "S-1-5-4": "Interactive users",
              "S-1-5-20": "Network Service", "S-1-5-19": "Local Service", "S-1-5-32-547": "Power Users", "S-1-5-32-546": "Guests",
              "S-1-5-7": "Anonymous logon"}


def _run(args, timeout=60):
    """A Windows tool without a window; its output as text (raises if it fails)."""
    import subprocess
    r = subprocess.run(args, capture_output=True, timeout=timeout, creationflags=0x08000000)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).decode(errors="replace").strip()[:300] or f"{args[0]} failed")
    return r.stdout.decode(errors="replace")


def _my_sid():
    import re
    m = re.search(r"S-1-5-[\d-]+", _run(["whoami", "/user", "/fo", "csv", "/nh"]))
    if not m:
        raise RuntimeError("Windows user not found")
    return m.group(0)


def _allowed_sids(path):
    """SIDs that the folder's permissions allow in (allow entries only), read with icacls in SDDL form."""
    import re
    import tempfile
    with tempfile.TemporaryDirectory(prefix="hc-acl-") as td:
        out = os.path.join(td, "acl.txt")
        _run(["icacls", str(path), "/save", out, "/Q"])
        with open(out, "rb") as f:  # UTF-16 little endian, with or without the byte order mark
            sddl = f.read().decode("utf-16-le").lstrip("﻿").strip().splitlines()[-1]
    sids = []
    for sid in re.findall(r"\(A;[^;]*;[^;]*;[^;]*;[^;]*;([^)]+)\)", sddl):
        sid = _SDDL_SIDS.get(sid, sid)
        if sid not in sids:
            sids.append(sid)
    return sids


def data_dir_access(path=None):
    """Who else (besides your user, SYSTEM and administrators) can access the data folder: list of names.
    None if it cannot be checked (non-Windows system or error)."""
    if os.name != "nt":
        return None
    try:
        me = _my_sid()
        return [_SID_NAMES.get(s, s) for s in _allowed_sids(path or dbm.DATA_DIR) if s not in _TRUSTED_SIDS | {me}]
    except Exception:
        return None


def restrict_data_dir(path=None):
    """Restrict the data folder to your user, SYSTEM and administrators. Permissions are set only on the
    folder; files inherit them (reset). Afterwards, check that keystore and database can still be read: otherwise
    restore the previous permissions (inherited from the parent folder)."""
    if os.name != "nt":
        raise AuthError(i18n.t("Available on Windows only"))
    d = Path(path or dbm.DATA_DIR)
    try:
        me = _my_sid()
        # no inheritance from the parent folder, only the three allowed accounts (inherited by files and subfolders)…
        _run(["icacls", str(d), "/inheritance:r", "/grant:r", f"*{me}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F",
              "*S-1-5-32-544:(OI)(CI)F", "/Q"], timeout=90)
        for sid in _allowed_sids(d):  # …and no other explicit permission left on the folder
            if sid not in _TRUSTED_SIDS | {me}:
                _run(["icacls", str(d), "/remove:g", f"*{sid}", "/Q"], timeout=90)
        if any(d.iterdir()):  # the contents inherit from the folder again
            _run(["icacls", str(d / "*"), "/reset", "/T", "/C", "/Q"], timeout=90)
        for f in [d / "keystore.json", d / "homecoin.db"]:
            if f.exists():
                f.open("rb").close()
        probe = d / ".hc-probe"
        probe.write_bytes(b"ok")
        probe.unlink()
        if data_dir_access(d):
            raise RuntimeError("other accounts can still open the folder")
    except Exception as exc:
        try:  # rollback: permissions inherited from the parent folder, as before
            _run(["icacls", str(d), "/reset", "/T", "/C", "/Q"], timeout=90)
        except Exception:
            pass
        raise RuntimeError(f"{exc} — permissions restored as before") from exc
    return data_dir_access(d)


# --------------------------------------------------------------------- vault

class Vault:
    """Unlock state of the process: key in memory, active sessions, wrong attempts."""

    def __init__(self):
        self.lock = threading.RLock()
        self.dek = None
        self.sessions = set()
        self.last_activity = 0.0
        self.failures = 0
        self.failed_before = 0
        self.blocked_until = 0.0
        self.initialized = False   # backup/migration/recurring items already run in this process
        self.import_token = None   # temporary code for local import scripts: (token, expiry)
        self.on_lock = []          # callbacks (e.g. clearing in-memory imports)
        # wrong attempts persist across server restarts (otherwise a restart would reset the wait)
        th = (read_keystore() or {}).get("throttle") or {}
        self.failures, self.blocked_until = int(th.get("failures", 0)), float(th.get("until", 0))
        threading.Thread(target=self._watch, daemon=True, name="homecoin-autolock").start()

    # state
    def configured(self):
        return KEYSTORE.exists()

    def auto_lock_minutes(self):
        ks = read_keystore() or {}
        return ks.get("auto_lock", AUTO_LOCK_DEFAULT)

    def language(self):
        """Interface language, kept in the keystore: it is needed before the data can be opened (sign-in screen)."""
        return i18n.set_language((read_keystore() or {}).get("language") or i18n.LANG["code"])

    def set_language(self, code):
        if code not in i18n.LANGUAGES:
            raise AuthError(i18n.t("Invalid language"))
        with self.lock:
            ks = read_keystore()
            ks["language"] = code
            write_keystore(ks)
        return i18n.set_language(code)

    def status(self, token):
        ks = read_keystore()
        if ks is not None:
            i18n.set_language(ks.get("language") or i18n.DEFAULT_LANGUAGE)
        return {
            "language": i18n.LANG["code"],
            "configured": ks is not None,
            "unlocked": self.valid(token, touch=False),
            "db_encrypted_without_keystore": ks is None and dbm.DB_PATH.exists() and dbm.is_encrypted(dbm.DB_PATH),
            "legacy_data": ks is None and dbm.DB_PATH.exists() and not dbm.is_encrypted(dbm.DB_PATH),
            "auto_lock": (ks or {}).get("auto_lock", AUTO_LOCK_DEFAULT),
            "retry_after": max(0, round(self.blocked_until - time.time())),
            "import_token_until": self.import_token_expiry() if self.valid(token, touch=False) else None,
            "min_password": MIN_PASSWORD,
        }

    def new_import_token(self, minutes=IMPORT_TOKEN_MINUTES):
        """Code for a local script (valid for `minutes`, only while HomeCoin is unlocked; one at a time)."""
        if minutes not in IMPORT_TOKEN_CHOICES:
            raise AuthError(i18n.t("Invalid duration"))
        with self.lock:
            token = "hc-" + secrets.token_urlsafe(24)
            self.import_token = (token, time.time() + minutes * 60)
            return token, minutes

    def import_token_expiry(self):
        it = self.import_token
        return it[1] if it and time.time() <= it[1] and self.dek is not None else None

    def revoke_import_token(self):
        self.import_token = None

    def valid_import_token(self, token):
        with self.lock:
            it = self.import_token
            if self.dek is None or not token or not it or time.time() > it[1]:
                return False
            if not secrets.compare_digest(token, it[0]):
                return False
            self.last_activity = time.time()
            return True

    def valid(self, token, touch=True):
        with self.lock:
            if self.dek is None or not token or token not in self.sessions:
                return False
            if self._expired():
                self.lock_now()
                return False
            if touch:
                self.last_activity = time.time()
            return True

    def _expired(self):
        minutes = self.auto_lock_minutes()
        return bool(minutes) and time.time() - self.last_activity > minutes * 60

    def _watch(self):
        while True:
            time.sleep(20)
            with self.lock:
                if self.dek is not None and self._expired():
                    self.lock_now()

    # transitions
    def _open(self, dek):
        dbm.set_key(dek)
        self.dek = dek
        if not self.initialized:
            dbm.init_db()
            self.initialized = True
        token = secrets.token_urlsafe(32)
        self.sessions = {token}  # a single session: a new sign-in closes the other browser tabs
        self.last_activity = time.time()
        self.failed_before = self.failures  # wrong attempts before this sign-in (for the activity log)
        if self.failures:
            self._save_throttle(0, 0.0)
        self.failures, self.blocked_until = 0, 0.0
        return token

    def _save_throttle(self, failures, until):
        ks = read_keystore()
        if ks is not None:
            ks["throttle"] = {"failures": failures, "until": until}
            write_keystore(ks)

    def lock_now(self):
        with self.lock:
            if self.dek is not None and dbm._key == self.dek:  # only the key this vault opened (tests run many vaults)
                dbm.set_key(None)
            self.dek = None
            self.sessions.clear()
            self.import_token = None
            for cb in self.on_lock:
                cb()

    def _throttle(self):
        wait = self.blocked_until - time.time()
        if wait > 0:
            raise AuthError(i18n.tn("Too many wrong attempts: try again in {n} second", "Too many wrong attempts: try again in {n} seconds", int(wait) + 1), 429,
                            retry_after=int(wait) + 1)

    def _failed(self):
        self.failures += 1
        if self.failures > FREE_ATTEMPTS:
            self.blocked_until = time.time() + min(MAX_DELAY, 5 * 2 ** min(self.failures - FREE_ATTEMPTS - 1, 10))
        self._save_throttle(self.failures, self.blocked_until)

    def setup(self, password, language=None):
        """First setup: create the data key and keystore, and encrypt any unencrypted data from earlier development versions."""
        with self.lock:
            if self.configured():
                raise AuthError(i18n.t("The password is already set"), 409)
            if dbm.DB_PATH.exists() and dbm.is_encrypted(dbm.DB_PATH):
                raise AuthError(i18n.t("The database is encrypted but the keystore.json file is missing: restore it in the data folder"), 409)
            check_password(password)
            dek, recovery = os.urandom(32), new_recovery_key()
            now = dt.datetime.now().isoformat(timespec="seconds")
            ks = {"app": "HomeCoin", "v": 1, "cipher": "sqlcipher4", "created": now, "changed": now,
                  "auto_lock": AUTO_LOCK_DEFAULT,
                  "language": language if language in i18n.LANGUAGES else i18n.LANG["code"],
                  "password": wrap(_norm_password(password), dek),
                  "recovery": wrap(norm_recovery(recovery).encode(), dek)}
            i18n.set_language(ks["language"])  # the first space and its categories are named in this language
            dbm.encrypt_existing(dek)  # unencrypted data from earlier versions: database and automatic backups become encrypted
            write_keystore(ks)
            return self._open(dek), recovery

    def login(self, password):
        with self.lock:
            ks = read_keystore()
            if ks is None:
                raise AuthError(i18n.t("Password not set yet"), 409)
            self._throttle()
            dek = unwrap(_norm_password(password), ks["password"])
            if dek is None:
                self._failed()
                raise AuthError(i18n.t("Wrong password"), 401, retry_after=max(0, round(self.blocked_until - time.time())))
            if ks["password"].get("n", 0) < SCRYPT["n"]:  # keystore from an earlier version: stronger key
                ks = read_keystore()
                ks["password"] = wrap(_norm_password(password), dek)
                write_keystore(ks)
            return self._open(dek)

    def recover(self, code, new_password):
        """Forgotten password: the recovery key sets a new password (and a new recovery key)."""
        with self.lock:
            ks = read_keystore()
            if ks is None:
                raise AuthError(i18n.t("Password not set yet"), 409)
            self._throttle()
            check_password(new_password)
            dek = unwrap(norm_recovery(code).encode(), ks["recovery"])
            if dek is None:
                self._failed()
                raise AuthError(i18n.t("Wrong recovery key"), 401)
            recovery = new_recovery_key()
            ks.update(password=wrap(_norm_password(new_password), dek),
                      recovery=wrap(norm_recovery(recovery).encode(), dek),
                      changed=dt.datetime.now().isoformat(timespec="seconds"))
            write_keystore(ks)
            return self._open(dek), recovery

    def _verify_current(self, ks, current):
        self._throttle()
        if unwrap(_norm_password(current), ks["password"]) != self.dek:
            self._failed()
            raise AuthError(i18n.t("Wrong current password"), 401)

    def change_password(self, current, new_password):
        with self.lock:
            ks = read_keystore()
            self._verify_current(ks, current)
            check_password(new_password)
            ks.update(password=wrap(_norm_password(new_password), self.dek),
                      changed=dt.datetime.now().isoformat(timespec="seconds"))
            write_keystore(ks)

    def new_recovery(self, current):
        with self.lock:
            ks = read_keystore()
            self._verify_current(ks, current)
            recovery = new_recovery_key()
            ks["recovery"] = wrap(norm_recovery(recovery).encode(), self.dek)
            write_keystore(ks)
            return recovery

    def set_auto_lock(self, minutes):
        if minutes not in AUTO_LOCK_CHOICES:
            raise AuthError(i18n.t("Invalid value"))
        with self.lock:
            ks = read_keystore()
            ks["auto_lock"] = minutes
            write_keystore(ks)

    def keystore_wraps(self):
        """The two encrypted copies of the DEK, to attach to downloadable backups."""
        ks = read_keystore()
        return {"password": ks["password"], "recovery": ks["recovery"]}

    def dek_from_backup(self, wraps, secret):
        """DEK of a backup made with another password/installation."""
        self._throttle()
        for kind, s in (("password", _norm_password(secret)), ("recovery", norm_recovery(secret).encode())):
            if kind in wraps and (dek := unwrap(s, wraps[kind])):
                return dek
        self._failed()
        raise AuthError(i18n.t("Wrong backup password or recovery key"), 422)
