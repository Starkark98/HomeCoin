"""Encrypted SQLite database (SQLCipher): schema, initial seed, connection and automatic backups."""
import os
import sqlite3
import datetime as dt
from pathlib import Path

import sqlcipher3
from flask import g

BASE_DIR = Path(__file__).resolve().parent.parent
LEGACY_DATA_DIR = BASE_DIR / "data"  # up to 1.1.0 the data lived inside the program folder


def default_data_dir():
    """Per-user data folder, outside the program folder (so updating or uninstalling never touches it) and outside
    Documents (often synced to OneDrive and under Controlled Folder Access): %LOCALAPPDATA%\\HomeCoin\\data on Windows.
    Not a temporary folder: Windows cleans %LOCALAPPDATA%\\Temp, not this one. HOMECOIN_DATA_DIR overrides it."""
    if os.environ.get("HOMECOIN_DATA_DIR"):
        return Path(os.environ["HOMECOIN_DATA_DIR"])
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "HomeCoin" / "data"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "HomeCoin" / "data"


DATA_DIR = default_data_dir()
BACKUP_DIR = DATA_DIR / "backups"
DB_PATH = DATA_DIR / "homecoin.db"
SCHEMA_VERSION = 17
KEEP_BACKUPS = 15

SCHEMA = """
-- spaces (portfolios): household or personal; accounts, categories and people belong to a space
CREATE TABLE IF NOT EXISTS portfolios (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'family' CHECK (type IN ('family', 'personal')),
    color      TEXT NOT NULL DEFAULT '#ec4899',
    icon       TEXT NOT NULL DEFAULT '🏠',
    position   INTEGER NOT NULL DEFAULT 0,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY,
    portfolio_id    INTEGER REFERENCES portfolios(id),
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'corrente',
    color           TEXT NOT NULL DEFAULT '#6366f1',
    icon            TEXT NOT NULL DEFAULT '🏦',
    initial_balance INTEGER NOT NULL DEFAULT 0,
    archived        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id           INTEGER PRIMARY KEY,
    portfolio_id INTEGER REFERENCES portfolios(id),
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
    color        TEXT NOT NULL DEFAULT '#94a3b8',
    icon         TEXT NOT NULL DEFAULT '📦',
    budget       INTEGER NOT NULL DEFAULT 0,
    split        TEXT NOT NULL DEFAULT 'prop',
    flow         TEXT NOT NULL DEFAULT '',  -- 'other' = expense that is a contribution to other spaces (not spending)
    UNIQUE (portfolio_id, name, kind)
);

CREATE TABLE IF NOT EXISTS recurring (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
    amount        INTEGER NOT NULL CHECK (amount > 0),
    account_id    INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER REFERENCES accounts(id),
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    frequency     TEXT NOT NULL,
    start_date    TEXT NOT NULL,
    end_date      TEXT,
    installments  INTEGER,
    principal     INTEGER,
    generated     INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY,
    date          TEXT NOT NULL,
    amount        INTEGER NOT NULL CHECK (amount > 0),
    kind          TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
    account_id    INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER REFERENCES accounts(id),
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description   TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    recurring_id  INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
    source        TEXT NOT NULL DEFAULT 'manual',
    excluded      INTEGER NOT NULL DEFAULT 0,  -- 1 = excluded from reports and totals (still counts in the balance)
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- fair split, chosen by the user (v17): whose contribution this is (NULL = automatic), or not a contribution at all
    person_id     INTEGER REFERENCES people(id) ON DELETE SET NULL,
    split_off     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS ix_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS ix_tx_category ON transactions(category_id);

CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY,
    pattern     TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE (pattern, category_id)
);

-- fair split: contributing people, plus generic key/value settings
CREATE TABLE IF NOT EXISTS people (
    id       INTEGER PRIMARY KEY,
    portfolio_id INTEGER REFERENCES portfolios(id),
    name     TEXT NOT NULL,
    income   INTEGER NOT NULL DEFAULT 0,   -- net monthly income in cents
    keyword  TEXT NOT NULL DEFAULT '',     -- to recognize their contributions in descriptions
    position INTEGER NOT NULL DEFAULT 0,
    space_id INTEGER REFERENCES portfolios(id) ON DELETE SET NULL  -- their own space: its transfers are theirs (v17)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- savings goals (per space): progress from an account balance or from an amount set aside by hand
CREATE TABLE IF NOT EXISTS goals (
    id           INTEGER PRIMARY KEY,
    portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    icon         TEXT NOT NULL DEFAULT '🎯',
    color        TEXT NOT NULL DEFAULT '#6366f1',
    target       INTEGER NOT NULL CHECK (target > 0),
    target_date  TEXT,
    account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    saved        INTEGER NOT NULL DEFAULT 0,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- investments: market value of accounts over time and (optional) securities for automatic updates
CREATE TABLE IF NOT EXISTS valuations (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    value      INTEGER NOT NULL,
    source     TEXT NOT NULL DEFAULT 'manual',
    UNIQUE (account_id, date)
);
CREATE TABLE IF NOT EXISTS holdings (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ticker      TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    quantity    REAL NOT NULL DEFAULT 0,
    asset_class TEXT NOT NULL DEFAULT 'azioni',
    price       REAL,
    currency    TEXT,
    price_eur   REAL,
    price_date  TEXT,
    isin        TEXT
);
-- trades on securities: if a security has any, its quantity is computed from them; amount = effect on the account's
-- cash in cents (buy negative, sell positive, fees included)
CREATE TABLE IF NOT EXISTS trades (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    holding_id  INTEGER REFERENCES holdings(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('buy', 'sell', 'split', 'capital', 'interest', 'dividend', 'fee')),
    quantity    REAL NOT NULL DEFAULT 0,
    price       REAL,
    amount      INTEGER NOT NULL DEFAULT 0,
    fees        INTEGER NOT NULL DEFAULT 0,
    notes       TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_trades_account ON trades(account_id, date);
-- month-end prices of securities (in the reference currency, despite the column name), to value past months correctly
CREATE TABLE IF NOT EXISTS price_history (
    holding_id INTEGER NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
    month      TEXT NOT NULL,
    price_eur  REAL NOT NULL,
    PRIMARY KEY (holding_id, month)
);
-- activity log of important operations (v11): one short row per event, deleted after 12 months
CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY,
    ts        TEXT NOT NULL,
    kind      TEXT NOT NULL,
    action    TEXT NOT NULL,
    detail    TEXT NOT NULL DEFAULT '',
    portfolio TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit_log(ts);
"""

PORTFOLIO_TYPES = {"family": "Family", "personal": "Personal"}  # type -> English name (i18n.space_name translates it)
# optional tabs (the others are the common core): each space picks its own, the type only sets the defaults
OPTIONAL_FEATURES = ("budget", "obiettivi", "emergenza", "calendario", "mutuo", "ripartizione", "investimenti", "risparmio")
DEFAULT_FEATURES = {
    "family": ("budget", "obiettivi", "emergenza", "calendario", "mutuo", "ripartizione"),
    "personal": ("budget", "obiettivi", "emergenza", "calendario", "investimenti", "risparmio"),
}

# default categories of a new space, few and broad (the detail goes in the description).
# Each category has its own hue, matching the dominant color of its icon (same scheme in every space).
_COMMON = [  # optimized palette: minimum perceptual distance (CIEDE2000) ~18 between categories, good contrast on light and dark
    ("groceries", "expense", "#059669", "🥦"), ("restaurants", "expense", "#ea580c", "🍕"),
    ("home", "expense", "#a16207", "🛋️"), ("utilities", "expense", "#fde047", "💡"),
    ("transport", "expense", "#e11d48", "🚗"), ("travel", "expense", "#3b82f6", "✈️"),
    ("shopping", "expense", "#c084fc", "🛍️"), ("health", "expense", "#0891b2", "💊"),
    ("bank", "expense", "#cbd5e1", "💳"), ("other", "expense", "#e7d3b0", "📦"),
    ("other_income", "income", "#3b82f6", "🎁"),
]
DEFAULT_CATEGORIES = {  # (code, kind, color, icon): the name comes from i18n.CATEGORY_NAMES in the chosen language
    "family": [("mortgage", "expense", "#f59e0b", "🔑"), *_COMMON,
               ("contributions", "income", "#2dd4bf", "💶")],
    "personal": [("subscriptions", "expense", "#7c3aed", "📺"), ("sport", "expense", "#65a30d", "🎾"),
                 ("books", "expense", "#f472b6", "📚"), ("taxes", "expense", "#78716c", "🏛️"),
                 *_COMMON, ("salary", "income", "#059669", "💼"), ("interest", "income", "#65a30d", "💹")],
}


def create_portfolio(conn, name, ptype, color="#ec4899", icon="🏠", lang=None):
    """Create a space with its default categories (named in the interface language); return its id."""
    from . import i18n
    pos = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM portfolios").fetchone()[0]
    pid = conn.execute("INSERT INTO portfolios(name, type, color, icon, position) VALUES (?,?,?,?,?)",
                       (name, ptype, color, icon, pos)).lastrowid
    conn.executemany("INSERT INTO categories(portfolio_id, name, kind, color, icon, code) VALUES (?,?,?,?,?,?)",
                     [(pid, i18n.category_name(code, lang), kind, color_, icon_, code)
                      for code, kind, color_, icon_ in DEFAULT_CATEGORIES[ptype]])
    return pid


def assign_category_codes(conn):
    """Older databases: give the fixed code to the default and system categories, recognized by any of their names
    (English, Italian of older versions, the other languages). One category per code and space; nothing is renamed."""
    from . import i18n
    taken = {(r[0], r[1]) for r in conn.execute("SELECT portfolio_id, code FROM categories WHERE code IS NOT NULL")}
    for cid, pid, name, kind in conn.execute(
            "SELECT id, portfolio_id, name, kind FROM categories WHERE code IS NULL ORDER BY id").fetchall():
        code = i18n.code_of_name(name)
        if not code or (pid, code) in taken:
            continue
        if code in ("contributions",) and kind not in ("income", "expense"):
            continue
        conn.execute("UPDATE categories SET code = ? WHERE id = ?", (code, cid))
        taken.add((pid, code))


PLAIN_HEADER = b"SQLite format 3\x00"
_key = None  # data key (32 bytes) while HomeCoin is unlocked; None = locked


class Locked(Exception):
    """Database access without unlocking HomeCoin first."""


def set_key(key):
    global _key
    _key = key


def is_encrypted(path):
    with open(path, "rb") as f:
        return f.read(16) != PLAIN_HEADER


def _keyed(path, key):
    conn = sqlcipher3.connect(str(path), timeout=10)
    conn.execute(f"PRAGMA key = \"x'{key.hex()}'\"")  # raw key: no additional derivation
    return conn


def connect(path=None, key=None):
    key = key or _key
    if key is None:
        raise Locked()
    conn = _keyed(path or DB_PATH, key)
    conn.row_factory = sqlcipher3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # hardening: temporary tables (sorting, grouping) stay in memory, not on disk; deleted rows are
    # overwritten. (Do NOT enable cipher_memory_security: with sqlcipher3-wheels 0.5.x it crashes the process)
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA secure_delete = ON")
    return conn


def _export(src, target, key):
    """Consistent copy of an open connection into a new file encrypted with key."""
    target.unlink(missing_ok=True)
    src.execute("ATTACH DATABASE ? AS enc KEY ?", (str(target), f"x'{key.hex()}'"))
    try:
        src.execute("SELECT sqlcipher_export('enc')")
        src.execute(f"PRAGMA enc.user_version = {src.execute('PRAGMA user_version').fetchone()[0]}")
    finally:
        src.execute("DETACH DATABASE enc")


def _shred(path):
    """Overwrite a file with zeros before deleting it (best effort: not guaranteed on SSDs)."""
    try:
        size = path.stat().st_size
        with open(path, "r+b") as f:
            while size > 0:
                n = min(size, 1 << 20)
                f.write(b"\x00" * n)
                size -= n
            f.flush()
            os.fsync(f.fileno())
    except OSError:
        pass
    path.unlink(missing_ok=True)


def _counts(conn):
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]
    return {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}


def encrypt_file(path, key):
    """Convert an unencrypted database (earlier development versions) into an encrypted one, verifying it before replacing."""
    plain = sqlite3.connect(path)
    try:
        plain.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        plain.execute("PRAGMA journal_mode = DELETE")
        expected = _counts(plain)
    finally:
        plain.close()
    tmp = path.with_name(path.name + ".enc-tmp")
    src = sqlcipher3.connect(str(path))  # no key: reads the unencrypted file
    try:
        _export(src, tmp, key)
    finally:
        src.close()
    check = _keyed(tmp, key)
    try:
        if _counts(check) != expected:
            raise RuntimeError(f"verification of the encrypted copy of {path.name} failed")
    finally:
        check.close()
    for extra in (path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
        if extra.exists():
            _shred(extra)
    _shred(path)
    os.replace(tmp, path)


def integrity_report(key=None):
    """Checks on the encrypted database: page authentication (SQLCipher HMAC), structure, references, balances."""
    conn = connect(key=key)
    cipher, structure, fkeys, counts, cipher_version = [], ["cannot be verified"], [], {}, "?"
    try:
        cipher_version = conn.execute("PRAGMA cipher_version").fetchone()[0]
        cipher = [r[0] for r in conn.execute("PRAGMA cipher_integrity_check")]  # empty = no tampered pages
        structure = [r[0] for r in conn.execute("PRAGMA integrity_check")]
        fkeys = conn.execute("PRAGMA foreign_key_check").fetchall()
        counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                  for t in ("portfolios", "accounts", "categories", "transactions", "recurring", "trades", "holdings")}
    except sqlcipher3.DatabaseError as exc:  # pages that cannot be decrypted or damaged structure
        structure = [f"error: {exc}"]
        cipher = cipher or ["pages cannot be decrypted"]
    finally:
        conn.close()
    backups = sorted(BACKUP_DIR.glob("homecoin-*")) if BACKUP_DIR.exists() else []
    plain = [f.name for f in [DB_PATH, *[b for b in backups if b.suffix == ".db"]] if f.exists() and not is_encrypted(f)]
    ok = not cipher and structure == ["ok"] and not fkeys and not plain
    return {"ok": ok, "checked_at": dt.datetime.now().isoformat(timespec="seconds"), "cipher": "SQLCipher " + cipher_version,
            "pages_tampered": len(cipher), "structure": structure[:5], "foreign_key_errors": len(fkeys),
            "plaintext_files": plain, "backups": len(backups), "counts": counts}


def encrypt_existing(key):
    """Encrypt the database and any automatic backups still unencrypted."""
    files = ([DB_PATH] if DB_PATH.exists() else []) + sorted(BACKUP_DIR.glob("homecoin-*.db"))
    for f in files:
        if not is_encrypted(f):
            encrypt_file(f, key)
    return len(files)


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


# ------------------------------------------------------------------ automatic backups: user settings
# Kept in a small file next to the data (no financial data: options and a folder), readable before HomeCoin is
# unlocked, because the start backup is taken while the database is being opened.
BACKUP_TRIGGERS = ("pre-convert", "pre-reconcile", "pre-doubles", "pre-import", "pre-restore-tx", "update")
BACKUP_EVERY = ("none", "daily", "weekly")
BACKUP_DEFAULTS = {"on_start": True, "every": "none", "keep": KEEP_BACKUPS, "dir": "",
                   "triggers": {t: True for t in BACKUP_TRIGGERS}}


def _settings_path():
    return DATA_DIR / "backup-settings.json"


def backup_settings():
    """The user's backup settings, completed with the defaults (a damaged file = the defaults)."""
    import json
    s = {**BACKUP_DEFAULTS, "triggers": dict(BACKUP_DEFAULTS["triggers"])}
    try:
        saved = json.loads(_settings_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return s
    if isinstance(saved, dict):
        if isinstance(saved.get("on_start"), bool):
            s["on_start"] = saved["on_start"]
        if saved.get("every") in BACKUP_EVERY:
            s["every"] = saved["every"]
        if isinstance(saved.get("keep"), int) and 3 <= saved["keep"] <= 200:
            s["keep"] = saved["keep"]
        if isinstance(saved.get("dir"), str):
            s["dir"] = saved["dir"]
        if isinstance(saved.get("triggers"), dict):
            s["triggers"].update({k: v for k, v in saved["triggers"].items() if k in BACKUP_TRIGGERS and isinstance(v, bool)})
    return s


def save_backup_settings(s):
    import json
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _settings_path().with_suffix(".tmp")
    tmp.write_bytes(json.dumps(s, indent=1).encode("utf-8"))
    tmp.replace(_settings_path())


def backup_dir():
    """(folder in use, the chosen folder is unreachable): a chosen folder that cannot be used (a USB drive removed)
    falls back to the default one, next to the data, so a backup is never lost."""
    chosen = backup_settings()["dir"]
    if chosen:
        p = Path(chosen)
        try:
            p.mkdir(parents=True, exist_ok=True)
            probe = p / ".hc-write-test"
            probe.write_bytes(b"")
            probe.unlink()
            return p, False
        except OSError:
            return BACKUP_DIR, True
    return BACKUP_DIR, False


def list_backups():
    """Automatic backups in the folder in use and in the default one (newest first): name, folder, time, reason, size."""
    out, seen = [], set()
    for folder in dict.fromkeys([backup_dir()[0], BACKUP_DIR]):
        if not folder.exists():
            continue
        for f in folder.glob("homecoin-*.db"):
            parts = f.stem.split("-", 3)  # homecoin-YYYYMMDD-HHMMSS-reason
            try:
                when = dt.datetime.strptime(parts[1] + parts[2], "%Y%m%d%H%M%S")
            except (IndexError, ValueError):
                continue
            if f.name in seen:
                continue
            seen.add(f.name)
            out.append({"name": f.name, "path": f, "at": when, "reason": parts[3] if len(parts) > 3 else "",
                        "size": f.stat().st_size, "default_folder": folder == BACKUP_DIR})
    return sorted(out, key=lambda x: x["at"], reverse=True)


def find_backup(name):
    """The file of a listed backup (only names from the list: never a path given by the caller)."""
    if not isinstance(name, str) or not name:
        return None
    return next((b["path"] for b in list_backups() if b["name"] == name), None)


def backup_now(reason="auto", force=False):
    """Consistent encrypted copy of the database into the backup folder; keeps the latest `keep` there. Skipped when
    the user switched off this kind of backup (start, or the action in `reason`), unless `force`."""
    if not DB_PATH.exists():
        return None
    s = backup_settings()
    if not force and ((reason == "startup" and not s["on_start"]) or (reason in BACKUP_TRIGGERS and not s["triggers"][reason])):
        return None
    folder, _ = backup_dir()
    folder.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = folder / f"homecoin-{stamp}-{reason}.db"
    src = connect()
    try:
        _export(src, target, _key)  # the copies are encrypted with the same key too
    finally:
        src.close()
    old = sorted(folder.glob("homecoin-*.db"))[:-s["keep"]]
    for f in old:
        f.unlink(missing_ok=True)
    return target


def scheduled_backup_due(now=None):
    """A periodic backup is due: daily or weekly, counted from the newest backup of any kind."""
    s = backup_settings()
    if s["every"] == "none":
        return False
    newest = list_backups()[:1]
    if not newest:
        return True
    gap = dt.timedelta(days=1 if s["every"] == "daily" else 7)
    return (now or dt.datetime.now()) - newest[0]["at"] >= gap


class MigrationError(Exception):
    """The data folder could not be moved: the old one is untouched."""


def _has_data(d):
    return (d / "keystore.json").exists() or (d / "homecoin.db").exists()


def _digest(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _tree(d):
    return {p.relative_to(d).as_posix(): p for p in d.rglob("*") if p.is_file()}


def migrate_data_folder(src=None, dst=None, now=None):
    """Moves the data of an older version (program folder\\data) to the per-user data folder, once.

    Copy into a sibling folder, check every file byte by byte (size + SHA-256), then rename the copy into place and the old
    folder to data.migrated-<date> (kept, never deleted: the user removes it after checking). Any problem: the copy is
    removed, the old folder stays as it was and MigrationError says why (HomeCoin then does not start, so it never opens
    an empty new installation next to the real data). Returns None (nothing to do), or a dict with what happened.
    Must run while HomeCoin is closed (run.py calls it after checking that the port is free)."""
    import shutil
    src, dst = Path(src or LEGACY_DATA_DIR), Path(dst or DATA_DIR)
    if os.environ.get("HOMECOIN_DATA_DIR") and src == LEGACY_DATA_DIR and dst == DATA_DIR:
        return None  # a folder chosen by hand (demo, tests, a custom path): never moved automatically
    if src.resolve() == dst.resolve() or not src.is_dir() or not _has_data(src):
        return None
    if _has_data(dst):  # already moved earlier (or two installations): use the new one, say the old one is still there
        return {"moved": False, "old": str(src), "new": str(dst)}
    if any((src / f"homecoin.db{x}").exists() and (src / f"homecoin.db{x}").stat().st_size for x in ("-wal", "-journal")):
        raise MigrationError("the database seems to be in use or was not closed cleanly: close every HomeCoin window "
                             "and start again")
    tmp = dst.with_name(dst.name + ".migrating")
    try:
        if tmp.exists():
            shutil.rmtree(tmp)  # leftover of an interrupted attempt (the old folder is still the original)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, tmp)
        before, after = _tree(src), _tree(tmp)
        if before.keys() != after.keys():
            raise MigrationError(f"{len(before)} files in the old folder, {len(after)} in the copy")
        for rel, p in before.items():
            q = after[rel]
            if p.stat().st_size != q.stat().st_size or _digest(p) != _digest(q):
                raise MigrationError(f"the copy of {rel} is different from the original")
        if dst.exists():
            dst.rmdir()  # only if empty: _has_data(dst) is False, any other file stops here with an error
        os.replace(tmp, dst)
    except MigrationError:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(tmp, ignore_errors=True)
        raise MigrationError(str(exc)) from exc
    stamp = (now or dt.datetime.now()).strftime("%Y%m%d-%H%M%S")
    old = src.with_name(f"{src.name}.migrated-{stamp}")
    try:  # the data is already safe in the new folder: if the rename fails, the old folder simply stays as it is
        os.replace(src, old)
        (old / "MOVED.txt").write_text(f"HomeCoin data moved on {stamp} to:\n{dst}\n\nThis is the old copy, no longer used. "
                                       "Delete this folder once you have checked that HomeCoin opens your data.\n", "utf-8")
    except OSError:
        old = src
    return {"moved": True, "old": str(old), "new": str(dst), "files": len(before)}


def legacy_copies():
    """Old data folders left by the move (program folder\\data.migrated-*), shown in Settings so they can be deleted."""
    return sorted(str(p) for p in BASE_DIR.glob(f"{LEGACY_DATA_DIR.name}.migrated-*") if p.is_dir())


def migrate(conn):
    """Upgrade databases created with earlier schema versions."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(transactions)")}
    if "excluded" not in cols:  # v2: exclusion from reports and totals
        conn.execute("ALTER TABLE transactions ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(categories)")}
    if "split" not in cols:  # v3: split rule (prop = proportional to income, equal, none)
        conn.execute("ALTER TABLE categories ADD COLUMN split TEXT NOT NULL DEFAULT 'prop'")
    # v4: spaces. Categories must be rebuilt: the UNIQUE(name, kind) constraint becomes per space
    cat_sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'categories'").fetchone()[0]
    if "portfolio_id" not in cat_sql:
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript("""
            BEGIN;
            CREATE TABLE categories_v4 (
                id INTEGER PRIMARY KEY, portfolio_id INTEGER REFERENCES portfolios(id), name TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')), color TEXT NOT NULL DEFAULT '#94a3b8',
                icon TEXT NOT NULL DEFAULT '📦', budget INTEGER NOT NULL DEFAULT 0, split TEXT NOT NULL DEFAULT 'prop',
                UNIQUE (portfolio_id, name, kind));
            INSERT INTO categories_v4(id, name, kind, color, icon, budget, split)
                SELECT id, name, kind, color, icon, budget, split FROM categories;
            DROP TABLE categories;
            ALTER TABLE categories_v4 RENAME TO categories;
            COMMIT;""")
        conn.execute("PRAGMA foreign_keys = ON")
    for table in ("accounts", "people"):
        if "portfolio_id" not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN portfolio_id INTEGER REFERENCES portfolios(id)")
    orphans = sum(conn.execute(f"SELECT COUNT(*) FROM {t} WHERE portfolio_id IS NULL").fetchone()[0]
                  for t in ("accounts", "categories", "people"))
    if orphans:  # data from earlier versions: merged into the first space (created if missing)
        first = conn.execute("SELECT id FROM portfolios ORDER BY position, id LIMIT 1").fetchone()
        if first:
            pid = first[0]
        else:
            pid = conn.execute("INSERT INTO portfolios(name, type, color, icon) VALUES (?, 'family', '#ec4899', '🏠')",
                               (PORTFOLIO_TYPES["family"],)).lastrowid
        for t in ("accounts", "categories", "people"):
            conn.execute(f"UPDATE {t} SET portfolio_id = ? WHERE portfolio_id IS NULL", (pid,))
        # fair split settings: from global to per-space (key@id)
        for k, v in conn.execute("SELECT key, value FROM settings WHERE key LIKE 'split_%' AND key NOT LIKE '%@%'").fetchall():
            conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (f"{k}@{pid}", v))
            conn.execute("DELETE FROM settings WHERE key = ?", (k,))
    rec_cols = {r[1] for r in conn.execute("PRAGMA table_info(recurring)")}
    if "rate" not in rec_cols:  # v5: annual rate of loans (fixed part)
        conn.execute("ALTER TABLE recurring ADD COLUMN rate REAL")
    # v6: mortgage rate type: fixed | variable (index + spread) | mixed (fixed for N years, then variable)
    for col, ddl in (("rate_type", "TEXT"), ("fixed_years", "INTEGER"), ("rate_index", "TEXT"),
                     ("spread", "REAL"), ("index_value", "REAL")):
        if col not in rec_cols:
            conn.execute(f"ALTER TABLE recurring ADD COLUMN {col} {ddl}")
    rec_cols = {r[1] for r in conn.execute("PRAGMA table_info(recurring)")}
    if "holding_id" not in rec_cols:  # v10: investment plan (the recurring transfer buys units of a security)
        conn.execute("ALTER TABLE recurring ADD COLUMN holding_id INTEGER REFERENCES holdings(id) ON DELETE SET NULL")
        conn.execute("ALTER TABLE recurring ADD COLUMN pac_since TEXT")
    if "flow" not in {r[1] for r in conn.execute("PRAGMA table_info(categories)")}:  # v9: contributions to other spaces
        conn.execute("ALTER TABLE categories ADD COLUMN flow TEXT NOT NULL DEFAULT ''")
        # legacy migration of old Italian databases: keep the Italian name
        conn.execute("UPDATE categories SET flow = 'other' WHERE kind = 'expense' AND name = 'Versamenti conto casa'")
    if "amortization" not in {r[1] for r in conn.execute("PRAGMA table_info(recurring)")}:  # v15: loan method
        conn.execute("ALTER TABLE recurring ADD COLUMN amortization TEXT")  # NULL = French (constant installment), 'constant' = constant principal
    if "amount_fixed" not in {r[1] for r in conn.execute("PRAGMA table_info(recurring)")}:  # v14
        conn.execute("ALTER TABLE recurring ADD COLUMN amount_fixed INTEGER NOT NULL DEFAULT 0")  # expected items: chosen amount, not the median
    if "expected" not in {r[1] for r in conn.execute("PRAGMA table_info(recurring)")}:  # v13: expected recurring items
        conn.execute("ALTER TABLE recurring ADD COLUMN expected INTEGER NOT NULL DEFAULT 0")  # variable amount/date
        conn.execute("ALTER TABLE recurring ADD COLUMN match_text TEXT NOT NULL DEFAULT ''")  # keyword
    if "features" not in {r[1] for r in conn.execute("PRAGMA table_info(portfolios)")}:  # v12: tabs chosen per space
        conn.execute("ALTER TABLE portfolios ADD COLUMN features TEXT")  # JSON; NULL = the type's defaults
    if "isin" not in {r[1] for r in conn.execute("PRAGMA table_info(holdings)")}:  # v7: trades on securities
        conn.execute("ALTER TABLE holdings ADD COLUMN isin TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_acc_portfolio ON accounts(portfolio_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_cat_portfolio ON categories(portfolio_id)")
    if "code" not in {r[1] for r in conn.execute("PRAGMA table_info(categories)")}:  # v16: fixed codes (languages)
        conn.execute("ALTER TABLE categories ADD COLUMN code TEXT")
        assign_category_codes(conn)
    # v17: fair split aligned with the spaces: each person's own space, and the attribution chosen by hand
    if "space_id" not in {r[1] for r in conn.execute("PRAGMA table_info(people)")}:
        conn.execute("ALTER TABLE people ADD COLUMN space_id INTEGER REFERENCES portfolios(id) ON DELETE SET NULL")
    tx_cols = {r[1] for r in conn.execute("PRAGMA table_info(transactions)")}
    if "person_id" not in tx_cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE SET NULL")
    if "split_off" not in tx_cols:
        conn.execute("ALTER TABLE transactions ADD COLUMN split_off INTEGER NOT NULL DEFAULT 0")


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    existed = DB_PATH.exists()
    if existed:
        backup_now("startup")
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        migrate(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        if conn.execute("SELECT COUNT(*) FROM portfolios").fetchone()[0] == 0:  # new database
            from . import i18n
            pid = create_portfolio(conn, i18n.space_name("family"), "family")
            conn.execute("INSERT INTO accounts(portfolio_id, name, type, color, icon) VALUES (?,?,?,?,?)",
                         (pid, i18n.main_account_name(), "corrente", "#6366f1", "🏦"))
        conn.commit()
    finally:
        conn.close()
