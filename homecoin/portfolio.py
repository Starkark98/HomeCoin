"""Portfolio analysis (2.5.0): what the investments of a space are made of — by asset class, security, country, region,
developed/emerging market, sector and currency, looking inside the funds ("look-through") — plus diversification
against the world equity market, the overlap between funds, costs (TER) and the correlation of the securities.
Read-only calculations: nothing here records transactions or trades.

What is not known is reported, never guessed: every view says how much of the value it covers and why the rest is
missing (no ISIN, composition not downloaded, not published by the issuer, synthetic fund, broker cash…).
"""
import datetime as dt
import json
import re
import urllib.parse
import urllib.request

from . import funds, i18n, tools
from .util import parse_date

STALE_DAYS = 120  # a composition older than this is flagged: funds change their holdings over time
TOP_HOLDINGS = 20  # largest underlying securities listed in Composition
# countries with a flag in static/vendor/flags (flag-icons, MIT): the page shows a flag only for these
_FLAG_DIR = __import__("pathlib").Path(__file__).resolve().parent.parent / "static" / "vendor" / "flags"
FLAGS = sorted(p.stem.upper() for p in _FLAG_DIR.glob("*.svg")) if _FLAG_DIR.is_dir() else []


def setting_online(db):
    """Download of fund compositions from the issuers: global setting, off until the user turns it on."""
    r = db.execute("SELECT value FROM settings WHERE key = 'fund_data_online'").fetchone()
    return bool(r) and r[0] == "1"


def _positions(db, pid, account_ids=None):
    """Investment accounts of the space with the value of each security and of the uninvested cash (as in the
    Investments page and the allocation chart)."""
    inv = tools.investments(db, pid, months=1, account_ids=account_ids)
    out = []
    for a in inv["accounts"]:
        priced = [h for h in a["holdings"] if h.get("value")]
        # units held but no price yet (never updated, or a code Yahoo does not know): reported, not counted as zero
        unpriced = [h for h in a["holdings"] if (h.get("quantity") or 0) > 1e-9 and h.get("value") is None]
        out.append({"account": a, "holdings": priced, "unpriced": unpriced, "cash": a["cash"] if a["has_trades"] else None,
                    "whole": None if (a["has_trades"] or priced) else a["value"]})
    return out


def _cash_like(r):
    """A line of a fund that is cash or a derivative, not a security: deposits, collateral, futures, FX."""
    return str(r.get("asset") or "").lower() in ("cash", "derivative", "futures", "fx", "money market") \
        or (r.get("sector") == "Cash and other" and not r.get("isin"))


def _fund_rows(db, isin):
    r = db.execute("SELECT * FROM fund_data WHERE isin = ?", (isin,)).fetchone() if isin else None
    if not r:
        return None
    d = dict(r)
    try:
        d["holdings"] = json.loads(d["holdings"] or "[]")
    except ValueError:
        d["holdings"] = []
    return d


# Diversification score, 1 to 10, from the standard measures used by fund managers, index providers and regulators.
# Each criterion has its points; a criterion that cannot be measured (e.g. the correlation without 12 months of prices)
# is left out and the score is scaled on the others, so it is never lowered by missing data.
#   companies   effective number of companies = 1 ÷ Herfindahl-Hirschman index (sum of the squared weights)   2 points
#   issuer      UCITS 5/10/40 rule: no company above 10%, those above 5% together at most 40%                1 point
#   top10       weight of the 10 largest companies (concentration ratio)                                       1 point
#   countries   similarity to the world equity market by country (sum of the smaller weight, country by country)  2 points
#   sectors     effective number of GICS sectors (1 ÷ HHI of the sector weights; the world market is about 7)  2 points
#   classes     at least two asset classes with 10% or more each (strategic asset allocation)                  1 point
#   correlation average correlation of the monthly returns of the securities at most 0.5                       1 point
SCORE_RULES = {"companies": (2, 75, 25), "top10": (1, 0.30), "countries": (2, 0.70, 0.45), "sectors": (2, 6, 4),
               "correlation": (1, 0.5)}


def _diversification(under, eq_country, sectors, equity_total, classes=None, corr_avg=None):
    """How diversified the shares are (see SCORE_RULES), plus the comparison of areas and markets with the world
    equity market and how much of it the countries held cover. None when nothing inside the shares is known."""
    eq = [u for u in under.values() if u["equity"] > 0]
    known = sum(u["equity"] for u in eq)
    if not known:
        return None
    w = sorted((u["equity"] / known for u in eq), reverse=True)
    n_eff = 1 / sum(x * x for x in w)
    top10 = sum(w[:10])
    above5 = sum(x for x in w if x > 0.05)
    largest = max(eq, key=lambda u: u["equity"])
    ctot = sum(eq_country.values()) or 1
    port = {c: v * 100 / ctot for c, v in eq_country.items()}
    wtot = sum(funds.WORLD.values())
    world = {c: v * 100 / wtot for c, v in funds.WORLD.items()}
    similarity = sum(min(port.get(c, 0), world.get(c, 0)) for c in set(port) | set(world))
    held = {c for c, p in port.items() if p >= 0.1}
    world_cov = sum(world.get(c, 0) for c in held)

    def group(fn, keys):
        return [{"key": k, "portfolio": sum(p for c, p in port.items() if fn(c) == k),
                 "world": sum(p for c, p in world.items() if fn(c) == k)} for k in keys]
    sec_tot = sum(v for v in sectors.values() if v > 0)
    sw = [v / sec_tot for v in sectors.values() if v > 0] if sec_tot else []
    n_sectors = sum(1 for x in sw if x >= 0.01)
    sec_eff = 1 / sum(x * x for x in sw) if sw else None
    top_sector = max(sectors.items(), key=lambda kv: kv[1])[0] if sw else None
    cls = {k: v for k, v in (classes or {}).items() if k not in ("liquidità", "non specificato") and v > 0}
    cls_tot = sum(cls.values())
    n_classes = sum(1 for v in cls.values() if cls_tot and v / cls_tot >= 0.10)

    def pts(value, rule, lower_is_better=False):
        top, full, half = (rule + (None,))[:3]
        ok = (lambda x, t: x <= t) if lower_is_better else (lambda x, t: x >= t)
        return top if ok(value, full) else (top // 2 if half is not None and ok(value, half) else 0)
    R = SCORE_RULES
    criteria = [
        {"key": "companies", "value": round(n_eff, 1), "points": pts(n_eff, R["companies"]), "max": 2},
        {"key": "issuer", "value": w[0], "extra": above5, "points": 1 if w[0] <= 0.10 and above5 <= 0.40 else 0, "max": 1},
        {"key": "top10", "value": top10, "points": pts(top10, R["top10"], True), "max": 1},
        {"key": "countries", "value": similarity / 100, "points": pts(similarity / 100, R["countries"]), "max": 2},
        {"key": "sectors", "value": round(sec_eff, 1) if sec_eff else None,
         "points": pts(sec_eff, R["sectors"]) if sec_eff else 0, "max": 2, "available": sec_eff is not None},
        {"key": "classes", "value": n_classes, "points": 1 if n_classes >= 2 else 0, "max": 1, "available": cls_tot > 0},
        {"key": "correlation", "value": corr_avg, "points": pts(corr_avg, R["correlation"], True) if corr_avg is not None else 0,
         "max": 1, "available": corr_avg is not None},
    ]
    for c in criteria:
        c.setdefault("available", True)
        if not c["available"]:
            c["points"] = 0
    got = sum(c["points"] for c in criteria if c["available"])
    out_of = sum(c["max"] for c in criteria if c["available"])
    score = max(1, round(got * 10 / out_of)) if out_of else 1
    return {"level": "high" if score >= 8 else "medium" if score >= 5 else "low", "score": score, "max_score": 10,
            "criteria": criteria,
            "companies": len(eq), "effective": round(n_eff, 1), "top10": top10, "largest": {"name": largest["name"],
                                                                                          "share": largest["equity"] / known},
            "top_sector": top_sector, "top_sector_share": (max(sw) if sw else None),
            "countries": len(held), "sectors": n_sectors, "world_coverage": world_cov / 100, "similarity": similarity / 100,
            "regions": group(funds.region_of, funds.REGIONS[:5]),
            "markets": group(funds.market_of, ("Developed", "Emerging", "Frontier and other")),
            "known_share": known / equity_total if equity_total else 0, "world_as_of": funds.WORLD_AS_OF}


def composition(db, pid, account_ids=None, today=None):
    """Look-through composition of the investments (values in cents)."""
    today = today or dt.date.today()
    base = tools.currency_of(db)
    dims = ("country", "region", "market", "sector", "currency")
    agg = {k: {} for k in dims}
    covered = {k: 0 for k in dims}
    total, equity_total, rows_by_fund, missing, notes, instruments, classes = 0, 0, {}, [], [], [], {}
    under = {}  # look-through: underlying security → {name, isin, value, funds, equity}
    eq_country = {}  # countries of the shares only: what is compared with the world equity market

    def add(dim, key, value):
        agg[dim][key] = agg[dim].get(key, 0) + value
        covered[dim] += value

    for pos in _positions(db, pid, account_ids):
        acc = pos["account"]
        if pos["whole"]:  # valued only as a whole (e.g. a pension fund with valuations): nothing known inside
            total += pos["whole"]
            classes["non specificato"] = classes.get("non specificato", 0) + pos["whole"]
            missing.append({"name": acc["name"], "value": pos["whole"], "reason": "whole"})
        if pos["cash"] and pos["cash"] > 0:
            total += pos["cash"]
            classes["liquidità"] = classes.get("liquidità", 0) + pos["cash"]
            add("currency", base, pos["cash"])
            missing.append({"name": i18n.t("{name} (cash)", name=acc["name"]), "value": pos["cash"], "reason": "cash",
                            "dims": ["country", "region"]})
        for h in pos.get("unpriced", []):
            missing.append({"name": h["name"] or h["ticker"], "value": None, "reason": "no_price", "holding_id": h["id"]})
        for h in pos["holdings"]:
            v = h["value"]
            total += v
            is_equity = h["asset_class"] == "azioni"
            if is_equity:
                equity_total += v
            classes[h["asset_class"]] = classes.get(h["asset_class"], 0) + v
            instruments.append({"id": h["id"], "name": h["name"] or h["ticker"], "ticker": h["ticker"], "value": v,
                                "asset_class": h["asset_class"], "isin": h.get("isin") or "", "account": acc["name"],
                                "ter": h.get("ter")})
            fd = _fund_rows(db, (h.get("isin") or "").upper())
            if not fd or not fd["holdings"]:
                reason = "no_isin" if not h.get("isin") else ("not_found" if fd else "not_loaded")
                missing.append({"name": h["name"] or h["ticker"], "value": v, "reason": reason, "holding_id": h["id"],
                                "isin": h.get("isin") or ""})
                continue
            rows = fd["holdings"]
            tot_w = sum(r["weight"] for r in rows if r["weight"] > 0) or 1
            s = funds.summary(rows)
            for dim in dims:
                if dim == "sector" and not is_equity:
                    continue  # sectors describe the shares: a bond fund's issuers are not counted as sectors
                for key, w in s[dim].items():
                    add(dim, key, round(v * w / tot_w))
            if is_equity:
                for key, w in s["country"].items():
                    eq_country[key] = eq_country.get(key, 0) + v * w / tot_w
            needed = [d for d in dims if d != "sector" or is_equity]
            # cash and derivatives inside a fund (deposits of a money market fund, futures) have a currency but no
            # country or sector: their absence there is not information the issuer failed to publish
            cash_w = sum(r["weight"] for r in rows if r["weight"] > 0 and _cash_like(r))
            lacking = [d for d in needed if sum(s[d].values()) < (tot_w if d == "currency" else tot_w - cash_w) * 0.95]
            if lacking:
                missing.append({"name": h["name"] or h["ticker"], "value": v, "reason": "partial", "dims": lacking,
                                "issuer": fd["issuer"]})
            if s["estimated_currency"] > tot_w * 0.05:
                notes.append({"level": "info", "text": i18n.t("{name}: the issuer does not give the currency of each "
                                                               "holding; it is estimated from the country.", name=h["name"] or h["ticker"])})
            if fd["source"] == "issuer" and funds.is_synthetic(fd["fund_name"] or h["name"], rows):
                notes.append({"level": "warn", "text": i18n.t("{name} is a synthetic (swap) fund: the issuer publishes "
                                                               "the basket it holds as collateral, not the index it follows, "
                                                               "so its countries and sectors are not its real exposure.",
                                                               name=h["name"] or h["ticker"])})
            if fd["as_of"] and (today - (parse_date(fd["as_of"]) or today)).days > STALE_DAYS:
                notes.append({"level": "info", "text": i18n.t("{name}: composition of {date}, update it.",
                                                               name=h["name"] or h["ticker"], date=fd["as_of"])})
            rows_by_fund[h["id"]] = (h["name"] or h["ticker"], v, rows, tot_w)
            for r in rows:
                key = r["isin"] or re.sub(r"[^a-z0-9]", "", r["name"].lower())[:24]
                if not key or r["weight"] <= 0 or (r.get("sector") == "Cash and other" and not r["isin"]) \
                        or str(r.get("asset") or "").lower() in ("other", "cash", "derivative", "futures"):
                    continue  # cash, derivatives and "all the rest" lines are not securities you hold
                u = under.setdefault(key, {"name": r["name"], "isin": r["isin"], "value": 0, "funds": [], "equity": 0,
                                           "country": r.get("country") or ""})
                u["value"] += v * r["weight"] / tot_w
                if is_equity:
                    u["equity"] += v * r["weight"] / tot_w
                if h["id"] not in u["funds"]:
                    u["funds"].append(h["id"])

    def table(dim):
        """Shares of the part whose information is known (as the platforms show them); how much of the total value
        that part is comes in "coverage"."""
        base_ = covered[dim]
        return [{"key": k, "value": round(v), "share": v / base_ if base_ else 0}
                for k, v in sorted(agg[dim].items(), key=lambda x: -x[1])]

    names = {i["id"]: i["name"] for i in instruments}
    top = sorted(under.values(), key=lambda x: -x["value"])[:TOP_HOLDINGS]
    corr = correlation(db, pid, account_ids=account_ids)
    diversification = _diversification(under, eq_country, agg["sector"], equity_total, classes, corr["average"])
    overlaps = []
    fids = list(rows_by_fund)
    for i, a in enumerate(fids):
        for b in fids[i + 1:]:
            pct = funds.overlap(rows_by_fund[a][2], rows_by_fund[b][2])
            if pct >= 1:
                overlaps.append({"a": rows_by_fund[a][0], "b": rows_by_fund[b][0], "overlap": round(pct, 1)})
    overlaps.sort(key=lambda x: -x["overlap"])
    return {
        "total": total, "currency": base, "online": setting_online(db),
        # sectors are known for a part of the shares only: their coverage is of the equity value
        "coverage": {d: min(1, covered[d] / (equity_total if d == "sector" else total)) if (equity_total if d == "sector" else total)
                     else 0 for d in dims},  # (min: the parts are rounded to cents)
        "equity_total": equity_total,
        "asset_classes": [{"key": k, "value": v, "share": v / total if total else 0}
                          for k, v in sorted(classes.items(), key=lambda x: -x[1])],
        "instruments": sorted([{**x, "share": x["value"] / total if total else 0} for x in instruments], key=lambda x: -x["value"]),
        "countries": table("country"), "regions": table("region"), "markets": table("market"), "sectors": table("sector"),
        "currencies": table("currency"), "diversification": diversification,
        "top_holdings": [{"name": u["name"], "isin": u["isin"], "country": u["country"], "value": round(u["value"]),
                          "share": u["value"] / total if total else 0, "funds": [names.get(f, "") for f in u["funds"]]}
                         for u in top],
        "overlaps": overlaps[:15], "missing": sorted(missing, key=lambda x: -(x["value"] or 0)), "notes": notes,
        "flags": FLAGS,
        "funds_loaded": len(rows_by_fund),
    }


# ------------------------------------------------------------------ refresh (network, on request only)

def _yahoo_sector(ticker, timeout=12):
    """Sector of a single stock from Yahoo's search (sends only the ticker); '' if not given."""
    url = "https://query1.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode(
        {"q": ticker, "quotesCount": 5, "newsCount": 0, "listsCount": 0})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HomeCoin"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        quotes = json.loads(r.read().decode("utf-8")).get("quotes", [])
    q = next((x for x in quotes if str(x.get("symbol", "")).upper() == ticker.upper()), None) or (quotes[0] if quotes else {})
    return funds.sector_of(q.get("sector") or q.get("sectorDisp") or "")


def refresh(db, pid, holding_ids=None):
    """Downloads what is inside each security of the space that has an ISIN: funds from their issuer (ISIN only),
    single stocks from their ISIN and Yahoo's sector (ticker only). Returns a report per security."""
    if not setting_online(db):
        raise ValueError(i18n.t("Turn on the download of fund compositions first"))
    rows = db.execute("""SELECT h.* FROM holdings h JOIN accounts a ON a.id = h.account_id
                         WHERE a.portfolio_id = ? AND a.type = ?""", (pid, tools.INVEST)).fetchall()
    report, done = [], set()
    now = dt.datetime.now().isoformat(timespec="seconds")
    for h in rows:
        if holding_ids is not None and h["id"] not in holding_ids:
            continue
        name = h["name"] or h["ticker"]
        isin = (h["isin"] or "").strip().upper()
        if not isin:
            report.append({"name": name, "status": "no_isin"})
            continue
        if not funds.valid_isin(isin):
            report.append({"name": name, "status": "bad_isin"})
            continue
        if isin in done:
            continue
        done.add(isin)
        kind = h["instrument"]
        if not kind and h["ticker"]:
            try:
                t = tools.lookup_instrument(h["ticker"]).get("type", "").upper()
                kind = "stock" if t == "EQUITY" else ("fund" if t in ("ETF", "MUTUALFUND") else None)
            except ValueError:
                kind = None
            if kind:
                db.execute("UPDATE holdings SET instrument = ? WHERE id = ?", (kind, h["id"]))
        if kind == "stock":
            try:
                sector = _yahoo_sector(h["ticker"])
            except Exception:
                sector = ""
            row = {"name": name, "isin": isin, "weight": 100.0, "country": funds.isin_country(isin), "sector": sector,
                   "currency": (h["currency"] or "").upper()[:3], "asset": "EQUITY"}
            db.execute("""INSERT INTO fund_data(isin, source, issuer, fund_name, currency, as_of, fetched_at, holdings)
                          VALUES (?, 'stock', '', ?, ?, ?, ?, ?) ON CONFLICT(isin) DO UPDATE SET source='stock',
                          fund_name=excluded.fund_name, currency=excluded.currency, as_of=excluded.as_of,
                          fetched_at=excluded.fetched_at, holdings=excluded.holdings""",
                       (isin, name, row["currency"], dt.date.today().isoformat(), now, json.dumps([row])))
            report.append({"name": name, "status": "ok", "source": "stock", "rows": 1, "sector": bool(sector)})
            continue
        try:
            res = funds.fetch(isin, name)
        except funds.NotFound as e:
            report.append({"name": name, "status": "not_found", "text": funds.describe_error(e)})
            continue
        except funds.Unavailable as e:
            report.append({"name": name, "status": "unavailable", "text": funds.describe_error(e)})
            continue
        db.execute("""INSERT INTO fund_data(isin, source, issuer, fund_name, currency, as_of, fetched_at, holdings)
                      VALUES (?, 'issuer', ?, ?, ?, ?, ?, ?) ON CONFLICT(isin) DO UPDATE SET source='issuer',
                      issuer=excluded.issuer, fund_name=excluded.fund_name, currency=excluded.currency,
                      as_of=excluded.as_of, fetched_at=excluded.fetched_at, holdings=excluded.holdings""",
                   (isin, res["issuer"], res["fund_name"] or "", res["currency"] or "", res["as_of"] or "", now,
                    json.dumps(res["holdings"], separators=(",", ":"))))
        report.append({"name": name, "status": "ok", "source": "issuer", "issuer": res["issuer"],
                       "rows": len(res["holdings"]), "as_of": res["as_of"]})
    db.commit()
    return report


# ------------------------------------------------------------------ costs and correlation

def by_account(db, pid, account_ids=None):
    """One line per investment account (of those chosen): value, weight in the analyzed total, main asset class and the
    diversification score of the account alone. The portfolio is judged as a whole (accounts are only containers);
    this shows how each part, e.g. one per goal, is built."""
    accounts = tools.investments(db, pid, months=1, account_ids=account_ids)["accounts"]
    rows = []
    for a in accounts:
        c = composition(db, pid, {a["id"]})
        if not c["total"]:
            continue
        top = c["asset_classes"][0] if c["asset_classes"] else None
        dv = c["diversification"]
        rows.append({"id": a["id"], "name": a["name"], "icon": a["icon"], "value": c["total"],
                     "main_class": top["key"] if top else None, "main_class_share": top["share"] if top else None,
                     "score": dv["score"] if dv else None, "level": dv["level"] if dv else None,
                     "known": c["coverage"]["country"], "securities": len(c["instruments"])})
    total = sum(r["value"] for r in rows)
    for r in rows:
        r["share"] = r["value"] / total if total else 0
    return sorted(rows, key=lambda r: -r["value"])


def costs(db, pid, account_ids=None):
    """Yearly ongoing charges: TER typed per security → weighted average and cost per year; securities without it."""
    out, total, with_ter, cost = [], 0, 0, 0.0
    for pos in _positions(db, pid, account_ids):
        for h in pos["holdings"]:
            v = h["value"]
            total += v
            ter = h.get("ter")
            row = {"id": h["id"], "name": h["name"] or h["ticker"], "ticker": h["ticker"], "value": v, "ter": ter,
                   "yearly": round(v * ter / 100) if ter is not None else None}
            if ter is not None:
                with_ter += v
                cost += v * ter / 100
            out.append(row)
    out.sort(key=lambda x: -(x["yearly"] if x["yearly"] is not None else -1))
    return {"items": out, "total": total, "covered": with_ter / total if total else 0,
            "weighted_ter": cost * 100 / with_ter if with_ter else None, "yearly": round(cost),
            "missing": [x["name"] for x in out if x["ter"] is None]}


def _next_month(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return f"{y + m // 12}-{m % 12 + 1:02d}"


def correlation(db, pid, months=36, limit=12, account_ids=None):
    """How the securities move together: Pearson correlation of their monthly returns over the last `months` months,
    from the month-end prices HomeCoin keeps ("Update prices"). +1 = always together (no diversification between
    them), 0 = unrelated, −1 = opposite. Only pairs with at least 12 months in common get a number; a return is taken
    only between two consecutive months (a missing month is a gap, not a two-month return)."""
    secs = []
    for pos in _positions(db, pid, account_ids):
        for h in pos["holdings"]:
            prices = dict(db.execute("SELECT month, price_eur FROM price_history WHERE holding_id = ? ORDER BY month DESC "
                                     "LIMIT ?", (h["id"], months + 1)).fetchall())
            keys = sorted(prices)
            rets = {m: prices[m] / prices[p] - 1 for p, m in zip(keys, keys[1:])
                    if prices[p] and prices[m] is not None and _next_month(p) == m}
            secs.append({"id": h["id"], "name": h["name"] or h["ticker"], "ticker": h["ticker"],
                         "asset_class": h["asset_class"], "value": h["value"], "returns": rets})
    secs.sort(key=lambda s: -s["value"])
    without = [s["name"] for s in secs if len(s["returns"]) < 12]  # listed apart, not as an empty row of the matrix
    secs = [s for s in secs if len(s["returns"]) >= 12][:limit]

    def pearson(a, b):
        common = sorted(set(a) & set(b))
        if len(common) < 12:
            return None
        x, y = [a[m] for m in common], [b[m] for m in common]
        mx, my = sum(x) / len(x), sum(y) / len(y)
        sxy = sum((p - mx) * (q - my) for p, q in zip(x, y))
        sx = sum((p - mx) ** 2 for p in x) ** 0.5
        sy = sum((q - my) ** 2 for q in y) ** 0.5
        return sxy / (sx * sy) if sx and sy else None
    matrix = [[1.0 if i == j else pearson(a["returns"], b["returns"]) for j, b in enumerate(secs)] for i, a in enumerate(secs)]
    vals = [matrix[i][j] for i in range(len(secs)) for j in range(i + 1, len(secs)) if matrix[i][j] is not None]
    return {"securities": [{k: s[k] for k in ("id", "name", "ticker", "asset_class")} | {"months": len(s["returns"])}
                           for s in secs],
            "matrix": matrix, "average": sum(vals) / len(vals) if vals else None,
            "months": max((len(s["returns"]) for s in secs), default=0), "without_history": without}


# ------------------------------------------------------------------ comparison with an index

def monthly_returns(series):
    """Time-weighted monthly returns of the portfolio from the investments series (value and money put in at each
    month end): money added or taken out in a month is not counted as performance."""
    out = []
    for prev, cur in zip(series, series[1:]):
        flow = cur["invested"] - prev["invested"]
        if prev["value"] > 0:
            out.append({"month": cur["month"], "r": (cur["value"] - flow) / prev["value"] - 1})
    return out


def max_drawdown(returns):
    peak, level, worst = 1.0, 1.0, 0.0
    for r in returns:
        level *= 1 + r
        peak = max(peak, level)
        worst = min(worst, level / peak - 1)
    return worst


def benchmark(db, pid, ticker, months=36, account_ids=None):
    """The portfolio (or the accounts chosen) against an index or ETF (Yahoo month-end prices, ticker only): cumulative
    return month by month, total and yearly return and the largest fall from a peak (max drawdown) of both."""
    inv = tools.investments(db, pid, months=months + 1, account_ids=account_ids)
    mine = monthly_returns(inv["series"])
    hist, cur = tools.fetch_history(ticker)
    keys = [m["month"] for m in mine]
    bench = []
    for prev, m in zip([None] + keys, keys):
        p0 = hist.get(prev) if prev else None
        p1 = hist.get(m)
        bench.append(p1 / p0 - 1 if p0 and p1 else None)
    points, a, b = [], 1.0, 1.0
    for m, rb in zip(mine, bench):
        a *= 1 + m["r"]
        if rb is not None:
            b *= 1 + rb
        points.append({"month": m["month"], "portfolio": a - 1, "benchmark": b - 1 if rb is not None or points else None})
    n = len(mine)
    yearly = lambda x: (1 + x) ** (12 / n) - 1 if n >= 12 and x > -1 else None  # noqa: E731
    br = [x for x in bench if x is not None]
    return {"ticker": ticker.upper(), "currency": cur, "points": points, "months": n,
            "portfolio": {"total": a - 1, "yearly": yearly(a - 1), "drawdown": max_drawdown([m["r"] for m in mine])},
            "benchmark": {"total": b - 1, "yearly": yearly(b - 1), "drawdown": max_drawdown(br)},
            "missing_months": sum(1 for x in bench if x is None)}
