"""Demo version: builds an encrypted database from scratch with sample data ("Sample" household), to show
HomeCoin without opening your own data. Used by demo.py / HomeCoin-Demo.cmd with a separate data folder,
recreated at every start: nothing done in the demo is kept, and the real data is never touched.
"""
import datetime as dt
import random

from . import db as dbm
from .services import process_recurring
from .util import add_months

PASSWORD = "demo-homecoin"  # shown on the demo's sign-in screen: it only protects fake data
MONTHS = 18


def _cat(conn, pid, name):
    return conn.execute("SELECT id FROM categories WHERE portfolio_id = ? AND name = ?", (pid, name)).fetchone()[0]


def _acc(conn, pid, name, type_, icon, color, initial=0):
    return conn.execute("INSERT INTO accounts(portfolio_id, name, type, icon, color, initial_balance) VALUES (?,?,?,?,?,?)",
                        (pid, name, type_, icon, color, initial)).lastrowid


def _rec(conn, **r):
    r.setdefault("frequency", "monthly")
    cols = ",".join(r)
    return conn.execute(f"INSERT INTO recurring({cols}) VALUES ({','.join('?' * len(r))})", tuple(r.values())).lastrowid


def _tx(conn, date, amount, kind, account, category=None, desc="", to=None):
    conn.execute("INSERT INTO transactions(date, amount, kind, account_id, to_account_id, category_id, description) "
                 "VALUES (?,?,?,?,?,?,?)", (date.isoformat(), amount, kind, account, to, category, desc))


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
        conn.execute("UPDATE portfolios SET name = 'Sample Home', icon = '🏡', color = '#ec4899' WHERE id = ?", (fam,))
        comune = conn.execute("SELECT id FROM accounts WHERE portfolio_id = ?", (fam,)).fetchone()[0]
        conn.execute("UPDATE accounts SET name = 'Joint account', initial_balance = 420000 WHERE id = ?", (comune,))
        carta = _acc(conn, fam, "Grocery card", "prepagata", "💳", "#14b8a6", 15000)
        for i, (n, inc, kw) in enumerate((("Anna", 230000, "anna"), ("Marco", 210000, "marco"))):
            conn.execute("INSERT INTO people(portfolio_id, name, income, keyword, position) VALUES (?,?,?,?,?)", (fam, n, inc, kw, i))
        _rec(conn, name="Home mortgage", kind="expense", amount=78500, account_id=comune, category_id=_cat(conn, fam, "Mortgage & loans"),
             start_date=add_months(start, -30).replace(day=5).isoformat(), installments=300, principal=17000000,
             rate_type="mixed", rate=2.9, fixed_years=10, rate_index="Euribor 3M", spread=1.1, index_value=2.0,
             generated=30, notes="Sample mixed-rate mortgage")
        _rec(conn, name="Electricity & gas", kind="expense", amount=14500, account_id=comune, category_id=_cat(conn, fam, "Utilities"),
             frequency="bimonthly", start_date=start.replace(day=20).isoformat())
        _rec(conn, name="Home internet", kind="expense", amount=2990, account_id=comune, category_id=_cat(conn, fam, "Utilities"),
             start_date=start.replace(day=12).isoformat())
        _rec(conn, name="Home insurance", kind="expense", amount=21000, account_id=comune,
             category_id=_cat(conn, fam, "Bank & insurance"), frequency="yearly", start_date=add_months(start, 2).replace(day=1).isoformat())
        _rec(conn, name="Grocery card top-up", kind="transfer", amount=50000, account_id=comune, to_account_id=carta,
             start_date=start.replace(day=2).isoformat())
        _rec(conn, name="Contribution Anna", kind="income", amount=95000, account_id=comune,
             category_id=_cat(conn, fam, "Contributions to household"), start_date=start.replace(day=1).isoformat())
        spesa, rist, casa_c, trasp, salute = (_cat(conn, fam, n) for n in
                                              ("Groceries", "Restaurants & bars", "Home & furniture", "Transport", "Health & personal care"))
        for m in months:
            for w in range(4):
                d = m + dt.timedelta(days=3 + w * 7)
                if d <= today:
                    _tx(conn, d, rnd.randint(6500, 13500), "expense", carta, spesa, rnd.choice(["Supermarket", "Market", "Discount store"]))
            for _ in range(rnd.randint(1, 3)):
                d = m + dt.timedelta(days=rnd.randint(0, 27))
                if d <= today:
                    _tx(conn, d, rnd.randint(2500, 9000), "expense", comune, rist, rnd.choice(["Pizzeria", "Trattoria", "Café"]))
            d = m + dt.timedelta(days=rnd.randint(5, 25))
            if d <= today:
                _tx(conn, d, rnd.randint(3000, 25000), "expense", comune, rnd.choice([casa_c, trasp, salute]),
                    rnd.choice(["Hardware store", "Pharmacy", "Fuel", "Furniture", "Car tax"]))

        # -------------------------------------------------------------- personal
        pers = dbm.create_portfolio(conn, "Marco", "personal", "#6366f1", "👤")
        cc = _acc(conn, pers, "Current account", "corrente", "🏦", "#6366f1", 350000)
        dep = _acc(conn, pers, "Deposit account", "risparmio", "🐷", "#10b981", 800000)
        broker = _acc(conn, pers, "Broker", "investimenti", "📈", "#8b5cf6")
        etf = conn.execute("INSERT INTO holdings(account_id, ticker, name, asset_class) VALUES (?,?,?,?)",
                           (broker, "DEMO-WORLD", "World equity ETF (sample)", "azioni")).lastrowid
        bond = conn.execute("INSERT INTO holdings(account_id, ticker, name, asset_class) VALUES (?,?,?,?)",
                            (broker, "DEMO-BOND", "Bond ETF (sample)", "obbligazioni")).lastrowid
        price = {etf: 98.0, bond: 51.0}
        for m in [add_months(start, -1), *months]:  # made-up month-end prices, with some fluctuation
            price[etf] *= 1 + rnd.gauss(0.008, 0.035)
            price[bond] *= 1 + rnd.gauss(0.002, 0.01)
            for h in (etf, bond):
                conn.execute("INSERT INTO price_history(holding_id, month, price_eur) VALUES (?,?,?)", (h, m.strftime("%Y-%m"), round(price[h], 2)))
        for h in (etf, bond):
            conn.execute("UPDATE holdings SET price_eur = ?, price = ?, currency = 'EUR', price_date = ? WHERE id = ?",
                         (round(price[h], 2), round(price[h], 2), today.isoformat(), h))
        _rec(conn, name="Salary", kind="income", amount=210000, account_id=cc, category_id=_cat(conn, pers, "Salary"),
             start_date=start.replace(day=27).isoformat())
        _rec(conn, name="Contribution to household account", kind="transfer", amount=95000, account_id=cc, to_account_id=comune,
             start_date=start.replace(day=1).isoformat())
        _rec(conn, name="World ETF plan", kind="transfer", amount=30000, account_id=cc, to_account_id=broker, holding_id=etf,
             start_date=start.replace(day=10).isoformat(), pac_since=start.isoformat())
        _rec(conn, name="Savings deposit", kind="transfer", amount=20000, account_id=cc, to_account_id=dep,
             start_date=start.replace(day=28).isoformat())
        _rec(conn, name="Streaming", kind="expense", amount=1299, account_id=cc, category_id=_cat(conn, pers, "Subscriptions"),
             start_date=start.replace(day=15).isoformat())
        _rec(conn, name="Gym", kind="expense", amount=4500, account_id=cc, category_id=_cat(conn, pers, "Sport & leisure"),
             start_date=start.replace(day=3).isoformat())
        _tx(conn, add_months(start, 1).replace(day=12), 300000, "transfer", cc, desc="First transfer to the broker", to=broker)
        conn.execute("INSERT INTO trades(account_id, holding_id, date, kind, quantity, price, amount, fees, notes) "
                     "VALUES (?,?,?, 'buy', 50, 50.5, -252700, 200, 'Initial purchase (sample)')",
                     (broker, bond, add_months(start, 1).replace(day=14).isoformat()))
        cats = {n: _cat(conn, pers, n) for n in ("Restaurants & bars", "Shopping & gifts", "Transport", "Books & learning", "Travel", "Taxes")}
        for i, m in enumerate(months):
            for _ in range(rnd.randint(2, 4)):
                d = m + dt.timedelta(days=rnd.randint(0, 27))
                if d <= today:
                    name = rnd.choice(["Restaurants & bars", "Shopping & gifts", "Transport", "Books & learning"])
                    _tx(conn, d, rnd.randint(1500, 12000), "expense", cc, cats[name], rnd.choice(["Shop", "Bookstore", "Train", "Dinner", "Gift"]))
            # regular but variable income, without a recurring item: the Calendar estimates it from history
            d = m.replace(day=min(28, 12 + rnd.randint(-3, 3)))
            if d < today.replace(day=1):
                _tx(conn, d, rnd.randint(35000, 70000), "income", cc, _cat(conn, pers, "Other income"), "Sample consulting fee")
            if i % 6 == 4:
                d = m + dt.timedelta(days=8)
                if d <= today:
                    _tx(conn, d, rnd.randint(45000, 90000), "expense", cc, cats["Travel"], "Weekend away")
        _tx(conn, months[-3].replace(day=16), 42000, "expense", cc, cats["Taxes"], "Income tax")
        conn.execute("INSERT INTO goals(portfolio_id, name, icon, color, target, target_date) VALUES (?,?,?,?,?,?)",
                     (pers, "Long trip", "✈️", "#3b82f6", 450000, add_months(today, 10).isoformat()))
        conn.execute("INSERT INTO goals(portfolio_id, name, icon, color, target, target_date) VALUES (?,?,?,?,?,?)",
                     (fam, "New kitchen", "🛋️", "#f59e0b", 1200000, add_months(today, 24).isoformat()))
        for name, cents in (("Groceries", 45000), ("Restaurants & bars", 15000), ("Utilities", 18000)):
            conn.execute("UPDATE categories SET budget = ? WHERE portfolio_id = ? AND name = ?", (cents, fam, name))
        conn.commit()
        process_recurring(conn, today)  # records past due items (and the investment plan purchases)
        # older plan purchases are already verified, the latest stay "estimated" (they show the reminder)
        conn.execute("UPDATE trades SET notes = 'Automatic purchase «World ETF plan» · verified price' "
                     "WHERE source = 'recurring' AND date < ?", (add_months(today, -2).isoformat(),))
        from .tools import sync_holdings
        sync_holdings(conn, broker)
        conn.commit()
    finally:
        conn.close()
