"""Activity log of important operations (sign-ins, security, changes, deletions, import/export).

It lives in the encrypted database like everything else: no unencrypted log files. Only events that matter, one short
row each; rows older than 12 months delete themselves (and at most MAX_ROWS rows are kept anyway).
Failed sign-in attempts happen while the database is locked: they are counted in memory and logged at the next sign-in.
Rows written by older versions keep their Italian texts; new rows use the English texts below, which the page shows in
the interface language (the stored text stays English, so changing language changes the whole log).
"""
import datetime as dt

from . import db as dbm

KEEP_MONTHS = 12
MAX_ROWS = 5000
KINDS = {"access": "Sign-in", "security": "Security", "change": "Change", "delete": "Deletion", "data": "Data"}

# endpoint -> (kind, description). Logged: every deliberate change of settings, configuration or data, in every tab.
# Deliberately not logged (noise): reads and calculations (previews, simulations, comparisons), single new transactions,
# recurring items processed automatically, price updates, lock/unlock, the per-transaction choices of Fair split.
# Settings saved while typing (Fair split, budgets) are merged into one row per subject (see write(merge=...)).
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
    "category_to_transfers": ("change", "Expenses turned into transfers to another space"),
    "rules_apply": ("change", "Rules applied to transactions"),
    "tx_update": ("change", "Transaction edited"),
    "tx_delete": ("delete", "Transaction deleted"),
    "tx_bulk": ("change", "Bulk edit of transactions"),
    "recurring_create": ("change", "Recurring item created"),
    "recurring_update": ("change", "Recurring item edited"),
    "recurring_delete": ("delete", "Recurring item deleted"),
    "recurring_link": ("change", "Transactions linked to a recurring item"),
    "recurring_reconcile": ("change", "Recurring transfer reconciled between spaces"),
    "account_doubles": ("delete", "Money recorded twice removed from an account"),
    "account_compare_backup": ("change", "Transactions restored from an automatic backup"),
    "backup_settings_put": ("change", "Backup settings changed"),
    "backup_by_hand": ("change", "Backup saved by hand"),
    "backups_put_back": ("change", "Rows put back from an automatic backup"),
    "backups_restore_all": ("security", "All data restored from an automatic backup"),
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
    "auth_language": ("change", "Interface language changed"),
    "backup": ("data", "Encrypted backup downloaded"),
    "restore": ("data", "Backup restored"),
    # 2.4.4: the settings and configuration that were missing
    "update_settings": ("change", "Automatic update check changed"),
    "emergency_put": ("change", "Emergency fund target changed (months)"),
    "split_put": ("change", "Fair split settings changed"),
    "rebalance_calc": ("change", "Rebalancing targets saved"),
    "budget_put": ("change", "Budget changed"),
    "rule_create": ("change", "Rule created"),
    "rule_delete": ("delete", "Rule deleted"),
    "goal_create": ("change", "Goal created"),
    "goal_update": ("change", "Goal edited"),
    "valuation_add": ("change", "Valuation recorded"),
    # 2.5.0: portfolio analysis
    "portfolio_online": ("security", "Download of fund compositions changed"),
    "portfolio_refresh": ("data", "Fund compositions downloaded"),
    "holding_details": ("change", "Security edited"),
}
# actions written directly (not through EVENTS): listed so that they are translated like the others
OTHER_ACTIONS = ("HomeCoin closed", "HomeCoin updated")
MERGE_MINUTES = 10  # the same setting changed again within this time: the row is updated, not repeated


def eur(cents):
    """Compact amount for activity log rows, in the reference currency: 1.234,56 € or $1,234.56."""
    from .util import fmt_money
    return fmt_money(cents)


def write(kind, action, detail="", portfolio=None, conn=None, merge=None):
    """Append a row (own connection: works even after a restore or in a response already finished).
    merge: the subject of a setting saved while typing (e.g. a category name): if the newest row is the same action on
    the same subject and space, less than MERGE_MINUTES old, it is updated instead (time and detail)."""
    own = conn is None
    conn = conn or dbm.connect()
    now = dt.datetime.now()
    ts, detail, portfolio = now.isoformat(sep=" ", timespec="seconds"), (detail or "")[:200], (portfolio or "")[:40]
    try:
        last = conn.execute("SELECT id, ts, kind, action, detail, portfolio FROM audit_log ORDER BY id DESC LIMIT 1").fetchone() \
            if merge is not None else None
        if last and (last[2], last[3], last[5]) == (kind, action, portfolio) and last[4].startswith(merge) \
                and now - dt.datetime.fromisoformat(last[1]) < dt.timedelta(minutes=MERGE_MINUTES):
            if " → " in last[4] and " → " in detail:  # keep the value before the first change: "A → C", not "B → C"
                detail = (last[4].split(" → ", 1)[0] + " → " + detail.split(" → ", 1)[1])[:200]
            elif not merge:  # a list of what changed ("people, settings"): everything changed in those minutes
                parts = [p for p in (last[4] + ", " + detail).split(", ") if p]
                detail = ", ".join(dict.fromkeys(parts))[:200]
            conn.execute("UPDATE audit_log SET ts = ?, detail = ? WHERE id = ?", (ts, detail, last[0]))
        else:
            conn.execute("INSERT INTO audit_log(ts, kind, action, detail, portfolio) VALUES (?,?,?,?,?)",
                         (ts, kind, action, detail, portfolio))
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
