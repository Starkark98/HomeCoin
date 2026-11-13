"""Demo version: builds an encrypted database from scratch with sample data ("Sample" household), to show
HomeCoin without opening your own data. Used by demo.py / HomeCoin-Demo.cmd with a separate data folder,
recreated at every start: nothing done in the demo is kept, and the real data is never touched.
"""
import datetime as dt
import json
import random

from . import db as dbm
from . import i18n
from .services import process_recurring
from .util import add_months

L = i18n.t  # sample names and descriptions in the interface language (English if not translated)

PASSWORD = "demo-homecoin"  # shown on the demo's sign-in screen: it only protects fake data
MONTHS = 18


def _cat(conn, pid, name):
    """A default category of the space, by its English name (found by code: the names are in the interface language)."""
    return conn.execute("SELECT id FROM categories WHERE portfolio_id = ? AND code = ?",
                        (pid, i18n.code_of_name(name))).fetchone()[0]


def _acc(conn, pid, name, type_, icon, color, initial=0):
    return conn.execute("INSERT INTO accounts(portfolio_id, name, type, icon, color, initial_balance) VALUES (?,?,?,?,?,?)",
                        (pid, name, type_, icon, color, initial)).lastrowid


def _rec(conn, **r):
    r.setdefault("frequency", "monthly")
    cols = ",".join(r)
    return conn.execute(f"INSERT INTO recurring({cols}) VALUES ({','.join('?' * len(r))})", tuple(r.values())).lastrowid


def _tx(conn, date, amount, kind, account, category=None, desc="", to=None, notes="", excluded=0, source="manual"):
    conn.execute("INSERT INTO transactions(date, amount, kind, account_id, to_account_id, category_id, description, notes, "
                 "excluded, source) VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (date.isoformat(), amount, kind, account, to, category, desc, notes, excluded, source))


def _holding(conn, account, ticker, name, cls):
    return conn.execute("INSERT INTO holdings(account_id, ticker, name, asset_class) VALUES (?,?,?,?)",
                        (account, ticker, name, cls)).lastrowid


def _trade(conn, account, holding, date, kind, qty=0, price=None, amount=0, fees=0, notes=""):
    conn.execute("INSERT INTO trades(account_id, holding_id, date, kind, quantity, price, amount, fees, notes) "
                 "VALUES (?,?,?,?,?,?,?,?,?)", (account, holding, date.isoformat(), kind, qty, price, amount, fees, notes))


def _setting(conn, key, value):
    conn.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, str(value)))


def sample_statement(today=None, currency="EUR"):
    """A made-up bank statement of the joint account (last 5 weeks, in the format of a bank of the interface language)
    for trying Import in the demo: some rows are already in HomeCoin (recognized as duplicates), the others are new and
    partly match the rules."""
    today = today or dt.date.today()
    # header (recognized by the import), card payment prefix, decimal separator, value date column, date format: the
    # "statement" of the language file
    st = i18n.statement()
    head, pos, dec, value_date, date_fmt = st["header"], st["card"], st["decimal"], st["value_date"], st.get("date", "%d/%m/%Y")
    rnd = random.Random(7)
    rows = []
    for i in range(14):
        d = today - dt.timedelta(days=2 + i * 2 + rnd.randint(0, 1))
        desc, amount = rnd.choice([(f"{pos} {L('Supermarket').upper()} CENTRALE", -rnd.randint(2500, 9000)),
                                   (f"{pos} {L('Pharmacy').upper()} SAN MARCO", -rnd.randint(800, 3500)),
                                   ("SDD STREAMING FAMILY", -1599), (f"{pos} {L('Pizzeria').upper()} DA LUIGI", -rnd.randint(3000, 6500)),
                                   (L("ATM withdrawal").upper(), -10000), (f"SEPA SAMPLE HOME {L('Refund').upper()}", rnd.randint(2000, 8000)),
                                   (f"{pos} {L('Fuel').upper()} A1", -rnd.randint(4000, 7000))])
        rows.append((d, desc, amount))
    out = [head]
    for d, desc, cents in sorted(rows, reverse=True):
        amt = f"{cents / 100:.2f}".replace(".", dec)
        day = d.strftime(date_fmt)
        out.append(";".join([day, *([day] if value_date else []), desc, amt, currency]))
    return "\n".join(out) + "\n"


def build(today=None):
    """Fill the database (already created and unlocked) with two sample spaces and 18 months of transactions."""
    rnd = random.Random(2026)
    today = today or dt.date.today()
    start = add_months(today.replace(day=1), -MONTHS)
    months = [add_months(start, i) for i in range(MONTHS + 1)]
    conn = dbm.connect()
    try:
        # ---------------------------------------------------------------- household
        fam = conn.execute("SELECT id FROM portfolios ORDER BY id LIMIT 1").fetchone()[0]
        conn.execute("UPDATE portfolios SET name = ?, icon = '🏡', color = '#ec4899' WHERE id = ?", (L("Sample Home"), fam))
        comune = conn.execute("SELECT id FROM accounts WHERE portfolio_id = ?", (fam,)).fetchone()[0]
        conn.execute("UPDATE accounts SET name = ?, initial_balance = 420000 WHERE id = ?", (L("Joint account"), comune))
        carta = _acc(conn, fam, L("Grocery card"), "prepagata", "💳", "#14b8a6", 15000)
        for i, (n, inc, kw) in enumerate((("Anna", 230000, "anna"), ("Marco", 210000, "marco"))):
            conn.execute("INSERT INTO people(portfolio_id, name, income, keyword, position) VALUES (?,?,?,?,?)", (fam, n, inc, kw, i))
        _rec(conn, name=L("Home mortgage"), kind="expense", amount=78500, account_id=comune, category_id=_cat(conn, fam, "Mortgage & loans"),
             start_date=add_months(start, -30).replace(day=5).isoformat(), installments=300, principal=17000000,
             rate_type="mixed", rate=2.9, fixed_years=10, rate_index="Euribor 3M", spread=1.1, index_value=2.0,
             generated=30, notes=L("Sample mixed-rate mortgage"))
        _rec(conn, name=L("Electricity & gas"), kind="expense", amount=14500, account_id=comune, category_id=_cat(conn, fam, "Utilities"),
             frequency="bimonthly", start_date=start.replace(day=20).isoformat())
        _rec(conn, name=L("Home internet"), kind="expense", amount=2990, account_id=comune, category_id=_cat(conn, fam, "Utilities"),
             start_date=start.replace(day=12).isoformat())
        _rec(conn, name=L("Home insurance"), kind="expense", amount=21000, account_id=comune,
             category_id=_cat(conn, fam, "Bank & insurance"), frequency="yearly", start_date=add_months(start, 2).replace(day=1).isoformat())
        _rec(conn, name=L("Grocery card top-up"), kind="transfer", amount=50000, account_id=comune, to_account_id=carta,
             start_date=start.replace(day=2).isoformat())
        _rec(conn, name=L("Contribution Anna"), kind="income", amount=118000, account_id=comune,
             category_id=_cat(conn, fam, "Contributions to household"), start_date=start.replace(day=1).isoformat())
        spesa, rist, casa_c, trasp, salute = (_cat(conn, fam, n) for n in
                                              ("Groceries", "Restaurants & bars", "Home & furniture", "Transport", "Health & personal care"))
        # a fixed-rate car loan with constant principal (installments going down) next to the mortgage (Mortgage & loans
        # tab), a cash wallet and an old closed account
        _rec(conn, name=L("Car loan"), kind="expense", amount=38100, account_id=comune, category_id=_cat(conn, fam, "Mortgage & loans"),
             start_date=add_months(start, -6).replace(day=15).isoformat(), installments=60, principal=1800000,
             rate_type="fixed", rate=5.4, amortization="constant", notes=L("Sample fixed-rate loan with constant principal"))
        cash = _acc(conn, fam, L("Cash"), "contanti", "💶", "#f59e0b", 8000)
        old = _acc(conn, fam, L("Old savings book"), "risparmio", "📕", "#94a3b8", 120000)
        _tx(conn, start + dt.timedelta(days=9), 120000, "transfer", old, desc=L("Savings book closed"), to=comune,
            notes=L("Account closed: archived, its history stays"))
        conn.execute("UPDATE accounts SET archived = 1 WHERE id = ?", (old,))
        # "expected" recurring item: variable bill, linked to the real payments by keyword (forecast = median)
        _rec(conn, name=L("Water bill"), kind="expense", amount=6200, account_id=comune, category_id=_cat(conn, fam, "Utilities"),
             frequency="bimonthly", start_date=start.replace(day=18).isoformat(), expected=1, match_text="aquaservice")
        other_c = _cat(conn, fam, "Other")
        for i, m in enumerate(months):
            if i % 2 == 0 and m.replace(day=18) <= today:
                _tx(conn, m.replace(day=16 + rnd.randint(0, 5)), rnd.randint(5200, 7400), "expense", comune,
                    _cat(conn, fam, "Utilities"), L("Water bill AquaService"))
            d = m + dt.timedelta(days=6)
            if d <= today:  # ATM withdrawals and small cash expenses
                _tx(conn, d, 10000, "transfer", comune, desc=L("ATM withdrawal"), to=cash)
                for _ in range(rnd.randint(2, 4)):
                    dd = m + dt.timedelta(days=rnd.randint(7, 27))
                    if dd <= today:
                        cat, desc = rnd.choice([(rist, L("Coffee")), (spesa, L("Bakery")), (spesa, L("Street market")),
                                                (other_c, L("Newsstand")), (other_c, L("Parking"))])
                        _tx(conn, dd, rnd.randint(300, 2500), "expense", cash, cat, desc)
        for m in months:
            for w in range(4):
                d = m + dt.timedelta(days=3 + w * 7)
                if d <= today:
                    _tx(conn, d, rnd.randint(6500, 13500), "expense", carta, spesa, rnd.choice([L("Supermarket"), L("Market"), L("Discount store")]))
            for _ in range(rnd.randint(1, 3)):
                d = m + dt.timedelta(days=rnd.randint(0, 27))
                if d <= today:
                    _tx(conn, d, rnd.randint(2500, 9000), "expense", comune, rist, rnd.choice([L("Pizzeria"), L("Trattoria"), L("Café")]))
            d = m + dt.timedelta(days=rnd.randint(5, 25))
            if d <= today:
                cat, desc = rnd.choice([(casa_c, L("Hardware store")), (casa_c, L("Furniture")), (salute, L("Pharmacy")),
                                        (trasp, L("Fuel")), (trasp, L("Car tax"))])
                _tx(conn, d, rnd.randint(3000, 25000), "expense", comune, cat, desc)
        # a purchase made for someone else and paid back: excluded from reports, still in the balance
        _tx(conn, months[-4].replace(day=9), 38000, "expense", comune, casa_c, L("Bike bought for a friend"),
            notes=L("Paid back in cash: excluded from reports and budgets"), excluded=1)
        _tx(conn, months[-2].replace(day=21), 64900, "expense", comune, casa_c, L("Washing machine"),
            notes=L("2-year warranty until {date}", date=add_months(months[-2], 24).strftime("%m/%Y")))
        # categorization rules, and a few recent transactions still to categorize (the rules or the history suggest them)
        for pattern, name in ((L("supermarket"), "Groceries"), (L("market"), "Groceries"), (L("pizzeria"), "Restaurants & bars"),
                              (L("pharmacy"), "Health & personal care"), (L("fuel"), "Transport"), ("aquaservice", "Utilities")):
            conn.execute("INSERT INTO rules(pattern, category_id) VALUES (?, ?)", (pattern, _cat(conn, fam, name)))
        for back, cents, desc in ((1, 4870, L("Supermarket")), (3, 1290, L("Pharmacy")), (4, 5600, L("Pizzeria")), (6, 2350, L("Hardware store"))):
            _tx(conn, today - dt.timedelta(days=back), cents, "expense", comune, None, desc, source="import")
        # rows of the sample statement (Import page) that are already here: the import recognizes them as duplicates
        for line in sample_statement(today).splitlines()[1:4]:
            cells = line.split(";")
            dmy, desc, amt = cells[0], cells[-3], cells[-2]
            cents = int(round(float(amt.replace(",", ".")) * 100))  # one decimal separator, no thousands
            day = dt.datetime.strptime(dmy, i18n.statement().get("date", "%d/%m/%Y")).date()  # the language's format
            _tx(conn, day, abs(cents), "expense" if cents < 0 else "income", comune, None, desc.title(), source="import")

        # -------------------------------------------------------------- personal
        pers = dbm.create_portfolio(conn, "Marco", "personal", "#6366f1", "👤")
        # fair split: Marco pays from his own space (his transfers are his), Anna from a bank outside HomeCoin (her
        # incomes are recognized by her name)
        conn.execute("UPDATE people SET space_id = ? WHERE portfolio_id = ? AND name = 'Marco'", (pers, fam))
        cc = _acc(conn, pers, L("Current account"), "corrente", "🏦", "#6366f1", 350000)
        dep = _acc(conn, pers, L("Deposit account"), "risparmio", "🐷", "#10b981", 800000)
        broker = _acc(conn, pers, L("Broker"), "investimenti", "📈", "#8b5cf6")
        card = _acc(conn, pers, L("Credit card"), "credito", "💳", "#e11d48")
        pension = _acc(conn, pers, L("Pension fund"), "investimenti", "🧓", "#0ea5e9", 1250000)
        etf = _holding(conn, broker, "DEMO-WORLD", L("World equity ETF (sample)"), "azioni")
        bond = _holding(conn, broker, "DEMO-BOND", L("Bond ETF (sample)"), "obbligazioni")
        mm = _holding(conn, broker, "DEMO-CASH", L("Money market ETF (sample)"), "monetario")
        gold = _holding(conn, broker, "DEMO-GOLD", L("Gold ETC (sample)"), "materie prime")
        price = {etf: 98.0, bond: 51.0, mm: 100.0, gold: 160.0}
        drift = {etf: (0.008, 0.035), bond: (0.002, 0.01), mm: (0.0028, 0.0004), gold: (0.006, 0.03)}
        for m in [add_months(start, -1), *months]:  # made-up month-end prices, with some fluctuation
            for h in price:
                price[h] *= 1 + rnd.gauss(*drift[h])
                conn.execute("INSERT INTO price_history(holding_id, month, price_eur) VALUES (?,?,?)", (h, m.strftime("%Y-%m"), round(price[h], 2)))
        for h in price:
            conn.execute("UPDATE holdings SET price_eur = ?, price = ?, currency = 'EUR', price_date = ? WHERE id = ?",
                         (round(price[h], 2), round(price[h], 2), today.isoformat(), h))
        _rec(conn, name=L("Salary"), kind="income", amount=210000, account_id=cc, category_id=_cat(conn, pers, "Salary"),
             start_date=start.replace(day=27).isoformat())
        _rec(conn, name=L("Contribution to household account"), kind="transfer", amount=108000, account_id=cc, to_account_id=comune,
             start_date=start.replace(day=1).isoformat())
        _rec(conn, name=L("World ETF plan"), kind="transfer", amount=30000, account_id=cc, to_account_id=broker, holding_id=etf,
             start_date=start.replace(day=10).isoformat(), pac_since=start.isoformat())
        _rec(conn, name=L("Savings deposit"), kind="transfer", amount=20000, account_id=cc, to_account_id=dep,
             start_date=start.replace(day=28).isoformat())
        _rec(conn, name=L("Streaming"), kind="expense", amount=1299, account_id=cc, category_id=_cat(conn, pers, "Subscriptions"),
             start_date=start.replace(day=15).isoformat())
        _rec(conn, name=L("Gym"), kind="expense", amount=4500, account_id=cc, category_id=_cat(conn, pers, "Sport & leisure"),
             start_date=start.replace(day=3).isoformat())
        _tx(conn, add_months(start, 1).replace(day=12), 300000, "transfer", cc, desc=L("First transfer to the broker"), to=broker)
        _trade(conn, broker, bond, add_months(start, 1).replace(day=14), "buy", 50, 50.5, -252700, 200, L("Initial purchase (sample)"))
        # more trades: money market for the reserve, gold, a partial sale (realized gain), coupons, interest, a fee
        _tx(conn, add_months(start, 3).replace(day=4), 500000, "transfer", dep, desc=L("To the broker: reserve in money market"), to=broker)
        _trade(conn, broker, mm, add_months(start, 3).replace(day=6), "buy", 48, 100.6, -483080, 200, L("Emergency reserve"))
        _trade(conn, broker, gold, add_months(start, 5).replace(day=11), "buy", 6, 158.2, -95120, 200)
        _trade(conn, broker, bond, add_months(start, 12).replace(day=20), "sell", 15, 52.9, 79150, 200, L("Partial sale"))
        for k in (4, 10, 16):
            if add_months(start, k) <= today:
                _trade(conn, broker, bond, add_months(start, k).replace(day=15), "dividend", amount=rnd.randint(2200, 2600),
                       notes=L("Half-yearly coupon"))
        for k in range(2, MONTHS, 3):
            _trade(conn, broker, None, add_months(start, k).replace(day=28), "interest", amount=rnd.randint(150, 400),
                   notes=L("Interest on uninvested cash"))
        _trade(conn, broker, None, add_months(start, 12) - dt.timedelta(days=1), "fee", amount=-3400, notes=L("Yearly custody fee"))
        # pension fund: valued as a whole from the statements (no securities), monthly contributions
        _rec(conn, name=L("Pension fund contribution"), kind="transfer", amount=15000, account_id=cc, to_account_id=pension,
             start_date=start.replace(day=20).isoformat())
        val = 1250000
        for i, m in enumerate(months):
            val = int(val * (1 + rnd.gauss(0.004, 0.012))) + 15000
            if i % 3 == 2 and add_months(m, 1) - dt.timedelta(days=1) <= today:
                conn.execute("INSERT INTO valuations(account_id, date, value) VALUES (?,?,?)",
                             (pension, (add_months(m, 1) - dt.timedelta(days=1)).isoformat(), val))
        cats = {n: _cat(conn, pers, n) for n in ("Restaurants & bars", "Shopping & gifts", "Transport", "Books & learning", "Travel", "Taxes")}
        for i, m in enumerate(months):
            for _ in range(rnd.randint(2, 4)):
                d = m + dt.timedelta(days=rnd.randint(0, 27))
                if d <= today:
                    name, desc = rnd.choice([("Restaurants & bars", L("Dinner")), ("Shopping & gifts", L("Gift")),
                                             ("Shopping & gifts", L("Shop")), ("Transport", L("Train")),
                                             ("Books & learning", L("Bookstore"))])
                    _tx(conn, d, rnd.randint(1500, 12000), "expense", cc, cats[name], desc)
            # regular but variable income, without a recurring item: the Calendar estimates it from history
            d = m.replace(day=min(28, 12 + rnd.randint(-3, 3)))
            if d < today.replace(day=1):
                _tx(conn, d, rnd.randint(35000, 70000), "income", cc, _cat(conn, pers, "Other income"), L("Sample consulting fee"))
            if i % 6 == 4:
                d = m + dt.timedelta(days=8)
                if d <= today:
                    _tx(conn, d, rnd.randint(45000, 90000), "expense", cc, cats["Travel"], L("Weekend away"))
            # credit card: purchases during the month, paid off from the current account at the start of the next
            spent = 0
            for _ in range(rnd.randint(2, 5)):
                d = m + dt.timedelta(days=rnd.randint(0, 27))
                if d <= today:
                    cents = rnd.randint(1500, 9000)
                    spent += cents
                    name, desc = rnd.choice([("Shopping & gifts", L("Online store")), ("Shopping & gifts", L("Clothing")),
                                             ("Shopping & gifts", L("Electronics")), ("Shopping & gifts", L("Gift shop")),
                                             ("Restaurants & bars", L("Sushi bar"))])
                    _tx(conn, d, cents, "expense", card, cats[name], desc)
            if spent and add_months(m, 1).replace(day=5) <= today:
                _tx(conn, add_months(m, 1).replace(day=5), spent, "transfer", cc, desc=L("Credit card payment"), to=card)
            if m.month == 12 and m.replace(day=31) <= today:
                _tx(conn, m.replace(day=31), rnd.randint(4000, 7000), "income", dep, _cat(conn, pers, "Interest"), L("Yearly interest"))
        _tx(conn, months[-3].replace(day=16), 42000, "expense", cc, cats["Taxes"], L("Income tax"))
        for pattern, name in ((L("train"), "Transport"), (L("bookstore"), "Books & learning"), (L("sushi"), "Restaurants & bars")):
            conn.execute("INSERT INTO rules(pattern, category_id) VALUES (?, ?)", (pattern, _cat(conn, pers, name)))

        # ------------------------------------------------- goals, budgets, settings, activity log
        conn.execute("INSERT INTO goals(portfolio_id, name, icon, color, target, target_date, account_id) VALUES (?,?,?,?,?,?,?)",
                     (pers, L("House down payment"), "🏠", "#3b82f6", 3000000, add_months(today, 30).isoformat(), dep))
        conn.execute("INSERT INTO goals(portfolio_id, name, icon, color, target, target_date, saved) VALUES (?,?,?,?,?,?,?)",
                     (pers, L("New laptop"), "💻", "#8b5cf6", 160000, add_months(today, 4).isoformat(), 95000))
        conn.execute("INSERT INTO goals(portfolio_id, name, icon, color, target, target_date, saved) VALUES (?,?,?,?,?,?,?)",
                     (fam, L("New kitchen"), "🛋️", "#f59e0b", 1200000, add_months(today, 24).isoformat(), 380000))
        conn.execute("INSERT INTO goals(portfolio_id, name, icon, color, target, target_date, saved) VALUES (?,?,?,?,?,?,?)",
                     (fam, L("Summer holiday"), "🏖️", "#14b8a6", 300000, add_months(today, 7).isoformat(), 120000))
        for pid, budgets in ((fam, (("Groceries", 45000), ("Restaurants & bars", 15000), ("Utilities", 18000),
                                    ("Home & furniture", 20000), ("Transport", 12000))),
                             (pers, (("Restaurants & bars", 12000), ("Shopping & gifts", 10000), ("Subscriptions", 2500),
                                     ("Books & learning", 4000)))):
            for name, cents in budgets:
                conn.execute("UPDATE categories SET budget = ? WHERE portfolio_id = ? AND code = ?",
                             (cents, pid, i18n.code_of_name(name)))
        _setting(conn, f"emergency_months@{pers}", 4)
        _setting(conn, f"split_months@{fam}", 6)
        _setting(conn, f"rebalance@{pers}", json.dumps({
            "accounts": [broker], "mode": "class", "targets": {"class": {"azioni": 60, "obbligazioni": 20, "monetario": 15,
                                                                         "materie prime": 5}, "security": {}},
            "excluded": {"class": [], "security": []}, "drift_abs": 5.0, "drift_rel": 25.0, "contribution": 100000, "sells": False}))
        _setting(conn, "last_backup_download", (today - dt.timedelta(days=41)).isoformat())  # shows the backup reminder
        log = [(40, "security", "Password created", ""), (40, "change", "Space created", "Marco"),
               (39, "data", "Bank statement imported", L("{n} transactions", n=62)), (38, "change", "Account created", L("Credit card")),
               (32, "change", "Recurring item created", L("Water bill")), (21, "change", "Fair split applied to recurring items", ""),
               (6, "access", "Sign-in", i18n.tn("after {n} failed attempt", "after {n} failed attempts", 2)),
               (5, "delete", "Transaction deleted", L("Duplicate payment")), (2, "data", "Transactions exported (unencrypted file)", L("whole period")),
               (0, "access", "Sign-in", "")]
        for back, kind, action, detail in log:
            ts = dt.datetime.combine(today - dt.timedelta(days=back), dt.time(9 + back % 10, 7 * (back % 8)))
            conn.execute("INSERT INTO audit_log(ts, kind, action, detail, portfolio) VALUES (?,?,?,?,?)",
                         (ts.isoformat(sep=" ", timespec="seconds"), "security" if "failed" in detail else kind, action, detail,
                          "Marco" if action in ("Account created",) else L("Sample Home")))
        conn.commit()
        process_recurring(conn, today)  # records past due items (and the investment plan purchases)
        # older plan purchases are already verified, the latest stay "estimated" (they show the reminder)
        conn.execute("UPDATE trades SET notes = ? WHERE source = 'recurring' AND date < ?",
                     (L("Automatic purchase «{name}» · {verified}", name=L("World ETF plan"), verified=L("verified price")),
                      add_months(today, -2).isoformat()))
        from .tools import sync_holdings
        sync_holdings(conn, broker)
        conn.commit()
    finally:
        conn.close()
