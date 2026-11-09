"""Analysis tools: mortgage schedule, emergency fund, goals, investments, savings rate, net worth.

All amounts are in cents. Accounts of type 'investimenti' are investments, the others are cash.
"""
import datetime as dt
import json
import re
import urllib.parse
import urllib.request

from . import i18n
from .services import account_balances
from .util import (OTHER_INVESTMENTS, SYSTEM_CODES, TECH_CATEGORIES, add_months, currency_of, fmt_decimal, fmt_money, occurrence,
                   parse_date)

INVEST = "investimenti"


# ------------------------------------------------------------------ helpers

def month_end(ym):
    y, m = map(int, ym.split("-"))
    return add_months(dt.date(y, m, 1), 1) - dt.timedelta(days=1)


def months_back(n, today=None):
    """List of 'YYYY-MM' for the last n months, current month included."""
    today = today or dt.date.today()
    first = today.replace(day=1)
    return [add_months(first, -i).strftime("%Y-%m") for i in range(n - 1, -1, -1)]


def complete_months(n, today=None):
    today = today or dt.date.today()
    first = today.replace(day=1)
    return add_months(first, -n).isoformat(), (first - dt.timedelta(days=1)).isoformat()


def history_months(db, pid, cap=240, today=None):
    """Months covered by the space's history: from the month of the first transaction to the current one (included)."""
    first = db.execute("""SELECT MIN(d) FROM (SELECT MIN(t.date) AS d FROM transactions t JOIN accounts a ON a.id = t.account_id
                                              WHERE a.portfolio_id = ?
                                              UNION ALL SELECT MIN(o.date) FROM trades o JOIN accounts a ON a.id = o.account_id
                                              WHERE a.portfolio_id = ?)""", (pid, pid)).fetchone()[0]
    today = today or dt.date.today()
    if not first:
        return 1
    y, m = int(first[:4]), int(first[5:7])
    return max(1, min(cap, (today.year - y) * 12 + today.month - m + 1))


def months_arg(db, pid, value, default, minimum=1, cap=240):
    """'months' parameter of the analyses: a number, or 'all' = the whole history."""
    if value == "all":
        return history_months(db, pid, cap)
    try:
        return max(minimum, min(cap, int(value or default)))
    except (TypeError, ValueError):
        return default


def pf_accounts(db, pid, active_only=True):
    return [dict(a) for a in db.execute(
        f"SELECT * FROM accounts WHERE portfolio_id = ? {'AND NOT archived' if active_only else ''} ORDER BY id", (pid,))]


def setting(db, key, pid, default):
    r = db.execute("SELECT value FROM settings WHERE key = ?", (f"{key}@{pid}",)).fetchone()
    return r[0] if r else default


def set_setting(db, key, pid, value):
    db.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
               (f"{key}@{pid}", str(value)))


# ------------------------------------------------------- mortgage schedule

RATE_TYPES = ("fixed", "variable", "mixed")
# reference indexes of variable and mixed-rate loans, per reference currency (same list as RATE_INDEXES in app.js; the
# UI offers only those of the installation's currency, the first is the default). Any of them stays valid in a saved loan,
# e.g. after a change of currency. The schedule uses the current value entered by hand: HomeCoin does not download rates
RATE_INDEX_GROUPS = {
    "EUR": ("Euribor 3M", "Euribor 1M", "Euribor 6M", "Euribor 12M"),
    "USD": ("SOFR 30-day average", "Term SOFR 1M", "Term SOFR 3M", "Term SOFR 6M", "US Treasury 1Y (CMT)", "US Prime Rate"),
    "GBP": ("Bank of England Bank Rate", "SONIA"),
    "CHF": ("SARON",),
    "CAD": ("Canadian prime rate", "CORRA"),
    "AUD": ("RBA cash rate", "BBSW 3M"),
    "MXN": ("TIIE 28", "TIIE de Fondeo"),
    "BRL": ("TR", "IPCA", "Selic", "CDI"),  # IPCA: inflation, for inflation-linked loans
}
# indexes of currencies HomeCoin no longer offers: a loan saved with one of them keeps it (shown and accepted)
LEGACY_RATE_INDEXES = ("Short-term prime rate (Japan)", "TIBOR 3M", "TONA", "RBI repo rate", "MCLR 1Y")
RATE_INDEXES = tuple(i for g in RATE_INDEX_GROUPS.values() for i in g) + LEGACY_RATE_INDEXES
DEFAULT_RATE_INDEX = {cur: g[0] for cur, g in RATE_INDEX_GROUPS.items()}


def rate_fn(rec):
    """Annual rate (%) of installment k (0 = first): fixed, variable (index + spread) or mixed (fixed for N years, then variable)."""
    kind = rec.get("rate_type") or "fixed"
    fixed = rec.get("rate") or 0
    variable = (rec.get("index_value") or 0) + (rec.get("spread") or 0)
    if kind == "variable":
        return lambda k: variable
    if kind == "mixed":
        switch = (rec.get("fixed_years") or 0) * 12
        return lambda k: fixed if k < switch else variable
    return lambda k: fixed


def rate_label(rec):
    kind = rec.get("rate_type") or "fixed"
    pct = lambda x: fmt_decimal(x) + "%"  # decimal separator of the currency's country
    var = f"{rec.get('rate_index') or 'index'} + {pct(rec.get('spread') or 0)}"
    if kind == "variable":
        return i18n.t("variable: {rate}", rate=var)
    if kind == "mixed":
        return i18n.t("mixed: {fixed} fixed for {years} years, then {variable}", fixed=pct(rec.get('rate') or 0),
                      years=rec.get('fixed_years') or 0, variable=var)
    return i18n.t("fixed {rate}", rate=pct(rec.get('rate') or 0)) if rec.get("rate") is not None else i18n.t("rate not specified")


AMORTIZATION_METHODS = ("french", "constant")


def amortization(principal, rate, n, start, installment=None, k0=0, method="french", capital=None):
    """Amortization schedule. `rate` = constant annual rate % or a function k -> rate (absolute k, 0 = first installment).
    method "french": constant installment. Without `installment` the installment is recalculated at every rate change on
    the residual and remaining installments; with `installment` it stays fixed and the term changes (early repayment
    'shorten term').
    method "constant" (constant principal: Italian amortization, SAC in Brazil): every installment repays the same share
    of principal, `capital` (default principal / n), plus the interest on the residual, so installments go down over time.
    With a given `capital` and a smaller residual the term gets shorter (early repayment 'shorten term')."""
    fn = rate if callable(rate) else (lambda k, r=rate: r or 0)
    if method == "constant":
        rows, residual, share = [], principal, capital or (principal / n if n else 0)
        for j in range(n):
            k = k0 + j
            r = fn(k)
            interest = residual * r / 100 / 12
            cap = residual if j == n - 1 else min(residual, share)  # the last installment closes any rounding left
            residual = max(0.0, residual - cap)
            rows.append({"n": k + 1, "date": occurrence(start, "monthly", j).isoformat(), "installment": cap + interest,
                         "capital": cap, "interest": interest, "residual": residual, "rate": r})
            if residual <= 0.5:
                break
        return rows
    rows, residual, last_rate, inst = [], principal, None, installment
    for j in range(n):
        k = k0 + j
        r = fn(k)
        i = r / 100 / 12
        if installment is None and r != last_rate:  # new installment on the residual for the remaining installments
            left = n - j
            inst = residual / left if i == 0 else residual * i / (1 - (1 + i) ** -left)
        last_rate = r
        interest = residual * i
        capital = min(residual, inst - interest)
        residual = max(0.0, residual - capital)
        rows.append({"n": k + 1, "date": occurrence(start, "monthly", j).isoformat(), "installment": capital + interest,
                     "capital": capital, "interest": interest, "residual": residual, "rate": r})
        if residual <= 0.5:
            break
    return rows


def method_of(rec):
    return "constant" if rec.get("amortization") == "constant" else "french"


def loan_plan(rec, principal=None):
    """Full schedule of a recurring item with installments, with its rate and amortization method."""
    return amortization(principal or rec["principal"], rate_fn(rec), rec["installments"], parse_date(rec["start_date"]),
                        method=method_of(rec))


def scheduled_amount(rec, n, plan=None):
    """Amount of installment n (0 = first) of a recurring item. Constant-principal loans: from the schedule, since every
    installment is different; anything else: the amount of the recurring item."""
    if method_of(rec) == "constant" and rec.get("principal") and rec.get("installments"):
        plan = plan or loan_plan(rec)
        if plan:
            return max(1, round(plan[min(n, len(plan) - 1)]["installment"]))
    return rec["amount"]


def residual_at(rec, when):
    """Outstanding principal of a loan at a date (None if it is not a loan with a principal)."""
    if not rec["installments"] or not rec["principal"]:
        return None
    plan = loan_plan(dict(rec))
    paid = [r for r in plan if r["date"] <= when.isoformat()]
    return paid[-1]["residual"] if paid else rec["principal"]


def mortgage_plans(db, pid, today=None):
    today = today or dt.date.today()
    out = []
    for rec in db.execute(
        """SELECT r.*, a.name AS account_name FROM recurring r JOIN accounts a ON a.id = r.account_id
           WHERE a.portfolio_id = ? AND r.kind = 'expense' AND r.installments IS NOT NULL ORDER BY r.amount DESC""", (pid,)):
        rec = dict(rec)
        principal = rec["principal"] or rec["amount"] * rec["installments"]
        plan = loan_plan(rec, principal)
        done = [r for r in plan if r["date"] <= today.isoformat()]
        left = plan[len(done):]
        current = left[0] if left else plan[-1]
        change = next((r for r in left if r["rate"] != current["rate"]), None)  # next rate change (mixed)
        variable = rec.get("rate_type") in ("variable", "mixed")
        out.append({
            "id": rec["id"], "name": rec["name"], "account": rec["account_name"],
            "amortization": method_of(rec), "first_installment": round(plan[0]["installment"]),
            "last_installment": round(plan[-1]["installment"]),
            "rate_type": rec.get("rate_type") or "fixed", "rate": rec["rate"], "fixed_years": rec.get("fixed_years"),
            "rate_index": rec.get("rate_index"), "spread": rec.get("spread"), "index_value": rec.get("index_value"),
            "rate_label": rate_label(rec), "current_rate": current["rate"],
            "index_missing": variable and rec.get("index_value") is None,
            "rate_change": {"date": change["date"], "n": change["n"], "rate": change["rate"],
                            "installment": round(change["installment"])} if change else None,
            "principal": principal, "installments": rec["installments"], "installment": round(current["installment"]),
            "paid": len(done), "residual": round(done[-1]["residual"] if done else principal),
            "interest_paid": round(sum(r["interest"] for r in done)), "interest_left": round(sum(r["interest"] for r in left)),
            "capital_paid": round(sum(r["capital"] for r in done)), "end_date": plan[-1]["date"],
            "rate_known": rec["rate"] is not None or variable,
            "schedule": [{k: (round(v) if isinstance(v, float) and k != "rate" else v) for k, v in r.items()} for r in plan],
            "_rec": rec,
        })
    return out


def simulate_prepayment(plan, extra, after_payment, mode):
    """Early repayment of `extra` after installment `after_payment`: shortens the term or lowers the installment."""
    n, fn = plan["installments"], rate_fn(plan["_rec"])
    sched = plan["schedule"]
    k = max(0, min(after_payment, len(sched)))
    before = sched[k - 1]["residual"] if k else plan["principal"]
    residual = before - extra
    notes = []
    if after_payment < plan["paid"]:
        notes.append({"level": "info", "text": i18n.t("Installment {after_payment} is already paid: this is a what-if on the past.", after_payment=after_payment)})
    if after_payment >= len(sched):
        notes.append({"level": "warn", "text": i18n.t("The loan is already fully repaid at that installment.")})
    if not plan.get("rate_known"):
        notes.append({"level": "warn", "text": i18n.t("The rate is not specified: calculated at 0%, so no interest is saved. Set the rate in Recurring.")})
    if residual <= 0:
        if residual < 0 and after_payment < len(sched):
            notes.append({"level": "info", "text": i18n.t("The amount is more than the residual debt: {amount} is enough to close the loan.", amount=fmt_money(round(before)))})
        return {"closed": True, "interest_saved": sum(r["interest"] for r in sched[k:]), "new_installment": 0,
                "new_remaining": 0, "new_end": sched[k - 1]["date"] if k else sched[0]["date"], "notes": notes}
    remaining_n = n - k
    old_interest = sum(r["interest"] for r in sched[k:])
    start = parse_date(sched[k]["date"]) if k < len(sched) else parse_date(sched[-1]["date"])
    method = method_of(plan["_rec"])
    if method == "constant":  # same principal share (shorter) or the residual spread over the same term (lower)
        share = sched[k]["capital"] if mode == "duration" and k < len(sched) else None
        new = amortization(residual, fn, remaining_n, start, k0=k, method="constant", capital=share)
    elif mode == "duration":  # same installment, fewer installments
        new = amortization(residual, fn, remaining_n, start, installment=sched[k]["installment"] if k < len(sched) else None, k0=k)
    else:  # same term, lower installment (also recalculated at rate changes)
        new = amortization(residual, fn, remaining_n, start, k0=k)
    return {"closed": False, "new_installment": round(new[0]["installment"]), "new_remaining": len(new),
            "new_end": new[-1]["date"], "interest_saved": round(old_interest - sum(r["interest"] for r in new)),
            "months_saved": remaining_n - len(new), "notes": notes}


# ---------------------------------------------------- cash and emergency fund

def market_values(db, pid, when=None):
    """Current value of investment accounts: latest valuation (up to `when`) or, if missing, the book balance."""
    when = (when or dt.date.today()).isoformat()
    out = {}
    # archived (closed) accounts too: they count in net worth for the months they held money, like normal accounts
    for a in pf_accounts(db, pid, active_only=False):
        if a["type"] != INVEST:
            continue
        if has_trades(db, a["id"]):  # account with trades: cash + securities, at any date
            out[a["id"]] = {"value": trades_value(db, a, when), "date": when, "estimated": False, "trades": True}
            continue
        v = db.execute("SELECT value, date FROM valuations WHERE account_id = ? AND date <= ? ORDER BY date DESC LIMIT 1",
                       (a["id"], when)).fetchone()
        out[a["id"]] = {"value": v[0] if v else book_balance(db, a, when), "date": v[1] if v else None, "estimated": not v}
    return out


def book_balance(db, account, when):
    """Book balance of an account at a date (opening balance + transactions + security trades up to that date)."""
    return account["initial_balance"] + db.execute(
        """SELECT COALESCE(SUM(CASE WHEN account_id = :a THEN (CASE WHEN kind = 'income' THEN amount ELSE -amount END)
                               ELSE amount END), 0)
           FROM transactions WHERE (account_id = :a OR (kind = 'transfer' AND to_account_id = :a)) AND date <= :d""",
        {"a": account["id"], "d": when}).fetchone()[0] + db.execute(
        "SELECT COALESCE(SUM(amount), 0) FROM trades WHERE account_id = ? AND date <= ?", (account["id"], when)).fetchone()[0]


def invest_adjustment(db, pid, when, account_id=None):
    """How much to add to the 'from transactions' balance of investment accounts to get their market value at a date:
    value − book balance + effect of the trades (which the transactions do not include)."""
    when = when if isinstance(when, str) else when.isoformat()
    mv = market_values(db, pid, parse_date(when))
    adj = 0
    for a in pf_accounts(db, pid, active_only=False):
        if a["id"] not in mv or (account_id and a["id"] != account_id):
            continue
        trades_cash = db.execute("SELECT COALESCE(SUM(amount), 0) FROM trades WHERE account_id = ? AND date <= ?",
                                 (a["id"], when)).fetchone()[0]
        adj += mv[a["id"]]["value"] - book_balance(db, a, when) + trades_cash
    return adj


# ------------------------------------------------- security trades and positions

TRADE_KINDS = {"buy": "Buy", "sell": "Sell", "split": "Split / reverse split",
               "capital": "Capital return", "interest": "Interest", "dividend": "Dividend", "fee": "Fee"}


def has_trades(db, account_id):
    return db.execute("SELECT 1 FROM trades WHERE account_id = ? LIMIT 1", (account_id,)).fetchone() is not None


def positions(db, account_id, when=None):
    """Positions per security from the trades (weighted average cost): quantity, cost, average cost, realized gains,
    last trade price. Trades without a security (interest, fees) go into 'income'."""
    when = when or "9999-12-31"
    pos, income = {}, 0
    for t in db.execute("SELECT * FROM trades WHERE account_id = ? AND date <= ? ORDER BY date, id", (account_id, when)):
        if t["holding_id"] is None:
            income += t["amount"]
            continue
        p = pos.setdefault(t["holding_id"], {"quantity": 0.0, "cost": 0.0, "realized": 0.0, "income": 0.0,
                                             "last_price": None, "last_date": None, "trades": 0})
        p["trades"] += 1
        k, q = t["kind"], t["quantity"]
        if k == "buy":
            p["quantity"] += q
            p["cost"] += -t["amount"]
        elif k == "sell":
            sold = abs(q)
            cost_out = p["cost"] * sold / p["quantity"] if p["quantity"] > 1e-9 else 0
            p["quantity"] -= sold
            p["cost"] -= cost_out
            p["realized"] += t["amount"] - cost_out
        elif k == "split":  # split / reverse split: the last known price must be rescaled too
            before = p["quantity"]
            p["quantity"] += q
            if p["last_price"] and before > 1e-9 and p["quantity"] > 1e-9:
                p["last_price"] *= before / p["quantity"]
        elif k == "capital":
            p["cost"] -= t["amount"]
        elif k in ("dividend", "interest", "fee"):
            p["income"] += t["amount"]
        if t["price"] and k in ("buy", "sell"):
            p["last_price"], p["last_date"] = t["price"], t["date"]
        if abs(p["quantity"]) < 1e-9:
            p["quantity"], p["cost"] = 0.0, 0.0
    for p in pos.values():
        p["avg_price"] = p["cost"] / p["quantity"] / 100 if p["quantity"] > 1e-9 else None
    return pos, income


def negative_position(db, account_id):
    """First security that, following the trades in date order, drops below zero units (selling units not owned):
    (ticker, date) or None. On the same day, buys count before sells."""
    q = {}
    for hid, date, qty, ticker in db.execute(
            """SELECT o.holding_id, o.date, o.quantity, h.ticker FROM trades o JOIN holdings h ON h.id = o.holding_id
               WHERE o.account_id = ? AND o.kind IN ('buy', 'sell', 'split') ORDER BY o.date, o.quantity DESC, o.id""",
            (account_id,)):
        q[hid] = q.get(hid, 0) + (qty or 0)
        if q[hid] < -1e-6:
            return ticker, date
    return None


def sync_holdings(db, account_id):
    """Align the quantity of securities that have trades with the quantity computed from the trades."""
    pos, _ = positions(db, account_id)
    for hid, p in pos.items():
        db.execute("UPDATE holdings SET quantity = ? WHERE id = ?", (round(p["quantity"], 6), hid))


def trades_value(db, account, when):
    """Estimated value at a date of an account with trades: cash + quantity × price (current price if available and the date
    is after the last update, otherwise the last known trade price)."""
    pos, _ = positions(db, account["id"], when)
    value = book_balance(db, account, when)
    for hid, p in pos.items():
        if p["quantity"] <= 1e-9:
            continue
        value += round(p["quantity"] * (price_at(db, hid, when, p) or 0) * 100)
    return value


def price_at(db, holding_id, when, pos=None):
    """Price (reference currency) of a security at a date: current price if the date is after the last update, otherwise the historical
    month-end price; without history, the last trade price known at that date."""
    h = db.execute("SELECT price_eur, price_date FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if h and h["price_eur"] is not None and h["price_date"] and h["price_date"] <= when and when[:7] >= h["price_date"][:7]:
        return h["price_eur"]
    hist = db.execute("SELECT price_eur FROM price_history WHERE holding_id = ? AND month <= ? ORDER BY month DESC LIMIT 1",
                      (holding_id, when[:7])).fetchone()
    trade = pos["last_price"] if pos else None
    if hist and pos and pos["last_date"] and pos["last_date"][:7] > db.execute(
            "SELECT MAX(month) FROM price_history WHERE holding_id = ? AND month <= ?", (holding_id, when[:7])).fetchone()[0]:
        return trade  # there is a trade more recent than the latest available historical price
    return hist["price_eur"] if hist else trade


def emergency(db, pid):
    months = 6
    target = float(setting(db, "emergency_months", pid, 6))
    accs = [{**a, "group": "conti"} for a in account_balances(db, pid) if not a["archived"] and a["type"] != INVEST]
    # in investment accounts, uninvested cash and money market securities count as emergency cash
    today = dt.date.today().isoformat()
    for a in [x for x in pf_accounts(db, pid) if x["type"] == INVEST and has_trades(db, x["id"])]:
        pos, _ = positions(db, a["id"])
        mon = sum(round(p["quantity"] * (price_at(db, hid, today, p) or 0) * 100) for hid, p in pos.items() if p["quantity"] > 1e-9
                  and (db.execute("SELECT asset_class FROM holdings WHERE id = ?", (hid,)).fetchone() or [""])[0] == "monetario")
        avail = book_balance(db, a, today) + mon
        if avail > 0:
            accs.append({"id": a["id"], "name": i18n.t("{name} (cash and money market)", name=a['name']), "balance": avail, "color": a["color"],
                         "group": "broker", "cash": book_balance(db, a, today), "money_market": mon})
    liquidity = sum(a["balance"] for a in accs)
    operational = sum(a["balance"] for a in accs if a["group"] == "conti")  # = the Calendar's "cash in accounts"
    d_from, d_to = complete_months(months)
    # average spending: includes contributions to other spaces too (e.g. the household account), which must be covered anyway
    exp = db.execute(
        """SELECT COALESCE(SUM(t.amount), 0) FROM transactions t JOIN accounts a ON a.id = t.account_id
           WHERE a.portfolio_id = ? AND t.kind = 'expense' AND NOT t.excluded AND t.date BETWEEN ? AND ?""",
        (pid, d_from, d_to)).fetchone()[0] / months
    from .util import MONTHLY_FACTOR
    fixed = sum(r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1) for r in db.execute(
        """SELECT r.amount, r.frequency FROM recurring r JOIN accounts a ON a.id = r.account_id
           WHERE a.portfolio_id = ? AND r.kind = 'expense' AND r.active = 1""", (pid,)))
    notes = []
    first = db.execute("""SELECT MIN(t.date) FROM transactions t JOIN accounts a ON a.id = t.account_id
                          WHERE a.portfolio_id = ? AND t.kind = 'expense'""", (pid,)).fetchone()[0]
    if first and first > d_from:  # fewer than `months` of history: the average is too low
        f, e = parse_date(first), parse_date(d_to)
        have = max(0, (e.year - f.year) * 12 + e.month - f.month + (f.day == 1))
        notes.append({"level": "warn", "text": i18n.tn("Only {n} complete month of expenses recorded: the average over {months} months is lower than your real spending.", "Only {n} complete months of expenses recorded: the average over {months} months is lower than your real spending.", have, months=months)})
    elif not exp:
        notes.append({"level": "info", "text": i18n.t("No expenses in the last {months} complete months: the months covered cannot be calculated.", months=months)})
    if liquidity < 0:
        notes.append({"level": "warn", "text": i18n.t("The available reserve is negative: some accounts (e.g. a credit card) are below zero.")})
    return {"notes": notes, "liquidity": liquidity, "operational": operational, "broker_cash": liquidity - operational,
            "accounts": [{"id": a["id"], "name": a["name"], "balance": a["balance"], "color": a["color"], "group": a["group"]}
                         for a in accs],
            "avg_expenses": round(exp), "fixed_monthly": round(fixed), "months_basis": months,
            "months_total": liquidity / exp if exp else None, "months_fixed": liquidity / fixed if fixed else None,
            "target_months": target, "target_amount": round(target * exp), "from": d_from, "to": d_to}


# --------------------------------------------------------------------- goals

def goals(db, pid, today=None):
    today = today or dt.date.today()
    balances = {a["id"]: a["balance"] for a in account_balances(db, pid)}
    mv = market_values(db, pid)
    people = [dict(p) for p in db.execute("SELECT name, income FROM people WHERE portfolio_id = ? ORDER BY position, id", (pid,))]
    tot_income = sum(p["income"] for p in people)
    out = []
    rows = [dict(g) for g in db.execute("SELECT g.*, a.name AS account_name FROM goals g LEFT JOIN accounts a ON a.id = g.account_id "
                                        "WHERE g.portfolio_id = ? ORDER BY g.position, g.id", (pid,))]
    for g in rows:
        g["notes"] = []
        shared = [o["name"] for o in rows if o is not g and o["account_id"] and o["account_id"] == g["account_id"]]
        if shared:  # the same balance counted for several goals
            g["notes"].append({"level": "warn", "text": i18n.t("{account_name} is also used by {value}: its balance counts for each goal, so the progress is overstated.", account_name=g['account_name'], value=', '.join(shared))})
        cur = (mv[g["account_id"]]["value"] if g["account_id"] in mv else balances.get(g["account_id"], 0)) \
            if g["account_id"] else g["saved"]
        g["current"] = max(0, cur)
        g["progress"] = min(1.0, g["current"] / g["target"])
        g["missing"] = max(0, g["target"] - g["current"])
        if g["account_id"] and cur < 0:
            g["notes"].append({"level": "warn", "text": i18n.t("{account_name} is below zero: the goal counts as not started.", account_name=g['account_name'])})
        if g["target_date"]:
            td = parse_date(g["target_date"])
            if td < today and g["missing"]:
                g["overdue"] = True
                g["notes"].append({"level": "warn", "text": i18n.t("The target date has passed: move it forward to get a realistic monthly amount.")})
            months_left = max(1, (td.year - today.year) * 12 + td.month - today.month)
            g["months_left"] = months_left
            g["monthly_needed"] = round(g["missing"] / months_left)
            if people and tot_income:  # each person's share in proportion to income
                g["per_person"] = [{"name": p["name"], "monthly": round(g["monthly_needed"] * p["income"] / tot_income)}
                                   for p in people]
        out.append(g)
    return out


# --------------------------------------------------------------- investments

def xirr(flows):
    """Annual internal rate of return on flows [(date, amount)], negative = contributions. None if it cannot be computed."""
    if len(flows) < 2 or not any(v < 0 for _, v in flows) or not any(v > 0 for _, v in flows):
        return None
    t0 = min(d for d, _ in flows)

    def npv(r):
        return sum(v / (1 + r) ** ((d - t0).days / 365.0) for d, v in flows)

    lo, hi = -0.99, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-6:
            break
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


VERIFY_DAYS = 30        # investment plan purchases with an estimated price, still unverified after more than N days


def pac_unverified(db, pid, today=None):
    """Automatic investment plan purchases that still have the estimated price after more than VERIFY_DAYS days.
    The note says "estimated price" in the language it was written in (any of them, or the Italian of older databases)."""
    limit = ((today or dt.date.today()) - dt.timedelta(days=VERIFY_DAYS)).isoformat()
    markers = sorted(i18n.estimated_markers())
    like = " OR ".join("o.notes LIKE ?" for _ in markers)
    out = []
    for o in db.execute(f"""SELECT o.*, h.ticker, a.name AS account_name
                           FROM trades o JOIN accounts a ON a.id = o.account_id LEFT JOIN holdings h ON h.id = o.holding_id
                           WHERE a.portfolio_id = ? AND o.source = 'recurring' AND ({like}) AND o.date <= ?
                           ORDER BY o.date""", (pid, *[f"%{m}%" for m in markers], limit)):
        o = dict(o)
        parts = (o["external_id"] or "").split(":")
        o["recurring_id"] = int(parts[1]) if len(parts) == 3 and parts[1].isdigit() else None
        out.append(o)
    return out


IDLE_DAYS = 30          # cash idle on the broker for at least N days…
IDLE_MIN = 10000        # …and above 100 € (in cents)…
IDLE_SHARE = 0.02       # …and above 2% of the account value


def idle_cash(db, account, cash, value, today=None):
    """Warning when cash arrived on the investment account and has not been used for purchases for IDLE_DAYS days:
    often it is an unrecorded purchase. None if there is nothing to report."""
    if cash is None or cash <= max(IDLE_MIN, IDLE_SHARE * max(value, 0)):
        return None
    today = today or dt.date.today()
    last_buy = db.execute("SELECT MAX(date) FROM trades WHERE account_id = ? AND kind = 'buy'", (account["id"],)).fetchone()[0]
    last_in = db.execute("""SELECT MAX(date) FROM transactions WHERE (kind = 'transfer' AND to_account_id = :a)
                            OR (kind = 'income' AND account_id = :a)""", {"a": account["id"]}).fetchone()[0]
    since = max(d for d in (last_buy, last_in) if d) if (last_buy or last_in) else None
    if not since:
        return None
    days = (today - parse_date(since)).days
    return {"since": since, "days": days, "cash": cash} if days >= IDLE_DAYS else None


def investments(db, pid, months=24):
    accs = [a for a in pf_accounts(db, pid) if a["type"] == INVEST]
    mv = market_values(db, pid)
    out, all_flows, total_value, total_in = [], [], 0, 0
    alloc = {}
    for a in accs:
        flows = [dict(r) for r in db.execute(
            """SELECT date, CASE WHEN (kind = 'transfer' AND to_account_id = :a) OR (kind = 'income' AND account_id = :a)
                                 THEN amount ELSE -amount END AS v
               FROM transactions WHERE account_id = :a OR to_account_id = :a ORDER BY date""", {"a": a["id"]})]
        invested = sum(f["v"] for f in flows)
        value = mv[a["id"]]["value"]
        vals = [dict(v) for v in db.execute("SELECT id, date, value, source FROM valuations WHERE account_id = ? ORDER BY date",
                                            (a["id"],))]
        holds = [dict(h) for h in db.execute("SELECT * FROM holdings WHERE account_id = ? ORDER BY id", (a["id"],))]
        pos, trade_income = positions(db, a["id"])
        for h in holds:
            p = pos.get(h["id"])
            price = h["price_eur"] if h["price_eur"] is not None else (p["last_price"] if p else None)
            h["value"] = round(h["quantity"] * price * 100) if price is not None else None
            h["estimated_price"] = h["price_eur"] is None and price is not None
            if p:  # security with trades: weighted average cost and results
                h.update(cost=round(p["cost"]), avg_price=p["avg_price"], realized=round(p["realized"]),
                         income=round(p["income"]), trades=p["trades"],
                         unrealized=h["value"] - round(p["cost"]) if h["value"] is not None else None)
            if h["value"]:
                alloc[h["asset_class"]] = alloc.get(h["asset_class"], 0) + h["value"]
        has_t = bool(pos) or db.execute("SELECT 1 FROM trades WHERE account_id = ? LIMIT 1", (a["id"],)).fetchone()
        cash_now = book_balance(db, a, dt.date.today().isoformat()) if has_t else None
        # allocation keys: asset class codes plus 'liquidità' (cash) and 'non specificato' (unspecified), mapped to labels by the UI
        if has_t and cash_now > 0:
            alloc["liquidità"] = alloc.get("liquidità", 0) + cash_now
        if not has_t and not any(h["value"] for h in holds) and value > 0:
            alloc["non specificato"] = alloc.get("non specificato", 0) + value
        val_date = parse_date(mv[a["id"]]["date"]) if mv[a["id"]]["date"] else dt.date.today()
        cash = [(parse_date(f["date"]), -f["v"]) for f in flows] + [(val_date, value)]
        all_flows += [(parse_date(f["date"]), -f["v"]) for f in flows]
        total_value += value
        total_in += invested
        out.append({"id": a["id"], "name": a["name"], "color": a["color"], "icon": a["icon"], "invested": invested,
                    "value": value, "value_date": mv[a["id"]]["date"], "estimated": mv[a["id"]]["estimated"],
                    "gain": value - invested, "return": (value - invested) / invested if invested > 0 else None,
                    "xirr": xirr(cash), "valuations": vals, "holdings": holds, "has_trades": bool(has_t),
                    "cash": cash_now, "trade_income": trade_income, "idle": idle_cash(db, a, cash_now, value) if has_t else None,
                    "realized": sum(h.get("realized", 0) for h in holds)})
    total_xirr = xirr(all_flows + [(dt.date.today(), total_value)]) if accs else None
    # monthly trend: cumulative invested amount and value (latest valuation up to month end)
    series = []
    for ym in months_back(months):
        end = month_end(ym)
        inv = val = 0
        for a in accs:
            inv += db.execute(
                """SELECT COALESCE(SUM(CASE WHEN (kind='transfer' AND to_account_id=:a) OR (kind='income' AND account_id=:a)
                                       THEN amount ELSE -amount END), 0)
                   FROM transactions WHERE (account_id=:a OR to_account_id=:a) AND date <= :d""",
                {"a": a["id"], "d": end.isoformat()}).fetchone()[0]
            val += market_values(db, pid, end).get(a["id"], {"value": 0})["value"]
        series.append({"month": ym, "invested": inv, "value": val})
    from .services import pac_pending
    return {"accounts": out, "pac_pending": pac_pending(db, pid), "pac_unverified": pac_unverified(db, pid),
            "total_value": total_value, "total_invested": total_in, "total_gain": total_value - total_in,
            "total_return": (total_value - total_in) / total_in if total_in > 0 else None, "total_xirr": total_xirr,
            "allocation": [{"name": k, "value": v} for k, v in sorted(alloc.items(), key=lambda x: -x[1])],
            "series": series}


# ----------------------------------------------------------------- rebalancing

ASSET_CLASSES = ("azioni", "obbligazioni", "monetario", "materie prime", "immobiliare", "crypto", "altro")
CASH, UNSPECIFIED = "liquidità", "non specificato"  # same keys as the allocation chart
STALE_PRICE_DAYS = 7        # market prices older than this: suggest updating them before rebalancing
STALE_VALUATION_DAYS = 92   # accounts valued as a whole (e.g. a pension fund): latest valuation older than a quarter
REBALANCE_DEFAULTS = {"accounts": None, "mode": "class", "targets": {"class": {}, "security": {}},
                      "excluded": {"class": [], "security": []},
                      "drift_abs": 5.0, "drift_rel": 25.0, "contribution": 0, "sells": False}


def _split(total, weights):
    """Split `total` cents in proportion to `weights` (list), with integer parts that add up exactly to `total`."""
    s = sum(weights)
    if not weights or s <= 0:
        return [0] * len(weights)
    parts = [int(total * w / s) for w in weights]
    parts[max(range(len(weights)), key=weights.__getitem__)] += total - sum(parts)  # rounding cents on the largest
    return parts


def rebalance(db, pid, cfg):
    """How far the portfolio is from the target allocation and what to buy (or sell) to get back to it.

    cfg: accounts (ids to count, None = all), mode 'class' (targets per asset class + broker cash) or 'security'
    (targets per security, broker cash, accounts valued only as a whole), targets {'class': {key: %}, 'security': {key: %}},
    drift_abs (percentage points) and drift_rel (% of the target): a row is off when either is exceeded (None = not used),
    contribution (new money, cents), sells (False = only buys with the new money, True = buys and sells up to the target),
    excluded {'class': [keys], 'security': [keys]}: rows left out (their value does not count in the total, nor their target).
    Values are the ones of the allocation chart (market value of the securities, uninvested cash of accounts with trades,
    whole value of the accounts without priced securities). Nothing is recorded."""
    inv = investments(db, pid, months=1)
    chosen = None if cfg["accounts"] is None else set(cfg["accounts"])
    accounts, rows, left = [], {}, []
    mode, targets = cfg["mode"], cfg["targets"].get(cfg["mode"]) or {}
    # rows left out of the calculation (e.g. a long-term holding or a class managed apart): shown, never counted.
    # Securities excluded in "security" mode are also left out of their class in "class" mode
    excl = cfg.get("excluded") or {}
    ex_sec = set(excl.get("security") or [])
    ex_rows = set(excl.get(mode) or [])

    def row(key, label, kind, **extra):
        return rows.setdefault(key, {"key": key, "label": label, "kind": kind, "value": 0, "holdings": [], **extra})

    # what can make the result misleading, collected while reading the accounts (shown above the table)
    unpriced, estimated, stale, neg_cash, old_valuation = [], [], [], [], []
    week_ago = (dt.date.today() - dt.timedelta(days=STALE_PRICE_DAYS)).isoformat()
    quarter_ago = (dt.date.today() - dt.timedelta(days=STALE_VALUATION_DAYS)).isoformat()
    for a in inv["accounts"]:
        included = chosen is None or a["id"] in chosen
        accounts.append({"id": a["id"], "name": a["name"], "icon": a["icon"], "value": a["value"], "included": included})
        if not included:
            continue
        for h in a["holdings"]:
            if abs(h["quantity"] or 0) < 1e-9:
                continue
            if not h["value"]:
                unpriced.append(h["ticker"])
            elif h.get("estimated_price"):
                estimated.append(h["ticker"])
            elif (h.get("price_date") or "") < week_ago:
                stale.append(h["ticker"])
        if a["has_trades"] and (a["cash"] or 0) < 0:
            neg_cash.append((a["name"], a["cash"]))
        if not a["has_trades"] and not any(h["value"] for h in a["holdings"]) and a["value"] > 0 and \
                (a.get("value_date") or "") < quarter_ago:
            old_valuation.append(a["name"])
        priced = [h for h in a["holdings"] if h["value"]]
        for h in priced:
            unit = h["value"] / h["quantity"] if h["quantity"] else None
            item = {"id": h["id"], "ticker": h["ticker"], "name": h["name"], "value": h["value"], "unit": unit,
                    "account": a["name"], "asset_class": h["asset_class"]}
            if mode == "class" and f"h:{h['id']}" in ex_sec:
                left.append({"key": f"h:{h['id']}", "label": h["ticker"], "kind": "security", "name": h["name"],
                             "account": a["name"], "asset_class": h["asset_class"], "value": h["value"], "via": "security"})
            elif mode == "class":
                row(h["asset_class"], h["asset_class"], "class")["holdings"].append(item)
                rows[h["asset_class"]]["value"] += h["value"]
            else:
                r = row(f"h:{h['id']}", h["ticker"], "security", name=h["name"], account=a["name"],
                        asset_class=h["asset_class"], unit=unit)
                r["value"] += h["value"]
        if a["has_trades"] and (a["cash"] or 0) > 0:
            r = row(CASH if mode == "class" else "cash", CASH, "cash")
            r["value"] += a["cash"]
        if not a["has_trades"] and not priced and a["value"] > 0:  # valued only as a whole (e.g. a pension fund)
            if mode == "class":
                row(UNSPECIFIED, UNSPECIFIED, "class")["value"] += a["value"]
            else:
                row(f"acc:{a['id']}", a["name"], "account")["value"] += a["value"]
    if mode == "class":  # every class can get a target, even one not owned yet
        for k in (*ASSET_CLASSES, CASH):
            row(k, k, "cash" if k == CASH else "class")
    for k in [k for k in rows if k in ex_rows]:
        left.append({**rows.pop(k), "via": mode})
    left.sort(key=lambda r: -r["value"])
    # targets of securities no longer owned or of accounts not counted: listed apart (so they can be cleared), not used
    names = {f"h:{h['id']}": h["ticker"] for h in db.execute(
        "SELECT h.id, h.ticker FROM holdings h JOIN accounts a ON a.id = h.account_id WHERE a.portfolio_id = ?", (pid,))}
    names.update({f"acc:{a['id']}": a["name"] for a in accounts})
    missing = [{"key": k, "label": names.get(k, k), "kind": "missing", "target": float(t)}
               for k, t in targets.items() if k not in rows and k not in ex_rows and t]

    total = sum(r["value"] for r in rows.values())
    contribution = cfg["contribution"]
    after_total = total + contribution
    sum_targets = round(sum(targets.get(k, 0) for k in rows), 4)
    has_targets = abs(sum_targets - 100) <= 0.05
    both_off = cfg["drift_abs"] is None and cfg["drift_rel"] is None  # no threshold: any visible drift counts
    order = {k: i for i, k in enumerate((*ASSET_CLASSES, CASH))}  # rows not owned yet: in the usual class order
    lst = sorted(rows.values(), key=lambda r: (-r["value"], order.get(r["key"], -1), r["label"]))
    for r in lst:
        r["target"] = float(targets.get(r["key"], 0) or 0)
        r["pct"] = r["value"] / total * 100 if total > 0 else 0.0
        r["drift"] = r["pct"] - r["target"]
        r["drift_rel"] = r["drift"] / r["target"] * 100 if r["target"] else None
        r["off"] = has_targets and total > 0 and (
            (cfg["drift_abs"] is not None and abs(r["drift"]) > cfg["drift_abs"]) or
            (cfg["drift_rel"] is not None and r["target"] > 0 and abs(r["drift_rel"]) > cfg["drift_rel"]) or
            (both_off and abs(r["drift"]) > 0.5))
        r["trade"] = 0
    short = None  # new money missing to reach every target (buys only)
    if has_targets and after_total > 0:
        goal = [r["target"] / 100 * after_total for r in lst]
        if cfg["sells"]:  # exactly to the target: buys and sells, the difference is the new money
            trades = [round(g_ - r["value"]) for g_, r in zip(goal, lst)]
            if trades:
                big = max(range(len(lst)), key=lambda i: abs(trades[i]))
                trades[big] += contribution - sum(trades)
        else:  # only buys: the new money goes to the rows below target, in proportion to what they miss
            gaps = [max(0.0, g_ - r["value"]) for g_, r in zip(goal, lst)]
            if sum(gaps) <= contribution:  # enough to reach every target: the rest follows the targets
                extra = _split(contribution - round(sum(gaps)), [r["target"] for r in lst])
                trades = [round(gp) + e for gp, e in zip(gaps, extra)]
                trades[max(range(len(lst)), key=lambda i: lst[i]["target"])] += contribution - sum(trades)
            else:
                trades = _split(contribution, gaps)
        for r, t in zip(lst, trades):
            r["trade"] = t
        if not cfg["sells"] and 0 < contribution < sum(gaps):
            short = round(sum(gaps)) - contribution
    for r in lst:
        r["after"] = r["value"] + r["trade"]
        r["after_pct"] = r["after"] / after_total * 100 if after_total > 0 else 0.0
        if r.get("unit"):  # unit = value of one unit, in cents
            r["units"] = round(r["trade"] / r["unit"], 4) if r["trade"] else 0
        if r["holdings"]:  # class mode: the class amount split among the securities already owned, by value
            for h, part in zip(r["holdings"], _split(r["trade"], [h["value"] for h in r["holdings"]])):
                h["trade"] = part
                h["units"] = round(part / h["unit"], 4) if h["unit"] and part else 0

    warnings = []

    def warn(level, text):  # level: 'warn' = the result may be wrong, 'info' = good to know
        warnings.append({"level": level, "text": text})
    names_of = lambda xs: ", ".join(xs[:5]) + (f" and {len(xs) - 5} more" if len(xs) > 5 else "")
    if unpriced:
        warn("warn", i18n.t("No price for {value}: not counted. Use \"Update prices\" or enter the price by hand.", value=names_of(unpriced)))
    for name, cash in neg_cash:
        warn("warn", i18n.t("{name} shows negative cash ({cash}): a transfer to the account is probably missing. Cash is not counted until it is fixed.", name=name, cash=fmt_money(cash)))
    if estimated:
        warn("info", i18n.t("Price of {value} taken from the last trade (no market price yet).", value=names_of(estimated)))
    if stale:
        warn("info", i18n.t("Prices of {value} are more than {stale_price_days} days old: update them for an accurate calculation.", value=names_of(stale), stale_price_days=STALE_PRICE_DAYS))
    if old_valuation:
        warn("info", i18n.t("The latest valuation of {value} is more than 3 months old.", value=names_of(old_valuation)))
    ignored = round(sum(float(targets.get(k) or 0) for k in ex_rows), 2)
    if ignored:
        warn("info", i18n.t("Targets of the rows not counted ({ignored}%) are ignored.", ignored=f"{ignored:g}"))
    if total > 0 and targets and not has_targets:
        gap = round(100 - sum_targets, 2)
        warn("warn", (i18n.t("Targets add up to {sum_targets}%: assign another {gap}% to reach 100%.", sum_targets=f"{sum_targets:g}", gap=format(gap, "g")) if gap > 0 else i18n.t("Targets add up to {sum_targets}%: remove {gap}% to reach 100%.", sum_targets=f"{sum_targets:g}", gap=format(-gap, "g"))))
    if short:
        warn("info", i18n.t("The new money is not enough to reach every target: about {short} more would be needed. It goes to the items furthest below target.", short=fmt_money(short)))
    whole = [r["label"] if r["kind"] == "account" else "accounts valued as a whole" for r in lst
             if r["trade"] and (r["kind"] == "account" or r["key"] == UNSPECIFIED)]
    if whole:
        warn("info", i18n.t("The amount for {value} is only an indication: there are no securities to buy or sell there.", value=names_of(whole)))
    if has_targets and any(r["trade"] < 0 and r["kind"] != "cash" for r in lst):
        warn("info", i18n.t("Sales may have taxes and fees, not included in the amounts."))
    if has_targets and cfg["drift_abs"] is None and cfg["drift_rel"] is None:
        warn("info", i18n.t("No drift threshold: every weight more than 0.5 points away from its target is flagged."))
    return {"rows": lst, "excluded": left, "warnings": warnings, "excluded_total": sum(r["value"] for r in left), "missing": missing,
            "accounts": accounts, "total": total, "contribution": contribution,
            "total_after": after_total, "sum_targets": sum_targets, "has_targets": has_targets, "needs_rebalance": any(r["off"] for r in lst),
            "max_drift": max((abs(r["drift"]) for r in lst if r["target"] or r["value"]), default=0.0)}


# instrument class from the Yahoo name/type: the first matching rule wins (a suggestion, always editable)
CLASS_RULES = [
    ("monetario", ("overnight", "money market", "monetar", "€str", "estr ", "eonia", "ultrashort", "ultra short", "0-1y", "0-1 y",
                   "0-3 m", "0-6 m", "cash ", "liquidity", "short term euro", "t-bill", "treasury bill")),
    ("crypto", ("bitcoin", "ethereum", "crypto", "btc", "eth ")),
    ("materie prime", ("gold", "silver", "physical", "commodit", "oro", "platinum", "oil", "metals")),
    ("immobiliare", ("real estate", "reit", "property", "immobil")),
    ("obbligazioni", ("bond", "treasury", "govt", "government", "gilt", "aggregate", "corporate", "obblig", "inflation", "fixed income",
                      "btp", "bund", "high yield")),
]


def classify_instrument(name, instrument_type=""):
    """Suggested class for a security from its long name and Yahoo type (ETF, EQUITY, MUTUALFUND, CRYPTOCURRENCY…)."""
    n = f" {(name or '').lower()} "
    if (instrument_type or "").upper() == "CRYPTOCURRENCY":
        return "crypto"
    for cls, words in CLASS_RULES:
        if any(w in n for w in words):
            return cls
    return "azioni" if (instrument_type or "").upper() in ("EQUITY", "ETF", "MUTUALFUND", "") else "altro"


_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-=^]{0,29}$")


def _chart_meta(ticker, timeout):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?range=5d&interval=1d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HomeCoin"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))["chart"]["result"][0]["meta"]


def search_symbol(query, timeout=12):
    """Yahoo symbol for a code written without the exchange (e.g. a Morningstar code 0P0000XXXX → 0P0000XXXX.F, or an ISIN).
    Sends only the code; accepts only a result that is the same code with the exchange suffix, or the only result."""
    url = "https://query1.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode(
        {"q": query, "quotesCount": 6, "newsCount": 0, "listsCount": 0})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HomeCoin"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        quotes = [q for q in json.loads(r.read().decode("utf-8")).get("quotes", [])
                  if isinstance(q.get("symbol"), str) and _SYMBOL.match(q["symbol"].upper())]
    q = query.upper()
    same = [x["symbol"].upper() for x in quotes if x["symbol"].upper().split(".")[0] == q]
    return same[0] if same else (quotes[0]["symbol"].upper() if len(quotes) == 1 else None)


def lookup_instrument(ticker, timeout=12):
    """Security data from Yahoo Finance for auto-fill (sends only the ticker). If the code does not exist as is,
    looks up the full symbol (exchange suffix) and returns it in "ticker"."""
    ticker = ticker.strip().upper()
    try:
        meta = _chart_meta(ticker, timeout)
    except Exception as exc:
        try:
            found = search_symbol(ticker, timeout)
            meta = _chart_meta(found, timeout) if found else None
        except Exception:
            meta = None
        if not meta:
            raise ValueError(i18n.t("Security not found on Yahoo Finance: {ticker}", ticker=ticker)) from exc
        ticker = found
    name = meta.get("longName") or meta.get("shortName") or ""
    itype = meta.get("instrumentType") or ""
    return {"ticker": ticker, "name": name, "type": itype, "currency": meta.get("currency"),
            "price": meta.get("regularMarketPrice"), "asset_class": classify_instrument(name, itype)}


def fetch_quote(ticker, timeout=12):
    """Latest price from Yahoo Finance: (price, currency). Raises ValueError if not available."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?range=5d&interval=1d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HomeCoin"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
        meta = data["chart"]["result"][0]["meta"]
        return float(meta["regularMarketPrice"]), meta.get("currency") or "EUR"
    except Exception as exc:  # no network, unknown ticker, changed format
        raise ValueError(i18n.t("Price not available for {ticker}: {exc}", ticker=ticker, exc=exc)) from exc


def fetch_history(ticker, timeout=15):
    """Month-end closes from Yahoo Finance (last 10 years): ({'YYYY-MM': price}, currency). Sends only the ticker."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?range=10y&interval=1mo&events=split"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HomeCoin"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            res = json.loads(r.read().decode("utf-8"))["chart"]["result"][0]
        closes = res["indicators"]["quote"][0]["close"]
        # Yahoo returns prices already adjusted for splits / reverse splits: convert them back to the actual prices of the time,
        # consistent with the quantities recorded before the split trade
        splits = [(dt.datetime.utcfromtimestamp(s["date"]).strftime("%Y-%m"), s["numerator"] / s["denominator"])
                  for s in (res.get("events") or {}).get("splits", {}).values() if s.get("denominator")]
        out = {}
        for ts, c in zip(res["timestamp"], closes):
            if c is None:
                continue
            month = dt.datetime.utcfromtimestamp(ts).strftime("%Y-%m")
            factor = 1.0
            for s_month, ratio_ in splits:
                if month < s_month:
                    factor *= ratio_
            out[month] = float(c) * factor
        return out, res["meta"].get("currency") or "EUR"
    except Exception as exc:
        raise ValueError(i18n.t("Price history not available for {ticker}: {exc}", ticker=ticker, exc=exc)) from exc


def refresh_history(db, pid):
    """Month-end prices (in the reference currency) of securities with trades, to value past months.
    Returns (securities updated, errors)."""
    base = currency_of(db)
    fx, ok, errors = {}, 0, []
    rows = db.execute("""SELECT h.id, h.ticker, MIN(o.date) AS first FROM holdings h JOIN accounts a ON a.id = h.account_id
                         JOIN trades o ON o.holding_id = h.id
                         WHERE a.portfolio_id = ? AND a.type = ? GROUP BY h.id""", (pid, INVEST)).fetchall()
    for h in rows:
        try:
            hist, cur = fetch_history(h["ticker"])
            if cur == "GBp":
                hist, cur = {k: v / 100 for k, v in hist.items()}, "GBP"
            if cur != base and cur not in fx:
                fx[cur] = fetch_history(f"{base}{cur}=X")[0]  # currency units per 1 unit of the reference currency, per month
            for month, price in hist.items():
                if month < h["first"][:7]:
                    continue
                rate = 1.0 if cur == base else fx[cur].get(month)
                if rate:
                    db.execute("""INSERT INTO price_history(holding_id, month, price_eur) VALUES (?, ?, ?)
                                  ON CONFLICT(holding_id, month) DO UPDATE SET price_eur = excluded.price_eur""",
                               (h["id"], month, price / rate))
            ok += 1
        except ValueError as e:
            errors.append(str(e))
    return ok, errors


def refresh_prices(db, pid):
    """Update the prices of the space's securities and record today's valuation of accounts holding securities."""
    today = dt.date.today().isoformat()
    base = currency_of(db)  # price_eur holds the price in the reference currency (historical column name)
    fx, ok, errors = {base: 1.0}, 0, []
    accounts, failed = {}, set()
    for h in db.execute("""SELECT h.* FROM holdings h JOIN accounts a ON a.id = h.account_id
                           WHERE a.portfolio_id = ? AND a.type = ? AND h.quantity > 0""", (pid, INVEST)).fetchall():
        try:
            price, cur = fetch_quote(h["ticker"])
            if cur == "GBp":  # London pence
                price, cur = price / 100, "GBP"
            if cur not in fx:
                fx[cur] = fetch_quote(f"{base}{cur}=X")[0]  # currency units per 1 unit of the reference currency
            price_eur = price / fx[cur]
            db.execute("UPDATE holdings SET price=?, currency=?, price_eur=?, price_date=? WHERE id=?",
                       (price, cur, price_eur, today, h["id"]))
            accounts[h["account_id"]] = accounts.get(h["account_id"], 0) + h["quantity"] * price_eur
            ok += 1
        except ValueError as e:
            errors.append(str(e))
            failed.add(h["account_id"])
    for acc_id, value in accounts.items():
        if has_trades(db, acc_id):  # the value of these accounts is computed from cash + securities
            continue
        if acc_id in failed:  # a security without a price: no partial valuation (it would be lower than the real one)
            continue
        db.execute("""INSERT INTO valuations(account_id, date, value, source) VALUES (?, ?, ?, 'auto')
                      ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value, source = 'auto'""",
                   (acc_id, today, round(value * 100)))
    hist_ok, hist_err = refresh_history(db, pid)
    db.commit()
    return {"updated": ok, "errors": errors + hist_err, "accounts": len(accounts), "history": hist_ok}


# ------------------------------------------------------ savings rate and net worth

# system categories excluded from reports (TECH_CATEGORIES, OTHER_INVESTMENTS) are defined in util.py, shared with
# forecast.py; both the English names and the Italian names of older databases are recognized


def savings(db, pid, months=12):
    """Monthly balance of the space: income = spent + other spaces + saved (the month's surplus), where
      income       = non-excluded income + interest/dividends on investment accounts + transfers received from other spaces
      spent        = actual expenses (except those in "contribution to other spaces" categories) + broker fees
      other spaces = transfers to other spaces + expenses in "contribution to other spaces" categories
      saved        = income − spent − other spaces (always the month's surplus)
    and, separately, invested = buys − sells of NON money market securities in investment accounts (excluded securities
    too), net of what was funded by inflows that are not income (severance pay, opening positions). Money market ETFs are
    cash: buying or selling them is not investing. Invested can exceed the surplus (earlier savings are used)."""
    accs = pf_accounts(db, pid, active_only=False)
    ids = {a["id"] for a in accs}
    inv_ids = {a["id"] for a in accs if a["type"] == INVEST}
    marks = ",".join("?" * len(ids)) or "NULL"
    rows = []
    for ym in months_back(months):
        first = dt.date(int(ym[:4]), int(ym[5:]), 1)
        end = month_end(ym).isoformat()
        r = {"month": ym, "income": 0, "from_others": 0, "expense": 0, "to_others": 0, "invested": 0}
        for t in db.execute(f"""SELECT t.kind, t.amount, t.account_id, t.to_account_id, t.excluded, c.code AS category,
                                       COALESCE(c.flow, '') AS flow
                                FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                                WHERE t.date BETWEEN ? AND ? AND (t.account_id IN ({marks}) OR t.to_account_id IN ({marks}))""",
                            (first.isoformat(), end, *ids, *ids)):
            src_in, dst_in = t["account_id"] in ids, t["to_account_id"] in ids
            if t["kind"] == "transfer":
                if t["excluded"]:  # as in the dashboard and reports: an excluded transfer does not count in the balance
                    continue
                if src_in and not dst_in:
                    r["to_others"] += t["amount"]
                elif dst_in and not src_in:
                    r["from_others"] += t["amount"]
                continue  # transfers between own accounts: they move cash, they do not change it
            if not t["excluded"]:
                if t["kind"] == "income":
                    r["income"] += t["amount"]
                elif t["flow"] == "other":
                    r["to_others"] += t["amount"]
                else:
                    r["expense"] += t["amount"]
            elif t["category"] == "other_investments":  # trades on securities that were not imported
                r["invested"] += t["amount"] if t["kind"] == "expense" else -t["amount"]
            elif t["kind"] == "income" and t["account_id"] in inv_ids and t["category"] not in SYSTEM_CODES:
                r["invested"] -= t["amount"]  # inflow that is not income (severance pay, opening): related buys do not count
        for o in db.execute(f"""SELECT o.kind, o.amount, COALESCE(h.asset_class, '') AS cls FROM trades o
                                LEFT JOIN holdings h ON h.id = o.holding_id
                                WHERE o.account_id IN ({marks}) AND o.date BETWEEN ? AND ?""", (*ids, first.isoformat(), end)):
            if o["kind"] in ("buy", "sell", "capital"):
                if o["cls"] != "monetario":  # money market ETFs are parked cash, not an investment
                    r["invested"] -= o["amount"]  # buy: negative amount → positive invested
            elif o["kind"] in ("interest", "dividend"):
                r["income"] += o["amount"]
            elif o["kind"] == "fee":
                r["expense"] -= o["amount"]
        inc = r["income"] + r["from_others"]
        r["saved"] = inc - r["expense"] - r["to_others"]  # saved = the month's surplus
        r["rate"] = r["saved"] / inc if inc > 0 else None
        r["invest_rate"] = r["invested"] / inc if inc > 0 else None
        rows.append(r)
    keys = ("income", "from_others", "expense", "to_others", "invested", "saved")
    tot = {k: sum(r[k] for r in rows) for k in keys}
    inc = tot["income"] + tot["from_others"]
    tot["rate"] = tot["saved"] / inc if inc > 0 else None
    tot["invest_rate"] = tot["invested"] / inc if inc > 0 else None
    return {"months": rows, "total": tot}


def net_worth(db, pid, months=12):
    accs = pf_accounts(db, pid, active_only=False)
    liquid = [a for a in accs if a["type"] != INVEST]
    debts = [dict(r) for r in db.execute(
        """SELECT r.* FROM recurring r JOIN accounts a ON a.id = r.account_id
           WHERE a.portfolio_id = ? AND r.kind = 'expense' AND r.installments IS NOT NULL""", (pid,))]
    for d in debts:
        d["principal"] = d["principal"] or d["amount"] * d["installments"]
    series = []
    for ym in months_back(months):
        end = month_end(ym).isoformat()
        liq = sum(book_balance(db, a, end) for a in liquid)
        inv = sum(v["value"] for v in market_values(db, pid, parse_date(end)).values())
        debt = sum(residual_at(d, parse_date(end)) or 0 for d in debts)
        series.append({"month": ym, "liquidity": liq, "investments": inv, "debts": round(debt),
                       "net": round(liq + inv - debt)})
    return {"series": series, "now": series[-1] if series else None,
            "debts": [{"name": d["name"], "residual": round(residual_at(d, dt.date.today()) or 0)} for d in debts]}
