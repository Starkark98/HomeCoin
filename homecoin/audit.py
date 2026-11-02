"""Activity log of important operations (sign-ins, security, changes, deletions, import/export).

It lives in the encrypted database like everything else: no unencrypted log files. Only events that matter, one short
row each; rows older than 12 months delete themselves (and at most MAX_ROWS rows are kept anyway).
Failed sign-in attempts happen while the database is locked: they are counted in memory and logged at the next sign-in.
Rows written by older versions keep their Italian texts; new rows use the English texts below.
"""
import datetime as dt

from . import db as dbm

KEEP_MONTHS = 12
MAX_ROWS = 5000
KINDS = {"access": "Sign-in", "security": "Security", "change": "Change", "delete": "Deletion", "data": "Data"}

# endpoint -> (kind, description). Deliberately not logged (noise): reads, single new transactions, budgets,
# rules, recurring items processed automatically, price updates, auto-lock/unlock.
EVENTS = {
    "auth_setup": ("security", "Password created"),
    "auth_login": ("access", "Sign-in"),
    "auth_recover": ("security", "Sign-in with recovery key and new password"),
    "auth_password": ("security", "Password changed"),
    "auth_recovery_key": ("security", "New recovery key"),
    "auth_import_token": ("security", "Temporary import code created"),
    "auth_import_token_revoke": ("security", "Temporary import code revoked"),
    "auth_settings": ("security", "Auto-lock changed"),
    "auth_protect_folder": ("security", "Data folder restricted to your Windows user"),
    "portfolio_create": ("change", "Space created"),
    "portfolio_update": ("change", "Space edited"),
    "portfolio_delete": ("delete", "Space deleted"),
    "account_create": ("change", "Account created"),
    "account_update": ("change", "Account edited"),
    "account_delete": ("delete", "Account deleted"),
    "category_create": ("change", "Category created"),
    "category_update": ("change", "Category edited"),
    "category_delete": ("delete", "Category deleted"),
    "rules_apply": ("change", "Rules applied to transactions"),
    "tx_update": ("change", "Transaction edited"),
    "tx_delete": ("delete", "Transaction deleted"),
    "tx_bulk": ("change", "Bulk edit of transactions"),
    "recurring_create": ("change", "Recurring item created"),
    "recurring_update": ("change", "Recurring item edited"),
    "recurring_delete": ("delete", "Recurring item deleted"),
    "recurring_link": ("change", "Transactions linked to a recurring item"),
    "split_apply": ("change", "Fair split applied to recurring items"),
    "goal_delete": ("delete", "Goal deleted"),
    "valuation_delete": ("delete", "Valuation deleted"),
    "holding_add": ("change", "Security added"),
    "holding_update": ("change", "Security edited"),
    "holding_delete": ("delete", "Security deleted"),
    "trade_add": ("change", "Trade recorded"),
    "trade_update": ("change", "Trade edited"),
    "trade_delete": ("delete", "Trade deleted"),
    "import_commit": ("data", "Bank statement imported"),
    "import_bundle": ("data", "Bundle imported"),
    "export_transactions": ("data", "Transactions exported (unencrypted file)"),
    "export_report": ("data", "Report exported (unencrypted file)"),
    "currency_set": ("change", "Reference currency changed"),
    "backup": ("data", "Encrypted backup downloaded"),
    "restore": ("data", "Backup restored"),
}


def eur(cents):
    """Compact amount for activity log rows, in the reference currency: 1.234,56 € or $1,234.56."""
    from .util import fmt_money
    return fmt_money(cents)


def write(kind, action, detail="", portfolio=None, conn=None):
    """Append a row (own connection: works even after a restore or in a response already finished)."""
    own = conn is None
    conn = conn or dbm.connect()
    try:
        conn.execute("INSERT INTO audit_log(ts, kind, action, detail, portfolio) VALUES (?,?,?,?,?)",
                     (dt.datetime.now().isoformat(sep=" ", timespec="seconds"), kind, action, (detail or "")[:200],
                      (portfolio or "")[:40]))
        conn.commit()
    finally:
        if own:
            conn.close()


def purge(conn):
    """Cleanup: remove rows older than 12 months and those beyond the limit."""
    today = dt.date.today()
    cutoff = (today - dt.timedelta(days=round(KEEP_MONTHS * 30.44))).isoformat()
    n = conn.execute("DELETE FROM audit_log WHERE ts < ?", (cutoff,)).rowcount
    n += conn.execute("DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ?)",
                      (MAX_ROWS,)).rowcount
    conn.commit()
    return n
