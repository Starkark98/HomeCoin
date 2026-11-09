"""Domain logic: balances, recurring items, automatic categorization."""
import datetime as dt
import threading
from collections import Counter, defaultdict

from . import i18n
from .util import CURRENCIES, CURRENCY, occurrence, normalize_desc, rule_matches, parse_date, MONTHLY_FACTOR

MAX_GENERATE = 5000  # safety limit for recurring items with very old dates


def scheduled_amount(r, n, plan=None):
    from .tools import scheduled_amount as amount  # tools imports this module: imported here
    return amount(r, n, plan)


def account_balances(db, portfolio_id=None):
    """Account balances (of one space, or of all spaces if portfolio_id is None)."""
    rows = db.execute(
        """
        SELECT a.*,
          a.initial_balance
          + COALESCE((SELECT SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE -t.amount END)
                        FROM transactions t WHERE t.account_id = a.id), 0)
          + COALESCE((SELECT SUM(t.amount) FROM transactions t
                        WHERE t.kind = 'transfer' AND t.to_account_id = a.id), 0)
          + COALESCE((SELECT SUM(o.amount) FROM trades o WHERE o.account_id = a.id), 0) AS balance,
          (SELECT COUNT(*) FROM transactions t
             WHERE t.account_id = a.id OR t.to_account_id = a.id) AS tx_count
        FROM accounts a WHERE (? IS NULL OR a.portfolio_id = ?) ORDER BY a.archived, a.id
        """, (portfolio_id, portfolio_id)
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------- recurring items

def _limit_ok(r, n, d):
    if r["installments"] is not None and n >= r["installments"]:
        return False
    if r["end_date"] and d.isoformat() > r["end_date"]:
        return False
    return True


def next_occurrence(r):
    if not r["active"]:
        return None
    start = parse_date(r["start_date"])
    n = r["generated"]
    d = occurrence(start, r["frequency"], n)
    return d if _limit_ok(r, n, d) else None


def count_past_occurrences(r, today=None):
    """How many occurrences fall on or before today (used to treat past installments as 'already paid')."""
    today = today or dt.date.today()
    start = parse_date(r["start_date"])
    n = 0
    while n < MAX_GENERATE:
        d = occurrence(start, r["frequency"], n)
        if d > today or not _limit_ok(r, n, d):
            break
        n += 1
    return n


_RECURRING_LOCK = threading.Lock()  # one generation at a time: two open browser tabs do not create duplicates


def process_recurring(db, today=None):
    """Record every due occurrence of the active recurring items as a transaction."""
    with _RECURRING_LOCK:
        return _process_recurring(db, today)


def _process_recurring(db, today=None):
    today = today or dt.date.today()
    created = 0
    db.commit()  # re-read the updated state (generated) after a possible generation in another request
    # "expected" recurring items (variable amount and date) do not generate transactions: they link to the real ones
    for r in db.execute("SELECT * FROM recurring WHERE active = 1 AND NOT expected").fetchall():
        r = dict(r)
        start = parse_date(r["start_date"])
        n = r["generated"]
        plan = None
        if r.get("amortization") == "constant" and r["principal"] and r["installments"]:
            from .tools import loan_plan
            plan = loan_plan(r)  # constant principal: every installment has its own amount
        while n < MAX_GENERATE:
            d = occurrence(start, r["frequency"], n)
            if d > today or not _limit_ok(r, n, d):
                break
            if db.execute("SELECT 1 FROM transactions WHERE recurring_id = ? AND date = ? AND source = 'recurring'",
                          (r["id"], d.isoformat())).fetchone():  # already recorded: do not duplicate it
                n += 1
                continue
            label = r["name"]
            if r["installments"]:
                label = f"{r['name']} - {n + 1}/{r['installments']}"
            db.execute(
                """INSERT INTO transactions(date, amount, kind, account_id, to_account_id, category_id,
                                            description, recurring_id, source)
                   VALUES (?,?,?,?,?,?,?,?, 'recurring')""",
                (d.isoformat(), scheduled_amount(r, n, plan) if plan else r["amount"], r["kind"], r["account_id"],
                 r["to_account_id"] if r["kind"] == "transfer" else None,
                 r["category_id"] if r["kind"] != "transfer" else None, label, r["id"]),
            )
            if r["kind"] == "transfer" and r.get("holding_id"):
                pac_buy(db, r, d.isoformat())
            n += 1
            created += 1
        if n != r["generated"]:
            db.execute("UPDATE recurring SET generated = ? WHERE id = ?", (n, r["id"]))
        if plan:  # the amount shown everywhere (lists, emergency fund, fair split) is the next installment
            nxt = scheduled_amount(r, n, plan)
            if nxt != r["amount"]:
                db.execute("UPDATE recurring SET amount = ? WHERE id = ?", (nxt, r["id"]))
    from .forecast import link_expected
    link_expected(db)
    db.commit()
    return created


def pac_buy(db, r, date):
    """Investment plan: the recurring transfer immediately buys units of the linked security at the day's estimated price
    (last known price). The trade stays editable; without any known price the purchase stays "to be completed"."""
    from .tools import positions, price_at, sync_holdings
    h = db.execute("SELECT * FROM holdings WHERE id = ? AND account_id = ?", (r["holding_id"], r["to_account_id"])).fetchone()
    if not h or db.execute("SELECT 1 FROM trades WHERE external_id = ?", (f"pac:{r['id']}:{date}",)).fetchone():
        return False  # security missing, or the purchase for that transfer is already recorded
    pos, _ = positions(db, h["account_id"], date)
    price = price_at(db, h["id"], date, pos.get(h["id"]))
    if not price:
        return False
    db.execute("""INSERT INTO trades(account_id, holding_id, date, kind, quantity, price, amount, fees, notes, source, external_id)
                  VALUES (?,?,?, 'buy', ?, ?, ?, 0, ?, 'recurring', ?)""",
               (h["account_id"], h["id"], date, round(r["amount"] / 100 / price, 6), price, -r["amount"],
                i18n.t("Automatic purchase «{name}» · {estimated} {price}: replace it with the real one", name=r["name"],
                       estimated=i18n.t("estimated price"), price=f"{price:.4f} {CURRENCIES[CURRENCY['code']][0]}"),
                f"pac:{r['id']}:{date}"))
    sync_holdings(db, h["account_id"])
    return True


def pac_pending(db, portfolio_id):
    """Investment plan transfers already made but without the linked purchase (no price known at the time): to complete by hand."""
    out = []
    for r in db.execute("""SELECT r.*, h.ticker, h.name AS holding_name FROM recurring r
                           JOIN accounts a ON a.id = r.to_account_id JOIN holdings h ON h.id = r.holding_id
                           WHERE r.kind = 'transfer' AND a.portfolio_id = ?""", (portfolio_id,)):
        done = {row[0] for row in db.execute("SELECT external_id FROM trades WHERE external_id LIKE ?", (f"pac:{r['id']}:%",))}
        for t in db.execute("SELECT date, amount FROM transactions WHERE recurring_id = ? ORDER BY date", (r["id"],)):
            if f"pac:{r['id']}:{t['date']}" not in done and t["date"] >= (r["pac_since"] or "9999"):
                out.append({"recurring_id": r["id"], "name": r["name"], "date": t["date"], "amount": t["amount"],
                            "account_id": r["to_account_id"], "holding_id": r["holding_id"], "ticker": r["ticker"]})
    return out


def recurring_view(r):
    r = dict(r)
    nxt = next_occurrence(r)
    r["next_date"] = nxt.isoformat() if nxt else None
    r["monthly_equivalent"] = round(r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1))
    if r["installments"]:
        start = parse_date(r["start_date"])
        n = r["installments"]
        if r["end_date"]:  # installments with an end date too: only those up to the end count (the schedule stays the full one)
            n_end = 0
            while n_end < n and occurrence(start, r["frequency"], n_end).isoformat() <= r["end_date"]:
                n_end += 1
            n = n_end or n
        r["paid"] = min(r["generated"], n)
        r["remaining_installments"] = n - r["paid"]
        r["remaining_amount"] = r["remaining_installments"] * r["amount"]
        r["total_amount"] = n * r["amount"]
        r["last_date"] = occurrence(start, r["frequency"], n - 1).isoformat()
        r["progress"] = r["paid"] / n
        constant = r.get("amortization") == "constant" and r["principal"]
        if constant:  # every installment is different: totals from the schedule
            from .tools import loan_plan
            plan = loan_plan(r)
            amounts = [round(x["installment"]) for x in plan[:n]]
            r["remaining_amount"] = sum(amounts[r["paid"]:])
            r["total_amount"] = sum(amounts)
        if r["principal"]:
            if constant or r.get("rate_type") or r.get("rate") is not None:  # known rate: interest from the schedule (excluding ancillary costs)
                from .tools import loan_plan
                plan = loan_plan(r)
                r["interest"] = round(sum(x["interest"] for x in plan))
            else:
                r["interest"] = r["total_amount"] - r["principal"]
    return r


def upcoming(db, days=60, today=None, portfolio_id=None):
    today = today or dt.date.today()
    horizon = today + dt.timedelta(days=days)
    out = []
    for r in db.execute(
        """SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
                  a.name AS account_name
           FROM recurring r JOIN accounts a ON a.id = r.account_id
           LEFT JOIN categories c ON c.id = r.category_id
           WHERE r.active = 1 AND (? IS NULL OR a.portfolio_id = ?)""", (portfolio_id, portfolio_id)
    ).fetchall():
        r = dict(r)
        if r.get("expected"):  # variable amount and date: forecast from recent payments
            from .forecast import expected_forecast
            for d, amount, late, nominal in expected_forecast(db, r, today, horizon):
                out.append({"recurring_id": r["id"], "date": d.isoformat(), "nominal": nominal.isoformat(), "late": late,
                            "name": r["name"], "kind": r["kind"], "amount": amount, "account_name": r["account_name"],
                            "account_id": r["account_id"], "to_account_id": r["to_account_id"],
                            "category_name": r["category_name"], "category_icon": r["category_icon"],
                            "category_color": r["category_color"], "installment": None, "estimated": True, "source": "expected"})
            continue
        start = parse_date(r["start_date"])
        n = r["generated"]
        plan = None
        if r.get("amortization") == "constant" and r["principal"] and r["installments"]:
            from .tools import loan_plan
            plan = loan_plan(r)
        for _ in range(400):
            d = occurrence(start, r["frequency"], n)
            if d > horizon or not _limit_ok(r, n, d):
                break
            out.append({
                "recurring_id": r["id"], "date": d.isoformat(), "name": r["name"], "kind": r["kind"],
                "amount": scheduled_amount(r, n, plan) if plan else r["amount"], "account_name": r["account_name"],
                "account_id": r["account_id"], "to_account_id": r["to_account_id"],
                "category_name": r["category_name"], "category_icon": r["category_icon"],
                "category_color": r["category_color"],
                "installment": f"{n + 1}/{r['installments']}" if r["installments"] else None,
            })
            n += 1
    out.sort(key=lambda x: x["date"])
    return out


# ---------------------------------------------------- auto categorization

class Categorizer:
    """Suggest a transaction's category: rules first, then the history of similar transactions."""

    def __init__(self, db, portfolio_id):
        self.rules = [
            dict(r) for r in db.execute(
                """SELECT r.pattern, r.category_id, c.kind FROM rules r
                   JOIN categories c ON c.id = r.category_id WHERE c.portfolio_id = ?""", (portfolio_id,)
            )
        ]
        # longer patterns = more specific, they take precedence
        self.rules.sort(key=lambda r: len(r["pattern"]), reverse=True)
        self.history = defaultdict(Counter)
        self.last_amount = {}
        from .forecast import payee_key  # same payee even with a different month and year in the description
        self.key = payee_key
        for t in db.execute(
            """SELECT t.description, t.category_id, t.kind, t.amount FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE t.kind != 'transfer' AND c.portfolio_id = ?
               ORDER BY t.date DESC, t.id DESC LIMIT 5000""", (portfolio_id,)
        ):
            key = (payee_key(t["description"]), t["kind"])
            if key[0]:
                self.history[key][t["category_id"]] += 1
                self.last_amount.setdefault(key, t["amount"])

    def suggest(self, description, kind):
        for r in self.rules:
            if r["kind"] == kind and rule_matches(r["pattern"], description):
                return {"category_id": r["category_id"], "source": "regola", "pattern": r["pattern"]}
        key = (self.key(description), kind)
        if key[0] and key in self.history:
            cat, _ = self.history[key].most_common(1)[0]
            return {"category_id": cat, "source": "storico", "amount": self.last_amount.get(key)}
        return {"category_id": None, "source": None}
