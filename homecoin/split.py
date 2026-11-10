"""Fair split of shared expenses between several people.

Principle: every person should save the same percentage of their income. Categories with the "split equally"
rule are divided into equal parts; "proportional" ones compensate, so that each person's total share is
proportional to income. "Excluded" categories do not enter the calculation.
"""
import datetime as dt
import json

from . import i18n
from .util import add_months

RULES = ("prop", "equal", "none")
BASES = ("expenses", "deposits", "manual")  # what is split: actual expenses, actual contributions, manual amounts
DEFAULTS = {"split_months": "6", "split_margin": "0", "split_round": "10", "split_minimum": "50",
            "split_base": "expenses", "split_manual": "[]"}


def clean_manual(value, account_ids):
    """Valid manual items: [{name, account_id, amount (cents/month), rule}]."""
    try:
        items = value if isinstance(value, list) else json.loads(value or "[]")
    except (TypeError, ValueError):  # not a text (a number, an object) or not JSON
        items = []
    if not isinstance(items, list):
        items = []
    out = []
    for it in items[:50]:
        if not isinstance(it, dict):
            continue
        try:
            acc, amount = int(it.get("account_id")), int(it.get("amount") or 0)
        except (TypeError, ValueError):
            continue
        name, rule = str(it.get("name") or "").strip()[:60], it.get("rule") if it.get("rule") in RULES else "prop"
        if name and acc in account_ids and amount > 0:
            out.append({"name": name, "account_id": acc, "amount": amount, "rule": rule})
    return out


def period(months, today=None):
    """Last `months` complete months (excluding the current month, still partial)."""
    today = today or dt.date.today()
    first_this = today.replace(day=1)
    start = add_months(first_this, -months)
    return start.isoformat(), (first_this - dt.timedelta(days=1)).isoformat()


def round_to(cents, step):
    return int(round(cents / step) * step) if step > 0 else int(round(cents))


def shares(people, equal_total, prop_total):
    """Each person's monthly share: equal part + proportional part that reaches the fair target.

    Returns (proportional parts, fractions of the proportional total, perfectly_fair)."""
    n, incomes = len(people), [p["income"] for p in people]
    total_income = sum(incomes)
    if not n or total_income <= 0:
        return [0] * n, [1 / n if n else 0] * n, False
    total = equal_total + prop_total
    target = [total * i / total_income for i in incomes]           # fair total share
    need = [max(0.0, t - equal_total / n) for t in target]         # what is missing after the equal part
    fair = all(t - equal_total / n >= -0.5 for t in target)        # the equal part does not exceed the fair share
    s = sum(need)
    prop = [prop_total * x / s for x in need] if s > 0 else [prop_total * i / total_income for i in incomes]
    frac = [x / prop_total for x in prop] if prop_total else [i / total_income for i in incomes]
    return prop, frac, fair


def keyword(p):
    return (p.get("keyword") or p["name"]).strip().lower()


def contributions(db, account_id, people, d_from, d_to):
    """Actual contributions to an account in the period, each attributed to ONE person only:
    - income in "Contribution…" categories (e.g. the person's bank transfer to the joint account; the Italian
      "Versament…" names of older databases are recognized too);
    - transfers received from accounts of OTHER spaces (e.g. from the contributor's personal space).
    Attribution: first the person's keyword in the description or notes; if none, the name of the source space
    or account. Returns ({person index: [total, count, of which transfers]}, unassigned)."""
    rows = db.execute(
        """SELECT t.amount, t.kind, lower(t.description) AS d, lower(t.notes) AS n,
                  lower(COALESCE(s.name, '')) AS src_acc, lower(COALESCE(sp.name, '')) AS src_pf
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
           LEFT JOIN accounts s ON s.id = t.account_id AND t.kind = 'transfer'
           LEFT JOIN portfolios sp ON sp.id = s.portfolio_id
           JOIN accounts dst ON dst.id = ?
           WHERE NOT t.excluded AND t.date BETWEEN ? AND ?
             AND ((t.kind = 'income' AND t.account_id = dst.id AND (c.code = 'contributions' OR c.name LIKE 'Contribution%' OR c.name LIKE 'Versament%'))
               OR (t.kind = 'transfer' AND t.to_account_id = dst.id AND s.portfolio_id != dst.portfolio_id))""",
        (account_id, d_from, d_to)).fetchall()
    kws = [keyword(p) for p in people]
    out, unassigned = {i: [0, 0, 0] for i in range(len(people))}, 0
    for r in rows:
        text = f"{r['d'] or ''} {r['n'] or ''}"
        who = next((i for i, kw in enumerate(kws) if kw and kw in text), None)
        if who is None and r["kind"] == "transfer":
            who = next((i for i, kw in enumerate(kws) if kw and (kw in r["src_pf"] or kw in r["src_acc"])), None)
        if who is None:
            unassigned += r["amount"]
            continue
        out[who][0] += r["amount"]
        out[who][1] += 1
        if r["kind"] == "transfer":
            out[who][2] += r["amount"]
    return out, unassigned


def _num(value, default):
    """A saved setting as a number; a damaged value (e.g. "True" written by an older version) falls back to the default."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if v == v and abs(v) != float("inf") else default


def expense_rows(db, portfolio_id, d_from, d_to, months):
    """Average monthly actual expenses per account and category (active accounts, transactions not excluded from reports)."""
    rows = [dict(r) for r in db.execute(
        """SELECT a.id AS account_id, a.name AS account, a.color AS account_color,
                  c.id AS category_id, COALESCE(c.name, 'Uncategorized') AS category,
                  COALESCE(c.icon, '❔') AS icon, COALESCE(c.color, '#94a3b8') AS color,
                  COALESCE(c.split, 'prop') AS rule, SUM(t.amount) AS total
           FROM transactions t JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.kind = 'expense' AND NOT t.excluded AND NOT a.archived AND a.portfolio_id = ?
             AND t.date BETWEEN ? AND ?
           GROUP BY a.id, t.category_id ORDER BY a.id, total DESC""", (portfolio_id, d_from, d_to))]
    for r in rows:
        r["monthly"] = r["total"] / months
        r["key"] = f"c{r['category_id']}"
        if r["category_id"] is None:
            r["category"] = i18n.t("Uncategorized")
    return rows


def base_rows(db, base, settings, portfolio_id, d_from, d_to, months):
    """Rows (account, item, rule, monthly amount) to split according to the chosen basis."""
    accounts = {a["id"]: dict(a) for a in db.execute(
        "SELECT id, name, color FROM accounts WHERE portfolio_id = ? AND NOT archived", (portfolio_id,))}
    if base == "manual":
        return [{"account_id": it["account_id"], "account": accounts[it["account_id"]]["name"],
                 "account_color": accounts[it["account_id"]]["color"], "category_id": None, "category": it["name"],
                 "icon": "✏️", "color": accounts[it["account_id"]]["color"], "rule": it["rule"],
                 "monthly": it["amount"], "key": f"m{i}"}
                for i, it in enumerate(clean_manual(settings.get("split_manual"), set(accounts)))]
    exp = expense_rows(db, portfolio_id, d_from, d_to, months)
    if base == "expenses":
        return exp
    # contributions: for each account, the average amount contributed is split; the part covering that account's
    # "split equally" expenses is divided equally, the rest in proportion to income
    rows = []
    for acc_id, acc in accounts.items():
        # contributed = "Contribution…" income + transfers from other spaces (as in the actual contributions per person)
        per, unassigned = contributions(db, acc_id, [], d_from, d_to)
        dep = unassigned / months
        if dep <= 0:
            continue
        eq = min(dep, sum(r["monthly"] for r in exp if r["account_id"] == acc_id and r["rule"] == "equal"))
        common = {"account_id": acc_id, "account": acc["name"], "account_color": acc["color"], "category_id": None,
                  "color": acc["color"]}
        if eq > 0:
            rows.append({**common, "category": i18n.t("Contributions for equally split expenses"), "icon": "½", "rule": "equal",
                         "monthly": eq, "key": f"d{acc_id}e"})
        if dep - eq > 0:
            rows.append({**common, "category": i18n.t("Rest of the contributions"), "icon": "🤝", "rule": "prop",
                         "monthly": dep - eq, "key": f"d{acc_id}p"})
    return rows


def compute(db, people, settings, portfolio_id):
    raw = str(settings.get("split_months", 6))
    if raw == "all":  # all complete months of the space's history
        from .tools import history_months
        months = max(1, min(120, history_months(db, portfolio_id) - 1))
    else:
        months = max(1, min(24, int(_num(raw, 6))))
    margin = max(0.0, _num(settings.get("split_margin"), 0)) / 100
    step = max(0, int(_num(settings.get("split_round"), 10) * 100))
    minimum = max(0, int(_num(settings.get("split_minimum"), 0) * 100))
    base = settings.get("split_base") if settings.get("split_base") in BASES else "expenses"
    d_from, d_to = period(months)

    rows = base_rows(db, base, settings, portfolio_id, d_from, d_to, months)
    if base != "manual":  # the contingency margin applies to averages, not to amounts typed by hand
        for r in rows:
            r["monthly"] *= 1 + margin
    used = [r for r in rows if r["rule"] != "none"]
    equal_total = sum(r["monthly"] for r in used if r["rule"] == "equal")
    prop_total = sum(r["monthly"] for r in used if r["rule"] == "prop")
    n = len(people)
    prop, frac, fair = shares(people, equal_total, prop_total)

    # share per row and per person
    for r in rows:
        if r["rule"] == "none" or not n:
            r["quotas"] = [0] * n
        elif r["rule"] == "equal":
            r["quotas"] = [r["monthly"] / n] * n
        else:
            r["quotas"] = [r["monthly"] * f for f in frac]

    # monthly contributions per account and person, compared with the actual ones in the period
    accounts = {}
    for r in used:
        acc = accounts.setdefault(r["account_id"], {"account_id": r["account_id"], "account": r["account"],
                                                    "color": r["account_color"], "exact": [0.0] * n})
        acc["exact"] = [a + q for a, q in zip(acc["exact"], r["quotas"])]
    deposits = []
    unassigned_total = 0
    for acc in accounts.values():
        # actual contributions: TOTAL contributions in the period divided by the months of the period (not the average
        # bank transfer), so skipped months or contributions split into several transfers weigh correctly; includes
        # transfers from other spaces, each attributed to one person only
        per, unassigned = contributions(db, acc["account_id"], people, d_from, d_to)
        unassigned_total += unassigned
        for i, p in enumerate(people):
            total_paid, count, via_transfer = per[i]
            exact = acc["exact"][i]
            rounded = round_to(exact, step)
            deposits.append({"account_id": acc["account_id"], "account": acc["account"], "color": acc["color"],
                             "person_id": p.get("id"), "person": p["name"], "exact": round(exact),
                             "rounded": rounded, "actual_total": total_paid, "actual_count": count,
                             "actual_transfers": via_transfer,
                             "actual": round(total_paid / months), "below_min": 0 < rounded < minimum})

    people_out = []
    all_paid = sum(d["actual_total"] for d in deposits)
    for i, p in enumerate(people):
        mine = [d for d in deposits if d["person_id"] == p.get("id") and d["person"] == p["name"]]
        share_exact = sum(d["exact"] for d in mine)
        share_rounded = sum(d["rounded"] for d in mine)
        paid_total = sum(d["actual_total"] for d in mine)
        paid_month = paid_total / months
        inc = p["income"]
        people_out.append({
            "id": p.get("id"), "name": p["name"], "income": inc, "share": round(share_exact),
            "share_rounded": share_rounded, "fraction_prop": frac[i] if n else 0,
            "weight": share_exact / (equal_total + prop_total) if equal_total + prop_total else 0,
            "savings": inc - share_rounded, "rate": (inc - share_rounded) / inc if inc else None,
            "rate_exact": (inc - share_exact) / inc if inc else None,
            # actual situation in the period: total contributed, monthly average (total ÷ months) and share of the total
            "paid_total": paid_total, "paid_month": round(paid_month), "paid_count": sum(d["actual_count"] for d in mine),
            "paid_weight": paid_total / all_paid if all_paid else None,
            "rate_actual": (inc - paid_month) / inc if inc else None,
        })
    return {
        "from": d_from, "to": d_to, "months": months, "margin": margin * 100 if base != "manual" else 0, "base": base,
        "equal_total": round(equal_total), "prop_total": round(prop_total), "total": round(equal_total + prop_total),
        "excluded_total": round(sum(r["monthly"] for r in rows if r["rule"] == "none")),
        "fair": fair, "people": people_out, "deposits": deposits,
        "paid_total": all_paid, "paid_month": round(all_paid / months),
        "unassigned_total": unassigned_total,  # contributions that cannot be attributed to anyone (missing keyword)
        "rows": [{k: (round(v) if k in ("monthly",) else v) for k, v in r.items() if k != "total"}
                 | {"quotas": [round(q) for q in r["quotas"]]} for r in rows],
    }
