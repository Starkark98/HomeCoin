"""HomeCoin - Flask application (JSON API + static web interface). Listens on 127.0.0.1 only."""
import csv
import datetime as dt
import io
import json
import os
import secrets
import threading
import time
from collections import Counter
from pathlib import Path

from flask import Flask, Response, abort, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from . import audit
from . import db as dbm
from . import forecast
from . import i18n
from . import importer
from . import security
from .db import get_db
from .services import (Categorizer, account_balances, count_past_occurrences, process_recurring,
                       recurring_view, upcoming)
from . import split as splitm
from . import tools
from . import updater
from . import util
from .util import FREQUENCIES, add_months, months_between, parse_date, parse_number, rule_matches

VERSION = "2.3.0"
STATIC_DIR = dbm.BASE_DIR / "static"
KINDS = ("expense", "income", "transfer")
ACCOUNT_TYPES = ("corrente", "risparmio", "credito", "prepagata", "contanti", "investimenti", "altro")
# English labels of the account type codes above (the codes are stored in the database and never change)
ACCOUNT_TYPE_LABELS = {"corrente": "current account", "risparmio": "savings account", "credito": "credit card",
                       "prepagata": "prepaid card", "contanti": "cash", "investimenti": "investment account", "altro": "other"}
TABLES = ("portfolios", "accounts", "categories", "recurring", "transactions", "rules", "people", "settings",
          "goals", "valuations", "holdings", "trades", "price_history")
CORE_TABLES = TABLES[1:6]  # required in a backup; the others may be missing from backups of older versions
PORTFOLIO_TYPES = ("family", "personal")
DUP_DAYS = 3  # tolerance in days for recognizing a transaction that already exists during import
MAX_INT = 10 ** 13  # limit for amounts (in cents: 100 billion euros) and other integers
# transaction NOT in a "contribution to other spaces" category (those expenses are not spending but contributions to another space)
NOT_OTHER = "COALESCE((SELECT flow FROM categories WHERE id = t.category_id), '') != 'other'"
# expense categories that are normally contributions to other spaces (English name + Italian legacy name)
OTHER_FLOW_NAMES = {"Contributions to household", "Versamenti conto casa"}

_imports = {}  # token -> data of the uploaded file (in memory, expire after 1 hour)
DEMO = os.environ.get("HOMECOIN_DEMO") == "1"  # demo version (demo.py): sample data, no internet


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


# ------------------------------------------------------------- validation

def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(i18n.t("Invalid request"))
    return data


def as_int(value, name, required=True, minimum=None):
    if value in (None, ""):
        if required:
            raise ApiError(i18n.t("Required field: {name}", name=i18n.t(name)))
        return None
    if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
        raise ApiError(i18n.t("Invalid value: {name}", name=i18n.t(name)))  # true/false or decimals must not be silently truncated
    try:
        v = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ApiError(i18n.t("Invalid value: {name}", name=i18n.t(name)))
    if minimum is not None and v < minimum:
        raise ApiError(i18n.t("Invalid value: {name}", name=i18n.t(name)))
    if abs(v) > MAX_INT:  # huge figures would overflow the totals (and every page with them)
        raise ApiError(i18n.t("Value too large: {name}", name=i18n.t(name)))
    return v


def as_key(value):
    """A code chosen from a list (type, action, token…): only a text; lists or objects become None (not hashable)."""
    return value if isinstance(value, str) else None


def as_dict(value, name):
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ApiError(i18n.t("Invalid data: {name}", name=i18n.t(name)))
    return value


def as_list(value, name):
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ApiError(i18n.t("Invalid list: {name}", name=i18n.t(name)))
    return value


def as_date(value, name="date", required=True):
    if value in (None, ""):
        if required:
            raise ApiError(i18n.t("Required field: {name}", name=i18n.t(name)))
        return None
    d = parse_date(value)
    if not d:
        raise ApiError(i18n.t("Invalid date: {name}", name=i18n.t(name)))
    return d.isoformat()


def as_text(value, maxlen=200):
    """Entered text: trimmed; short fields (names, descriptions) also without double spaces or line breaks,
    long notes keep their line breaks."""
    s = str(value or "").strip()
    if maxlen <= 200:
        s = " ".join(s.split())
    return s[:maxlen]


def tx_date(value):
    """Date of a transaction or a trade: no typos like 2062 or 1926."""
    d = as_date(value)
    if not ("1990-01-01" <= d <= (dt.date.today() + dt.timedelta(days=366)).isoformat()):
        raise ApiError(i18n.t("Date out of range ({d}): check the year", d=d))
    return d


def as_rate(value):
    """Annual rate in % (e.g. 3 or '2,95'); None if empty."""
    if value in (None, ""):
        return None
    try:
        v = float(str(value).replace(",", "."))
    except ValueError:
        raise ApiError(i18n.t("Invalid rate"))
    if not 0 <= v <= 50:
        raise ApiError(i18n.t("Invalid rate"))
    return v


def rate_from_body(b):
    """Rate of a loan: fixed, variable (index + spread) or mixed (fixed for N years, then variable)."""
    kind = b.get("rate_type") or None
    if kind is None and b.get("rate") in (None, ""):
        return {"rate_type": None, "rate": None, "fixed_years": None, "rate_index": None, "spread": None, "index_value": None}
    kind = kind or "fixed"
    if kind not in ("fixed", "variable", "mixed"):
        raise ApiError(i18n.t("Invalid rate type"))
    out = {"rate_type": kind, "rate": None, "fixed_years": None, "rate_index": None, "spread": None, "index_value": None}
    if kind in ("fixed", "mixed"):
        out["rate"] = as_rate(b.get("rate"))
        if out["rate"] is None:
            raise ApiError(i18n.t("Enter the fixed rate"))
    if kind == "mixed":
        out["fixed_years"] = as_int(b.get("fixed_years"), "years at fixed rate", minimum=1)
    if kind in ("variable", "mixed"):
        idx = b.get("rate_index") or tools.DEFAULT_RATE_INDEX[util.currency_of(get_db())]
        if as_key(idx) not in tools.RATE_INDEXES:
            raise ApiError(i18n.t("Invalid index"))
        out["rate_index"], out["spread"] = idx, as_rate(b.get("spread"))
        if out["spread"] is None:
            raise ApiError(i18n.t("Enter the spread"))
        iv = b.get("index_value")  # current value of the index, optional (may be negative)
        if iv not in (None, ""):
            try:
                out["index_value"] = float(str(iv).replace(",", "."))
            except ValueError:
                raise ApiError(i18n.t("Invalid index value"))
            if not -5 <= out["index_value"] <= 20:
                raise ApiError(i18n.t("Invalid index value"))
    return out


def as_color(value, default="#6366f1"):
    v = str(value or "").strip()
    if len(v) == 7 and v.startswith("#") and all(c in "0123456789abcdefABCDEF" for c in v[1:]):
        return v
    return default


def row_exists(table, id_):
    return get_db().execute(f"SELECT 1 FROM {table} WHERE id = ?", (id_,)).fetchone() is not None


# ------------------------------------------------------------- spaces

PF_ACCOUNTS = "(SELECT id FROM accounts WHERE portfolio_id = ?)"  # accounts of the space (subquery)


def pf():
    """Id of the active space: X-Portfolio header (or ?pf=), otherwise the first non-archived space."""
    if "pf" not in g:
        db = get_db()
        raw = request.headers.get("X-Portfolio") or request.args.get("pf") or ""
        ok = raw.isascii() and raw.isdigit() and len(raw) <= 12  # not "²" or a number beyond the database integers
        row = db.execute("SELECT * FROM portfolios WHERE id = ?", (int(raw),)).fetchone() if ok else None
        row = row or db.execute("SELECT * FROM portfolios ORDER BY archived, position, id LIMIT 1").fetchone()
        g.pf, g.portfolio = row["id"], dict(row)
    return g.pf


def portfolio_of(table, id_):
    r = get_db().execute(f"SELECT portfolio_id FROM {table} WHERE id = ?", (id_,)).fetchone()
    return r[0] if r else None


def own_account(account_id):
    """The account must exist and belong to the active space."""
    if portfolio_of("accounts", account_id) != pf():
        raise ApiError(i18n.t("Account not found in this space"))


def id_list(value, name, limit=5000):
    """List of ids from a request: it must really be a list (not true/false, a number or a text)."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ApiError(i18n.t("Invalid list: {name}", name=i18n.t(name)))
    return [as_int(i, name) for i in value[:limit]]


def not_archived(*account_ids):
    """New transactions and recurring items don't go on archived (closed) accounts: reactivate the account if needed."""
    for aid in account_ids:
        if aid is None:
            continue
        r = get_db().execute("SELECT name, archived FROM accounts WHERE id = ?", (aid,)).fetchone()
        if r and r["archived"]:
            raise ApiError(i18n.t("The account \"{name}\" is archived: reactivate it in Accounts to use it", name=r['name']), 409)


def check_refs(kind, account_id, to_account_id, category_id):
    acc_pf = portfolio_of("accounts", account_id)
    if acc_pf is None:
        raise ApiError(i18n.t("Account not found"))
    if kind == "transfer":  # the destination may also be in another space
        if to_account_id is None or not row_exists("accounts", to_account_id):
            raise ApiError(i18n.t("Select the destination account"))
        if to_account_id == account_id:
            raise ApiError(i18n.t("The source and destination accounts must be different"))
        return None, to_account_id
    if category_id is not None:
        c = get_db().execute("SELECT kind, portfolio_id FROM categories WHERE id = ?", (category_id,)).fetchone()
        if not c or c["portfolio_id"] != acc_pf:
            raise ApiError(i18n.t("Category not found in this space"))
        if c["kind"] != kind:
            raise ApiError(i18n.t("The category does not match the transaction type"))
    return category_id, None


def tx_from_body(b):
    kind = b.get("kind")
    if kind not in KINDS:
        raise ApiError(i18n.t("Invalid transaction type"))
    amount = as_int(b.get("amount"), "amount", minimum=1)
    account_id = as_int(b.get("account_id"), "account")
    to_account_id = as_int(b.get("to_account_id"), "destination account", required=False)
    category_id = as_int(b.get("category_id"), "category", required=False)
    category_id, to_account_id = check_refs(kind, account_id, to_account_id, category_id)
    return {
        "date": tx_date(b.get("date")), "amount": amount, "kind": kind, "account_id": account_id,
        "to_account_id": to_account_id, "category_id": category_id,
        "description": as_text(b.get("description")), "notes": as_text(b.get("notes"), 1000),
        "excluded": 1 if b.get("excluded") else 0,
    }


TX_SELECT = """
SELECT t.*, a.name AS account_name, a.color AS account_color, a.icon AS account_icon,
       a.portfolio_id AS portfolio_id, pa.name AS portfolio_name,
       ta.name AS to_account_name, ta.portfolio_id AS to_portfolio_id, tp.name AS to_portfolio_name,
       c.name AS category_name, c.color AS category_color, c.icon AS category_icon
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN portfolios pa ON pa.id = a.portfolio_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN portfolios tp ON tp.id = ta.portfolio_id
LEFT JOIN categories c ON c.id = t.category_id
"""


def tx_filters(args):
    # always limited to the active space: transactions of its accounts + transfers coming in from other spaces
    p = pf()
    where = [f"(t.account_id IN {PF_ACCOUNTS} OR t.to_account_id IN {PF_ACCOUNTS})"]
    params = [p, p]
    if args.get("from"):
        where.append("t.date >= ?"); params.append(as_date(args["from"], "from"))
    if args.get("to"):
        where.append("t.date <= ?"); params.append(as_date(args["to"], "to"))
    # account, category and type take one value or several, comma-separated (any of them: OR within a filter, AND
    # between filters)
    def many(name):
        return [v.strip() for v in str(args.get(name) or "").split(",") if v.strip()]
    accs = [as_int(v, "account") for v in many("account_id")]
    if accs:
        marks = ",".join("?" * len(accs))
        where.append(f"(t.account_id IN ({marks}) OR t.to_account_id IN ({marks}))"); params += accs + accs
    cats = many("category_id")
    if cats:
        ids = [as_int(v, "category") for v in cats if v != "none"]
        parts = [f"t.category_id IN ({','.join('?' * len(ids))})"] if ids else []
        if "none" in cats:
            parts.append("(t.category_id IS NULL AND t.kind != 'transfer')")
        where.append("(" + " OR ".join(parts) + ")"); params += ids
    kinds = [k for k in many("kind") if k in KINDS]
    if kinds:
        where.append(f"t.kind IN ({','.join('?' * len(kinds))})"); params += kinds
    if args.get("excluded") in ("0", "1"):
        where.append("t.excluded = ?"); params.append(int(args["excluded"]))
    if args.get("recurring_id"):
        where.append("t.recurring_id = ?"); params.append(as_int(args["recurring_id"], "recurring item"))
    if args.get("q"):
        q = f"%{args['q'].strip()}%"
        where.append("(t.description LIKE ? OR t.notes LIKE ?)"); params += [q, q]
    return " WHERE " + " AND ".join(where), params


# ------------------------------------------------------------------- app

def create_app(port):
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    # cookies don't distinguish the port: one name per instance, so HomeCoin and the demo (or two ports) don't
    # overwrite each other's session when they are open together in the same browser
    COOKIE = f"{security.COOKIE}_{'demo_' if DEMO else ''}{port}"
    app.teardown_appcontext(dbm.close_db)
    vault = security.Vault()
    vault.on_lock.append(_imports.clear)  # files uploaded for import are kept only while unlocked
    public_api = {"/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/recover"}

    @app.before_request
    def guard():
        # DNS rebinding protection: accept only requests addressed to localhost
        if request.host not in allowed_hosts:
            abort(403)
        # CSRF protection: writes require a custom header and a local origin
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if request.headers.get("X-HomeCoin") != "1":
                abort(403)
            origin = request.headers.get("Origin")
            if origin and origin.split("://", 1)[-1] not in allowed_hosts:
                abort(403)
        # Fetch Metadata: the browser declares where the request comes from; no API calls from other sites,
        # not even reads (on top of SameSite=Strict, Host and Origin)
        if request.path.startswith("/api/") and request.headers.get("Sec-Fetch-Site") == "cross-site":
            abort(403)
        # access: no data without a valid session (the database stays encrypted and the key is not in memory)
        if request.path.startswith("/api/") and request.path not in public_api:
            if vault.valid(request.cookies.get(COOKIE)):
                return None
            # local import script with a temporary code: never for the security functions and updates, nor for
            # taking the data out in bulk (backup, restore, unencrypted exports)
            if not request.path.startswith(("/api/auth/", "/api/update", "/api/backup", "/api/restore", "/api/export/")) and \
                    vault.valid_import_token(request.headers.get("X-HomeCoin-Token")):
                return None
            return jsonify(error=i18n.t("HomeCoin is locked: enter the password"), locked=True), 401

    @app.after_request
    def audit_event(resp):
        """Activity log: one line for each important operation that succeeded (see audit.EVENTS)."""
        ev = audit.EVENTS.get(request.endpoint)
        if ev and resp.status_code < 400 and vault.dek is not None and not g.get("audit_skip"):
            if request.endpoint.startswith("export_"):  # which period left unencrypted
                a = request.args
                note(f"{a.get('from') or i18n.t('start')} → {a.get('to') or i18n.t('today')}" if a.get("from") or a.get("to")
                     else i18n.t("whole period"))
            kind, action = ev
            kind, action, detail = g.get("audit_kind") or kind, g.get("audit_action") or action, g.get("audit_detail") or ""
            if not detail and request.is_json:  # creations and edits: the name of what was touched is enough
                b = request.get_json(silent=True) or {}
                detail = str(b.get("name") or b.get("ticker") or "") if isinstance(b, dict) else ""
            if request.endpoint in ("auth_login", "auth_recover", "auth_setup"):
                if vault.failed_before:
                    detail = i18n.tn("after {n} failed attempt", "after {n} failed attempts", vault.failed_before)
                    kind = "security"
            elif not request.cookies.get(COOKIE) or not vault.valid(request.cookies.get(COOKIE), touch=False):
                detail = (detail + " · " if detail else "") + "from script with temporary code"
            p = g.get("portfolio")
            try:
                conn = dbm.connect()
                try:
                    if request.endpoint == "auth_login":
                        audit.purge(conn)  # cleanup: lines older than 12 months
                    audit.write(kind, action, detail, p["name"] if p else "", conn)
                finally:
                    conn.close()
            except Exception:  # the activity log must never make the operation fail
                pass
        return resp

    def note(detail, action=None):
        """Short detail (and, if needed, a different description) of this request's activity log line."""
        g.audit_detail = detail
        if action:
            g.audit_action = action

    @app.after_request
    def security_headers(resp):
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        # no access to sensors and peripherals, no embedding in documents of other types
        resp.headers["Permissions-Policy"] = ("camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), "
                                              "bluetooth=(), hid=(), clipboard-read=(), display-capture=(), interest-cohort=()")
        resp.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        resp.headers["Server"] = "HomeCoin"  # instead of "waitress": no web server name or version
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.errorhandler(ApiError)
    def api_error(e):
        return jsonify(error=e.message), e.status

    @app.errorhandler(security.AuthError)
    def auth_error(e):
        return jsonify(error=e.message, **e.extra), e.status

    @app.errorhandler(dbm.Locked)
    def locked_error(_e):
        return jsonify(error=i18n.t("HomeCoin is locked: enter the password"), locked=True), 401

    # --------------------------------------------------------- access

    def load_currency():
        """Reference currency of the installation (setting), kept in util.CURRENCY for the texts written by the server."""
        util.CURRENCY["code"] = util.currency_of(get_db())
        return util.CURRENCY["code"]

    def with_session(token, **data):
        load_currency()
        resp = jsonify(ok=True, **data)
        resp.set_cookie(COOKIE, token, httponly=True, samesite="Strict", path="/")
        return resp

    def field(name):
        v = body().get(name)
        return v if isinstance(v, str) else ""

    @app.get("/api/auth/status")
    def auth_status():
        demo = {"demo": True, "demo_password": __import__("homecoin.demo", fromlist=["PASSWORD"]).PASSWORD} if DEMO else {}
        return jsonify(version=VERSION, **vault.status(request.cookies.get(COOKIE)), **demo,
                       languages=i18n.LANGUAGES)

    @app.post("/api/auth/setup")
    def auth_setup():
        token, recovery = vault.setup(field("password"), field("language") or None)
        return with_session(token, recovery_key=recovery)

    @app.post("/api/auth/login")
    def auth_login():
        return with_session(vault.login(field("password")))

    @app.post("/api/auth/recover")
    def auth_recover():
        token, recovery = vault.recover(field("recovery_key"), field("password"))
        return with_session(token, recovery_key=recovery)

    @app.post("/api/auth/logout")
    def auth_logout():
        vault.lock_now()
        resp = jsonify(ok=True)
        resp.delete_cookie(COOKIE, path="/")
        return resp

    @app.post("/api/auth/password")
    def auth_password():
        vault.change_password(field("current"), field("password"))
        return jsonify(ok=True)

    @app.post("/api/auth/recovery-key")
    def auth_recovery_key():
        return jsonify(recovery_key=vault.new_recovery(field("current")))

    @app.post("/api/auth/import-token")
    def auth_import_token():
        b = request.get_json(silent=True)
        b = b if isinstance(b, dict) else {}
        token, minutes = vault.new_import_token(as_int(b.get("minutes") or security.IMPORT_TOKEN_MINUTES, "duration"))
        return jsonify(token=token, minutes=minutes)

    @app.delete("/api/auth/import-token")
    def auth_import_token_revoke():
        vault.revoke_import_token()
        return jsonify(ok=True)

    @app.get("/api/audit")
    def audit_list():
        """Activity log (all spaces), newest first; optional filter by type."""
        kind = request.args.get("kind") or ""
        if kind and kind not in audit.KINDS:
            raise ApiError(i18n.t("Invalid type"))
        limit = min(as_int(request.args.get("limit") or 200, "limit", minimum=1), 1000)
        offset = as_int(request.args.get("offset") or 0, "offset", minimum=0)
        db = get_db()
        where, params = ("WHERE kind = ?", [kind]) if kind else ("", [])
        rows = [dict(r) for r in db.execute(f"SELECT * FROM audit_log {where} ORDER BY id DESC LIMIT ? OFFSET ?",
                                            (*params, limit, offset))]
        total = db.execute(f"SELECT COUNT(*) FROM audit_log {where}", params).fetchone()[0]
        counts = dict(db.execute("SELECT kind, COUNT(*) FROM audit_log GROUP BY kind").fetchall())
        return jsonify(items=rows, total=total, counts=counts, keep_months=audit.KEEP_MONTHS)

    @app.get("/api/auth/integrity")
    def auth_integrity():
        """Checks database integrity and encryption (requires HomeCoin unlocked) and data folder protection."""
        dbm.close_db()
        rep = dbm.integrity_report(vault.dek)
        ks = security.read_keystore() or {}
        rep["kdf"] = {"password_n": ks.get("password", {}).get("n"), "recovery_n": ks.get("recovery", {}).get("n"),
                      "target_n": security.SCRYPT["n"]}
        rep["folder_others"] = security.data_dir_access()
        if rep["folder_others"]:
            rep["ok"] = False
        return jsonify(rep)

    @app.get("/api/auth/folder")
    def auth_folder():
        """Only the data folder permissions (light check offered after sign-in)."""
        return jsonify(folder_others=None if DEMO else security.data_dir_access())

    @app.post("/api/auth/protect-folder")
    def auth_protect_folder():
        """At the user's request: data folder accessible only to their Windows user (plus SYSTEM and administrators)."""
        if DEMO:
            raise ApiError(i18n.t("Not needed in the demo version"))
        try:
            others = security.restrict_data_dir()
        except Exception as exc:  # also timeout or missing PowerShell: a clear message, never a 500 error
            raise ApiError(i18n.t("Permissions not changed: {exc}", exc=exc))
        return jsonify(ok=True, folder_others=others)

    @app.post("/api/auth/quit")
    def auth_quit():
        """Close HomeCoin (the server has no window when started from the installer's shortcut): lock, answer, then exit.
        Under /api/auth/: never allowed with the temporary import code."""
        try:  # logged now: after locking, the database is closed
            audit.write("access", "HomeCoin closed")
        except Exception:
            pass
        vault.lock_now()
        threading.Timer(0.4, app.config.get("HC_EXIT") or (lambda: os._exit(0))).start()
        resp = jsonify(ok=True)
        resp.delete_cookie(COOKIE, path="/")
        return resp

    @app.post("/api/auth/ping")
    def auth_ping():  # the user is using the page: postpone auto-lock (the guard already does it)
        return jsonify(ok=True)

    @app.put("/api/auth/language")
    def auth_language():
        """Interface language (kept in the keystore, so the sign-in screen uses it too)."""
        code = vault.set_language(field("language"))
        note(i18n.LANGUAGES[code])
        return jsonify(ok=True, language=code)

    @app.put("/api/auth/settings")
    def auth_settings():
        vault.set_auto_lock(as_int(body().get("auto_lock"), "auto-lock"))
        return jsonify(ok=True, auto_lock=vault.auto_lock_minutes())

    # --------------------------------------------------------- updates (signed GitHub releases, see updater.py)

    UPDATE_KEYS = ("update_auto", "update_checked", "update_info")
    update_busy = threading.Lock()

    def save_setting(db, key, value):
        db.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (key, value))

    def update_status(db, error=None):
        s = dict(db.execute("SELECT key, value FROM settings WHERE key IN (?, ?, ?)", UPDATE_KEYS).fetchall())
        try:
            info = json.loads(s.get("update_info") or "{}")
        except ValueError:
            info = {}
        latest = updater.parse_version(info.get("latest"))
        available = bool(latest) and latest > updater.parse_version(VERSION)
        kind = updater.install_kind()
        return {"current": VERSION, "auto": s.get("update_auto", "1") == "1", "checked": s.get("update_checked"),
                "latest": info.get("latest") if latest else None, "available": available,
                "notes": str(info.get("notes") or "") if available else "",
                "url": info.get("url") if available else updater.RELEASE_PAGE, "kind": kind, "demo": DEMO,
                "can_apply": available and kind in ("installer", "zip") and not DEMO, "error": error}

    @app.get("/api/update")
    def update_get():
        """Update status. ?check=1 asks GitHub now; ?auto=1 asks only if automatic checks are on and the last check
        was more than 20 hours ago (the client calls it after every sign-in). Never in the demo."""
        db = get_db()
        st = update_status(db)
        force, auto = request.args.get("check") == "1", request.args.get("auto") == "1"
        if DEMO or not (force or auto):
            return jsonify(st)
        if not force:
            try:
                last = dt.datetime.fromisoformat(st["checked"] or "")
            except ValueError:
                last = None
            if not st["auto"] or (last and dt.datetime.now() - last < dt.timedelta(hours=20)):
                return jsonify(st)
        error = None
        try:
            info = updater.check(VERSION)
            info.pop("manifest", None)
            save_setting(db, "update_info", json.dumps(info))
        except updater.UpdateError as e:
            error = str(e)
        save_setting(db, "update_checked", dt.datetime.now().isoformat(timespec="seconds"))
        db.commit()
        return jsonify(update_status(db, error))

    @app.put("/api/update/settings")
    def update_settings():
        auto = body().get("auto")
        if not isinstance(auto, bool):
            raise ApiError(i18n.t("Invalid value"))
        db = get_db()
        save_setting(db, "update_auto", "1" if auto else "0")
        db.commit()
        return jsonify(update_status(db))

    @app.post("/api/update/apply")
    def update_apply():
        """Download the latest signed release, verify it, back up the database, install it and restart HomeCoin."""
        if DEMO:
            raise ApiError(i18n.t("Updates are disabled in the demo version"))
        kind = updater.install_kind()
        if kind == "dev":
            raise ApiError(i18n.t("This is a development copy (git): update it with git, not from here"))
        if kind not in ("installer", "zip"):
            raise ApiError(i18n.t("Automatic updates are not available for this installation: download the new version from GitHub"))
        if not update_busy.acquire(blocking=False):
            raise ApiError(i18n.t("An update is already in progress"), 409)
        try:
            try:
                info = updater.check(VERSION)  # again, signed: never trust an earlier answer
                if not info["available"]:
                    raise ApiError(i18n.t("HomeCoin is already up to date"), 409)
                path = updater.download(info["manifest"], kind, info.get("assets"))
                dbm.backup_now("update")
                if kind == "installer":
                    updater.launch_installer(path)  # it closes this process and reopens HomeCoin
                else:
                    updater.apply_zip(path)
                    (app.config.get("HC_RESTART") or updater.restart)(port=port)
            except updater.UpdateError as e:
                raise ApiError(str(e), 502)
            try:  # logged now: the database is closed before exiting
                audit.write("security", "HomeCoin updated", f"{VERSION} → {info['latest']} ({'installer' if kind == 'installer' else 'ZIP'})")
            except Exception:
                pass
            vault.lock_now()
            threading.Timer(0.8, app.config.get("HC_EXIT") or (lambda: os._exit(0))).start()
        except Exception:
            update_busy.release()
            raise
        resp = jsonify(ok=True, version=info["latest"], kind=kind)
        resp.delete_cookie(COOKIE, path="/")
        return resp

    @app.get("/api/demo/statement.csv")
    def demo_statement():
        """Demo only: a made-up bank statement to try the Import page with."""
        if not DEMO:
            abort(404)
        from . import demo as demom
        return Response(demom.sample_statement(currency=util.currency_of(get_db())), mimetype="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="sample-bank-statement.csv"'})

    @app.errorhandler(HTTPException)
    def http_error(e):
        if request.path.startswith("/api/"):
            return jsonify(error=e.description or e.name), e.code
        return e

    # --------------------------------------------------------- static files

    @app.get("/")
    def index():
        resp = send_from_directory(STATIC_DIR, "index.html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/i18n.js")
    def i18n_script():
        """Interface language and its translations, loaded before app.js (the language is in the keystore, readable
        before sign-in; the translations are public texts of the program, no user data)."""
        if vault.configured():
            code = vault.language()
        else:  # first start: the language picked on the welcome screen (cookie), else the browser's
            code = request.cookies.get("hc_lang")
            code = i18n.set_language(code if code in i18n.LANGUAGES else i18n.best_match(request.headers.get("Accept-Language")))
        m = i18n.meta(code)
        data = {"lang": code, "languages": i18n.LANGUAGES, "t": i18n.table(code),
                "plural": m.get("plural", "one"), "months": m["months"], "currency": m.get("currency", "EUR"),
                "date_pattern": m.get("date_pattern", i18n.DATE_PATTERN), "month_pattern": m.get("month_pattern", i18n.MONTH_PATTERN),
                "currencies": {k: {"symbol": c.symbol, "locale": c.locale, "name": c.name, "short": c.short,
                                   "steps": c.steps, "regions": c.regions, "indexes": c.indexes}
                               for k, c in util.CURRENCIES.items()}}
        resp = Response("window.HC_I18N = " + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ";\n",
                        mimetype="text/javascript")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/static/<path:path>")
    def static_files(path):
        resp = send_from_directory(STATIC_DIR, path)
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    # ------------------------------------------------------------ meta

    def portfolios_list(db):
        out = [dict(r) for r in db.execute(
            """SELECT p.*, (SELECT COUNT(*) FROM accounts a WHERE a.portfolio_id = p.id) AS accounts
               FROM portfolios p ORDER BY p.archived, p.position, p.id""")]
        for p in out:  # active optional tabs (with no saved choice, the type's defaults apply)
            p["features"] = json.loads(p["features"]) if p.get("features") else list(dbm.DEFAULT_FEATURES[p["type"]])
        return out

    def accounts_with_value(db, p):
        """Account balances; for investment accounts also the market value (cash + securities or valuation)."""
        accs = account_balances(db, p)
        if any(a["type"] == tools.INVEST for a in accs):
            mv = tools.market_values(db, p)
            for a in accs:
                if a["id"] in mv:
                    a["market_value"] = mv[a["id"]]["value"]
        return accs

    @app.get("/api/meta")
    def meta():
        db = get_db()
        process_recurring(db)
        p = pf()
        all_accounts = [dict(r) for r in db.execute(
            """SELECT a.id, a.name, a.icon, a.color, a.archived, a.portfolio_id, p.name AS portfolio_name
               FROM accounts a JOIN portfolios p ON p.id = a.portfolio_id ORDER BY p.position, p.id, a.id""")]
        plist = portfolios_list(db)
        return jsonify(
            version=VERSION,
            currency=load_currency(),
            # a currency no longer offered (saved by an older version): HomeCoin uses the euro and Settings says so
            currency_unavailable=(lambda r: r[0] if r and r[0] not in util.CURRENCIES else None)(
                get_db().execute("SELECT value FROM settings WHERE key = 'currency'").fetchone()),
            data_dir=str(dbm.DATA_DIR),
            legacy_copies=[] if DEMO else dbm.legacy_copies(),  # old data folders left by the move, to delete
            last_backup=(db.execute("SELECT value FROM settings WHERE key = 'last_backup_download'").fetchone() or [None])[0],
            portfolio=next((x for x in plist if x["id"] == p), g.portfolio),
            portfolios=plist,
            accounts=accounts_with_value(db, p),
            all_accounts=all_accounts,  # for transfers to other spaces
            categories=[dict(r) for r in db.execute(
                "SELECT * FROM categories WHERE portfolio_id = ? ORDER BY kind, name", (p,))],
            rules=[dict(r) for r in db.execute(
                "SELECT r.*, c.name AS category_name FROM rules r JOIN categories c ON c.id = r.category_id "
                "WHERE c.portfolio_id = ? ORDER BY r.pattern", (p,))],
            tx_count=db.execute(f"SELECT COUNT(*) FROM transactions WHERE account_id IN {PF_ACCOUNTS}",
                                (p,)).fetchone()[0],
        )

    @app.put("/api/settings/currency")
    def currency_set():
        """Reference currency of the whole installation. Amounts are NOT converted (it is a label: everything is assumed to be
        in that currency); market prices converted into the old currency are cleared, to be downloaded again."""
        b, db = body(), get_db()
        code = as_key(b.get("currency"))
        if code not in util.CURRENCIES:
            raise ApiError(i18n.t("Invalid currency"))
        old = util.currency_of(db)
        if code == old:
            g.audit_skip = True
            return jsonify(ok=True, currency=code, prices_cleared=0)
        if b.get("confirm") is not True:  # the client shows the warning first: no change by mistake
            raise ApiError(i18n.t("Confirm the change: amounts are not converted"), 409)
        cleared = db.execute("UPDATE holdings SET price_eur = NULL WHERE price_eur IS NOT NULL").rowcount
        cleared += db.execute("DELETE FROM price_history").rowcount
        db.execute("INSERT INTO settings(key, value) VALUES ('currency', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (code,))
        db.commit()
        load_currency()
        note(i18n.t("{old} → {new}, amounts not converted", old=old, new=code)
             + (" · " + i18n.t("market prices to update") if cleared else ""))
        return jsonify(ok=True, currency=code, prices_cleared=cleared)

    # --------------------------------------------------------- spaces

    def portfolio_from_body(b):
        ptype = b.get("type")
        if ptype not in PORTFOLIO_TYPES:
            raise ApiError(i18n.t("Invalid space type"))
        name = as_text(b.get("name"), 40) or i18n.space_name(ptype)
        return name, ptype, as_color(b.get("color"), "#ec4899"), as_text(b.get("icon"), 8) or "🏠"

    @app.get("/api/portfolios")
    def portfolios_get():
        return jsonify(portfolios_list(get_db()))

    def features_from_body(b, ptype):
        """Optional tabs chosen for the space (if none: the type's defaults)."""
        f = b.get("features")
        if f is None:
            return list(dbm.DEFAULT_FEATURES[ptype])
        if not isinstance(f, list) or any(x not in dbm.OPTIONAL_FEATURES for x in f):
            raise ApiError(i18n.t("Invalid tabs"))
        return [x for x in dbm.OPTIONAL_FEATURES if x in f]  # stable order, no duplicates

    @app.post("/api/portfolios")
    def portfolio_create():
        db, b = get_db(), body()
        vals = portfolio_from_body(b)
        new_id = dbm.create_portfolio(db, *vals)
        db.execute("UPDATE portfolios SET features = ? WHERE id = ?", (json.dumps(features_from_body(b, vals[1])), new_id))
        db.commit()
        return jsonify(id=new_id), 201

    @app.put("/api/portfolios/<int:pid_>")
    def portfolio_update(pid_):
        db = get_db()
        if not row_exists("portfolios", pid_):
            raise ApiError(i18n.t("Space not found"), 404)
        b = body()
        name, ptype, color, icon = portfolio_from_body(b)
        old = db.execute("SELECT type, features FROM portfolios WHERE id = ?", (pid_,)).fetchone()
        old_type = old["type"]
        # hidden tabs don't lose data (they stay in the calculations): the type can be changed freely
        old_f = json.loads(old["features"]) if old["features"] else list(dbm.DEFAULT_FEATURES[old_type])
        feats = features_from_body(b, ptype) if "features" in b else old_f
        archived = 1 if b.get("archived") else 0
        if archived and db.execute("SELECT COUNT(*) FROM portfolios WHERE archived = 0 AND id != ?",
                                   (pid_,)).fetchone()[0] == 0:
            raise ApiError(i18n.t("At least one active space must remain"))
        changes = [i18n.t("type {old} → {new}", old=i18n.t(dbm.PORTFOLIO_TYPES[old_type]), new=i18n.t(dbm.PORTFOLIO_TYPES[ptype]))
                   if old_type != ptype else "",
                   i18n.t("tabs added: {tabs}", tabs=", ".join(sorted(set(feats) - set(old_f)))) if set(feats) - set(old_f) else "",
                   i18n.t("tabs hidden: {tabs}", tabs=", ".join(sorted(set(old_f) - set(feats)))) if set(old_f) - set(feats) else ""]
        if any(changes):
            note(" · ".join([name, *[c for c in changes if c]]))
        db.execute("UPDATE portfolios SET name=?, type=?, color=?, icon=?, archived=?, features=? WHERE id=?",
                   (name, ptype, color, icon, archived, json.dumps(feats), pid_))
        db.commit()
        return jsonify(ok=True)

    @app.delete("/api/portfolios/<int:pid_>")
    def portfolio_delete(pid_):
        db = get_db()
        if db.execute("SELECT COUNT(*) FROM accounts WHERE portfolio_id = ?", (pid_,)).fetchone()[0]:
            raise ApiError(i18n.t("The space contains accounts: move or delete them first, or archive the space"), 409)
        if db.execute("SELECT COUNT(*) FROM portfolios WHERE id != ?", (pid_,)).fetchone()[0] == 0:
            raise ApiError(i18n.t("You can't delete the only space"))
        note((db.execute("SELECT name FROM portfolios WHERE id = ?", (pid_,)).fetchone() or [""])[0])
        db.execute("DELETE FROM categories WHERE portfolio_id = ?", (pid_,))
        db.execute("DELETE FROM people WHERE portfolio_id = ?", (pid_,))
        db.execute("DELETE FROM settings WHERE key LIKE ?", (f"%@{pid_}",))
        db.execute("DELETE FROM portfolios WHERE id = ?", (pid_,))
        db.commit()
        return jsonify(ok=True)

    # ----------------------------------------------------------- accounts

    def account_from_body(b):
        name = as_text(b.get("name"), 60)
        if not name:
            raise ApiError(i18n.t("The account name is required"))
        t = b.get("type") if b.get("type") in ACCOUNT_TYPES else "altro"
        return (name, t, as_color(b.get("color")), as_text(b.get("icon"), 8) or "🏦",
                as_int(b.get("initial_balance") or 0, "opening balance"), 1 if b.get("archived") else 0)

    def same_name(table, name, exclude_id=None, extra=""):
        """Is there already an item with the same name (case-insensitive) in the active space?"""
        return get_db().execute(f"SELECT name FROM {table} WHERE portfolio_id = ? AND lower(name) = lower(?) AND id != ? {extra}",
                                (pf(), name, exclude_id or 0)).fetchone()

    @app.post("/api/accounts")
    def account_create():
        db = get_db()
        vals = account_from_body(body())
        if (dup := same_name("accounts", vals[0])):
            raise ApiError(i18n.t("The account \"{value}\" already exists", value=dup[0]), 409)
        cur = db.execute(
            "INSERT INTO accounts(portfolio_id, name, type, color, icon, initial_balance, archived) VALUES (?,?,?,?,?,?,?)",
            (pf(), *vals))
        db.commit()
        return jsonify(id=cur.lastrowid), 201

    @app.put("/api/accounts/<int:aid>")
    def account_update(aid):
        db = get_db()
        own_account(aid)
        vals = account_from_body(body())
        if (dup := same_name("accounts", vals[0], aid)):
            raise ApiError(i18n.t("The account \"{value}\" already exists", value=dup[0]), 409)
        old_type = db.execute("SELECT type FROM accounts WHERE id = ?", (aid,)).fetchone()[0]
        if old_type == tools.INVEST and vals[1] != tools.INVEST and db.execute(
                "SELECT 1 FROM trades WHERE account_id = ? UNION SELECT 1 FROM holdings WHERE account_id = ? LIMIT 1",
                (aid, aid)).fetchone():
            raise ApiError(i18n.t("The account has securities and trades: it stays an investment account (otherwise the securities would no longer be valued). To close it, sell or delete the securities, or archive it."), 409)
        if vals[5] and not db.execute("SELECT archived FROM accounts WHERE id = ?", (aid,)).fetchone()[0]:
            active = [r[0] for r in db.execute("SELECT name FROM recurring WHERE active = 1 AND (account_id = ? OR to_account_id = ?)",
                                               (aid, aid))]
            if active:  # they would keep recording transactions on a closed account
                raise ApiError(i18n.t("Before archiving the account, pause or move the active recurring items linked to it: {items}",
                                      items=", ".join(f'"{n}"' for n in active)), 409)
        old = db.execute("SELECT name, type, initial_balance, archived FROM accounts WHERE id = ?", (aid,)).fetchone()
        changes = [i18n.t("type {old} → {new}", old=i18n.t(ACCOUNT_TYPE_LABELS.get(old["type"], old["type"])),
                          new=i18n.t(ACCOUNT_TYPE_LABELS.get(vals[1], vals[1]))) if old["type"] != vals[1] else "",
                   i18n.t("opening balance {old} → {new}", old=audit.eur(old["initial_balance"]), new=audit.eur(vals[4]))
                   if old["initial_balance"] != vals[4] else "",
                   (i18n.t("archived") if vals[5] else i18n.t("reactivated")) if old["archived"] != vals[5] else ""]
        note(" · ".join([vals[0], *[c for c in changes if c]]))
        db.execute("UPDATE accounts SET name=?, type=?, color=?, icon=?, initial_balance=?, archived=? WHERE id=?", (*vals, aid))
        db.commit()
        return jsonify(ok=True)

    @app.delete("/api/accounts/<int:aid>")
    def account_delete(aid):
        db = get_db()
        own_account(aid)
        used = db.execute(
            "SELECT (SELECT COUNT(*) FROM transactions WHERE account_id=? OR to_account_id=?)"
            " + (SELECT COUNT(*) FROM recurring WHERE account_id=? OR to_account_id=?)"
            " + (SELECT COUNT(*) FROM trades WHERE account_id=?) + (SELECT COUNT(*) FROM holdings WHERE account_id=?)",
            (aid, aid, aid, aid, aid, aid)).fetchone()[0]
        if used:
            raise ApiError(i18n.t("The account has linked transactions, trades, securities or recurring items: you can archive it instead of deleting it"), 409)
        note(db.execute("SELECT name FROM accounts WHERE id = ?", (aid,)).fetchone()[0])
        db.execute("DELETE FROM accounts WHERE id = ?", (aid,))
        db.commit()
        return jsonify(ok=True)

    # ------------------------------------------------------- categories

    def category_from_body(b):
        name = as_text(b.get("name"), 60)
        if not name:
            raise ApiError(i18n.t("The category name is required"))
        kind = b.get("kind")
        if kind not in ("expense", "income"):
            raise ApiError(i18n.t("Invalid category type"))
        flow = b.get("flow") if "flow" in b else ("other" if name in OTHER_FLOW_NAMES else "")
        return (name, kind, as_color(b.get("color"), "#94a3b8"), as_text(b.get("icon"), 8) or "📦",
                as_int(b.get("budget") or 0, "budget", minimum=0),
                "other" if kind == "expense" and flow == "other" else "")

    def system_code(db, pid, name):
        """A new category named like a system one (any language) gets its code, if the space does not have it yet."""
        code = i18n.code_of_name(name)
        if code not in util.SYSTEM_CODES:
            return None
        taken = db.execute("SELECT 1 FROM categories WHERE portfolio_id = ? AND code = ?", (pid, code)).fetchone()
        return None if taken else code

    @app.post("/api/categories")
    def category_create():
        db = get_db()
        vals = category_from_body(body())
        if (dup := same_name("categories", vals[0], extra=f"AND kind = '{vals[1]}'")):
            raise ApiError(i18n.t("The category \"{value}\" already exists", value=dup[0]), 409)
        try:
            cur = db.execute("INSERT INTO categories(portfolio_id, name, kind, color, icon, budget, flow, code) "
                             "VALUES (?,?,?,?,?,?,?,?)", (pf(), *vals, system_code(db, pf(), vals[0])))
        except Exception:
            raise ApiError(i18n.t("A category with this name already exists"))
        db.commit()
        return jsonify(id=cur.lastrowid), 201

    @app.put("/api/categories/<int:cid>")
    def category_update(cid):
        db = get_db()
        b = body()
        name, kind, color, icon, budget, flow = category_from_body(b)
        if "flow" not in b:  # updates that don't know the field (e.g. color only): it stays as it was
            flow = db.execute("SELECT flow FROM categories WHERE id = ?", (cid,)).fetchone()
            flow = flow[0] if flow else ""
        old = db.execute("SELECT kind, name, code FROM categories WHERE id=? AND portfolio_id=?", (cid, pf())).fetchone()
        if not old:
            raise ApiError(i18n.t("Category not found"), 404)
        if old["kind"] != kind:
            raise ApiError(i18n.t("You can't change the type of an existing category"))
        if old["code"] in util.SYSTEM_CODES and name != old["name"]:
            raise ApiError(i18n.t("\"{name}\" is a system category used in the savings and invested calculations: you can change its color and icon, not its name", name=old['name']), 409)
        if (dup := same_name("categories", name, cid, extra=f"AND kind = '{kind}'")):
            raise ApiError(i18n.t("The category \"{value}\" already exists", value=dup[0]), 409)
        try:
            db.execute("UPDATE categories SET name=?, color=?, icon=?, budget=?, flow=? WHERE id=?",
                       (name, color, icon, budget, flow, cid))
        except Exception:
            raise ApiError(i18n.t("A category with this name already exists"))
        db.commit()
        return jsonify(ok=True)

    @app.delete("/api/categories/<int:cid>")
    def category_delete(cid):
        db = get_db()
        c = db.execute("SELECT name, code FROM categories WHERE id = ? AND portfolio_id = ?", (cid, pf())).fetchone()
        if not c:  # not found or in another space: nothing to delete, and we say so
            raise ApiError(i18n.t("Category not found in this space"), 404)
        if c["code"] in util.SYSTEM_CODES:
            raise ApiError(i18n.t("\"{name}\" is a system category used in the savings and invested calculations: it can't be deleted", name=c['name']), 409)
        tx, rec = db.execute("SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?), "
                             "(SELECT COUNT(*) FROM recurring WHERE category_id = ?)", (cid, cid)).fetchone()
        if (tx or rec) and request.args.get("force") != "1":  # the client asks for confirmation, showing what would be left uncategorized
            return jsonify(error=i18n.t("Category in use"), transactions=tx, recurring=rec), 409
        note(c["name"] + (f" · {tx} transactions left uncategorized" if tx else ""))
        db.execute("DELETE FROM categories WHERE id = ? AND portfolio_id = ?", (cid, pf()))
        db.commit()
        return jsonify(ok=True)

    # ------------------------------------------- the same money recorded twice (between spaces)

    REC_COLS = "id, name, amount, frequency, start_date, generated, active, account_id, to_account_id"

    def match_limits(b):
        """How close two records must be to be the same money: days (0-31, default 5), amount % (0-100, default 2;
        of the smaller amount, as people say it: 600 is 50% more than 400)."""
        days, tol = b.get("days", 5), b.get("tolerance", 2)
        if isinstance(days, bool) or not isinstance(days, int) or not 0 <= days <= 31:
            raise ApiError(i18n.t("The date difference must be between 0 and 31 days"))
        if isinstance(tol, bool) or not isinstance(tol, (int, float)) or not 0 <= tol <= 100:
            raise ApiError(i18n.t("The amount difference must be between 0 and 100%"))
        return days, tol

    CLOSE = 2  # % within which two amounts are simply the same money; beyond it a pairing is shown as "different"

    def far_apart(a, b):
        """The two amounts differ more than CLOSE % (of the smaller one): the pairing needs the user's tick."""
        return abs(a - b) * 100 > min(a, b) * CLOSE

    def int_list(v):
        v = v or []
        if not isinstance(v, list) or not all(isinstance(x, int) and not isinstance(x, bool) for x in v):
            raise ApiError(i18n.t("Invalid request"))
        return v

    def similar_amount(a, b, tol):
        """None if the two amounts are not the same money, else the cost of the difference (‰ of the smaller one)."""
        diff, low = abs(a - b), min(a, b)
        return None if diff * 100 > low * tol else 1000 * diff // max(low, 1)

    def same_money(t, o, days, tol):
        """Cost of pairing two records with a "date" and an "amount" (None = not the same money): one day weighs like
        1% of amount difference."""
        d = abs((dt.date.fromisoformat(o["date"]) - dt.date.fromisoformat(t["date"])).days)
        s = similar_amount(t["amount"], o["amount"], tol)
        return None if s is None or d > days else 10 * d + s

    def next_due(r):
        return util.occurrence(dt.date.fromisoformat(r["start_date"]), r["frequency"], r["generated"])

    def same_flow(a, o, days, tol):
        """Two recurring items for the same money: same frequency, similar amount, next due dates within `days`."""
        if a["frequency"] != o["frequency"]:
            return None
        d = abs((next_due(a) - next_due(o)).days)
        s = similar_amount(a["amount"], o["amount"], tol)
        return None if s is None or d > days else 10 * d + s

    @app.post("/api/categories/<int:cid>/to-transfers")
    def category_to_transfers(cid):
        """Turn the expenses of a category (e.g. "Contributions to household") into transfers to the accounts of another
        space, so that each movement of money exists once: out of one account, into one account, seen in both spaces.
        dry_run=true only shows what would happen. Options:
          to_account_ids: the accounts the money reaches, all in ONE other space (to_account_id: a single one);
          default_account_id: where an expense with no matching record goes (one of them; null = it stays an expense);
          merge (default true): the same money already recorded is recognized, among ALL the chosen accounts, so the
            account is the one where the money really arrived: similar amount (within `tolerance` %, default 2),
            close date (within `days`, default 5), the best overall pairing (repeated similar amounts never steal each
            other's partner):
              an existing transfer from this space to one of the accounts → the expense is a duplicate, deleted;
              an income in one of the accounts → replaced by the transfer (which keeps the expense's amount);
              two incomes in two different accounts that together make the expense (`split`, default true) → the
              expense becomes two transfers, one per account (together exactly the expense);
            `unmatch`: ids of expenses the user says are not paired (they go to the default account);
          assign: {expense id: account id, or 0 = leave as an expense}: the user's choice for a row, over the rest;
          recurring_ids: the category's recurring expenses the user chose to turn into recurring transfers (none by
            default: a recurring item is only ever changed by the user's choice); recurring_accounts: {id: account id
            or "split"}; by default the account of the recurring income that looks like the same money (or two that
            together make it: "split"), else the default account. No other recurring item is touched: a recurring
            income of the destination or a recurring transfer already planned is only reported; the user can then merge
            it with /api/recurring/<id>/reconcile."""
        b, db, p = body(), get_db(), pf()
        c = db.execute("SELECT name, kind, code, flow FROM categories WHERE id = ? AND portfolio_id = ?", (cid, p)).fetchone()
        if not c:
            raise ApiError(i18n.t("Category not found in this space"), 404)
        if c["kind"] != "expense" or c["code"] in util.SYSTEM_CODES:
            raise ApiError(i18n.t("Only the expenses of an ordinary category can become transfers"))
        ids = int_list(b.get("to_account_ids")) or [as_int(b.get("to_account_id"), "destination account")]
        accs = {}
        for aid in ids:
            a = db.execute("SELECT id, name, portfolio_id, archived FROM accounts WHERE id = ?", (aid,)).fetchone()
            if not a or a["portfolio_id"] == p or a["archived"]:
                raise ApiError(i18n.t("Choose an active account of another space"))
            accs[aid] = dict(a)
        if len({a["portfolio_id"] for a in accs.values()}) > 1:
            raise ApiError(i18n.t("The destination accounts must all be in the same space"))
        dest_space = next(iter(accs.values()))["portfolio_id"]
        default = b.get("default_account_id", ids[0])
        if default is not None and default not in accs:
            raise ApiError(i18n.t("The default account must be one of the destination accounts"))
        dry, merge, split = bool(b.get("dry_run")), b.get("merge", True) is not False, b.get("split", True) is not False
        days, tol = match_limits(b)
        unmatch, rec_ids = set(int_list(b.get("unmatch"))), set(int_list(b.get("recurring_ids")))
        confirm = set(int_list(b.get("confirm")))  # pairings with a different amount the user ticked
        assign, rec_acc = b.get("assign") or {}, b.get("recurring_accounts") or {}
        if not isinstance(assign, dict) or not all(isinstance(v, int) and not isinstance(v, bool) and (v == 0 or v in accs)
                                                   for v in assign.values()):
            raise ApiError(i18n.t("Invalid request"))
        if not isinstance(rec_acc, dict) or not all(v == "split" or (isinstance(v, int) and not isinstance(v, bool) and v in accs)
                                                    for v in rec_acc.values()):
            raise ApiError(i18n.t("Invalid request"))
        assign = {int(k): v for k, v in assign.items() if str(k).isdigit()}
        rec_acc = {int(k): v for k, v in rec_acc.items() if str(k).isdigit()}
        marks = ",".join("?" * len(ids))

        def cost(t, o):
            return same_money(t, o, days, tol)

        txs = [dict(r) for r in db.execute(
            f"""SELECT id, date, amount, account_id, description FROM transactions
                WHERE category_id = ? AND kind = 'expense' AND account_id IN {PF_ACCOUNTS} ORDER BY date, id""", (cid, p))]
        open_ = [t for t in txs if t["id"] not in unmatch and t["id"] not in assign] if merge else []
        transfers = [dict(r) for r in db.execute(
            f"""SELECT id, date, amount, to_account_id AS acc FROM transactions WHERE kind = 'transfer'
                AND to_account_id IN ({marks}) AND account_id IN {PF_ACCOUNTS}""", (*ids, p))] if merge else []
        incomes = [dict(r) for r in db.execute(
            f"SELECT id, date, amount, account_id AS acc FROM transactions WHERE account_id IN ({marks}) AND kind = 'income'",
            ids)] if merge else []
        # 1) already a transfer (duplicate), 2) an income of one of the accounts (merge), 3) two incomes in two accounts
        # that together make the expense (split), for those left
        hits = {}
        for i, j in util.best_pairs(open_, transfers, cost):
            hits[open_[i]["id"]] = ("duplicate", [transfers[j]])
        rest = [t for t in open_ if t["id"] not in hits]
        for i, j in util.best_pairs(rest, incomes, cost):
            hits[rest[i]["id"]] = ("merge", [incomes[j]])
        if split and len(ids) > 1:
            used = {h[0]["id"] for a, h in hits.values() if a == "merge"}
            free = [x for x in incomes if x["id"] not in used]
            cands = []
            for t in (t for t in rest if t["id"] not in hits):
                d0 = dt.date.fromisoformat(t["date"])
                near = [x for x in free if abs((dt.date.fromisoformat(x["date"]) - d0).days) <= days and x["amount"] < t["amount"]]
                for k, x in enumerate(near):
                    for y in near[k + 1:]:
                        s = x["acc"] != y["acc"] and similar_amount(t["amount"], x["amount"] + y["amount"], tol)
                        if s is not None and s is not False:
                            dd = abs((dt.date.fromisoformat(x["date"]) - d0).days) + abs((dt.date.fromisoformat(y["date"]) - d0).days)
                            cands.append((10 * dd + s, t["id"], x, y))
            taken = set()
            for _, tid, x, y in sorted(cands, key=lambda z: (z[0], z[1])):  # closest first; each record once
                if tid not in hits and x["id"] not in taken and y["id"] not in taken:
                    hits[tid] = ("split", [x, y])
                    taken |= {x["id"], y["id"]}
        items = []
        for t in txs:
            action, hit = hits.get(t["id"], ("convert", []))
            # a pairing whose amount is far from the expense's (beyond CLOSE %) is only a suggestion until ticked
            suggestion = None
            if hit and far_apart(t["amount"], sum(h["amount"] for h in hit)) and t["id"] not in confirm:
                suggestion = {"action": action, "date": hit[0]["date"], "amount": sum(h["amount"] for h in hit)}
                action, hit = "convert", []
            to = hit[0]["acc"] if action in ("merge", "duplicate") else None
            if t["id"] in assign:  # the user's choice for the row
                action, hit, to = ("convert", [], assign[t["id"]]) if assign[t["id"]] else ("keep", [], None)
            elif action == "convert":
                to = default
                if to is None:
                    action = "keep"
            parts = []
            if action == "split":  # together exactly the expense: the second part takes what is left
                parts = [{"account_id": hit[0]["acc"], "amount": hit[0]["amount"]},
                         {"account_id": hit[1]["acc"], "amount": t["amount"] - hit[0]["amount"]}]
            items.append({"id": t["id"], "date": t["date"], "amount": t["amount"], "description": t["description"],
                          "action": action, "to_account_id": to, "parts": parts,
                          "match_id": hit[0]["id"] if hit else None, "match_date": hit[0]["date"] if hit else None,
                          "match_amount": sum(h["amount"] for h in hit) if hit else None,
                          "matches": [{"id": h["id"], "date": h["date"], "amount": h["amount"], "account_id": h["acc"]} for h in hit],
                          "unmatched": t["id"] in unmatch, "assigned": t["id"] in assign, "suggestion": suggestion,
                          "confirmed": t["id"] in confirm and bool(hit)})
        # an income for the same money in ANOTHER account of the destination space: maybe an account is missing
        elsewhere = 0
        conv = [t for t in items if t["action"] == "convert"]
        if conv:
            others = [dict(r) for r in db.execute(
                f"""SELECT id, date, amount FROM transactions WHERE kind = 'income' AND account_id NOT IN ({marks})
                    AND account_id IN (SELECT id FROM accounts WHERE portfolio_id = ?)""", (*ids, dest_space))]
            elsewhere = len(util.best_pairs(conv, others, cost))

        # recurring expenses of the category (plain ones: no loan schedule, no variable amount): listed, unticked, with
        # the account suggested by the recurring income that looks like the same money (or two that together make it)
        recs = [dict(r) for r in db.execute(
            f"""SELECT {REC_COLS} FROM recurring WHERE category_id = ? AND kind = 'expense' AND NOT expected
                AND installments IS NULL AND principal IS NULL AND account_id IN {PF_ACCOUNTS} ORDER BY name""", (cid, p))]
        planned = [dict(r) for r in db.execute(
            f"""SELECT {REC_COLS} FROM recurring WHERE kind = 'transfer' AND to_account_id IN ({marks}) AND active
                AND account_id IN {PF_ACCOUNTS}""", (*ids, p))]
        dest_inc = [dict(r) for r in db.execute(
            f"SELECT {REC_COLS} FROM recurring WHERE account_id IN ({marks}) AND kind = 'income' AND active", ids)]
        pairs = util.best_pairs(recs, dest_inc, lambda a, o: same_flow(a, o, days, tol))
        sugg = {recs[i]["id"]: {"account_id": dest_inc[j]["account_id"], "parts": []} for i, j in pairs}
        if len(ids) > 1:  # two recurring incomes in two accounts that together make one recurring expense
            used = {dest_inc[j]["id"] for _, j in pairs}
            for r in recs:
                if r["id"] in sugg:
                    continue
                best = None
                for k, x in enumerate(dest_inc):
                    for y in dest_inc[k + 1:]:
                        if x["account_id"] == y["account_id"] or x["frequency"] != r["frequency"] or y["frequency"] != r["frequency"] \
                                or {x["id"], y["id"]} & used:
                            continue
                        s = similar_amount(r["amount"], x["amount"] + y["amount"], tol)
                        dd = abs((next_due(x) - next_due(r)).days) + abs((next_due(y) - next_due(r)).days)
                        if s is not None and dd <= 2 * days and (best is None or 10 * dd + s < best[0]):
                            best = (10 * dd + s, x, y)
                if best:
                    _, x, y = best
                    used |= {x["id"], y["id"]}
                    sugg[r["id"]] = {"account_id": "split", "parts": [
                        {"account_id": x["account_id"], "amount": x["amount"], "income": x["name"]},
                        {"account_id": y["account_id"], "amount": r["amount"] - x["amount"], "income": y["name"]}]}
        rec_items = []
        for r in recs:
            s = sugg.get(r["id"], {"account_id": None, "parts": []})
            to = rec_acc.get(r["id"], s["account_id"] if s["account_id"] is not None else (default or ids[0]))
            if to == "split" and not s["parts"]:
                raise ApiError(i18n.t("Invalid request"))
            rec_items.append({"id": r["id"], "name": r["name"], "amount": r["amount"], "frequency": r["frequency"],
                              "active": bool(r["active"]), "chosen": r["id"] in rec_ids, "to_account_id": to,
                              "suggested": s["account_id"], "parts": s["parts"],
                              "planned": [o["name"] for o in planned if same_flow(r, o, days, tol) is not None],
                              "dest_income": [o["name"] for o in dest_inc if same_flow(r, o, days, tol) is not None]})
        rec_conv = [x for x in rec_items if x["chosen"]]

        # effect on the reports (saved = income + from other spaces − spending − to other spaces), per account: a
        # merged transfer keeps the expense's amount, so the account moves by the difference
        flow_other = c["flow"] == "other"
        moved = sum(i["amount"] for i in items if i["action"] in ("convert", "merge", "split"))
        dup = sum(i["amount"] for i in items if i["action"] == "duplicate")
        replaced = sum(i["match_amount"] for i in items if i["action"] in ("merge", "split"))
        per = {a: 0 for a in ids}
        for i in items:
            if i["action"] == "convert":
                per[i["to_account_id"]] += i["amount"]
            elif i["action"] == "merge":
                per[i["to_account_id"]] += i["amount"] - i["match_amount"]
            elif i["action"] == "split":
                for part, m in zip(i["parts"], i["matches"]):
                    per[part["account_id"]] += part["amount"] - m["amount"]
        effect = {
            "spending": 0 if flow_other else -(moved + dup),
            "to_others": moved - dup if flow_other else moved,
            "source_balance": dup,                        # a deleted duplicate expense gives back what it took
            "dest_income": -replaced,                     # replaced incomes now count as "from other spaces"
            "dest_from_others": moved,
            "dest_balance": sum(per.values()),
        }
        n = {k: sum(i["action"] == k for i in items) for k in ("convert", "merge", "split", "duplicate", "keep")}
        to_space = db.execute("SELECT name FROM portfolios WHERE id = ?", (dest_space,)).fetchone()["name"]
        names = {a: accs[a]["name"] for a in ids}
        summary = {"category": c["name"], "to_account": ", ".join(names.values()), "to_space": to_space,
                   "accounts": [{"id": a, "name": names[a]} for a in ids], "default_account_id": default,
                   "transactions": len(txs), "total": sum(t["amount"] for t in txs),
                   "first": txs[0]["date"] if txs else None, "last": txs[-1]["date"] if txs else None,
                   "converted": n["convert"], "merged": n["merge"], "split": n["split"], "duplicates": n["duplicate"],
                   "kept": n["keep"], "items": items, "effect": effect,
                   "dest_balances": [{"account_id": a, "name": names[a], "delta": per[a]} for a in ids if per[a]],
                   "elsewhere": elsewhere, "days": days, "tolerance": tol,
                   "recurring": len(rec_conv), "recurring_items": rec_items, "flow_other": flow_other}
        if dry or not (any(i["action"] != "keep" for i in items) or rec_conv):
            g.audit_skip = True  # a preview changes nothing: not in the activity log
            return jsonify(dry_run=True, **summary)
        dbm.backup_now("pre-convert")
        tx_cols = "date, amount, kind, account_id, to_account_id, category_id, description, notes, recurring_id, source, excluded"
        for i in items:
            if i["action"] == "keep":
                continue
            if i["action"] == "duplicate":
                db.execute("DELETE FROM transactions WHERE id = ?", (i["id"],))
                continue
            if i["action"] == "split":  # the expense becomes the first part; a copy becomes the second
                first, second = i["parts"]
                row = dict(db.execute(f"SELECT {tx_cols} FROM transactions WHERE id = ?", (i["id"],)).fetchone())
                db.execute("""UPDATE transactions SET kind = 'transfer', to_account_id = ?, amount = ?, category_id = NULL
                              WHERE id = ?""", (first["account_id"], first["amount"], i["id"]))
                row.update(kind="transfer", to_account_id=second["account_id"], amount=second["amount"], category_id=None)
                db.execute(f"INSERT INTO transactions ({tx_cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
                for m in i["matches"]:
                    db.execute("DELETE FROM transactions WHERE id = ?", (m["id"],))
                continue
            db.execute("UPDATE transactions SET kind = 'transfer', to_account_id = ?, category_id = NULL WHERE id = ?",
                       (i["to_account_id"], i["id"]))
            if i["action"] == "merge":
                db.execute("DELETE FROM transactions WHERE id = ?", (i["match_id"],))
        converted = []
        for x in rec_conv:
            if x["to_account_id"] == "split":  # one recurring transfer per account, together exactly the expense
                first, second = x["parts"]
                row = dict(db.execute("SELECT * FROM recurring WHERE id = ?", (x["id"],)).fetchone())
                db.execute("""UPDATE recurring SET kind = 'transfer', to_account_id = ?, amount = ?, category_id = NULL
                              WHERE id = ?""", (first["account_id"], first["amount"], x["id"]))
                row.pop("id")
                row.update(kind="transfer", to_account_id=second["account_id"], amount=second["amount"], category_id=None)
                cur = db.execute(f"INSERT INTO recurring ({','.join(row)}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
                converted += [x["id"], cur.lastrowid]
            else:
                db.execute("UPDATE recurring SET kind = 'transfer', to_account_id = ?, category_id = NULL WHERE id = ?",
                           (x["to_account_id"], x["id"]))
                converted.append(x["id"])
        db.commit()
        done = n["convert"] + n["merge"] + n["split"]
        note(i18n.t("{category} → transfers to {account}", category=c["name"], account=summary["to_account"]) + " · "
             + i18n.tn("{n} transaction", "{n} transactions", done)
             + (" · " + i18n.tn("{n} income merged", "{n} incomes merged", n["merge"]) if n["merge"] else "")
             + (" · " + i18n.tn("{n} duplicate removed", "{n} duplicates removed", n["duplicate"]) if n["duplicate"] else "")
             + (" · " + i18n.tn("{n} recurring item", "{n} recurring items", len(rec_conv)) if rec_conv else ""))
        return jsonify(dry_run=False, converted_recurring=converted, **summary)

    # ---------------------------------------------------------- rules

    @app.post("/api/rules")
    def rule_create():
        b = body()
        pattern = as_text(b.get("pattern"), 80).lower()
        if len(pattern) < 2:
            raise ApiError(i18n.t("The keyword must be at least 2 characters long"))
        cid = as_int(b.get("category_id"), "category")
        if portfolio_of("categories", cid) != pf():
            raise ApiError(i18n.t("Category not found"))
        db = get_db()
        db.execute("INSERT OR IGNORE INTO rules(pattern, category_id) VALUES (?,?)", (pattern, cid))
        db.commit()
        return jsonify(ok=True), 201

    @app.delete("/api/rules/<int:rid>")
    def rule_delete(rid):
        db = get_db()
        db.execute("DELETE FROM rules WHERE id = ? AND category_id IN (SELECT id FROM categories WHERE portfolio_id = ?)",
                   (rid, pf()))
        db.commit()
        return jsonify(ok=True)

    @app.post("/api/rules/apply")
    def rules_apply():
        """Automatically categorizes the transactions that are still uncategorized."""
        db = get_db()
        cat = Categorizer(db, pf())
        n = 0
        for t in db.execute(f"SELECT id, description, kind FROM transactions WHERE category_id IS NULL "
                            f"AND kind != 'transfer' AND account_id IN {PF_ACCOUNTS}", (pf(),)).fetchall():
            s = cat.suggest(t["description"], t["kind"])
            if s["category_id"]:
                db.execute("UPDATE transactions SET category_id=? WHERE id=?", (s["category_id"], t["id"]))
                n += 1
        db.commit()
        note(i18n.tn("{n} transaction categorized", "{n} transactions categorized", n))
        if not n:
            g.audit_skip = True
        return jsonify(updated=n)

    # -------------------------------------------------------- transactions

    @app.get("/api/transactions")
    def tx_list():
        db = get_db()
        where, params = tx_filters(request.args)
        limit = min(as_int(request.args.get("limit") or 100, "limit", minimum=1), 1000)
        offset = as_int(request.args.get("offset") or 0, "offset", minimum=0)
        items = db.execute(f"{TX_SELECT}{where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?",
                           (*params, limit, offset)).fetchall()
        tot = db.execute(
            f"""SELECT COUNT(*) AS n,
                  COALESCE(SUM(CASE WHEN t.kind='income' AND NOT t.excluded THEN t.amount END), 0) AS income,
                  COALESCE(SUM(CASE WHEN t.kind='expense' AND NOT t.excluded THEN t.amount END), 0) AS expense,
                  COALESCE(SUM(t.excluded), 0) AS excluded
                FROM transactions t{where}""", params).fetchone()
        return jsonify(items=[dict(r) for r in items], total=tot["n"], income=tot["income"],
                       expense=tot["expense"], excluded=tot["excluded"])

    def visible_tx(tid):
        """The transaction must be visible in the active space (its own account or an incoming transfer)."""
        p = pf()
        ok = get_db().execute(
            f"SELECT 1 FROM transactions WHERE id = ? AND (account_id IN {PF_ACCOUNTS} OR to_account_id IN {PF_ACCOUNTS})",
            (tid, p, p)).fetchone()
        if not ok:
            raise ApiError(i18n.t("Transaction not found"), 404)

    def own_tx(tid):
        """To edit or delete: the transaction must start from an account of the active space. A transfer coming
        from another space belongs to that space: it is edited there (here it is read-only)."""
        visible_tx(tid)
        r = get_db().execute("SELECT t.account_id, p.name FROM transactions t JOIN accounts a ON a.id = t.account_id "
                             "JOIN portfolios p ON p.id = a.portfolio_id WHERE t.id = ?", (tid,)).fetchone()
        if portfolio_of("accounts", r[0]) != pf():
            raise ApiError(i18n.t("This transfer comes from the space \"{value}\": edit or delete it from there", value=r[1]), 409)

    @app.post("/api/transactions")
    def tx_create():
        b = body()
        t = tx_from_body(b)
        own_account(t["account_id"])
        not_archived(t["account_id"], t["to_account_id"])
        db = get_db()
        if not b.get("force"):  # manual entry: warn if the same transaction already exists (e.g. already imported)
            dup = db.execute(
                """SELECT date, description FROM transactions WHERE account_id = ? AND kind = ? AND amount = ?
                   AND date BETWEEN date(?, ?) AND date(?, ?) ORDER BY abs(julianday(date) - julianday(?)) LIMIT 1""",
                (t["account_id"], t["kind"], t["amount"], t["date"], f"-{DUP_DAYS} days", t["date"], f"+{DUP_DAYS} days",
                 t["date"])).fetchone()
            if dup:
                return jsonify(error=i18n.t("This transaction may already exist"), duplicate={"date": dup["date"], "description": dup["description"]}), 409
        cur = db.execute(
            """INSERT INTO transactions(date, amount, kind, account_id, to_account_id, category_id,
                                        description, notes, excluded) VALUES (?,?,?,?,?,?,?,?,?)""",
            (t["date"], t["amount"], t["kind"], t["account_id"], t["to_account_id"], t["category_id"],
             t["description"], t["notes"], t["excluded"]))
        db.commit()
        return jsonify(id=cur.lastrowid), 201

    def pac_trade_of(db, tx):
        """Automatic investment plan purchase created by this deposit (if any)."""
        if not tx["recurring_id"]:
            return None
        return db.execute("SELECT id, account_id FROM trades WHERE source = 'recurring' AND external_id = ?",
                          (f"pac:{tx['recurring_id']}:{tx['date']}",)).fetchone()

    def drop_pac_trades(db, tx_ids):
        """Deleting an investment plan deposit also deletes the automatic purchase it generated: otherwise the broker
        would appear to have bought with money that never arrived (negative cash)."""
        found = []
        for i in range(0, len(tx_ids), 500):
            chunk = tx_ids[i:i + 500]
            for t in db.execute(f"SELECT recurring_id, date FROM transactions WHERE id IN ({','.join('?' * len(chunk))})", chunk).fetchall():
                o = pac_trade_of(db, t)
                if o:
                    found.append(o)
        before = {a: tools.negative_position(db, a) for a in {o["account_id"] for o in found}}
        for o in found:
            db.execute("DELETE FROM trades WHERE id = ?", (o["id"],))
        for a, bad in before.items():  # the units bought are needed by a later sale: don't delete
            check_positions(db, a, bad, "The deposit generated an investment plan purchase")
            tools.sync_holdings(db, a)
        return len(found)

    @app.put("/api/transactions/<int:tid>")
    def tx_update(tid):
        t = tx_from_body(body())
        db = get_db()
        own_tx(tid)
        old = db.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
        if t["account_id"] != old["account_id"]:
            own_account(t["account_id"])
        warning = None
        o = pac_trade_of(db, old)
        if o and any(t[k] != old[k] for k in ("date", "amount", "kind", "account_id", "to_account_id")):
            # the purchase stays linked (even with the new date) but its amounts must be corrected by hand
            db.execute("UPDATE trades SET external_id = ? WHERE id = ?", (f"pac:{old['recurring_id']}:{t['date']}", o["id"]))
            warning = ("This deposit has an automatic investment plan purchase: update the trade in Investments "
                       "as well (amount, date, units)")
        changes = [i18n.t("amount {old} → {new}", old=audit.eur(old["amount"]), new=audit.eur(t["amount"]))
                   if old["amount"] != t["amount"] else "",
                   i18n.t("date {old} → {new}", old=old["date"], new=t["date"]) if old["date"] != t["date"] else "",
                   i18n.t("account changed") if old["account_id"] != t["account_id"] else "",
                   i18n.t("category changed") if old["category_id"] != t["category_id"] else "",
                   (i18n.t("excluded from reports") if t["excluded"] else i18n.t("included in reports"))
                   if old["excluded"] != t["excluded"] else ""]
        note(" · ".join([f"{old['date']} {(old['description'] or '')[:40]}", *[c for c in changes if c]]))
        db.execute(
            """UPDATE transactions SET date=?, amount=?, kind=?, account_id=?, to_account_id=?,
                   category_id=?, description=?, notes=?, excluded=? WHERE id=?""",
            (t["date"], t["amount"], t["kind"], t["account_id"], t["to_account_id"], t["category_id"],
             t["description"], t["notes"], t["excluded"], tid))
        db.commit()
        return jsonify(ok=True, warning=warning)

    @app.delete("/api/transactions/<int:tid>")
    def tx_delete(tid):
        db = get_db()
        own_tx(tid)
        o = db.execute("SELECT date, description, amount FROM transactions WHERE id = ?", (tid,)).fetchone()
        n = drop_pac_trades(db, [tid])
        note(f"{o['date']} {(o['description'] or '')[:40]} · {audit.eur(o['amount'])}" + (" · " + i18n.t("with its investment plan purchase") if n else ""))
        db.execute("DELETE FROM transactions WHERE id = ?", (tid,))
        db.commit()
        return jsonify(ok=True, pac_deleted=n)

    @app.post("/api/transactions/bulk")
    def tx_bulk():
        b = body()
        ids = id_list(b.get("ids"), "id")
        if not ids:
            raise ApiError(i18n.t("No transactions selected"))
        db = get_db()
        p = pf()
        asked = len(ids)
        ids = [r[0] for r in db.execute(  # only transactions that start from accounts of the active space
            f"SELECT id FROM transactions WHERE id IN ({','.join('?' * len(ids))}) "
            f"AND account_id IN {PF_ACCOUNTS}", (*ids, p))]
        if not ids:
            raise ApiError(i18n.t("The selected transactions are transfers coming from another space: edit them from there"))
        g.skipped_incoming = asked - len(ids)
        marks = ",".join("?" * len(ids))
        action = as_key(b.get("action"))
        note(i18n.tn("{n} transaction", "{n} transactions", len(ids)), {"delete": "Multiple transactions deleted", "category": "Category changed on multiple transactions",
                                          "exclude": "Transactions excluded from reports", "include": "Transactions included in reports"}.get(action))
        if action == "delete":
            g.audit_kind = "delete"
        pac_deleted = 0
        if action == "delete":
            pac_deleted = drop_pac_trades(db, ids)
            db.execute(f"DELETE FROM transactions WHERE id IN ({marks})", ids)
        elif action == "category":
            cid = as_int(b.get("category_id"), "category")
            c = db.execute("SELECT kind FROM categories WHERE id=? AND portfolio_id=?", (cid, p)).fetchone()
            if not c:
                raise ApiError(i18n.t("Category not found"))
            db.execute(f"UPDATE transactions SET category_id=? WHERE kind=? AND account_id IN {PF_ACCOUNTS} AND id IN ({marks})",
                       (cid, c["kind"], p, *ids))
        elif action in ("exclude", "include"):
            db.execute(f"UPDATE transactions SET excluded=? WHERE id IN ({marks})",
                       (1 if action == "exclude" else 0, *ids))
        else:
            raise ApiError(i18n.t("Invalid action"))
        db.commit()
        return jsonify(ok=True, pac_deleted=pac_deleted, skipped=g.get("skipped_incoming", 0))

    @app.get("/api/suggest")
    def suggest():
        """Autofill from history for a description: category (rules, then history), last amount, usual account
        and, for transfers, the usual destination account. Only active accounts of the space."""
        kind = request.args.get("kind", "expense")
        if kind not in KINDS:
            kind = "expense"
        desc = as_text(request.args.get("description"), 200)
        db, p = get_db(), pf()
        out = Categorizer(db, p).suggest(desc, kind) if kind != "transfer" else {"category_id": None, "source": None}
        key = forecast.payee_key(desc)
        if len(desc) >= 3 and key:
            same = [t for t in db.execute(
                f"""SELECT t.description, t.amount, t.account_id, t.to_account_id FROM transactions t
                    JOIN accounts a ON a.id = t.account_id
                    WHERE t.kind = ? AND t.account_id IN {PF_ACCOUNTS} AND NOT a.archived
                    ORDER BY t.date DESC, t.id DESC LIMIT 3000""", (kind, p)) if forecast.payee_key(t["description"]) == key][:50]
            if same:
                active = {r[0] for r in db.execute("SELECT id FROM accounts WHERE NOT archived")}
                out["amount"] = out.get("amount") or same[0]["amount"]
                out["account_id"] = Counter(t["account_id"] for t in same).most_common(1)[0][0]
                tos = Counter(t["to_account_id"] for t in same if t["to_account_id"] in active)
                if kind == "transfer" and tos:
                    out["to_account_id"] = tos.most_common(1)[0][0]
                out["count"] = len(same)
                out["source"] = out.get("source") or "storico"
        return jsonify(out)

    @app.get("/api/descriptions")
    def descriptions():
        """Descriptions already used that contain the typed text: one per payee (the most recent, without repeating
        month and year), most used first; the transaction type is optional."""
        q = as_text(request.args.get("q"), 80)
        if len(q) < 2:
            return jsonify([])
        kind = request.args.get("kind") if request.args.get("kind") in KINDS else None
        rows = get_db().execute(
            f"""SELECT description, date, kind, amount FROM transactions
               WHERE description LIKE ? AND account_id IN {PF_ACCOUNTS} {'AND kind = ?' if kind else ''}
               ORDER BY date DESC LIMIT 2000""",
            (f"%{q}%", pf(), *([kind] if kind else []))).fetchall()
        best, count = {}, Counter()
        for r in rows:
            k = forecast.payee_key(r["description"])
            count[k] += 1
            best.setdefault(k, r)
        top = [best[k] for k, _ in count.most_common(12)]
        if request.args.get("full"):  # for the dropdown: name without month and year, type, how many times, last amount and date
            return jsonify([{"description": r["description"], "name": forecast.clean_name(r["description"]), "kind": r["kind"],
                             "count": count[forecast.payee_key(r["description"])], "amount": r["amount"], "date": r["date"]} for r in top])
        return jsonify([r["description"] for r in top])

    @app.get("/api/notes")
    def notes_for_description():
        """Notes used recently in transactions with the same or a similar description (same payer/payee key, else one
        that shares its longest word), most recent first, one per text; q filters them by what is already typed."""
        desc = as_text(request.args.get("description"), 200)
        q = as_text(request.args.get("q"), 200).lower()
        kind = request.args.get("kind") if request.args.get("kind") in KINDS else None
        key = forecast.payee_key(desc)
        if len(desc.strip()) < 3 or not key:
            return jsonify([])
        rows = get_db().execute(
            f"""SELECT description, notes, date FROM transactions
               WHERE notes IS NOT NULL AND TRIM(notes) != '' AND account_id IN {PF_ACCOUNTS} {'AND kind = ?' if kind else ''}
               ORDER BY date DESC, id DESC LIMIT 3000""", (pf(), *([kind] if kind else []))).fetchall()
        word = max(key.split(), key=len)
        same = [r for r in rows if forecast.payee_key(r["description"]) == key]
        if not same and len(word) >= 3:  # nothing with the same payee: descriptions that share its main word
            same = [r for r in rows if word in forecast.payee_key(r["description"]).split()]
        out, count = {}, Counter()
        for r in same:
            text = r["notes"].strip()
            if q and q not in text.lower():
                continue
            count[text] += 1
            out.setdefault(text, r["date"])
        return jsonify([{"notes": t, "date": d, "count": count[t]} for t, d in list(out.items())[:8]])

    @app.get("/api/rules/suggestions")
    def rule_suggestions():
        """Keywords suggested for new rules: payees that repeat among the transactions still uncategorized."""
        db, p = get_db(), pf()
        cat = Categorizer(db, p)
        count, kinds, pattern = Counter(), {}, {}
        for t in db.execute(f"""SELECT description, kind FROM transactions WHERE category_id IS NULL AND kind != 'transfer'
                                AND account_id IN {PF_ACCOUNTS} ORDER BY date DESC LIMIT 3000""", (p,)):
            if cat.suggest(t["description"], t["kind"])["source"] == "regola":
                continue  # already covered by a rule
            k = forecast.payee_key(t["description"])
            if len(k) >= 3:
                count[k] += 1
                kinds.setdefault(k, t["kind"])
                # the keyword must appear as is in the description, otherwise the rule would not fire
                pattern.setdefault(k, k if rule_matches(k, t["description"]) else max(k.split(), key=len))
        return jsonify([{"pattern": pattern[k], "count": n, "kind": kinds[k]} for k, n in count.most_common(15)
                        if n >= 2 and len(pattern[k]) >= 3])

    # ------------------------------------------------------- recurring items

    def recurring_from_body(b):
        kind = b.get("kind")
        if kind not in KINDS:
            raise ApiError(i18n.t("Invalid type"))
        freq = as_key(b.get("frequency"))
        if freq not in FREQUENCIES:
            raise ApiError(i18n.t("Invalid frequency"))
        name = as_text(b.get("name"), 80)
        if not name:
            raise ApiError(i18n.t("The name is required"))
        account_id = as_int(b.get("account_id"), "account")
        category_id, to_account_id = check_refs(
            kind, account_id, as_int(b.get("to_account_id"), "destination account", required=False),
            as_int(b.get("category_id"), "category", required=False))
        start = as_date(b.get("start_date"), "first due date")
        end = as_date(b.get("end_date"), "end date", required=False)
        if end and end < start:
            raise ApiError(i18n.t("The end date is before the start date"))
        # plausible years: a typo (e.g. 0225) would generate thousands of past due dates
        if not ("1990-01-01" <= start <= f"{dt.date.today().year + 10}-12-31") or (end and end > "2100-12-31"):
            raise ApiError(i18n.t("Recurring item date out of range: check the year"))
        if b.get("installments") and b.get("principal") and freq != "monthly":
            raise ApiError(i18n.t("The amortization schedule is calculated on monthly installments: for a loan with interest use the monthly frequency (or remove the loan amount)"))
        holding_id = as_int(b.get("holding_id"), "investment plan security", required=False)
        if holding_id:  # investment plan: only for transfers to an investment account that holds that security
            ok = kind == "transfer" and get_db().execute(
                "SELECT 1 FROM holdings h JOIN accounts a ON a.id = h.account_id WHERE h.id = ? AND a.id = ? AND a.type = ?",
                (holding_id, to_account_id, tools.INVEST)).fetchone()
            if not ok:
                raise ApiError(i18n.t("The investment plan security must belong to the destination investment account"))
        expected = 1 if b.get("expected") else 0
        if expected and (kind == "transfer" or b.get("installments")):
            raise ApiError(i18n.t("A variable amount applies to income and expenses, not to transfers or installments"))
        method = b.get("amortization") or "french"
        if method not in tools.AMORTIZATION_METHODS:
            raise ApiError(i18n.t("Invalid amortization method"))
        if method == "constant" and (kind != "expense" or not b.get("installments") or not b.get("principal")):
            raise ApiError(i18n.t("Constant principal needs an expense with the loan amount and the number of installments"))
        constant = method == "constant"
        return {
            "holding_id": holding_id, "expected": expected, "amount_fixed": 1 if expected and b.get("amount_fixed") else 0,
            "match_text": as_text(b.get("match_text"), 60) if expected else "",
            "amortization": "constant" if constant else None,
            # constant principal: the amount is calculated from the schedule (installment by installment)
            "name": name, "kind": kind, "amount": as_int(b.get("amount"), "amount", minimum=1, required=not constant) or 1,
            "account_id": account_id, "to_account_id": to_account_id, "category_id": category_id,
            "frequency": freq, "start_date": start, "end_date": end,
            "installments": as_int(b.get("installments"), "number of installments", required=False, minimum=1),
            "principal": as_int(b.get("principal"), "loan amount", required=False, minimum=0),
            **rate_from_body(b),
            "active": 0 if b.get("active") is False else 1, "notes": as_text(b.get("notes"), 1000),
        }

    @app.get("/api/recurring")
    def recurring_list():
        """Recurring items of the space, plus the recurring transfers that other spaces send to its accounts
        ("incoming": one record, shown in both spaces, read-only here: only the space that created it changes it)."""
        db = get_db()
        rows = db.execute(
            """SELECT r.*, a.name AS account_name, ta.name AS to_account_name, c.name AS category_name,
                      c.icon AS category_icon, c.color AS category_color,
                      h.ticker AS holding_ticker, h.name AS holding_name, h.asset_class AS holding_class,
                      a.portfolio_id != ? AS incoming, pa.name AS from_space
               FROM recurring r JOIN accounts a ON a.id = r.account_id
               JOIN portfolios pa ON pa.id = a.portfolio_id
               LEFT JOIN accounts ta ON ta.id = r.to_account_id
               LEFT JOIN categories c ON c.id = r.category_id
               LEFT JOIN holdings h ON h.id = r.holding_id
               WHERE a.portfolio_id = ? OR (r.kind = 'transfer' AND ta.portfolio_id = ?)
               ORDER BY r.active DESC, r.name""", (pf(), pf(), pf())).fetchall()
        out = [{**recurring_view(r), "incoming": bool(r["incoming"]),
                "from_space": r["from_space"] if r["incoming"] else None} for r in rows]
        today = dt.date.today()
        for r in out:  # expected items: next date and amount predicted from recent payments, delay
            if r.get("expected"):
                st = forecast.expected_stats(db, r)
                nxt = forecast.expected_forecast(db, r, today, add_months(today, 14)) if r["active"] else []
                r["monthly_equivalent"] = round(r["monthly_equivalent"] * st["amount"] / r["amount"]) if r["amount"] else 0
                r.update(expected_source=st["source"], expected_median=st["median"])
                r.update(expected_amount=st["amount"], expected_count=st["count"], expected_min=st.get("min"),
                         expected_max=st.get("max"), last_date=st["last"].isoformat() if st["last"] else None,
                         next_date=nxt[0][0].isoformat() if nxt else None,
                         late_since=nxt[0][3].isoformat() if nxt and nxt[0][2] else None,
                         generated=db.execute("SELECT COUNT(*) FROM transactions WHERE recurring_id = ?", (r["id"],)).fetchone()[0])
        unverified = {}  # investment plan purchases with an estimated price for more than 30 days, per recurring item
        for u in tools.pac_unverified(db, pf()):
            unverified[u["recurring_id"]] = unverified.get(u["recurring_id"], 0) + 1
        for r in out:
            r["pac_unverified"] = unverified.get(r["id"], 0)
        return jsonify(out)

    def own_recurring(rid):
        r = get_db().execute("SELECT account_id FROM recurring WHERE id = ?", (rid,)).fetchone()
        if not r or portfolio_of("accounts", r[0]) != pf():
            raise ApiError(i18n.t("Recurring item not found"), 404)

    @app.post("/api/recurring")
    def recurring_create():
        b = body()
        r = recurring_from_body(b)
        own_account(r["account_id"])
        not_archived(r["account_id"], r["to_account_id"])
        r["generated"] = 0 if b.get("post_past") else count_past_occurrences(r)
        r["pac_since"] = dt.date.today().isoformat() if r["holding_id"] else None  # automatic purchases from today onward
        r["amount"] = tools.scheduled_amount(r, r["generated"])  # constant principal: the next installment
        db = get_db()
        cols = ",".join(r)
        cur = db.execute(f"INSERT INTO recurring({cols}) VALUES ({','.join('?' * len(r))})", tuple(r.values()))
        db.commit()
        created = process_recurring(db)
        return jsonify(id=cur.lastrowid, created=created), 201

    @app.put("/api/recurring/<int:rid>")
    def recurring_update(rid):
        db = get_db()
        own_recurring(rid)
        r = recurring_from_body(body())
        own_account(r["account_id"])
        old = db.execute("SELECT * FROM recurring WHERE id = ?", (rid,)).fetchone()
        r["pac_since"] = (old["pac_since"] if old["holding_id"] == r["holding_id"] and old["pac_since"] else
                          dt.date.today().isoformat()) if r["holding_id"] else None
        if (r["start_date"] != old["start_date"] or r["frequency"] != old["frequency"] or r["end_date"] != old["end_date"]
                or (r["active"] and not old["active"]) or r["expected"] != old["expected"]):
            # new schedule, resuming after a pause, end moved, switch to/from variable amount: the due dates already
            # recorded stay and it restarts from today, without duplicating them or catching up on past ones in bulk
            # (for those there is "link transactions")
            r["generated"] = count_past_occurrences(r)
        r["amount"] = tools.scheduled_amount(r, r.get("generated", old["generated"]))  # constant principal: next installment
        db.execute(f"UPDATE recurring SET {', '.join(f'{k}=?' for k in r)} WHERE id=?", (*r.values(), rid))
        db.commit()
        created = process_recurring(db)
        return jsonify(ok=True, created=created)

    @app.delete("/api/recurring/<int:rid>")
    def recurring_delete(rid):
        db = get_db()
        own_recurring(rid)
        r = db.execute("SELECT name, amount FROM recurring WHERE id = ?", (rid,)).fetchone()
        n = db.execute("SELECT COUNT(*) FROM transactions WHERE recurring_id = ?", (rid,)).fetchone()[0]
        expected = db.execute("SELECT expected FROM recurring WHERE id = ?", (rid,)).fetchone()[0]
        note(f"{r['name']} · {audit.eur(r['amount'])}" + (" · " + i18n.tn("with {n} transaction", "with {n} transactions", n) if request.args.get("with_transactions") == "1" and n and not expected else ""))
        if expected:  # the transactions of a variable recurring item are the real ones (imported or entered): never deleted
            db.execute("UPDATE transactions SET recurring_id = NULL WHERE recurring_id = ?", (rid,))
        elif request.args.get("with_transactions") == "1":
            drop_pac_trades(db, [r[0] for r in db.execute("SELECT id FROM transactions WHERE recurring_id = ?", (rid,))])
            db.execute("DELETE FROM transactions WHERE recurring_id = ?", (rid,))
        db.execute("DELETE FROM recurring WHERE id = ?", (rid,))
        db.commit()
        return jsonify(ok=True)

    @app.post("/api/recurring/<int:rid>/link")
    def recurring_link(rid):
        """Links transactions already recorded to a recurring item (e.g. deposits made before creating it). With start_date
        it moves the start back: past due dates count as paid and no transaction is generated again."""
        db = get_db()
        own_recurring(rid)
        b = body()
        ids = id_list(b.get("transaction_ids"), "transaction")
        for tid in ids:
            row = db.execute("SELECT account_id FROM transactions WHERE id = ?", (tid,)).fetchone()
            if not row or portfolio_of("accounts", row[0]) != pf():
                raise ApiError(i18n.t("Transaction not found in this space: {tid}", tid=tid))
        start = as_date(b.get("start_date"), "first due date", required=False)
        if start:
            db.execute("UPDATE recurring SET start_date = ? WHERE id = ?", (start, rid))
        if ids:
            db.execute(f"UPDATE transactions SET recurring_id = ? WHERE id IN ({','.join('?' * len(ids))})", (rid, *ids))
        r = dict(db.execute("SELECT * FROM recurring WHERE id = ?", (rid,)).fetchone())
        db.execute("UPDATE recurring SET generated = ? WHERE id = ?", (count_past_occurrences(r), rid))
        db.commit()
        process_recurring(db)
        linked = db.execute("SELECT COUNT(*) FROM transactions WHERE recurring_id = ?", (rid,)).fetchone()[0]
        return jsonify(ok=True, linked=linked, **recurring_view(db.execute("SELECT * FROM recurring WHERE id = ?", (rid,)).fetchone()))

    @app.post("/api/recurring/<int:rid>/reconcile")
    def recurring_reconcile(rid):
        """One flow of money between two spaces = one recurring transfer. For a recurring transfer to an account of
        another space, proposes (dry_run) and then applies only what the user ticked (`choices`: {key: bool}, the rest
        keeps its default):
          per past due date (same money: similar amount, close date, best overall pairing), on the sending side
            link "lnk:<id>": a transfer to that account already recorded and not linked → linked (default on);
            conv "cnv:<id>": an expense of the sending account → becomes the transfer and is linked (default on only
              when its category counts under "Other spaces");
          and on the receiving side, the income of the same due date:
            "del:<id>": the due date is covered by a transfer → the income is the same money twice, deleted (on);
            "inc:<id>": no transfer for that due date → stays an income (default), or becomes the transfer from
              the sending account (the sending balance then goes down: only if that money really left it);
          recurring items for the same money (same frequency, similar amount, close next due date), default on:
            "rec:<id>": a recurring income of the receiving account, a recurring expense of the sending account or
              another recurring transfer between the two → removed (its past transactions stay). The amount of this
              recurring transfer is the one that counts."""
        db = get_db()
        own_recurring(rid)
        b = body()
        r = dict(db.execute("SELECT * FROM recurring WHERE id = ?", (rid,)).fetchone())
        dest = db.execute("SELECT id, name, portfolio_id FROM accounts WHERE id = ?", (r["to_account_id"],)).fetchone() \
            if r["to_account_id"] else None
        if r["kind"] != "transfer" or not dest or dest["portfolio_id"] == pf() or r["holding_id"] or r["installments"]:
            raise ApiError(i18n.t("Only a recurring transfer to an account of another space can be reconciled"))
        days, tol = match_limits(b)
        choices = b.get("choices") or {}
        if not isinstance(choices, dict) or not all(isinstance(v, bool) for v in choices.values()):
            raise ApiError(i18n.t("Invalid request"))
        src, to = r["account_id"], r["to_account_id"]
        today = dt.date.today()
        start, end = dt.date.fromisoformat(r["start_date"]), r["end_date"] and dt.date.fromisoformat(r["end_date"])
        dues = []
        for k in range(2000):  # past due dates (at most ~40 years weekly)
            d = util.occurrence(start, r["frequency"], k)
            if d > today or (end and d > end):
                break
            dues.append({"date": d.isoformat(), "amount": r["amount"]})

        def cost(due, t, extra=0):
            c = same_money(due, t, days, tol)
            return None if c is None else c + extra

        tx_cols = "t.id, t.date, t.amount, t.description, t.kind, t.recurring_id, c.flow"
        sending = [dict(x) for x in db.execute(
            f"""SELECT {tx_cols} FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                WHERE t.account_id = ? AND ((t.kind = 'transfer' AND t.to_account_id = ?
                      AND (t.recurring_id IS NULL OR t.recurring_id = ?))
                   OR (t.kind = 'expense' AND (t.recurring_id IS NULL OR t.recurring_id = ?)))""", (src, to, rid, rid))]
        # already linked transfer first, then a transfer to link or a past payment of this recurring item still recorded
        # as an expense (it was an expense before becoming a transfer), then any other expense to convert
        rank = lambda t: (0 if t["kind"] == "transfer" and t["recurring_id"] == rid  # noqa: E731
                          else 1 if t["kind"] == "transfer" or t["recurring_id"] == rid else 2)
        rows, covered, already = [], set(), 0
        for i, j in util.best_pairs(dues, sending, lambda d, t: cost(d, t, rank(t))):
            t, due = sending[j], dues[i]["date"]
            if rank(t) == 0:
                covered.add(due)
                already += 1
                continue
            key = f"{'lnk' if t['kind'] == 'transfer' else 'cnv'}:{t['id']}"
            # an amount far from the recurring item's (beyond CLOSE %) is shown as different and waits for the user
            diff = far_apart(t["amount"], r["amount"])
            on = choices.get(key, not diff and (t["kind"] == "transfer" or t["flow"] == "other" or t["recurring_id"] == rid))
            rows.append({"key": key, "type": key[:3], "id": t["id"], "date": t["date"], "amount": t["amount"],
                         "description": t["description"], "due": due, "on": on, "flow_other": t["flow"] == "other",
                         "own": t["recurring_id"] == rid, "different": diff})
            if on:
                covered.add(due)
        incomes = [dict(x) for x in db.execute(
            "SELECT id, date, amount, description FROM transactions WHERE account_id = ? AND kind = 'income'", (to,))]
        for i, j in util.best_pairs(dues, incomes, cost):
            t, due = incomes[j], dues[i]["date"]
            key = f"{'del' if due in covered else 'inc'}:{t['id']}"
            diff = far_apart(t["amount"], r["amount"])
            rows.append({"key": key, "type": key[:3], "id": t["id"], "date": t["date"], "amount": t["amount"],
                         "description": t["description"], "due": due, "different": diff,
                         "on": choices.get(key, key[:3] == "del" and not diff)})
        rows.sort(key=lambda x: (x["due"], x["type"]))
        # recurring items for the same money
        cands = [dict(x) for x in db.execute(
            f"""SELECT {REC_COLS}, kind FROM recurring WHERE active AND id != ? AND (
                    (kind = 'income' AND account_id = ?) OR (kind = 'expense' AND account_id = ?)
                 OR (kind = 'transfer' AND account_id = ? AND to_account_id = ?))
                AND NOT expected AND installments IS NULL AND holding_id IS NULL""", (rid, to, src, src, to))]
        recs = [{"key": f"rec:{x['id']}", "type": "rec", "id": x["id"], "name": x["name"], "kind": x["kind"],
                 "amount": x["amount"], "frequency": x["frequency"], "next_date": next_due(x).isoformat(),
                 "different": far_apart(x["amount"], r["amount"]),
                 "on": choices.get(f"rec:{x['id']}", not far_apart(x["amount"], r["amount"]))}
                for x in cands if same_flow(r, x, days, tol) is not None]

        # effect on the reports of both spaces (saved = income + from other spaces − spending − to other spaces)
        on = [x for x in rows if x["on"]]
        cnv = [x for x in on if x["type"] == "cnv"]
        cnv_cat = sum(x["amount"] for x in cnv if not x["flow_other"])  # leave spending for "Other spaces"
        cnv_all = sum(x["amount"] for x in cnv)
        dele = sum(x["amount"] for x in on if x["type"] == "del")
        inc = sum(x["amount"] for x in on if x["type"] == "inc")
        effect = {"spending": -cnv_cat, "to_others": cnv_cat + inc, "source_balance": -inc,
                  "dest_income": -(dele + inc), "dest_from_others": cnv_all + inc, "dest_balance": cnv_all - dele}
        to_space = db.execute("SELECT name FROM portfolios WHERE id = ?", (dest["portfolio_id"],)).fetchone()["name"]
        summary = {"name": r["name"], "amount": r["amount"], "to_account": dest["name"], "to_space": to_space, "dues": len(dues),
                   "linked": already,
                   "rows": rows, "recurring": recs, "effect": effect, "days": days, "tolerance": tol}
        if b.get("dry_run") or not (on or any(x["on"] for x in recs)):
            g.audit_skip = True  # a preview changes nothing: not in the activity log
            return jsonify(dry_run=True, **summary)
        dbm.backup_now("pre-reconcile")
        for x in on:
            if x["type"] == "lnk":
                db.execute("UPDATE transactions SET recurring_id = ? WHERE id = ?", (rid, x["id"]))
            elif x["type"] == "cnv":
                db.execute("""UPDATE transactions SET kind = 'transfer', to_account_id = ?, category_id = NULL,
                              recurring_id = ? WHERE id = ?""", (to, rid, x["id"]))
            elif x["type"] == "del":
                db.execute("DELETE FROM transactions WHERE id = ?", (x["id"],))
            elif x["type"] == "inc":  # the money left the sending account: the income becomes that transfer
                db.execute("""UPDATE transactions SET kind = 'transfer', account_id = ?, to_account_id = ?,
                              category_id = NULL, recurring_id = ? WHERE id = ?""", (src, to, rid, x["id"]))
        removed = [x for x in recs if x["on"]]
        for x in removed:  # its past transactions stay (recurring_id becomes NULL); it never generates again
            db.execute("DELETE FROM recurring WHERE id = ?", (x["id"],))
        db.commit()
        n = lambda t: sum(1 for x in on if x["type"] == t)  # noqa: E731
        note(f"{r['name']} → {dest['name']} · "
             + i18n.tn("{n} transaction", "{n} transactions", n("lnk") + n("cnv") + n("inc"))
             + (" · " + i18n.tn("{n} duplicate removed", "{n} duplicates removed", n("del")) if n("del") else "")
             + (" · " + i18n.tn("{n} recurring item", "{n} recurring items", len(removed)) if removed else ""))
        return jsonify(dry_run=False, **summary)

    @app.post("/api/accounts/<int:aid>/doubles")
    def account_doubles(aid):
        """Money recorded twice in one account: two records in the same direction (both bring money in, or both take it
        out), similar amount, close date (`days` default 3, `tolerance` % default 0), each record in one pair at most,
        the closest pairs first. Typical after mixing recurring items, imports and conversions: an income and a transfer
        for the same money, a transfer generated by a recurring item and the same one entered by hand, the same import
        twice. Per pair the record kept is the most coherent one (a transfer, seen in both spaces, over an income or an
        expense; an imported one over a generated one); the other is deleted, and its recurring link moves to the one
        kept. dry_run shows the pairs and the effect on each account; then only what is ticked (`choices` {key: bool};
        by default the pairs with the same amount)."""
        db = get_db()
        own_account(aid)
        b = body()
        days, tol = b.get("days", 3), b.get("tolerance", 0)
        days, tol = match_limits({"days": days, "tolerance": tol})
        choices = b.get("choices") or {}
        if not isinstance(choices, dict) or not all(isinstance(v, bool) for v in choices.values()):
            raise ApiError(i18n.t("Invalid request"))
        rows = [dict(r) for r in db.execute(
            """SELECT t.id, t.date, t.amount, t.kind, t.account_id, t.to_account_id, t.description, t.source,
                      t.recurring_id, a.name AS account_name, ta.name AS to_account_name, pa.name AS space,
                      tp.name AS to_space
               FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN portfolios pa ON pa.id = a.portfolio_id
               LEFT JOIN accounts ta ON ta.id = t.to_account_id LEFT JOIN portfolios tp ON tp.id = ta.portfolio_id
               WHERE t.account_id = ? OR t.to_account_id = ? ORDER BY t.date, t.id""", (aid, aid))]
        inflow = [t for t in rows if (t["kind"] == "income" and t["account_id"] == aid)
                  or (t["kind"] == "transfer" and t["to_account_id"] == aid)]
        outflow = [t for t in rows if (t["kind"] == "expense" and t["account_id"] == aid)
                   or (t["kind"] == "transfer" and t["account_id"] == aid)]

        def score(t):  # the record to keep: a transfer (seen in both spaces), then an imported one, then a linked one
            return (t["kind"] == "transfer") * 4 + (t["source"] == "import") * 2 + (t["recurring_id"] is not None), -t["id"]

        pairs = []
        for direction, group in (("in", inflow), ("out", outflow)):
            cands = []
            for k, x in enumerate(group):
                for y in group[k + 1:]:
                    if x["kind"] == y["kind"] == "transfer" and x["recurring_id"] and x["recurring_id"] == y["recurring_id"] \
                            and x["date"] != y["date"]:
                        continue  # two due dates of the same recurring item, not a double
                    c = same_money(x, y, days, tol)
                    if c is not None:
                        cands.append((c, x["id"], y["id"], x, y))
            used = set()
            for _, _, _, x, y in sorted(cands, key=lambda z: z[:3]):
                if x["id"] in used or y["id"] in used:
                    continue
                used |= {x["id"], y["id"]}
                keep, drop = (x, y) if score(x) >= score(y) else (y, x)
                key = f"dbl:{drop['id']}:{keep['id']}"
                default = keep["amount"] == drop["amount"]
                pairs.append({"key": key, "direction": direction, "keep": keep, "drop": drop,
                              "different": keep["amount"] != drop["amount"], "on": choices.get(key, default)})
        pairs.sort(key=lambda p: p["drop"]["date"])
        # effect on the balances: a deleted record gives back (or takes back) its amount on each account it touched
        effect = {}
        for p in (p for p in pairs if p["on"]):
            d = p["drop"]
            if d["kind"] == "transfer":
                effect[d["account_id"]] = effect.get(d["account_id"], 0) + d["amount"]
                effect[d["to_account_id"]] = effect.get(d["to_account_id"], 0) - d["amount"]
            else:
                effect[d["account_id"]] = effect.get(d["account_id"], 0) + (-d["amount"] if d["kind"] == "income" else d["amount"])
        names = {t["account_id"]: (t["account_name"], t["space"]) for t in rows}
        names.update({t["to_account_id"]: (t["to_account_name"], t["to_space"]) for t in rows if t["to_account_id"]})
        acc = db.execute("SELECT name FROM accounts WHERE id = ?", (aid,)).fetchone()
        summary = {"account": acc["name"], "pairs": pairs, "days": days, "tolerance": tol,
                   "effect": [{"account_id": k, "name": names[k][0], "space": names[k][1], "delta": v}
                              for k, v in effect.items() if v]}
        on = [p for p in pairs if p["on"]]
        if b.get("dry_run") or not on:
            g.audit_skip = True  # a preview changes nothing: not in the activity log
            return jsonify(dry_run=True, **summary)
        dbm.backup_now("pre-doubles")
        for p in on:
            keep, drop = p["keep"], p["drop"]
            if drop["recurring_id"] and not keep["recurring_id"]:  # the due date stays paid, by the record kept
                db.execute("UPDATE transactions SET recurring_id = ? WHERE id = ?", (drop["recurring_id"], keep["id"]))
            db.execute("DELETE FROM transactions WHERE id = ?", (drop["id"],))
        db.commit()
        note(f"{acc['name']} · " + i18n.tn("{n} duplicate removed", "{n} duplicates removed", len(on)))
        return jsonify(dry_run=False, removed=len(on), **summary)

    def auto_backups():
        """The automatic backups (newest first): at start, periodic, before bulk changes, by hand."""
        return [{"name": b["name"], "at": b["at"].isoformat(timespec="minutes"), "reason": b["reason"], "size": b["size"],
                 "default_folder": b["default_folder"]} for b in dbm.list_backups()]

    # ------------------------------------------------------- backups: settings, by hand, compare, put back
    # (all under /api/backup…: never reachable with the temporary import code)

    def same_row(a, b):
        """Is a transaction with the same id in a backup and now the same one (edited or not)? SQLite may give the id
        of a deleted transaction to a new one: same creation time (to the second), type and accounts, and at least one
        of description, amount and date unchanged."""
        return (a.get("created_at") == b.get("created_at")
                and all(a[k] == b[k] for k in ("kind", "account_id", "to_account_id"))
                and any(a[k] == b[k] for k in ("description", "amount", "date")))

    _sched = {"checked": 0.0}

    @app.before_request
    def scheduled_backup():
        """Periodic backup (daily or weekly, if chosen): checked at most every 10 minutes while HomeCoin is unlocked."""
        if dbm._key is None or time.time() - _sched["checked"] < 600:
            return None
        _sched["checked"] = time.time()
        try:
            if dbm.scheduled_backup_due():
                dbm.backup_now("scheduled", force=True)
        except Exception:  # a backup problem never blocks the app; it shows in Settings
            pass
        return None

    @app.get("/api/backup-settings")
    def backup_settings_get():
        s = dbm.backup_settings()
        folder, fallback = dbm.backup_dir()
        return jsonify(settings=s, folder=str(folder), default_folder=str(dbm.BACKUP_DIR), fallback=fallback,
                       triggers=list(dbm.BACKUP_TRIGGERS), backups=auto_backups())

    @app.put("/api/backup-settings")
    def backup_settings_put():
        b, s = body(), dbm.backup_settings()
        if "on_start" in b:
            s["on_start"] = bool(b["on_start"])
        if "every" in b:
            if b["every"] not in dbm.BACKUP_EVERY:
                raise ApiError(i18n.t("Invalid request"))
            s["every"] = b["every"]
        if "keep" in b:
            keep = b["keep"]
            if isinstance(keep, bool) or not isinstance(keep, int) or not 3 <= keep <= 200:
                raise ApiError(i18n.t("Keep between 3 and 200 backups"))
            s["keep"] = keep
        if "triggers" in b:
            t = b["triggers"]
            if not isinstance(t, dict) or not all(k in dbm.BACKUP_TRIGGERS and isinstance(v, bool) for k, v in t.items()):
                raise ApiError(i18n.t("Invalid request"))
            s["triggers"].update(t)
        if "dir" in b:
            d = as_text(b.get("dir"), 400).strip()
            if d:
                p = Path(d)
                if not p.is_absolute():
                    raise ApiError(i18n.t("Write the full path of the folder (for example D:\\Backup\\HomeCoin)"))
                try:
                    p.mkdir(parents=True, exist_ok=True)
                    (p / ".hc-write-test").write_bytes(b"")
                    (p / ".hc-write-test").unlink()
                except OSError:
                    raise ApiError(i18n.t("HomeCoin cannot write in this folder"))
            s["dir"] = d
        dbm.save_backup_settings(s)
        note(i18n.t("Backup settings changed"))
        return backup_settings_get()

    @app.post("/api/backup-now")
    def backup_by_hand():
        target = dbm.backup_now("manual", force=True)
        return jsonify(ok=True, name=target.name if target else None, backups=auto_backups())

    @app.post("/api/backup-folder/open")
    def backup_folder_open():
        """Opens the backup folder in the file manager of this PC (HomeCoin runs only on this PC)."""
        folder, _ = dbm.backup_dir()
        folder.mkdir(parents=True, exist_ok=True)
        if hasattr(os, "startfile"):
            os.startfile(str(folder))  # noqa: S606 - a local folder chosen by the user
        g.audit_skip = True
        return jsonify(ok=True, folder=str(folder))

    # what a backup can put back, row by row: name → (columns of identity shown, rows that must exist first)
    RESTORABLE = {
        "accounts": ("name", {"portfolio_id": "portfolios"}),
        "categories": ("name", {"portfolio_id": "portfolios"}),
        "rules": ("pattern", {"category_id": "categories"}),
        "recurring": ("name", {"account_id": "accounts", "to_account_id": "accounts"}),
        "transactions": ("description", {"account_id": "accounts", "to_account_id": "accounts"}),
    }

    def backup_rows(path):
        conn = dbm.connect(path=path)
        try:
            return {t: {r["id"]: dict(r) for r in conn.execute(f"SELECT * FROM {t}")} for t in RESTORABLE}
        finally:
            conn.close()

    @app.post("/api/backups/compare")
    def backups_compare():
        """Differences between an automatic backup and the current data, for accounts, categories, rules, recurring
        items and transactions: deleted since then (can be put back), changed (can be taken back to how they were),
        added. All the spaces: a backup is of the whole database."""
        b, db = body(), get_db()
        path = dbm.find_backup(b.get("backup"))
        if not path:
            raise ApiError(i18n.t("Backup not found"), 404)
        old = backup_rows(path)
        names = {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM accounts")}
        names.update({r["id"]: r["name"] for t, rows in [("accounts", old["accounts"])] for r in rows.values()})
        out = {}
        for t, (label, _) in RESTORABLE.items():
            now = {r["id"]: dict(r) for r in db.execute(f"SELECT * FROM {t}")}
            ignore = {"created_at", "updated_at", "generated", "last_used"}
            # SQLite may give the id of a deleted row to a new one: the same id is the same row only if it was created
            # at the same moment (an edit keeps created_at), else it is "deleted + added"
            same = {i for i in old[t] if i in now and (same_row(old[t][i], now[i]) if t == "transactions"
                                                        else old[t][i].get("created_at") == now[i].get("created_at"))}

            def show(r):
                x = {"id": r["id"], "label": r.get(label) or "", "date": r.get("date") or r.get("start_date"),
                     "amount": r.get("amount"), "kind": r.get("kind"), "account": names.get(r.get("account_id")),
                     "to_account": names.get(r.get("to_account_id"))}
                return x

            changed = []
            for i in sorted(same):
                diff = [k for k in old[t][i] if k not in ignore and k in now[i] and old[t][i][k] != now[i][k]]
                if diff:
                    changed.append({"before": show(old[t][i]), "after": show(now[i]), "fields": diff})
            out[t] = {"deleted": [show(r) for i, r in old[t].items() if i not in same],
                      "changed": changed, "added": [show(r) for i, r in now.items() if i not in same]}
            for k in ("deleted", "added"):
                out[t][k].sort(key=lambda x: str(x["date"] or ""))
        g.audit_skip = True  # a comparison changes nothing
        return jsonify(backup=b.get("backup"), tables=out)

    @app.post("/api/backups/put-back")
    def backups_put_back():
        """Puts back rows deleted since an automatic backup (`put_back` {table: [ids]}) and takes changed rows back to
        how they were (`revert` {table: [ids]}). Rows whose account (or space, category) no longer exists are skipped
        and reported; optional links that no longer exist are emptied. A copy of the current data is saved first."""
        b, db = body(), get_db()
        path = dbm.find_backup(b.get("backup"))
        if not path:
            raise ApiError(i18n.t("Backup not found"), 404)
        put, rev = b.get("put_back") or {}, b.get("revert") or {}
        for d in (put, rev):
            if not isinstance(d, dict) or not all(k in RESTORABLE for k in d):
                raise ApiError(i18n.t("Invalid request"))
        put = {t: set(int_list(v)) for t, v in put.items()}
        rev = {t: set(int_list(v)) for t, v in rev.items()}
        if not any(put.values()) and not any(rev.values()):
            raise ApiError(i18n.t("Tick at least one row"))
        old = backup_rows(path)
        dbm.backup_now("pre-restore-tx", force=True)
        done, skipped = 0, 0
        optional = {"category_id": "categories", "recurring_id": "recurring", "holding_id": "holdings", "person_id": "people"}
        for t, (_, needed) in RESTORABLE.items():  # parents first: accounts and categories before what points to them
            cols = [r[1] for r in db.execute(f"PRAGMA table_info({t})")]
            for i in sorted(put.get(t, set()) | rev.get(t, set())):
                row = old[t].get(i)
                if not row:
                    continue
                row = {k: v for k, v in row.items() if k in cols}
                exists = lambda table, v: v is None or db.execute(f"SELECT 1 FROM {table} WHERE id = ?", (v,)).fetchone()  # noqa: E731
                if not all(exists(tab, row.get(col)) for col, tab in needed.items()):
                    skipped += 1
                    continue
                for col, tab in optional.items():
                    if col in row and not exists(tab, row[col]):
                        row[col] = None
                current = db.execute(f"SELECT 1 FROM {t} WHERE id = ?", (i,)).fetchone()
                if i in rev.get(t, set()) and current:
                    keep = {k: v for k, v in row.items() if k != "id"}
                    db.execute(f"UPDATE {t} SET {', '.join(f'{k} = ?' for k in keep)} WHERE id = ?", (*keep.values(), i))
                else:
                    if current:
                        row.pop("id")  # the id was reused meanwhile: a new one
                    db.execute(f"INSERT INTO {t} ({','.join(row)}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
                done += 1
        db.commit()
        note(i18n.tn("{n} row put back from a backup", "{n} rows put back from a backup", done) + f" · {b.get('backup')}")
        return jsonify(ok=True, done=done, skipped=skipped)

    @app.post("/api/backups/restore-all")
    def backups_restore_all():
        """Replaces all the data with an automatic backup (a copy of the current data is saved first)."""
        b = body()
        path = dbm.find_backup(b.get("backup"))
        if not path:
            raise ApiError(i18n.t("Backup not found"), 404)
        conn = dbm.connect(path=path)
        try:
            payload = {t: [dict(r) for r in conn.execute(f"SELECT * FROM {t}")] for t in TABLES}
        finally:
            conn.close()
        note(b.get("backup"))
        return restore_payload(payload)

    @app.get("/api/backups/auto")
    @app.get("/api/auto-backups")  # names and times only: not under /api/backup, which the import code may not use
    def backups_auto():
        return jsonify(auto_backups())

    @app.post("/api/accounts/<int:aid>/compare-backup")
    def account_compare_backup(aid):
        """What changed in one account since an automatic backup: the transactions deleted since then (they can be put
        back, one by one: `restore_ids`), the ones changed and the ones added, with the effect on the balance. For
        mistakes such as deleting a real transaction while cleaning up doubles. dry_run=true only compares."""
        db = get_db()
        own_account(aid)
        b = body()
        name = b.get("backup")
        if not isinstance(name, str) or not dbm.find_backup(name):  # only a listed file: never a path
            raise ApiError(i18n.t("Backup not found"), 404)
        restore = set(int_list(b.get("restore_ids")))
        cols = "id, date, amount, kind, account_id, to_account_id, category_id, description, notes, recurring_id, source, excluded, created_at"
        q = f"SELECT {cols} FROM transactions WHERE account_id = ? OR to_account_id = ?"
        old_db = dbm.connect(path=dbm.find_backup(name))
        try:
            old = {r["id"]: dict(r) for r in old_db.execute(q, (aid, aid))}
        finally:
            old_db.close()
        now = {r["id"]: dict(r) for r in db.execute(q, (aid, aid))}

        def effect(t):  # what the record does to this account's balance
            inflow = t["kind"] == "income" or (t["kind"] == "transfer" and t["to_account_id"] == aid)
            return t["amount"] if inflow else -t["amount"]

        names = {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM accounts")}

        def label(t):
            return {**t, "effect": effect(t), "account_name": names.get(t["account_id"]),
                    "to_account_name": names.get(t["to_account_id"])}

        keys = ("date", "amount", "kind", "account_id", "to_account_id", "description")
        # the same id is the same transaction only if its type and accounts are the same: SQLite may give the id of a
        # deleted transaction to a new one, which is then "deleted + added", not "changed"
        same = {i for i in old if i in now and same_row(old[i], now[i])}
        deleted = [label(t) for i, t in sorted(old.items(), key=lambda x: x[1]["date"]) if i not in same]
        changed = [{"before": label(old[i]), "after": label(now[i])} for i in sorted(same, key=lambda i: now[i]["date"])
                   if any(old[i][k] != now[i][k] for k in keys)]
        added = [label(t) for i, t in sorted(now.items(), key=lambda x: x[1]["date"]) if i not in same]
        bal_now = sum(effect(t) for t in now.values())
        bal_old = sum(effect(t) for t in old.values())
        summary = {"backup": name, "deleted": deleted, "changed": changed, "added": added,
                   "difference": bal_now - bal_old}
        todo = [t for t in deleted if t["id"] in restore]
        if b.get("dry_run") or not todo:
            g.audit_skip = True  # a comparison changes nothing: not in the activity log
            return jsonify(dry_run=True, **summary)
        dbm.backup_now("pre-restore-tx")
        accounts = {r["id"] for r in db.execute("SELECT id FROM accounts")}
        cats = {r["id"] for r in db.execute("SELECT id FROM categories")}
        recs = {r["id"] for r in db.execute("SELECT id FROM recurring")}
        put_back = 0
        for t in todo:
            if t["account_id"] not in accounts or (t["to_account_id"] and t["to_account_id"] not in accounts):
                continue  # its account no longer exists
            row = {k: old[t["id"]][k] for k in cols.split(", ")}
            row["category_id"] = row["category_id"] if row["category_id"] in cats else None
            row["recurring_id"] = row["recurring_id"] if row["recurring_id"] in recs else None
            if db.execute("SELECT 1 FROM transactions WHERE id = ?", (row["id"],)).fetchone():
                row.pop("id")  # the id was reused meanwhile: a new one
            db.execute(f"INSERT INTO transactions ({','.join(row)}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
            put_back += 1
        db.commit()
        note(i18n.tn("{n} transaction restored", "{n} transactions restored", put_back) + f" · {name}")
        return jsonify(dry_run=False, restored=put_back, **summary)

    @app.post("/api/recurring/run")
    def recurring_run():
        return jsonify(created=process_recurring(get_db()))

    @app.get("/api/upcoming")
    def upcoming_list():
        days = min(as_int(request.args.get("days") or 60, "days", minimum=1), 730)
        return jsonify(upcoming(get_db(), days, portfolio_id=pf()))

    @app.get("/api/calendar")
    def calendar():
        """Upcoming payments of the next months that affect the space (including transfers coming from other spaces) and
        projected cash: today's balance of the non-investment accounts + effect of each payment on those accounts."""
        db, p = get_db(), pf()
        months = min(as_int(request.args.get("months") or 3, "months", minimum=1), 12)
        today = dt.date.today()
        end = add_months(today.replace(day=1), months) - dt.timedelta(days=1)
        accs = account_balances(db, p)
        mine = {a["id"] for a in accs}
        cash = {a["id"] for a in accs if a["type"] != tools.INVEST and not a["archived"]}
        names = {r[0]: r[1] for r in db.execute("SELECT id, name FROM accounts")}
        items = []
        # confirmed: normal recurring items · estimated: expected recurring items (variable amount/date) and regular income from history
        estimates = [*forecast.regular_flows(db, sorted(cash), today, end, "income"),
                     *forecast.regular_flows(db, sorted(cash), today, end, "expense")]
        for u in [*upcoming(db, (end - today).days, today), *estimates]:
            src, dst = u["account_id"], u["to_account_id"]
            if src not in mine and dst not in mine:
                continue
            if u["kind"] == "transfer":
                effect = (u["amount"] if dst in cash else 0) - (u["amount"] if src in cash else 0)
            else:
                effect = (u["amount"] if u["kind"] == "income" else -u["amount"]) if src in cash else 0
            items.append({**u, "effect": effect, "account_name": u.get("account_name") or names.get(src),
                          "to_account_name": names.get(dst), "incoming": src not in mine, "estimated": bool(u.get("estimated"))})
        items.sort(key=lambda x: (x["date"], x["estimated"]))
        start = sum(a["balance"] for a in accs if a["id"] in cash)
        return jsonify(today=today.isoformat(), end=end.isoformat(), months=months, start_liquidity=start, items=items,
                       history_months=forecast.HISTORY_MONTHS, regular_min=forecast.REGULAR_MIN)

    # -------------------------------------------------------- statistics

    @app.get("/api/stats")
    def stats():
        db = get_db()
        args = request.args
        p = pf()
        acc = as_int(args.get("account_id"), "account", required=False)
        if acc:
            own_account(acc)
        d_from = as_date(args.get("from"), required=False)
        d_to = as_date(args.get("to"), required=False)
        first, last = db.execute(f"SELECT MIN(date), MAX(date) FROM transactions WHERE account_id IN {PF_ACCOUNTS}",
                                 (p,)).fetchone()
        today = dt.date.today().isoformat()
        d_from = d_from or first or today
        d_to = d_to or max(today, last or today)

        where = "t.date BETWEEN ? AND ?"
        params = [d_from, d_to]
        if acc:
            where += " AND t.account_id = ?"
            params.append(acc)
        else:
            where += f" AND t.account_id IN {PF_ACCOUNTS}"
            params.append(p)
        excluded = db.execute(f"SELECT COUNT(*) FROM transactions t WHERE {where} AND t.excluded",
                              params).fetchone()[0]
        where += " AND NOT t.excluded"  # the balance (calculated separately) includes them anyway

        # expenses in "contribution to other spaces" categories are not spending: they go with the transfers to other spaces
        spend = f"kind='expense' AND {NOT_OTHER}"
        tot = db.execute(
            f"""SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount END),0) AS income,
                       COALESCE(SUM(CASE WHEN {spend} THEN amount END),0) AS expense,
                       COALESCE(SUM(CASE WHEN kind='expense' AND NOT ({NOT_OTHER}) THEN amount END),0) AS other_cat,
                       COUNT(*) AS n
                FROM transactions t WHERE {where}""", params).fetchone()

        by_cat = {}
        for kind in ("expense", "income"):
            by_cat[kind] = [dict(r) for r in db.execute(
                f"""SELECT t.category_id AS id, COALESCE(c.name, 'Uncategorized') AS name,
                           COALESCE(c.color, '#cbd5e1') AS color, COALESCE(c.icon, '❔') AS icon,
                           COALESCE(c.budget, 0) AS budget, SUM(t.amount) AS total, COUNT(*) AS n
                    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                    WHERE {where} AND t.kind = ? {f'AND {NOT_OTHER}' if kind == 'expense' else ''}
                    GROUP BY t.category_id ORDER BY total DESC""", (*params, kind))]
            for r in by_cat[kind]:
                if r["id"] is None:
                    r["name"] = i18n.t("Uncategorized")

        by_month = [dict(r) for r in db.execute(
            f"""SELECT substr(t.date,1,7) AS month,
                       COALESCE(SUM(CASE WHEN kind='income' THEN amount END),0) AS income,
                       COALESCE(SUM(CASE WHEN {spend} THEN amount END),0) AS expense,
                       COALESCE(SUM(CASE WHEN kind='expense' AND NOT ({NOT_OTHER}) THEN amount END),0) AS to_others
                FROM transactions t WHERE {where} GROUP BY month ORDER BY month""", params)]

        # month-end balance (all accounts or the selected account)
        if acc:
            signed = """CASE WHEN t.account_id = :a AND t.kind = 'income' THEN t.amount
                             WHEN t.account_id = :a THEN -t.amount
                             WHEN t.to_account_id = :a THEN t.amount ELSE 0 END"""
            initial = db.execute("SELECT initial_balance FROM accounts WHERE id=?", (acc,)).fetchone()
            initial = initial[0] if initial else 0
            flt = "WHERE (t.account_id = :a OR t.to_account_id = :a)"
        else:
            # net worth of the space: internal transfers cancel out, those to/from other spaces don't
            P = "(SELECT id FROM accounts WHERE portfolio_id = :p)"
            signed = f"""CASE WHEN t.account_id IN {P} THEN
                              CASE t.kind WHEN 'income' THEN t.amount WHEN 'expense' THEN -t.amount
                                   ELSE CASE WHEN t.to_account_id IN {P} THEN 0 ELSE -t.amount END END
                              WHEN t.to_account_id IN {P} THEN t.amount ELSE 0 END"""
            initial = db.execute("SELECT COALESCE(SUM(initial_balance),0) FROM accounts WHERE portfolio_id = ?",
                                 (p,)).fetchone()[0]
            flt = f"WHERE t.account_id IN {P} OR t.to_account_id IN {P}"
        monthly = db.execute(
            f"SELECT substr(t.date,1,7) AS m, SUM({signed}) AS v FROM transactions t {flt} GROUP BY m ORDER BY m",
            {"a": acc, "p": p}).fetchall()
        running, series, cum = initial, [], {}
        for r in monthly:
            running += r["v"]
            cum[r["m"]] = running
        start_d, end_d = parse_date(d_from), parse_date(d_to)
        y, m = start_d.year, start_d.month
        bal = initial + sum(r["v"] for r in monthly if r["m"] < f"{y:04d}-{m:02d}")
        # investment accounts: market value (cash + securities or latest valuation) instead of just the amount invested
        has_inv = db.execute(f"SELECT 1 FROM accounts WHERE type = ? AND id IN {PF_ACCOUNTS}" + (" AND id = ?" if acc else "") + " LIMIT 1",
                             (tools.INVEST, p, *([acc] if acc else []))).fetchone()
        inv_adj = (lambda when: tools.invest_adjustment(db, p, when, acc)) if has_inv else (lambda when: 0)
        while (y, m) <= (end_d.year, end_d.month) and len(series) < 600:
            key = f"{y:04d}-{m:02d}"
            bal = cum.get(key, bal)
            month_end = min(tools.month_end(key), dt.date.today())
            series.append({"month": key, "balance": bal + inv_adj(month_end)})
            m += 1
            if m > 12:
                y, m = y + 1, 1
        balance_now = running + inv_adj(dt.date.today())

        top = [dict(r) for r in db.execute(
            f"""{TX_SELECT} WHERE {where} AND t.kind = 'expense' AND {NOT_OTHER} ORDER BY t.amount DESC LIMIT 6""", params)]

        # transfers exchanged with other spaces in the period (not income/expenses, but they move net worth)
        # (like the rest of the dashboard: without the transactions excluded from reports and, if chosen, only for the given account)
        acc_flt = " AND (t.account_id = ? OR t.to_account_id = ?)" if acc else ""
        cross = db.execute(
            f"""SELECT COALESCE(SUM(CASE WHEN t.to_account_id IN {PF_ACCOUNTS} THEN t.amount END), 0),
                       COALESCE(SUM(CASE WHEN t.account_id IN {PF_ACCOUNTS} THEN t.amount END), 0)
                FROM transactions t WHERE t.kind = 'transfer' AND NOT t.excluded AND t.date BETWEEN ? AND ?
                AND ((t.to_account_id IN {PF_ACCOUNTS} AND t.account_id NOT IN {PF_ACCOUNTS})
                  OR (t.account_id IN {PF_ACCOUNTS} AND t.to_account_id NOT IN {PF_ACCOUNTS})){acc_flt}""",
            (p, p, d_from, d_to, p, p, p, p, *([acc, acc] if acc else []))).fetchone()
        # transfers to other spaces month by month: in the chart they sit in the expenses bar, separate from spending
        # (and the ones received, which count in the month's savings as in "saved")
        months_idx = {r["month"]: {**r, "from_others": 0} for r in by_month}
        for mo, out_v, in_v in db.execute(
                f"""SELECT substr(t.date,1,7),
                           COALESCE(SUM(CASE WHEN t.account_id IN {PF_ACCOUNTS} THEN t.amount END), 0),
                           COALESCE(SUM(CASE WHEN t.to_account_id IN {PF_ACCOUNTS} THEN t.amount END), 0)
                    FROM transactions t WHERE t.kind = 'transfer' AND NOT t.excluded AND t.date BETWEEN ? AND ?
                    AND ((t.account_id IN {PF_ACCOUNTS} AND t.to_account_id NOT IN {PF_ACCOUNTS})
                      OR (t.to_account_id IN {PF_ACCOUNTS} AND t.account_id NOT IN {PF_ACCOUNTS})){acc_flt}
                    GROUP BY 1""", (p, p, d_from, d_to, p, p, p, p, *([acc, acc] if acc else []))):
            r = months_idx.setdefault(mo, {"month": mo, "income": 0, "expense": 0, "to_others": 0, "from_others": 0})
            r["to_others"] += out_v
            r["from_others"] += in_v
        by_month = sorted(months_idx.values(), key=lambda r: r["month"])

        return jsonify(
            from_=d_from, to=d_to, months=months_between(start_d, end_d),
            income=tot["income"], expense=tot["expense"], count=tot["n"],
            by_category=by_cat, by_month=by_month, balance_series=series,
            balance_now=balance_now, top_expenses=top, excluded=excluded,
            transfers_in=cross[0], transfers_out=cross[1] + tot["other_cat"], other_categories=tot["other_cat"],
            # savings = surplus: income (and transfers received from other spaces) − spending − contributions to other spaces
            saved=tot["income"] + cross[0] - tot["expense"] - cross[1] - tot["other_cat"],
        )

    @app.get("/api/report")
    def report():
        """Category x month statement over a calendar year (year) or a custom range (from/to)."""
        db = get_db()
        p = pf()
        years = [r[0] for r in db.execute(
            f"SELECT DISTINCT substr(date,1,4) FROM transactions WHERE account_id IN {PF_ACCOUNTS} ORDER BY 1 DESC", (p,))]
        if request.args.get("all") == "1":  # the whole history
            first, last = db.execute(f"SELECT MIN(date), MAX(date) FROM transactions WHERE account_id IN {PF_ACCOUNTS}",
                                     (p,)).fetchone()
            today = dt.date.today().isoformat()
            d_from, d_to = (first or today)[:8] + "01", max(last or today, today)
        elif request.args.get("from") and request.args.get("to"):
            d_from, d_to = as_date(request.args["from"], "from"), as_date(request.args["to"], "to")
            if d_to < d_from:
                raise ApiError(i18n.t("The period is not valid"))
        else:
            year = request.args.get("year") or (years[0] if years else str(dt.date.today().year))
            if not (year.isascii() and year.isdigit() and len(year) == 4 and year >= "1900"):
                raise ApiError(i18n.t("Invalid year"))
            d_from, d_to = f"{year}-01-01", f"{year}-12-31"
        start, end = parse_date(d_from), parse_date(d_to)
        if start < add_months(end.replace(day=1), -119):  # at most 10 years in a report (the columns are the months)
            start = add_months(end.replace(day=1), -119)
            d_from = start.isoformat()
        months, y, m = [], start.year, start.month
        while (y, m) <= (end.year, end.month) and len(months) < 120:
            months.append(f"{y:04d}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        col = {k: i for i, k in enumerate(months)}
        out = {"from": d_from, "to": d_to, "year": d_from[:4], "years": years or [d_from[:4]], "months": months,
               "excluded": db.execute(f"SELECT COUNT(*) FROM transactions WHERE excluded AND date BETWEEN ? AND ? "
                                      f"AND account_id IN {PF_ACCOUNTS}", (d_from, d_to, p)).fetchone()[0]}
        for kind in ("expense", "income", "other"):  # other = contributions to other spaces (dedicated categories)
            rows = {}
            flt = {"expense": f"AND {NOT_OTHER}", "income": "", "other": f"AND NOT ({NOT_OTHER})"}[kind]
            for r in db.execute(
                """SELECT t.category_id AS id, COALESCE(c.name,'Uncategorized') AS name,
                          COALESCE(c.color,'#cbd5e1') AS color, COALESCE(c.icon,'❔') AS icon,
                          substr(t.date,1,7) AS ym, SUM(t.amount) AS v
                   FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                   WHERE t.kind = ? AND t.date BETWEEN ? AND ? AND NOT t.excluded AND t.account_id IN {PF_ACCOUNTS} {FLT}
                   GROUP BY t.category_id, ym""".replace("{PF_ACCOUNTS}", PF_ACCOUNTS).replace("{FLT}", flt),
                    ("income" if kind == "income" else "expense", d_from, d_to, p)):
                row = rows.setdefault(r["id"], {"id": r["id"], "name": r["name"] if r["id"] is not None else i18n.t("Uncategorized"), "color": r["color"],
                                                "icon": r["icon"], "months": [0] * len(months), "total": 0})
                row["months"][col[r["ym"]]] = r["v"]
                row["total"] += r["v"]
            if kind == "other":  # also the transfers to accounts of other spaces, one row per destination space
                for r in db.execute(
                        f"""SELECT tp.id, tp.name, tp.icon, tp.color, substr(t.date,1,7) AS ym, SUM(t.amount) AS v
                            FROM transactions t JOIN accounts ta ON ta.id = t.to_account_id JOIN portfolios tp ON tp.id = ta.portfolio_id
                            WHERE t.kind = 'transfer' AND NOT t.excluded AND t.date BETWEEN ? AND ?
                            AND t.account_id IN {PF_ACCOUNTS} AND tp.id != ? GROUP BY tp.id, ym""", (d_from, d_to, p, p)):
                    row = rows.setdefault(f"gc:{r['id']}", {"id": None, "transfer": True, "name": i18n.t("Transfers to {name}", name=r['name']),
                                                            "color": r["color"], "icon": r["icon"], "months": [0] * len(months), "total": 0})
                    row["months"][col[r["ym"]]] = r["v"]
                    row["total"] += r["v"]
            lst = sorted(rows.values(), key=lambda x: -x["total"])
            out[kind] = {"rows": lst, "months": [sum(r["months"][i] for r in lst) for i in range(len(months))],
                         "total": sum(r["total"] for r in lst)}
        # transfers received from other spaces: not income, but they count in savings (as on the dashboard)
        out["transfers_in"] = db.execute(
            f"""SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.kind = 'transfer' AND NOT t.excluded
                AND t.date BETWEEN ? AND ? AND t.to_account_id IN {PF_ACCOUNTS} AND t.account_id NOT IN {PF_ACCOUNTS}""",
            (d_from, d_to, p, p)).fetchone()[0]
        return jsonify(out)

    # ------------------------------------------------- fair split

    def family_only():
        pf()  # fair split available in every space that enables the tab

    def split_state():
        db = get_db()
        p = pf()
        people = [dict(r) for r in db.execute("SELECT * FROM people WHERE portfolio_id = ? ORDER BY position, id", (p,))]
        settings = dict(splitm.DEFAULTS)
        settings.update({r["key"].split("@")[0]: r["value"] for r in db.execute(
            "SELECT key, value FROM settings WHERE key LIKE ?", (f"split_%@{p}",))})
        rules = [dict(r) for r in db.execute(
            "SELECT id, name, icon, color, split FROM categories WHERE kind = 'expense' AND portfolio_id = ? ORDER BY name", (p,))]
        accounts = [dict(r) for r in db.execute(
            "SELECT id, name, color FROM accounts WHERE portfolio_id = ? AND NOT archived ORDER BY id", (p,))]
        return {"people": people, "settings": settings, "rules": rules, "accounts": accounts,
                "result": splitm.compute(db, people, settings, p)}

    @app.get("/api/split")
    def split_get():
        family_only()
        return jsonify(split_state())

    @app.put("/api/split")
    def split_put():
        family_only()
        b = body()
        db = get_db()
        cur_pf = pf()
        people = b.get("people")
        if isinstance(people, list):
            if len(people) > 10:
                raise ApiError(i18n.t("At most 10 people"))
            keep = []
            for pos, p in enumerate(people):
                name = as_text(as_dict(p, "person").get("name"), 40)
                if not name:
                    raise ApiError(i18n.t("Each person must have a name"))
                vals = (name, as_int(p.get("income") or 0, "income", minimum=0), as_text(p.get("keyword"), 40), pos)
                person_id = as_int(p.get("id"), "id", required=False)
                if person_id and portfolio_of("people", person_id) == cur_pf:
                    db.execute("UPDATE people SET name=?, income=?, keyword=?, position=? WHERE id=?", (*vals, person_id))
                else:
                    person_id = db.execute("INSERT INTO people(name, income, keyword, position, portfolio_id) VALUES (?,?,?,?,?)",
                                           (*vals, cur_pf)).lastrowid
                keep.append(person_id)
            marks = ",".join("?" * len(keep)) or "NULL"
            db.execute(f"DELETE FROM people WHERE portfolio_id = ? AND id NOT IN ({marks})", (cur_pf, *keep))
        for k, v in as_dict(b.get("settings"), "settings").items():
            if k not in splitm.DEFAULTS:
                continue
            if k == "split_base":
                if v not in splitm.BASES:
                    raise ApiError(i18n.t("Invalid calculation basis"))
            elif k == "split_manual":
                v = json.dumps(splitm.clean_manual(v, {a["id"] for a in db.execute(
                    "SELECT id FROM accounts WHERE portfolio_id = ?", (cur_pf,))}), ensure_ascii=False)
            elif k == "split_months":  # whole months (or 'all' = the whole history): an odd value would break the page
                if v != "all" and str(v) not in ("1", "2", "3", "4", "5", "6", "9", "12", "18", "24", "36"):
                    raise ApiError(i18n.t("Invalid averaging period"))
            else:
                try:
                    if isinstance(v, bool):  # float(True) = 1.0, but "True" would be saved and break the calculation
                        raise TypeError
                    f = float(v)
                except (TypeError, ValueError):
                    raise ApiError(i18n.t("Invalid value: {k}", k=k))
                if f != f or f in (float("inf"), float("-inf")) or f < 0 or f > 10 ** 9:
                    raise ApiError(i18n.t("Invalid value: {k}", k=k))
            db.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                       (f"{k}@{cur_pf}", str(v)))
        for cid, rule in as_dict(b.get("rules"), "split rules").items():
            if as_key(rule) not in splitm.RULES:
                raise ApiError(i18n.t("Invalid split rule"))
            db.execute("UPDATE categories SET split = ? WHERE id = ? AND kind = 'expense' AND portfolio_id = ?",
                       (rule, as_int(cid, "category"), cur_pf))
        db.commit()
        return jsonify(split_state())

    @app.post("/api/split/apply")
    def split_apply():
        """Updates (or creates) the monthly recurring contributions with the proposed amounts."""
        family_only()
        b = body()
        db = get_db()
        cur_pf = pf()
        # contribution income category: by its code (any language), or a name of older versions ("Contribution…",
        # Italian "Versament…") for categories created by hand
        cat = db.execute("SELECT id FROM categories WHERE kind='income' AND (code = 'contributions' OR name LIKE 'Contribution%' "
                         "OR name LIKE 'Versament%') AND portfolio_id = ? ORDER BY code IS NULL, id", (cur_pf,)).fetchone()
        updated, created, transfers = 0, 0, []
        start = add_months(dt.date.today().replace(day=1), 1).replace(day=15).isoformat()
        deposits = b.get("deposits") or []
        if not isinstance(deposits, list) or not all(isinstance(d, dict) for d in deposits):
            raise ApiError(i18n.t("Invalid list of contributions"))
        for d in deposits:
            account_id, amount = as_int(d.get("account_id"), "account"), as_int(d.get("amount"), "amount", minimum=1)
            p = db.execute("SELECT * FROM people WHERE id = ? AND portfolio_id = ?",
                           (as_int(d.get("person_id"), "person"), cur_pf)).fetchone()
            if not p or portfolio_of("accounts", account_id) != cur_pf:
                raise ApiError(i18n.t("Person or account not found"))
            kw = (p["keyword"] or p["name"]).strip()
            # someone who contributes with a recurring transfer from their own space: THAT transfer is updated (otherwise
            # an extra income here would double the balance of the joint account)
            gc = db.execute("""SELECT r.id, sp.name AS pf_name FROM recurring r JOIN accounts s ON s.id = r.account_id
                               JOIN portfolios sp ON sp.id = s.portfolio_id
                               WHERE r.kind = 'transfer' AND r.to_account_id = ? AND r.active = 1 AND s.portfolio_id != ?
                               AND (lower(r.name) LIKE lower(?) OR lower(s.name) LIKE lower(?) OR lower(sp.name) LIKE lower(?))
                               ORDER BY r.id LIMIT 1""",
                            (account_id, cur_pf, f"%{kw}%", f"%{kw}%", f"%{kw}%")).fetchone()
            rec = db.execute("""SELECT id FROM recurring WHERE kind='income' AND account_id=? AND active=1
                                AND (name LIKE ? OR name LIKE ?) ORDER BY id LIMIT 1""",
                             (account_id, f"%{kw}%", f"%{p['name']}%")).fetchone()
            if gc:
                db.execute("UPDATE recurring SET amount=? WHERE id=?", (amount, gc["id"]))
                transfers.append(i18n.t("{name} (transfer from the space \"{space}\")", name=p["name"], space=gc["pf_name"]))
                updated += 1
            elif rec:
                db.execute("UPDATE recurring SET amount=? WHERE id=?", (amount, rec["id"]))
                updated += 1
            elif not cat:
                raise ApiError(i18n.t("For {name} there is neither a recurring contribution nor a recurring transfer from another space, and there is no \"Contributions…\" income category to create one", name=p['name']))
            else:
                db.execute("""INSERT INTO recurring(name, kind, amount, account_id, category_id, frequency, start_date,
                              generated, active, notes) VALUES (?, 'income', ?, ?, ?, 'monthly', ?, 0, 1, ?)""",
                           (i18n.t("Contribution {name}", name=p['name']), amount, account_id, cat["id"], start,
                            "Created by the fair split calculator"))
                created += 1
        db.commit()
        note(i18n.t("{updated} updated, {created} created", updated=updated, created=created)
             + (" · " + i18n.t("transfers: {list}", list=", ".join(transfers)) if transfers else ""))
        return jsonify(updated=updated, created=created, transfers=transfers)

    # ------------------------------------------------- analysis tools

    def personal_only():
        pf()  # the tools don't depend on the type: each space chooses its own tabs (features)

    @app.get("/api/budget")
    def budget_get():
        """Monthly budgets: spent in the chosen month and monthly average over the chosen complete months (3/6/12 or the whole history)."""
        db = get_db()
        p = pf()
        month = request.args.get("month") or dt.date.today().strftime("%Y-%m")
        if len(month) != 7 or not month[:4].isdigit() or not month[5:].isdigit():
            raise ApiError(i18n.t("Invalid month"))
        raw = request.args.get("avg") or "3"
        n = max(1, tools.history_months(db, p) - 1) if raw == "all" else tools.months_arg(db, p, raw, 3, cap=120)
        d_from, d_to = tools.complete_months(n)
        rows = [dict(r) for r in db.execute(
            f"""SELECT c.id, c.name, c.icon, c.color, c.budget,
                  COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.category_id = c.id AND t.kind = 'expense'
                            AND NOT t.excluded AND substr(t.date, 1, 7) = ?), 0) AS spent,
                  COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.category_id = c.id AND t.kind = 'expense'
                            AND NOT t.excluded AND t.date BETWEEN ? AND ?), 0) / ? AS avg
                FROM categories c WHERE c.portfolio_id = ? AND c.kind = 'expense' AND c.flow != 'other'
                ORDER BY c.budget DESC, c.name""",
            (month, d_from, d_to, n, p))]
        for r in rows:
            r["avg3"] = r["avg"]  # compatibility
        return jsonify(month=month, avg_from=d_from, avg_to=d_to, avg_months=n, avg_key=raw, categories=rows)

    @app.put("/api/categories/<int:cid>/budget")
    def budget_put(cid):
        db = get_db()
        budget = as_int(body().get("budget") or 0, "budget", minimum=0)
        if not db.execute("UPDATE categories SET budget = ? WHERE id = ? AND portfolio_id = ?", (budget, cid, pf())).rowcount:
            raise ApiError(i18n.t("Category not found"), 404)
        db.commit()
        return jsonify(ok=True)

    @app.get("/api/tools/mortgage")
    def mortgage_get():
        return jsonify([{k: v for k, v in p.items() if k != "_rec"} for p in tools.mortgage_plans(get_db(), pf())])

    @app.post("/api/tools/mortgage/simulate")
    def mortgage_simulate():
        b = body()
        plans = {x["id"]: x for x in tools.mortgage_plans(get_db(), pf())}
        plan = plans.get(as_int(b.get("recurring_id"), "loan"))
        if not plan:
            raise ApiError(i18n.t("Loan not found"))
        extra = as_int(b.get("extra"), "amount", minimum=1)
        after = as_int(plan["paid"] if b.get("after_payment") in (None, "") else b.get("after_payment"), "installment", minimum=0)
        return jsonify(tools.simulate_prepayment(plan, extra, after, "installment" if b.get("mode") == "installment" else "duration"))

    @app.get("/api/tools/emergency")
    def emergency_get():
        return jsonify(tools.emergency(get_db(), pf()))

    @app.put("/api/tools/emergency")
    def emergency_put():
        v = as_rate(body().get("target_months"))
        if v is None or not 1 <= v <= 36:
            raise ApiError(i18n.t("Invalid number of months"))
        db = get_db()
        tools.set_setting(db, "emergency_months", pf(), v)
        db.commit()
        return jsonify(tools.emergency(db, pf()))

    def goal_from_body(b):
        name = as_text(b.get("name"), 60)
        if not name:
            raise ApiError(i18n.t("The goal name is required"))
        account_id = as_int(b.get("account_id"), "account", required=False)
        if account_id is not None:  # also 0 or a nonexistent id: a clear message, not a database error
            own_account(account_id)
        return (name, as_text(b.get("icon"), 8) or "🎯", as_color(b.get("color")), as_int(b.get("target"), "target", minimum=1),
                as_date(b.get("target_date"), "target date", required=False), account_id,
                as_int(b.get("saved") or 0, "saved", minimum=0))

    @app.get("/api/goals")
    def goals_get():
        return jsonify(tools.goals(get_db(), pf()))

    @app.post("/api/goals")
    def goal_create():
        db = get_db()
        cur = db.execute("""INSERT INTO goals(portfolio_id, name, icon, color, target, target_date, account_id, saved)
                            VALUES (?,?,?,?,?,?,?,?)""", (pf(), *goal_from_body(body())))
        db.commit()
        return jsonify(id=cur.lastrowid), 201

    @app.put("/api/goals/<int:gid>")
    def goal_update(gid):
        db = get_db()
        if not db.execute("""UPDATE goals SET name=?, icon=?, color=?, target=?, target_date=?, account_id=?, saved=?
                             WHERE id=? AND portfolio_id=?""", (*goal_from_body(body()), gid, pf())).rowcount:
            raise ApiError(i18n.t("Goal not found"), 404)
        db.commit()
        return jsonify(ok=True)

    @app.delete("/api/goals/<int:gid>")
    def goal_delete(gid):
        db = get_db()
        note((db.execute("SELECT name FROM goals WHERE id = ? AND portfolio_id = ?", (gid, pf())).fetchone() or [""])[0])
        db.execute("DELETE FROM goals WHERE id = ? AND portfolio_id = ?", (gid, pf()))
        db.commit()
        return jsonify(ok=True)

    def own_invest_account(aid):
        own_account(aid)
        if get_db().execute("SELECT type FROM accounts WHERE id = ?", (aid,)).fetchone()[0] != tools.INVEST:
            raise ApiError(i18n.t("The account is not an investment account"))

    @app.get("/api/investments")
    def investments_get():
        personal_only()
        return jsonify(tools.investments(get_db(), pf(), months=tools.months_arg(get_db(), pf(), request.args.get("months"), 24)))

    @app.post("/api/investments/<int:aid>/valuations")
    def valuation_add(aid):
        personal_only()
        own_invest_account(aid)
        b = body()
        db = get_db()
        db.execute("""INSERT INTO valuations(account_id, date, value, source) VALUES (?, ?, ?, 'manual')
                      ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value, source = 'manual'""",
                   (aid, as_date(b.get("date")), as_int(b.get("value"), "value", minimum=0)))
        db.commit()
        return jsonify(ok=True), 201

    @app.delete("/api/valuations/<int:vid>")
    def valuation_delete(vid):
        db = get_db()
        r = db.execute("SELECT v.account_id, v.date, v.value, a.name FROM valuations v JOIN accounts a ON a.id = v.account_id "
                       "WHERE v.id = ?", (vid,)).fetchone()
        if not r:
            raise ApiError(i18n.t("Valuation not found"), 404)
        own_account(r[0])
        note(f"{r['name']} · {r['date']} · {audit.eur(r['value'])}")
        db.execute("DELETE FROM valuations WHERE id = ?", (vid,))
        db.commit()
        return jsonify(ok=True)

    ASSET_CLASSES = ("azioni", "obbligazioni", "monetario", "materie prime", "immobiliare", "crypto", "altro")

    def holding_from_body(b):
        ticker = as_text(b.get("ticker"), 30).upper()
        if not ticker:
            raise ApiError(i18n.t("Enter the ticker (e.g. VWCE.DE, SWDA.MI)"))
        try:
            qty = parse_number(b.get("quantity") or 0) or 0.0
        except ValueError:
            raise ApiError(i18n.t("Invalid quantity"))
        if qty < 0:
            raise ApiError(i18n.t("Invalid quantity"))
        cls = b.get("asset_class") if b.get("asset_class") in ASSET_CLASSES else None
        name = as_text(b.get("name"), 80)
        if cls is None and DEMO:
            cls = tools.classify_instrument(name)
        if cls is None:  # no choice: automatic suggestion from the name (and possibly from Yahoo)
            try:
                info = tools.lookup_instrument(ticker)
                cls, name, ticker = info["asset_class"], name or info["name"][:80], info["ticker"]  # full symbol
            except ValueError:
                cls = tools.classify_instrument(name)
        return ticker, name, qty, cls

    @app.get("/api/investments/lookup")
    def instrument_lookup():
        """Autofills a security (name, suggested class, price) from Yahoo: sends only the ticker."""
        personal_only()
        if DEMO:
            raise ApiError(i18n.t("Online features are disabled in the demo version"), 404)
        ticker = as_text(request.args.get("ticker"), 30).upper()
        if not ticker:
            raise ApiError(i18n.t("Enter the ticker"))
        try:
            return jsonify(tools.lookup_instrument(ticker))
        except ValueError as e:
            raise ApiError(str(e), 404)

    @app.post("/api/investments/<int:aid>/holdings")
    def holding_add(aid):
        personal_only()
        own_invest_account(aid)
        db = get_db()
        cur = db.execute("INSERT INTO holdings(account_id, ticker, name, quantity, asset_class) VALUES (?,?,?,?,?)",
                         (aid, *holding_from_body(body())))
        db.commit()
        return jsonify(id=cur.lastrowid), 201

    @app.put("/api/holdings/<int:hid>")
    def holding_update(hid):
        db = get_db()
        r = db.execute("SELECT account_id, ticker FROM holdings WHERE id = ?", (hid,)).fetchone()
        if not r:
            raise ApiError(i18n.t("Security not found"), 404)
        own_account(r[0])
        vals = holding_from_body(body())
        if vals[0] != r["ticker"]:  # a different instrument: current and historical prices of the old ticker no longer apply
            db.execute("DELETE FROM price_history WHERE holding_id = ?", (hid,))
            db.execute("UPDATE holdings SET price = NULL, currency = NULL, price_eur = NULL, price_date = NULL WHERE id = ?", (hid,))
        db.execute("UPDATE holdings SET ticker=?, name=?, quantity=?, asset_class=? WHERE id=?", (*vals, hid))
        tools.sync_holdings(db, r[0])  # with trades, the quantity stays the calculated one
        db.commit()
        return jsonify(ok=True)

    @app.delete("/api/holdings/<int:hid>")
    def holding_delete(hid):
        db = get_db()
        r = db.execute("SELECT account_id FROM holdings WHERE id = ?", (hid,)).fetchone()
        if r:
            own_account(r[0])
            n = db.execute("SELECT COUNT(*) FROM trades WHERE holding_id = ?", (hid,)).fetchone()[0]
            if n:  # deleting it would also delete the trades, changing the account's cash and results
                raise ApiError(i18n.tn("The security has {n} recorded trade: delete it first (from Trades), or leave it with zero quantity if you sold it all",
                                       "The security has {n} recorded trades: delete them first (from Trades), or leave it with zero quantity if you sold it all", n), 409)
            note(db.execute("SELECT ticker FROM holdings WHERE id = ?", (hid,)).fetchone()[0])
            db.execute("UPDATE recurring SET holding_id = NULL WHERE holding_id = ?", (hid,))
            db.execute("DELETE FROM holdings WHERE id = ?", (hid,))
            db.commit()
        return jsonify(ok=True)

    # ------------------------------------------------- trades

    def as_float(value, name):
        try:
            v = parse_number(value)
        except (TypeError, ValueError):
            v = None
        if v is None or v != v or v in (float("inf"), float("-inf")):
            raise ApiError(i18n.t("Invalid value: {name}", name=i18n.t(name)))
        return v

    @app.get("/api/investments/<int:aid>/trades")
    def trades_list(aid):
        personal_only()
        own_invest_account(aid)
        return jsonify([dict(r) for r in get_db().execute(
            """SELECT o.*, h.ticker, h.name AS holding_name FROM trades o LEFT JOIN holdings h ON h.id = o.holding_id
               WHERE o.account_id = ? ORDER BY o.date DESC, o.id DESC""", (aid,))])

    def trade_from_body(b, aid):
        """Data of a trade: buy/sell (quantity, price, fees; optionally the exact total debited/credited),
        split (quantity change), interest/dividends/fees/capital returns (amount)."""
        db = get_db()
        kind = as_key(b.get("kind"))
        if kind not in tools.TRADE_KINDS:
            raise ApiError(i18n.t("Invalid trade type"))
        hid = as_int(b.get("holding_id"), "security", required=kind in ("buy", "sell", "split", "capital"))
        if hid is not None and not db.execute("SELECT 1 FROM holdings WHERE id = ? AND account_id = ?", (hid, aid)).fetchone():
            raise ApiError(i18n.t("Security not found in this account"))
        fees = as_int(b.get("fees") or 0, "fees", minimum=0)
        qty = price = None
        if kind in ("buy", "sell"):
            qty, price = abs(as_float(b.get("quantity"), "quantity")), as_float(b.get("price"), "price")
            if qty <= 0 or price < 0:
                raise ApiError(i18n.t("Quantity and price must be positive"))
            total = as_int(b.get("total"), "total", required=False, minimum=1)  # actual amount on the statement
            gross = qty * price * 100
            if not gross <= MAX_INT:  # also infinity (e.g. 1e200 × 1e200): same limit as every other amount
                raise ApiError(i18n.t("Value too large: quantity × price"))
            gross = round(gross)
            amount = (-(total or gross + fees)) if kind == "buy" else (total or gross - fees)
            if abs(amount) > MAX_INT:
                raise ApiError(i18n.t("Value too large: amount"))
            if kind == "sell" and amount < 0:
                raise ApiError(i18n.t("The fees exceed the sale proceeds: check quantity, price and fees"))
            qty = qty if kind == "buy" else -qty
        elif kind == "split":
            qty, amount = as_float(b.get("quantity"), "quantity"), 0
        else:
            amount = as_int(b.get("amount"), "amount")
            amount = -abs(amount) if kind == "fee" else abs(amount)
        ext = as_text(b.get("external_id"), 60)
        return {"holding_id": hid, "date": tx_date(b.get("date")), "kind": kind, "quantity": qty or 0, "price": price,
                "amount": amount, "fees": fees, "notes": as_text(b.get("notes"), 200),
                "external_id": ext if ext.startswith("pac:") else None}

    TRADE_LABELS = {"buy": "buy", "sell": "sell", "split": "split", "capital": "capital return",
                    "interest": "interest", "dividend": "dividend", "fee": "fee"}

    def trade_note(db, t):
        """Activity log line of a trade: type, security, date, amount."""
        tk = db.execute("SELECT ticker FROM holdings WHERE id = ?", (t["holding_id"],)).fetchone() if t["holding_id"] else None
        note(" · ".join(x for x in (i18n.t(TRADE_LABELS.get(t["kind"], t["kind"])), tk[0] if tk else "", t["date"],
                                    audit.eur(t["amount"]) if t["amount"] else "") if x))

    def check_positions(db, aid, before, why=""):
        """Rolls back the change if it sells units that were not owned on that date (only if this wasn't already happening before)."""
        bad = tools.negative_position(db, aid)
        if bad and not before:
            db.rollback()
            if why:  # the deposit generated an investment plan purchase
                raise ApiError(i18n.t("The deposit generated an investment plan purchase: deleting it, the units of {security} "
                                      "would drop below zero on {date}: units not owned would be sold. Check the dates and "
                                      "quantities of buys and sells.", security=bad[0], date=bad[1]), 409)
            raise ApiError(i18n.t("With this change, the units of {security} would drop below zero on {date}: units not owned "
                                  "would be sold. Check the dates and quantities of buys and sells.", security=bad[0], date=bad[1]), 409)

    @app.post("/api/investments/<int:aid>/trades")
    def trade_add(aid):
        personal_only()
        own_invest_account(aid)
        db, t = get_db(), trade_from_body(body(), aid)
        before = tools.negative_position(db, aid)
        tid = db.execute(f"INSERT INTO trades(account_id, {', '.join(t)}) VALUES (?, {', '.join('?' * len(t))})",
                         (aid, *t.values())).lastrowid
        check_positions(db, aid, before)
        tools.sync_holdings(db, aid)
        db.commit()
        trade_note(db, t)
        return jsonify(ok=True, id=tid), 201

    @app.put("/api/trades/<int:tid>")
    def trade_update(tid):
        db = get_db()
        r = db.execute("SELECT account_id, external_id, source FROM trades WHERE id = ?", (tid,)).fetchone()
        if not r:
            raise ApiError(i18n.t("Trade not found"), 404)
        own_account(r[0])
        t = trade_from_body(body(), r[0])
        t["external_id"] = t["external_id"] or r["external_id"]  # an investment plan purchase stays linked to its deposit
        # the user corrected the automatic purchase (English wording or Italian legacy wording in the notes)
        if r["source"] == "recurring" and any(m in t["notes"] for m in i18n.estimated_markers()):
            t["notes"] = t["notes"].split(" · ")[0] + " · " + i18n.t("verified price")
        before = tools.negative_position(db, r[0])
        db.execute(f"UPDATE trades SET {', '.join(f'{k}=?' for k in t)} WHERE id=?", (*t.values(), tid))
        check_positions(db, r[0], before)
        trade_note(db, t)
        tools.sync_holdings(db, r[0])
        db.commit()
        return jsonify(ok=True)

    @app.delete("/api/trades/<int:tid>")
    def trade_delete(tid):
        db = get_db()
        r = db.execute("SELECT * FROM trades WHERE id = ?", (tid,)).fetchone()
        if r:
            own_account(r["account_id"])
            trade_note(db, r)
            aid = r["account_id"]  # (not r[0]: with SELECT * the first column is the trade id)
            before = tools.negative_position(db, aid)
            db.execute("DELETE FROM trades WHERE id = ?", (tid,))
            check_positions(db, aid, before)
            tools.sync_holdings(db, aid)
            db.commit()
        return jsonify(ok=True)

    # --------------------------------------------- bundle import (local scripts)

    @app.post("/api/import/bundle")
    def import_bundle():
        """Imports accounts, categories, transactions, securities, trades and valuations into the active space in a
        single database transaction. References via 'key'; existing accounts and categories with the same name are reused.
        dry_run=true runs everything and rolls back, returning the summary (including the resulting balances)."""
        b, db, p = body(), get_db(), pf()
        dry = bool(b.get("dry_run"))
        if not dry:
            dbm.backup_now("pre-import")
        acc, cat, hold, cat_kind = {}, {}, {}, {}
        created = {"accounts": 0, "categories": 0, "transactions": 0, "holdings": 0, "trades": 0, "valuations": 0}

        def ref(table, key, what):
            if key not in table:
                raise ApiError(i18n.t("Unknown reference ({what}): {key}", what=what, key=key))
            return table[key]
        try:
            for a in b.get("accounts") or []:
                row = db.execute("SELECT id FROM accounts WHERE portfolio_id = ? AND lower(name) = lower(?)", (p, as_text(a.get("name"), 60))).fetchone()
                vals = account_from_body(a)
                if row:
                    db.execute("UPDATE accounts SET type=?, color=?, icon=?, initial_balance=?, archived=? WHERE id=?",
                               (*vals[1:], row[0]))
                    acc[a["key"]] = row[0]
                else:
                    acc[a["key"]] = db.execute("""INSERT INTO accounts(portfolio_id, name, type, color, icon, initial_balance,
                                                  archived) VALUES (?,?,?,?,?,?,?)""", (p, *vals)).lastrowid
                    created["accounts"] += 1
            for c in b.get("categories") or []:
                kind = c.get("kind") if c.get("kind") in ("expense", "income") else "expense"
                name = as_text(c.get("name"), 60)
                row = db.execute("SELECT id FROM categories WHERE portfolio_id = ? AND lower(name) = lower(?) AND kind = ?", (p, name, kind)).fetchone()
                if row:
                    cat[c["key"]] = row[0]
                else:
                    cat[c["key"]] = db.execute("INSERT INTO categories(portfolio_id, name, kind, color, icon, flow, code) VALUES (?,?,?,?,?,?,?)",
                                               (p, name, kind, as_color(c.get("color")), as_text(c.get("icon"), 8) or "📦",
                                                "other" if kind == "expense" and name in OTHER_FLOW_NAMES else "",
                                                system_code(db, p, name))).lastrowid
                    created["categories"] += 1
                cat_kind[cat[c["key"]]] = kind
            for t in b.get("transactions") or []:
                kind = t.get("kind")
                if kind not in KINDS:
                    raise ApiError(i18n.t("Invalid transaction type: {kind}", kind=kind))
                src = ref(acc, t.get("account"), "account")
                dst = ref(acc, t.get("to_account"), "destination account") if kind == "transfer" else None
                if dst is not None and dst == src:
                    raise ApiError(i18n.t("Transfer to the same account: {value}", value=t.get('description') or t.get('date')))
                cid = ref(cat, t.get("category"), "category") if kind != "transfer" and t.get("category") else None
                if cid is not None and cat_kind[cid] != kind:  # same rule as transactions entered by hand
                    raise ApiError(i18n.t("The category does not match the transaction type: {value}", value=t.get('description') or t.get('date')))
                db.execute("""INSERT INTO transactions(date, amount, kind, account_id, to_account_id, category_id,
                                                       description, notes, source, excluded) VALUES (?,?,?,?,?,?,?,?, 'import', ?)""",
                           (tx_date(t.get("date")), as_int(t.get("amount"), "amount", minimum=1), kind, src, dst, cid,
                            as_text(t.get("description"), 200), as_text(t.get("notes"), 500), 1 if t.get("excluded") else 0))
                created["transactions"] += 1
            for h in b.get("holdings") or []:
                aid = ref(acc, h.get("account"), "account")
                isin, ticker = as_text(h.get("isin"), 20).upper(), as_text(h.get("ticker"), 30).upper()
                row = db.execute("SELECT id FROM holdings WHERE account_id = ? AND ((isin IS NOT NULL AND isin = ?) OR ticker = ?)",
                                 (aid, isin, ticker)).fetchone()
                cls = h.get("asset_class") if h.get("asset_class") in ASSET_CLASSES else "altro"
                if row:
                    db.execute("UPDATE holdings SET ticker=?, name=?, asset_class=?, isin=? WHERE id=?",
                               (ticker, as_text(h.get("name"), 80), cls, isin or None, row[0]))
                    hold[h["key"]] = row[0]
                else:
                    hold[h["key"]] = db.execute("""INSERT INTO holdings(account_id, ticker, name, quantity, asset_class, isin)
                                                   VALUES (?,?,?,0,?,?)""",
                                                (aid, ticker, as_text(h.get("name"), 80), cls, isin or None)).lastrowid
                    created["holdings"] += 1
            for o in b.get("trades") or []:
                if as_key(o.get("kind")) not in tools.TRADE_KINDS:
                    raise ApiError(i18n.t("Invalid trade type: {value}", value=o.get('kind')))
                ext = as_text(o.get("external_id"), 60)
                if ext and db.execute("SELECT 1 FROM trades WHERE external_id = ?", (ext,)).fetchone():
                    continue  # trade already imported (same broker code): bundle run again, no duplicates
                db.execute("""INSERT INTO trades(account_id, holding_id, date, kind, quantity, price, amount, fees, notes,
                                                 source, external_id) VALUES (?,?,?,?,?,?,?,?,?, 'import', ?)""",
                           (ref(acc, o.get("account"), "account"), ref(hold, o["holding"], "security") if o.get("holding") else None,
                            tx_date(o.get("date")), o["kind"], as_float(o.get("quantity") or 0, "quantity"),
                            as_float(o["price"], "price") if o.get("price") is not None else None,
                            as_int(o.get("amount") or 0, "amount"), as_int(o.get("fees") or 0, "fees"),
                            as_text(o.get("notes"), 200), as_text(o.get("external_id"), 60) or None))
                created["trades"] += 1
            for v in b.get("valuations") or []:
                db.execute("""INSERT INTO valuations(account_id, date, value, source) VALUES (?, ?, ?, 'import')
                              ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value, source = 'import'""",
                           (ref(acc, v.get("account"), "account"), as_date(v.get("date")), as_int(v.get("value"), "value", minimum=0)))
                created["valuations"] += 1
            for aid in set(acc.values()):
                bad = tools.negative_position(db, aid)
                if bad:  # same check as for trades entered by hand
                    raise ApiError(i18n.t("In the bundle the units of {value} drop below zero on {value2}: check buys and sells", value=bad[0], value2=bad[1]))
                tools.sync_holdings(db, aid)
            balances = {a["name"]: a["balance"] for a in account_balances(db, p) if a["id"] in acc.values()}
            mv = tools.market_values(db, p)
            values = {a["name"]: mv[a["id"]]["value"] for a in account_balances(db, p) if a["id"] in mv and a["id"] in acc.values()}
            positions = {}
            for aid in set(acc.values()):
                pos, _ = tools.positions(db, aid)
                for hid, x in pos.items():
                    h = db.execute("SELECT ticker FROM holdings WHERE id = ?", (hid,)).fetchone()
                    positions[h[0]] = {"quantity": round(x["quantity"], 4), "cost": round(x["cost"]), "realized": round(x["realized"])}
        except ApiError:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            raise ApiError(i18n.t("Import failed: {exc}", exc=exc))
        if dry:
            db.rollback()
        else:
            db.commit()
        if dry:
            g.audit_skip = True  # dry run: changes nothing, does not go in the activity log
        counts = (i18n.tn("{n} account", "{n} accounts", created["accounts"]) if created["accounts"] else "",
                  i18n.tn("{n} transaction", "{n} transactions", created["transactions"]) if created["transactions"] else "",
                  i18n.tn("{n} trade", "{n} trades", created["trades"]) if created["trades"] else "",
                  i18n.tn("{n} security", "{n} securities", created["holdings"]) if created["holdings"] else "")
        note(", ".join(x for x in counts if x)
             or i18n.t("no new data"))
        return jsonify(dry_run=dry, created=created, balances=balances, values=values, positions=positions)

    # ------------------------------------------------- rebalancing calculator

    def rebalance_config(b, base):
        """Rebalancing settings from a request, on top of the saved ones (base): validated, nothing else kept."""
        cfg = json.loads(json.dumps(base))
        if "accounts" in b:
            ids = None if b["accounts"] is None else id_list(b["accounts"], "account")
            cfg["accounts"] = None if ids is None else sorted(set(ids))
        if "mode" in b:
            if as_key(b["mode"]) not in ("class", "security"):
                raise ApiError(i18n.t("Invalid rebalancing mode"))
            cfg["mode"] = b["mode"]
        for mode, t in as_dict(b.get("targets"), "targets").items():
            if mode not in ("class", "security"):
                raise ApiError(i18n.t("Invalid targets"))
            clean = {}
            for k, v in as_dict(t, "targets").items():
                if not isinstance(k, str) or len(k) > 40:
                    raise ApiError(i18n.t("Invalid targets"))
                if isinstance(v, (bool, list, dict)):
                    raise ApiError(i18n.t("Invalid target"))
                try:
                    p = float(str(v).replace(",", ".")) if v not in (None, "") else 0.0
                except ValueError:
                    raise ApiError(i18n.t("Invalid target"))
                if not 0 <= p <= 100 or p != p:
                    raise ApiError(i18n.t("Each target must be between 0 and 100%"))
                if p:
                    clean[k] = round(p, 2)
            if len(clean) > 200:
                raise ApiError(i18n.t("Too many targets"))
            cfg["targets"][mode] = clean
        for k in ("drift_abs", "drift_rel"):
            if k in b:
                if b[k] in (None, ""):
                    cfg[k] = None
                    continue
                try:
                    v = float(str(b[k]).replace(",", "."))
                except ValueError:
                    raise ApiError(i18n.t("Invalid drift threshold"))
                if isinstance(b[k], (bool, list, dict)) or v != v or not 0 <= v <= (100 if k == "drift_abs" else 1000):
                    raise ApiError(i18n.t("Invalid drift threshold"))
                cfg[k] = v or None  # 0 = not used, like an empty field
        for mode, keys in as_dict(b.get("excluded"), "excluded items").items():  # rows left out of the calculation
            if mode not in ("class", "security"):
                raise ApiError(i18n.t("Invalid excluded items"))
            keys = as_list(keys, "excluded items")
            if len(keys) > 200 or not all(isinstance(k, str) and 0 < len(k) <= 40 for k in keys):
                raise ApiError(i18n.t("Invalid excluded items"))
            cfg["excluded"][mode] = sorted(set(keys))
        if "contribution" in b:
            cfg["contribution"] = as_int(b["contribution"] or 0, "amount to invest", minimum=0)
        if "sells" in b:
            cfg["sells"] = b["sells"] is True
        return cfg

    def rebalance_saved(db):
        raw = tools.setting(db, "rebalance", pf(), None)
        cfg = json.loads(json.dumps(tools.REBALANCE_DEFAULTS))
        if raw:
            try:
                cfg.update({k: v for k, v in json.loads(raw).items() if k in cfg})
            except (ValueError, AttributeError):
                pass
        if not isinstance(cfg.get("excluded"), dict):  # settings saved by 1.1.0 have no exclusions
            cfg["excluded"] = {}
        for mode in ("class", "security"):
            cfg["excluded"].setdefault(mode, [])
        return cfg

    @app.get("/api/investments/rebalance")
    def rebalance_get():
        db = get_db()
        cfg = rebalance_saved(db)
        return jsonify(config=cfg, result=tools.rebalance(db, pf(), cfg))

    @app.post("/api/investments/rebalance")
    def rebalance_calc():
        """Calculates with the settings sent (not saved), or saves them with save=true. Never records trades."""
        b, db = body(), get_db()
        cfg = rebalance_config(b, rebalance_saved(db))
        if b.get("save") is True:
            tools.set_setting(db, "rebalance", pf(), json.dumps(cfg))
            db.commit()
        return jsonify(config=cfg, result=tools.rebalance(db, pf(), cfg))

    @app.post("/api/investments/refresh")
    def investments_refresh():
        """Downloads updated prices (the only feature that contacts the internet: it sends only the tickers)."""
        personal_only()
        if DEMO:
            raise ApiError(i18n.t("In the demo version prices are made up: online updates are disabled"))
        return jsonify(tools.refresh_prices(get_db(), pf()))

    @app.get("/api/tools/savings")
    def savings_get():
        personal_only()
        months = tools.months_arg(get_db(), pf(), request.args.get("months"), 12)
        db = get_db()
        return jsonify(savings=tools.savings(db, pf(), months), net_worth=tools.net_worth(db, pf(), months))

    # ----------------------------------------------------------- export


    def export_rows():
        where, params = tx_filters(request.args)
        rows = get_db().execute(f"{TX_SELECT}{where} ORDER BY t.date, t.id", params).fetchall()
        header = [i18n.t("Date"), i18n.t("Type"), i18n.t("Description"), i18n.t("Category"), i18n.t("Account"),
                  i18n.t("Destination account"), i18n.t("Amount"), i18n.t("Notes"), i18n.t("Excluded from reports")]
        kinds = {"expense": i18n.t("Expense"), "income": i18n.t("Income"), "transfer": i18n.t("Transfer")}
        yes = i18n.t("Yes")
        data = []
        for r in rows:
            signed = -r["amount"] if r["kind"] == "expense" else r["amount"]
            data.append([r["date"], kinds[r["kind"]], r["description"], r["category_name"] or "",
                         r["account_name"], r["to_account_name"] or "", signed / 100, r["notes"],
                         yes if r["excluded"] else ""])
        return header, data

    def xlsx_response(wb, filename):
        # formula injection protection: openpyxl would write a text starting with "=" (e.g. an imported bank
        # description) as an active formula; HomeCoin exports contain no formulas, so everything stays text
        for ws in wb.worksheets:
            for row in ws.iter_rows():
                for c in row:
                    if c.data_type == "f":
                        c.data_type = "s"
        buf = io.BytesIO()
        wb.save(buf)
        return Response(buf.getvalue(),
                        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    def style_sheet(ws, money_cols, widths):
        from openpyxl.styles import Alignment, Font, PatternFill
        fill = PatternFill("solid", fgColor="6366F1")
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = fill
            c.alignment = Alignment(horizontal="center")
        # separators follow the Excel language; symbol, its position and the decimals follow the reference currency
        cur = util.CURRENCIES[util.currency_of(get_db())]
        n = "#,##0" + ("." + "0" * cur.digits if cur.digits else "")
        sym = f'"{cur.symbol}{" " if cur.space else ""}"' if cur.prefix else f'"{" " if cur.space else ""}{cur.symbol}"'
        one = f"{sym}{n}" if cur.prefix else f"{n}{sym}"
        fmt = f"{one};[Red]-{one}"
        for col in money_cols:
            for row in ws.iter_rows(min_row=2, min_col=col, max_col=col):
                for c in row:
                    c.number_format = fmt
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = w
        ws.freeze_panes = "A2"

    @app.get("/api/export/transactions")
    def export_transactions():
        header, data = export_rows()
        stamp = dt.date.today().isoformat()
        if request.args.get("format") == "xlsx":
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = i18n.t("Transactions")[:31]
            ws.append(header)
            for r in data:
                r = list(r)
                r[0] = parse_date(r[0])
                ws.append(r)
                ws.cell(ws.max_row, 1).number_format = util.DATE_EXCEL[util.currency_of(get_db())]
            style_sheet(ws, [7], [12, 11, 45, 22, 20, 20, 14, 30, 12])
            ws.auto_filter.ref = ws.dimensions
            return xlsx_response(wb, f"homecoin-transactions-{stamp}.xlsx")
        buf = io.StringIO()
        # as a spreadsheet of the currency's country expects it: comma decimals with ";" between columns (euro),
        # dot decimals with "," between columns (pound, dollars, franc, peso)
        cur = util.CURRENCIES[util.currency_of(get_db())]
        w = csv.writer(buf, delimiter=";" if cur.decimal == "," else ",")
        w.writerow(header)
        for r in data:
            r = list(r)
            r[6] = f"{r[6]:.{cur.digits}f}".replace(".", cur.decimal)
            # formula injection protection (CSV opened in Excel): texts starting with = + - @ become plain text
            w.writerow([("'" + v) if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") and i != 6 else v
                        for i, v in enumerate(r)])
        return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="homecoin-transactions-{stamp}.csv"'})

    @app.get("/api/export/report")
    def export_report():
        import openpyxl
        from openpyxl.styles import Font
        data = report().get_json()
        labels = [i18n.month_label(int(m[5:]), int(m[:4])) for m in data["months"]]
        n = len(labels)
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for kind, title in (("expense", i18n.t("Expenses")), ("income", i18n.t("Income"))):
            ws = wb.create_sheet(title[:31])
            ws.append([i18n.t("Category"), *labels, i18n.t("Total")])
            for r in data[kind]["rows"]:
                ws.append([r["name"], *[v / 100 for v in r["months"]], r["total"] / 100])
            ws.append([i18n.t("Total").upper(), *[v / 100 for v in data[kind]["months"]], data[kind]["total"] / 100])
            for c in ws[ws.max_row]:
                c.font = Font(bold=True)
            style_sheet(ws, range(2, n + 3), [26] + [12] * (n + 1))
        ws = wb.create_sheet(i18n.t("Summary")[:31])
        ws.append([i18n.t("Month"), i18n.t("Income"), i18n.t("Expenses"), i18n.t("Balance")])
        for i, label in enumerate(labels):
            inc, exp = data["income"]["months"][i] / 100, data["expense"]["months"][i] / 100
            ws.append([label, inc, exp, inc - exp])
        style_sheet(ws, [2, 3, 4], [12, 14, 14, 14])
        return xlsx_response(wb, f"homecoin-report-{data['from']}_{data['to']}.xlsx")

    # ---------------------------------------------------- backup/restore

    @app.get("/api/backup")
    def backup():
        db = get_db()
        payload = {"app": "HomeCoin", "version": VERSION, "exported_at": dt.datetime.now().isoformat()}
        for t in TABLES:
            payload[t] = [dict(r) for r in db.execute(f"SELECT * FROM {t}")]
        # file encrypted with the data key; it contains the key encrypted with the current password and recovery
        # key, so it can also be restored on a new installation
        wrapped = {"app": "HomeCoin", "format": "hcbackup-1", "version": VERSION,
                   "exported_at": payload["exported_at"], "keys": vault.keystore_wraps(),
                   **security.seal(vault.dek, json.dumps(payload, ensure_ascii=False).encode("utf-8"))}
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
        # for the reminder in Settings: the automatic backups stay on this PC, a downloaded copy can be kept elsewhere
        db.execute("INSERT INTO settings(key, value) VALUES ('last_backup_download', ?) "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (dt.date.today().isoformat(),))
        db.commit()
        return Response(json.dumps(wrapped), mimetype="application/octet-stream",
                        headers={"Content-Disposition": f'attachment; filename="homecoin-backup-{stamp}.hcbackup"'})

    def read_backup(raw, secret):
        try:
            payload = json.loads(raw.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(i18n.t("The file is not a valid HomeCoin backup"))
        if isinstance(payload, dict) and payload.get("format") == "hcbackup-1":
            data = security.unseal(vault.dek, payload)  # same installation: same data key
            if data is None:
                if not secret:
                    raise ApiError(i18n.t("Backup created with a different key: enter the password (or the recovery key) that was valid when it was created"), 422) from None
                data = security.unseal(vault.dek_from_backup(payload.get("keys") or {}, secret), payload)
                if data is None:
                    raise ApiError(i18n.t("The backup is damaged"))
            payload = json.loads(data.decode("utf-8"))
        return payload

    @app.post("/api/restore")
    def restore():
        f = request.files.get("file")
        if not f:
            raise ApiError(i18n.t("No file uploaded"))
        payload = read_backup(f.read(), request.form.get("password", ""))
        if not isinstance(payload, dict) or payload.get("app") != "HomeCoin" or \
                not all(isinstance(payload.get(t), list) for t in CORE_TABLES):
            raise ApiError(i18n.t("The file is not a valid HomeCoin backup"))
        return restore_payload(payload)

    def restore_payload(payload):
        """Replace all the data with a backup's (dict of table → rows); a copy of the current data is saved first."""
        dbm.backup_now("pre-restore", force=True)  # never skipped: the way back from a wrong restore
        db = get_db()
        cols = {t: [r[1] for r in db.execute(f"PRAGMA table_info({t})")] for t in TABLES}
        try:
            db.execute("PRAGMA foreign_keys = OFF")
            present = [t for t in TABLES if isinstance(payload.get(t), list)]
            # ALL data tables are emptied, including those an old backup doesn't contain: no rows left over from
            # the current database that would end up linked to different accounts or securities
            for t in reversed(TABLES):
                db.execute(f"DELETE FROM {t}")
            for t in present:
                for row in payload[t]:
                    if not isinstance(row, dict):
                        continue
                    keys = [k for k in row if k in cols[t]]
                    db.execute(f"INSERT INTO {t}({','.join(keys)}) VALUES ({','.join('?' * len(keys))})",
                               [row[k] for k in keys])
            broken = db.execute("PRAGMA foreign_key_check").fetchall()
            if broken:  # rows pointing to nonexistent accounts, categories or securities: the backup is inconsistent
                raise ValueError(i18n.tn("{n} invalid link in the backup", "{n} invalid links in the backup", len(broken)))
            db.commit()
        except Exception as exc:
            db.rollback()
            raise ApiError(i18n.t("Restore failed, current data unchanged: {exc}", exc=exc))
        finally:
            db.execute("PRAGMA foreign_keys = ON")
        dbm.migrate(db)  # backups of older versions: assigns accounts/categories to a space
        db.commit()
        load_currency()  # the backup brings its own reference currency
        return jsonify(ok=True)

    # ----------------------------------------------------------- import

    def purge_imports():
        now = time.time()
        for k in [k for k, v in _imports.items() if now - v["at"] > 3600]:
            del _imports[k]

    @app.post("/api/import/upload")
    def import_upload():
        purge_imports()
        f = request.files.get("file")
        if not f or not f.filename:
            raise ApiError(i18n.t("No file uploaded"))
        try:
            rows = importer.read_table(f.filename, f.read())
        except ValueError as exc:
            raise ApiError(str(exc))
        header_row = importer.detect_header(rows)
        if header_row >= 0:
            headers = [str(h or f"Column {i + 1}") for i, h in enumerate(rows[header_row])]
            mapping = importer.guess_mapping(headers)
        else:
            headers = [f"Column {i + 1}" for i in range(len(rows[0]))]
            mapping = {k: None for k in importer.FIELD_KEYWORDS}
        data_rows = rows[header_row + 1:]
        mapping = importer.guess_mapping_from_data(data_rows, mapping)
        date_order, order_source = importer.detect_date_order(
            data_rows, mapping["date"], util.DATE_ORDER_DEFAULT.get(util.currency_of(get_db()), "dmy"))
        token = secrets.token_urlsafe(16)
        _imports[token] = {"rows": rows, "header_row": header_row, "filename": f.filename, "at": time.time()}
        return jsonify(token=token, filename=f.filename, headers=headers, header_row=header_row,
                       mapping=mapping, preview=data_rows[:8], total=len(data_rows),
                       date_order=date_order, date_order_source=order_source)

    @app.post("/api/import/date-order")
    def import_date_order():
        """Order of day and month for the date column chosen by hand in the columns step."""
        b = body()
        item = _imports.get(as_key(b.get("token")))
        if not item:
            raise ApiError(i18n.t("Import session expired: upload the file again"))
        col = as_int(b.get("column"), "column", required=False)
        width = len(item["rows"][0])
        col = col if col is not None and 0 <= col < width else None
        order, source = importer.detect_date_order(item["rows"][item["header_row"] + 1:], col,
                                                   util.DATE_ORDER_DEFAULT.get(util.currency_of(get_db()), "dmy"))
        return jsonify(date_order=order, date_order_source=source)

    @app.post("/api/import/analyze")
    def import_analyze():
        b = body()
        item = _imports.get(as_key(b.get("token")))
        if not item:
            raise ApiError(i18n.t("Import session expired: upload the file again"))
        account_id = as_int(b.get("account_id"), "account")
        own_account(account_id)
        width = len(item["rows"][0])
        mapping, chosen = {}, as_dict(b.get("mapping"), "columns")
        for k in importer.FIELD_KEYWORDS:
            v = as_int(chosen.get(k), "column", required=False)
            mapping[k] = v if v is not None and 0 <= v < width else None
        if mapping["date"] is None:
            raise ApiError(i18n.t("Select the date column"))
        if mapping["amount"] is None and mapping["debit"] is None and mapping["credit"] is None:
            raise ApiError(i18n.t("Select the amount column (or income/expense columns)"))
        order = b.get("date_order") or "dmy"
        if order not in ("dmy", "mdy"):
            raise ApiError(i18n.t("Invalid date format"))
        parsed = importer.parse_rows(item["rows"], item["header_row"], mapping, bool(b.get("invert")), order)

        db = get_db()
        cat = Categorizer(db, pf())
        by_name = {(c["name"].lower(), c["kind"]): c["id"] for c in db.execute(
            "SELECT * FROM categories WHERE portfolio_id = ?", (pf(),))}
        # duplicates: same account, type and amount with a date within DUP_DAYS days (the description may
        # differ, e.g. installments generated by recurring items). Each existing transaction covers only one row.
        dates = [p["date"] for p in parsed if p["date"]]
        existing = {}
        if dates:
            # also transfers already recorded: going out of the account they are a debit, coming in a credit
            for t in db.execute(
                """SELECT date, amount, CASE WHEN kind != 'transfer' THEN kind
                                             WHEN account_id = ? THEN 'expense' ELSE 'income' END AS kind
                   FROM transactions WHERE (account_id = ? OR (kind = 'transfer' AND to_account_id = ?))
                   AND date BETWEEN date(?, ?) AND date(?, ?)""",
                (account_id, account_id, account_id, min(dates), f"-{DUP_DAYS} day", max(dates), f"+{DUP_DAYS} day")):
                existing.setdefault((t["amount"], t["kind"]), []).append([parse_date(t["date"]), False])
        for p in parsed:
            cid = by_name.get((p["raw_category"].lower(), p["kind"])) if p["raw_category"] else None
            source = "file" if cid else None
            if not cid:
                s = cat.suggest(p["description"], p["kind"])
                cid, source = s["category_id"], s["source"]
            p["category_id"], p["category_source"] = cid, source
            p["duplicate"] = False
            if p["date"]:
                d = parse_date(p["date"])
                candidates = [e for e in existing.get((p["amount"], p["kind"]), [])
                              if not e[1] and abs((e[0] - d).days) <= DUP_DAYS]
                if candidates:
                    min(candidates, key=lambda e: abs((e[0] - d).days))[1] = True
                    p["duplicate"] = True
        return jsonify(rows=parsed)

    @app.post("/api/import/commit")
    def import_commit():
        b = body()
        account_id = as_int(b.get("account_id"), "account")
        own_account(account_id)
        rows = b.get("rows") or []
        if not isinstance(rows, list) or not rows or not all(isinstance(r, dict) for r in rows):
            raise ApiError(i18n.t("No transactions to import"))
        # an uploaded file is imported only once (e.g. double click on "Import": no duplicate rows)
        if _imports.pop(as_key(b.get("token")), None) is None:
            raise ApiError(i18n.t("This file has already been imported (or the session expired): upload it again if needed"), 409)
        db = get_db()
        cat_kind = {c["id"]: c["kind"] for c in db.execute("SELECT id, kind FROM categories WHERE portfolio_id = ?", (pf(),))}
        values = []
        for r in rows[:importer.MAX_ROWS]:
            kind = r.get("kind")
            if kind not in ("expense", "income"):
                continue
            d = parse_date(r.get("date"))
            amount = as_int(r.get("amount"), "amount", required=False)
            if not d or not amount or amount <= 0 or not ("1990-01-01" <= d.isoformat() <= (dt.date.today() + dt.timedelta(days=366)).isoformat()):
                continue
            cid = as_int(r.get("category_id"), "category", required=False)
            if cid is not None and cat_kind.get(cid) != kind:
                cid = None
            values.append((d.isoformat(), amount, kind, account_id, cid, as_text(r.get("description")),
                           "import"))
        db.executemany("INSERT INTO transactions(date, amount, kind, account_id, category_id, description,"
                       " source) VALUES (?,?,?,?,?,?,?)", values)
        db.commit()
        acc_name = db.execute("SELECT name FROM accounts WHERE id = ?", (account_id,)).fetchone()[0]
        note(i18n.tn("{n} transaction", "{n} transactions", len(values)) + f" · {acc_name}")
        return jsonify(imported=len(values))

    return app
