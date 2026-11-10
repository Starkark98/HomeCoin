"""Calendar forecasts: "expected" recurring items (variable amount and date) and regular income estimated from history.

Expected recurring item (e.g. a salary that changes by a few euros and a few days): it does not record transactions by
itself; the real transaction (entered or imported) is linked automatically if its description contains the keyword and
the amount is plausible. Forecast amount and day = median of recent payments; if it does not arrive within the
tolerance it is "late".
Regular income: income not linked to recurring items, grouped by payer (normalized description), present in at least
REGULAR_MIN of the last HISTORY_MONTHS complete months: amount = median of the monthly totals, day = median day.
"""
import calendar
import datetime as dt
from collections import Counter, defaultdict
from statistics import median

from . import i18n
from .util import FREQUENCIES, TECH_CODES_SQL, add_months, normalize_desc, parse_date, rule_matches

HISTORY_MONTHS = 6
REGULAR_MIN = 4
# estimated income: only significant amounts (e.g. no account interest of a few euros): at least INCOME_MIN and at
# least INCOME_SHARE of the largest regular income
INCOME_MIN = 5000
INCOME_SHARE = 0.05
TOLERANCE_DAYS = 7          # delay after which an expected income is "late"
LINK_WINDOW_DAYS = 10       # a transaction can be linked up to 10 days before the start of the recurring item


# words ignored when grouping by payer: month names of every interface language (static/i18n/<lang>.json) and a few
# Italian and English words of salary and rent descriptions
MONTH_WORDS = i18n.month_words() | {"mese", "mensile", "saldo", "acconto", "sept", "month", "monthly"}


def payee_key(description):
    """Payer/payee key: normalized description without months and years ("Salary - September 2025" and
    "Salary - October 2025" are the same payer)."""
    words = [w for w in normalize_desc(" ".join(w for w in (description or "").lower().split() if w.strip(" -.,:/") not in MONTH_WORDS)).split()
             if w not in MONTH_WORDS]
    return " ".join(words[:3]) or (description or "").lower().strip()[:30]


def clean_name(description):
    """Name to show for an estimated item: the description without month, year and installment number ("Salary - August 2026" → "Salary")."""
    import re
    words = [w for w in (description or "").split() if w.lower().strip(" -.,:/") not in MONTH_WORDS and not re.fullmatch(r"\d{2,4}|\d+/\d+", w.strip(" -.,:/"))]  # also the installment number "49/300"
    return re.sub(r"[\s\-–:/,.]+$", "", " ".join(words)).strip() or (description or "")


def _in_month(year, month, day):
    return dt.date(year, month, min(max(1, round(day)), calendar.monthrange(year, month)[1]))


def keyword(r):
    return (r.get("match_text") or r["name"]).strip().lower()


def expected_stats(db, r):
    """Typical amount and day from recent payments (or the configured ones if there are none yet), last date."""
    rows = db.execute("SELECT date, amount FROM transactions WHERE recurring_id = ? ORDER BY date DESC LIMIT ?",
                      (r["id"], HISTORY_MONTHS)).fetchall()
    fixed = bool(r.get("amount_fixed"))  # the user chose to always forecast the configured amount (e.g. after a raise)
    if not rows:
        return {"amount": r["amount"], "day": parse_date(r["start_date"]).day, "last": None, "count": 0,
                "source": "set", "median": None}
    med = round(median(x["amount"] for x in rows))
    return {"amount": r["amount"] if fixed else med, "median": med, "source": "fixed" if fixed else "median",
            "day": median(int(x["date"][8:]) for x in rows),
            "last": parse_date(rows[0]["date"]), "count": len(rows),
            "min": min(x["amount"] for x in rows), "max": max(x["amount"] for x in rows)}


def link_expected(db):
    """Link real transactions to the matching expected recurring items (description with the keyword, same account
    and kind, amount between half and double the typical one)."""
    linked = 0
    for r in db.execute("SELECT * FROM recurring WHERE active = 1 AND expected = 1").fetchall():
        r = dict(r)
        kw, st = keyword(r), expected_stats(db, r)
        since = (parse_date(r["start_date"]) - dt.timedelta(days=LINK_WINDOW_DAYS)).isoformat()
        for t in db.execute("""SELECT id, description, amount FROM transactions WHERE recurring_id IS NULL AND account_id = ?
                               AND kind = ? AND date >= ? AND NOT excluded""", (r["account_id"], r["kind"], since)).fetchall():
            if kw and rule_matches(kw, t["description"]) and st["amount"] / 2 <= t["amount"] <= st["amount"] * 2:
                db.execute("UPDATE transactions SET recurring_id = ? WHERE id = ?", (r["id"], t["id"]))
                linked += 1
    return linked


def expected_forecast(db, r, today, horizon):
    """Next forecast occurrences of an expected recurring item up to horizon: [(date, amount, late, nominal date)].
    At most one overdue item (the one not yet arrived), moved to today."""
    st = expected_stats(db, r)
    unit, step = FREQUENCIES[r["frequency"]]
    start = parse_date(r["start_date"])
    out = []
    if unit == "d":
        d = (st["last"] + dt.timedelta(days=step)) if st["last"] else start
        while d < today - dt.timedelta(days=step):
            d += dt.timedelta(days=step)
    else:
        if st["last"]:
            base = add_months(st["last"].replace(day=1), step)
        else:
            base = start.replace(day=1)
            while add_months(base, step) <= today.replace(day=1):  # no multiple overdue items
                base = add_months(base, step)
        d = _in_month(base.year, base.month, st["day"])
    for _ in range(60):
        if d > horizon or (r["end_date"] and d.isoformat() > r["end_date"]):
            break
        late = d + dt.timedelta(days=TOLERANCE_DAYS) < today
        out.append((max(d, today), st["amount"], late, d))
        if unit == "d":
            d += dt.timedelta(days=step)
        else:
            nm = add_months(d.replace(day=1), step)
            d = _in_month(nm.year, nm.month, st["day"])
    return out


def regular_flows(db, account_ids, today, horizon, kind="income"):
    """Regular income (or expenses) not covered by recurring items, forecast up to horizon: same logic in both directions
    (same payer/payee in at least REGULAR_MIN of the last HISTORY_MONTHS months, median amount and day)."""
    if not account_ids:
        return []
    first = add_months(today.replace(day=1), -HISTORY_MONTHS)
    marks = ",".join("?" * len(account_ids))
    rows = db.execute(f"""SELECT t.date, t.amount, t.description, t.account_id, c.icon, c.name AS category_name
                          FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                          WHERE t.kind = ? AND NOT t.excluded AND t.recurring_id IS NULL AND t.date >= ?
                          AND t.account_id IN ({marks})
                          AND COALESCE(c.code, '') NOT IN ({TECH_CODES_SQL})
                          ORDER BY t.date""", (kind, first.isoformat(), *account_ids)).fetchall()
    groups = defaultdict(list)
    for t in rows:
        groups[payee_key(t["description"])].append(t)
    cur = today.strftime("%Y-%m")
    regular = []
    for key, txs in groups.items():
        by_month = defaultdict(list)
        for t in txs:
            by_month[t["date"][:7]].append(t)
        past = {m: v for m, v in by_month.items() if m < cur}
        if len(past) >= REGULAR_MIN:
            regular.append((key, txs, by_month, past, round(median(sum(x["amount"] for x in v) for v in past.values()))))
    floor = 0
    if kind == "income":  # only significant income, compared with the largest one (expected recurring items included)
        biggest = max([a for *_, a in regular] + [r[0] for r in db.execute(
            f"SELECT amount FROM recurring WHERE active = 1 AND kind = 'income' AND account_id IN ({marks})", account_ids)] + [0])
        floor = max(INCOME_MIN, biggest * INCOME_SHARE)
    out = []
    for key, txs, by_month, past, amount in regular:
        if amount < floor:
            continue
        day = median(int(v[0]["date"][8:]) for v in past.values())
        last = txs[-1]
        acc = Counter(t["account_id"] for t in txs).most_common(1)[0][0]
        m = today.replace(day=1)
        while m <= horizon:
            key_m = m.strftime("%Y-%m")
            if not (key_m == cur and key_m in by_month):  # already arrived this month: do not count it twice
                d = _in_month(m.year, m.month, day)
                if d <= horizon:
                    out.append({"date": max(d, today).isoformat(), "nominal": d.isoformat(), "late": d < today,
                                "name": clean_name(last["description"]) or key, "amount": amount, "kind": kind,
                                "account_id": acc, "to_account_id": None, "category_icon": last["icon"],
                                "category_name": last["category_name"], "estimated": True, "source": "history",
                                "months_seen": len(past)})
            m = add_months(m, 1)
    return out
