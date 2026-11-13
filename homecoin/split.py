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


def candidates(db, portfolio_id, d_from, d_to):
    """The money that reached the accounts of the space in the period and may be someone's contribution:
    - transfers from accounts of OTHER spaces (e.g. from a person's own space: one flow of money, seen in both);
    - every income of the space; those in a "Contribution…" category are contributions by default (also the Italian
      "Versament…" names of older databases), the others only when they are attributed to a person.
    Transactions excluded from reports never count."""
    return [dict(r) for r in db.execute(
        """SELECT t.id, t.date, t.amount, t.kind, t.description, t.notes, t.person_id, t.split_off,
                  dst.id AS account_id, dst.name AS account, dst.color AS account_color,
                  (t.kind = 'income' AND (c.code = 'contributions' OR c.name LIKE 'Contribution%' OR c.name LIKE 'Versament%'))
                    AS contribution_cat,
                  s.portfolio_id AS src_space, COALESCE(sp.name, '') AS src_space_name, COALESCE(s.name, '') AS src_account
           FROM transactions t
           JOIN accounts dst ON dst.id = CASE WHEN t.kind = 'transfer' THEN t.to_account_id ELSE t.account_id END
           LEFT JOIN categories c ON c.id = t.category_id
           LEFT JOIN accounts s ON s.id = t.account_id AND t.kind = 'transfer'
           LEFT JOIN portfolios sp ON sp.id = s.portfolio_id
           WHERE dst.portfolio_id = ? AND NOT t.excluded AND t.date BETWEEN ? AND ?
             AND (t.kind = 'income' OR (t.kind = 'transfer' AND s.portfolio_id != dst.portfolio_id))
           ORDER BY t.date DESC, t.id DESC""", (portfolio_id, d_from, d_to))]


def attribute(c, people):
    """Whose contribution a candidate is: (person index or None, reason, counted).
    1. the user's choice (`person_id`, or `split_off` = not a contribution);
    2. a transfer from the space linked to a person: that person (no keyword needed);
    3. the person's keyword (their name by default) in the description or notes;
    4. a transfer whose source space or account has the keyword in its name (older setups).
    A transfer from another space or a "Contribution…" income nobody matches is still a contribution, unassigned;
    any other income nobody matches is not counted."""
    if c["split_off"]:
        return None, "off", False
    if c["person_id"]:
        idx = next((i for i, p in enumerate(people) if p.get("id") == c["person_id"]), None)
        if idx is not None:
            return idx, "manual", True
    transfer = c["kind"] == "transfer"
    if transfer:
        idx = next((i for i, p in enumerate(people) if p.get("space_id") and p["space_id"] == c["src_space"]), None)
        if idx is not None:
            return idx, "space", True
    text = f"{c['description'] or ''} {c['notes'] or ''}".lower()
    kws = [keyword(p) for p in people]
    idx = next((i for i, kw in enumerate(kws) if kw and kw in text), None)
    if idx is not None:
        return idx, "keyword", True
    if transfer:
        names = f"{c['src_space_name']} {c['src_account']}".lower()
        idx = next((i for i, kw in enumerate(kws) if kw and kw in names), None)
        if idx is not None:
            return idx, "source", True
    return None, "none", bool(transfer or c["contribution_cat"])


def attributed(db, portfolio_id, people, d_from, d_to):
    """Every candidate with its attribution: [{..., who, reason, counted}]."""
    out = []
    for c in candidates(db, portfolio_id, d_from, d_to):
        who, reason, counted = attribute(c, people)
        out.append({**c, "who": who, "reason": reason, "counted": counted})
    return out


def contributions(rows, account_id, n):
    """Contributions to one account from the attributed candidates: ({person index: [total, count, of which by
    transfer]}, unassigned total)."""
    out, unassigned = {i: [0, 0, 0] for i in range(n)}, 0
    for r in rows:
        if r["account_id"] != account_id or not r["counted"]:
            continue
        if r["who"] is None:
            unassigned += r["amount"]
            continue
        out[r["who"]][0] += r["amount"]
        out[r["who"]][1] += 1
        if r["kind"] == "transfer":
            out[r["who"]][2] += r["amount"]
    return out, unassigned


def fed_accounts(db, portfolio_id, rows, d_from, d_to):
    """Accounts of the space that receive money only from other accounts of the same space (a grocery card topped up
    from the joint account, cash from the cashpoint): nobody pays into them directly, so their expenses belong to the
    accounts that feed them. {fed account: {feeding account: share}} (shares of the internal money received)."""
    direct = {r["account_id"] for r in rows if r["counted"]}
    inflow = {}
    for src, dst, total in db.execute(
            """SELECT t.account_id, t.to_account_id, SUM(t.amount) FROM transactions t
               JOIN accounts a ON a.id = t.account_id JOIN accounts b ON b.id = t.to_account_id
               WHERE t.kind = 'transfer' AND a.portfolio_id = ? AND b.portfolio_id = ? AND NOT t.excluded
                 AND t.date BETWEEN ? AND ? GROUP BY t.account_id, t.to_account_id""",
            (portfolio_id, portfolio_id, d_from, d_to)):
        if dst not in direct and src != dst:
            inflow.setdefault(dst, {})[src] = total
    shares = {dst: {src: v / sum(srcs.values()) for src, v in srcs.items()} for dst, srcs in inflow.items()}
    for _ in range(3):  # a chain (joint → card → cash): resolved to the accounts people pay into
        changed = False
        for dst, srcs in shares.items():
            if any(s in shares for s in srcs):
                new = {}
                for s, f in srcs.items():
                    for s2, f2 in (shares[s].items() if s in shares and s != dst else [(s, 1)]):
                        new[s2] = new.get(s2, 0) + f * f2
                shares[dst], changed = new, True
        if not changed:
            break
    return shares


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


def redirect(rows, fed, accounts):
    """Expense rows of fed accounts moved to the accounts that feed them (in proportion to the money received), so the
    proposal says how much to pay into the account people really pay into; `via` keeps where the money was spent."""
    out = []
    for r in rows:
        srcs = fed.get(r["account_id"])
        if not srcs:
            out.append(r)
            continue
        for src, share in srcs.items():
            if src not in accounts:
                continue
            out.append({**r, "account_id": src, "account": accounts[src]["name"], "account_color": accounts[src]["color"],
                        "monthly": r["monthly"] * share, "via": r["account"]})
    return out


def base_rows(db, base, settings, portfolio_id, d_from, d_to, months, attr=None):
    """Rows (account, item, rule, monthly amount) to split according to the chosen basis."""
    accounts = {a["id"]: dict(a) for a in db.execute(
        "SELECT id, name, color FROM accounts WHERE portfolio_id = ? AND NOT archived", (portfolio_id,))}
    if base == "manual":
        return [{"account_id": it["account_id"], "account": accounts[it["account_id"]]["name"],
                 "account_color": accounts[it["account_id"]]["color"], "category_id": None, "category": it["name"],
                 "icon": "✏️", "color": accounts[it["account_id"]]["color"], "rule": it["rule"],
                 "monthly": it["amount"], "key": f"m{i}"}
                for i, it in enumerate(clean_manual(settings.get("split_manual"), set(accounts)))]
    attr = attr if attr is not None else attributed(db, portfolio_id, [], d_from, d_to)
    exp = redirect(expense_rows(db, portfolio_id, d_from, d_to, months),
                   fed_accounts(db, portfolio_id, attr, d_from, d_to), accounts)
    if base == "expenses":
        return exp
    # contributions: for each account, the average amount contributed is split; the part covering that account's
    # "split equally" expenses is divided equally, the rest in proportion to income
    rows = []
    for acc_id, acc in accounts.items():
        # contributed = everything counted as a contribution to this account, whoever made it
        dep = sum(r["amount"] for r in attr if r["account_id"] == acc_id and r["counted"]) / months
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

    attr = attributed(db, portfolio_id, people, d_from, d_to)
    rows = base_rows(db, base, settings, portfolio_id, d_from, d_to, months, attr)
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

    # monthly contributions per account and person, compared with the actual ones in the period; also the accounts
    # with no proposal that received contributions (otherwise money paid there would be invisible)
    accounts = {}
    for r in used:
        acc = accounts.setdefault(r["account_id"], {"account_id": r["account_id"], "account": r["account"],
                                                    "color": r["account_color"], "exact": [0.0] * n})
        acc["exact"] = [a + q for a, q in zip(acc["exact"], r["quotas"])]
    for r in attr:
        if r["counted"] and r["account_id"] not in accounts:
            accounts[r["account_id"]] = {"account_id": r["account_id"], "account": r["account"],
                                         "color": r["account_color"], "exact": [0.0] * n}
    deposits = []
    unassigned_total = 0
    for acc in accounts.values():
        # actual contributions: TOTAL contributions in the period divided by the months of the period (not the average
        # bank transfer), so skipped months or contributions split into several transfers weigh correctly; each one
        # attributed to one person only (see attribute)
        per, unassigned = contributions(attr, acc["account_id"], n)
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
        "unassigned_total": unassigned_total,  # contributions that cannot be attributed to anyone
        "rows": [{k: (round(v) if k in ("monthly",) else v) for k, v in r.items() if k != "total"}
                 | {"quotas": [round(q) for q in r["quotas"]]} for r in rows],
        # the attribution check: every candidate, who it counts for and why (the user can change it)
        "contributions": [{"id": r["id"], "date": r["date"], "amount": r["amount"], "kind": r["kind"],
                           "description": r["description"], "account_id": r["account_id"], "account": r["account"],
                           "from_space": r["src_space_name"] if r["kind"] == "transfer" else None,
                           "person_id": people[r["who"]].get("id") if r["who"] is not None else None,
                           "reason": r["reason"], "counted": r["counted"], "manual": bool(r["person_id"] or r["split_off"])}
                          for r in attr],
    }
