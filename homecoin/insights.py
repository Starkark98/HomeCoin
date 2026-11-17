"""Insights (2.6.0): recurring items that cost more than before, unusual spending of a month, the year in brief.
Read-only calculations on the space's own data: nothing is changed (recurring items are never changed by themselves)."""
import datetime as dt
from statistics import median

from . import tools
from .util import MONTHLY_FACTOR, add_months

# a recurring item "costs more" when its last payment is at least this much above the usual one
RISE_PCT, RISE_MIN = 0.05, 100           # +5% and at least 1 (in cents of the reference currency)
# a category is unusual in a month when it is at least 1.5 times its average and at least 50 above it; a single
# expense is unusual when it is at least 3 times the usual expense of its category and at least 100
CAT_RATIO, CAT_MIN, TX_RATIO, TX_MIN = 1.5, 5000, 3.0, 10000
HISTORY_MONTHS = 6

SPEND = """t.kind = 'expense' AND NOT t.excluded
           AND COALESCE((SELECT flow FROM categories WHERE id = t.category_id), '') != 'other'
           AND t.account_id IN (SELECT id FROM accounts WHERE portfolio_id = ?)"""


def price_increases(db, items):
    """For each active recurring expense (no loans, no transfers, not coming from another space): the last real
    payment against the usual one (median of up to 6 before it, at least 2). Returns {item id: increase}."""
    out = {}
    for r in items:
        # variable (expected) items change by nature, loans follow their schedule: neither is a price increase
        if r.get("kind") != "expense" or not r.get("active") or r.get("incoming") or r.get("principal") or r.get("expected"):
            continue
        amounts = [a for (a,) in db.execute("SELECT amount FROM transactions WHERE recurring_id = ? ORDER BY date DESC, id DESC "
                                           "LIMIT 7", (r["id"],))]
        if len(amounts) < 3:
            continue
        last, before = amounts[0], median(amounts[1:])
        if before > 0 and last - before >= max(RISE_MIN, before * RISE_PCT):
            per_year = round(MONTHLY_FACTOR.get(r.get("frequency"), 1) * 12, 4)
            out[r["id"]] = {"before": round(before), "now": last, "pct": (last - before) / before,
                            "per_year": round((last - before) * per_year)}
    return out


def _month_bounds(month):
    first = dt.date(int(month[:4]), int(month[5:7]), 1)
    return first, add_months(first, 1) - dt.timedelta(days=1)


def unusual(db, pid, month=None, today=None):
    """Spending of a month (default: the current one) far above the usual: categories against their average of the
    previous 6 months, single expenses against the usual expense of their category (median of the last 12 months)."""
    today = today or dt.date.today()
    month = month or today.isoformat()[:7]
    first, last = _month_bounds(month)
    hist_from = add_months(first, -HISTORY_MONTHS)
    oldest = db.execute(f"SELECT MIN(t.date) FROM transactions t WHERE {SPEND}", (pid,)).fetchone()[0]
    # months with data before this one (a space started 2 months ago has a 2-month average, not a 6-month one)
    if not oldest or oldest >= first.isoformat():
        return {"month": month, "categories": [], "transactions": [], "history_months": 0}
    start = max(hist_from, dt.date.fromisoformat(oldest[:7] + "-01"))
    n_months = max(1, (first.year - start.year) * 12 + first.month - start.month)
    rows = db.execute(
        f"""SELECT t.category_id AS id, COALESCE(c.name, '') AS name, COALESCE(c.icon, '❔') AS icon,
                   COALESCE(c.color, '#b4b9c2') AS color,
                   SUM(CASE WHEN t.date BETWEEN :f AND :l THEN t.amount ELSE 0 END) AS now,
                   SUM(CASE WHEN t.date >= :h AND t.date < :f THEN t.amount ELSE 0 END) AS hist
            FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
            WHERE {SPEND.replace('?', ':p')} AND t.date >= :h AND t.date <= :l GROUP BY t.category_id""",
        {"f": first.isoformat(), "l": last.isoformat(), "h": start.isoformat(), "p": pid}).fetchall()
    cats = []
    for r in rows:
        if r["id"] is None:  # still to categorize: already shown as such, not "unusual"
            continue
        avg = r["hist"] / n_months
        if r["now"] >= CAT_MIN and r["now"] >= avg * CAT_RATIO and r["now"] - avg >= CAT_MIN:
            cats.append({"id": r["id"], "name": r["name"], "icon": r["icon"], "color": r["color"], "now": r["now"],
                         "average": round(avg), "ratio": r["now"] / avg if avg else None, "extra": round(r["now"] - avg)})
    cats.sort(key=lambda x: -x["extra"])
    txs = []
    for t in db.execute(
            f"""SELECT t.id, t.date, t.amount, t.description, t.category_id, COALESCE(c.name, '') AS category,
                       COALESCE(c.icon, '❔') AS icon
                FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                WHERE {SPEND} AND t.category_id IS NOT NULL AND t.date BETWEEN ? AND ? AND t.amount >= ?
                ORDER BY t.amount DESC LIMIT 40""",
            (pid, first.isoformat(), last.isoformat(), TX_MIN)):
        usual = [a for (a,) in db.execute(
            f"""SELECT t.amount FROM transactions t WHERE {SPEND} AND t.category_id IS ? AND t.date < ? AND t.date >= ?""",
            (pid, t["category_id"], first.isoformat(), add_months(first, -12).isoformat()))]
        if len(usual) >= 5 and t["amount"] >= median(usual) * TX_RATIO:
            txs.append({**dict(t), "usual": round(median(usual))})
    return {"month": month, "categories": cats[:6], "transactions": txs[:6], "history_months": n_months}


def year_brief(db, pid, year, today=None):
    """The year in brief, with the same monthly balance as Savings and the Dashboard (tools.savings): income, spent,
    other spaces, saved and savings rate, invested; net worth at the start and at the end; the largest categories with
    the year before; the best and the hardest month. The same totals of the year before, for comparison."""
    today = today or dt.date.today()
    back = min(240, max(1, (today.year - (year - 1)) * 12 + today.month))
    rows = tools.savings(db, pid, back)["months"]
    keys = ("income", "from_others", "expense", "to_others", "invested", "saved")

    # the current year is compared with the same months of the year before (January to this month), not a whole year
    upto = today.month if year == today.year else 12

    def totals(y):
        sel = [r for r in rows if r["month"].startswith(f"{y}-") and int(r["month"][5:7]) <= upto]
        tot = {k: sum(r[k] for r in sel) for k in keys}
        inc = tot["income"] + tot["from_others"]
        tot.update(income_all=inc, out_all=tot["expense"] + tot["to_others"], months=sum(1 for r in sel if r["income"]
                   or r["expense"] or r["from_others"] or r["to_others"]), rate=tot["saved"] / inc if inc > 0 else None)
        return tot, sel

    cur, months = totals(year)
    prev, _ = totals(year - 1)
    cats = [dict(r) for r in db.execute(
        f"""SELECT t.category_id AS id, COALESCE(c.name, '') AS name, COALESCE(c.icon, '❔') AS icon,
                   COALESCE(c.color, '#b4b9c2') AS color,
                   SUM(CASE WHEN t.date BETWEEN :f AND :l THEN t.amount ELSE 0 END) AS total,
                   SUM(CASE WHEN t.date BETWEEN :pf AND :pl THEN t.amount ELSE 0 END) AS before
            FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
            WHERE {SPEND.replace('?', ':p')} AND t.date BETWEEN :pf AND :l
            GROUP BY t.category_id HAVING total > 0 ORDER BY total DESC LIMIT 6""",
        {"p": pid, "f": f"{year}-01-01", "l": f"{year}-12-31", "pf": f"{year - 1}-01-01",
         "pl": f"{year - 1}-{upto:02d}-31" if upto == 12 else (add_months(dt.date(year - 1, upto, 1), 1) - dt.timedelta(days=1)).isoformat()})]
    active = [m for m in months if m["income"] or m["expense"] or m["from_others"] or m["to_others"]]
    nw = {x["month"]: x["net"] for x in tools.net_worth(db, pid, back)["series"]}
    end_month = f"{year}-12" if year < today.year else today.isoformat()[:7]
    pick = lambda m: {"month": m["month"], "saved": m["saved"]} if m else None  # noqa: E731
    return {"year": year, "partial": year == today.year, "compared_months": upto, "current": cur, "previous": prev, "categories": cats,
            "best_month": pick(max(active, key=lambda m: m["saved"], default=None)),
            "hardest_month": pick(min(active, key=lambda m: m["saved"], default=None)),
            "net_worth_start": nw.get(f"{year - 1}-12"), "net_worth_end": nw.get(end_month)}
