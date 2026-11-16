"""What is inside an ETF or a fund: its holdings, read from the public files its issuer publishes (iShares, Vanguard,
Xtrackers, Amundi, SPDR, Invesco), so the portfolio can be analyzed by country, region, sector, currency and overlap.

Optional and on request only: nothing is downloaded unless the user switched it on (setting `fund_data_online`) and
clicked "Update compositions". Only the ISIN is sent, over HTTPS, to the issuers' own hosts listed in ALLOWED_HOSTS;
no cookies, no account. Each reader returns the same normalized shape; when a fund is not found or a file changes
format, the fund is simply reported as "not available" (never guessed).

Normalized holding row: {"name", "isin" (or ""), "weight" (% of the fund), "country" (ISO 3166 alpha-2 or ""),
"sector" (one of SECTORS or ""), "currency" (ISO 4217 or ""), "asset" (raw type of security)}.
"""
import io
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from . import i18n

TIMEOUT = 30
MAX_BYTES = 30 * 1024 * 1024
ALLOWED_HOSTS = {"www.ishares.com", "etf.dws.com", "etf.deutsche-am.com", "www.amundietf.de", "www.ssga.com",
                 "dng-api.invesco.com", "www.de.vanguard"}  # etf.deutsche-am.com: the Xtrackers files redirect there
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# the 11 GICS sectors (stored as these keys, translated on screen) + cash and other
SECTORS = ("Information Technology", "Financials", "Health Care", "Consumer Discretionary", "Consumer Staples",
           "Industrials", "Communication Services", "Energy", "Materials", "Utilities", "Real Estate", "Cash and other")
_SECTOR_ALIASES = {
    "information technology": 0, "technology": 0, "it": 0, "tech": 0,
    "financials": 1, "financial": 1, "financial services": 1, "banks": 1, "insurance": 1,
    "health care": 2, "healthcare": 2,
    "consumer discretionary": 3, "consumer cyclical": 3, "consumer goods": 3,
    "consumer staples": 4, "consumer defensive": 4, "consumer services": 3,
    "industrials": 5, "industrial": 5,
    "communication services": 6, "communication": 6, "communications": 6, "telecommunications": 6,
    "telecommunication services": 6, "telecommunication": 6, "media": 6,
    "energy": 7, "oil & gas": 7,
    "materials": 8, "basic materials": 8,
    "utilities": 9,
    "real estate": 10,
    "cash and/or derivatives": 11, "cash": 11, "cash and derivatives": 11, "other": 11, "derivatives": 11,
    "money market": 11, "liquidity": 11,
}


def sector_of(raw):
    """GICS sector key for a sector name written by an issuer or by Yahoo ('' if unknown)."""
    k = re.sub(r"\s+", " ", str(raw or "").strip().lower())
    if not k:
        return ""
    if k in _SECTOR_ALIASES:
        return SECTORS[_SECTOR_ALIASES[k]]
    for alias, i in _SECTOR_ALIASES.items():  # "Information Technology Services", "Financials (Banks)"…
        if len(alias) > 3 and k.startswith(alias):
            return SECTORS[i]
    return ""


# English country names used by the issuers → ISO 3166 alpha-2 (the browser translates the codes on screen)
COUNTRIES = {
    "united states": "US", "united states of america": "US", "usa": "US", "canada": "CA", "mexico": "MX",
    "brazil": "BR", "chile": "CL", "colombia": "CO", "peru": "PE", "argentina": "AR",
    "united kingdom": "GB", "great britain": "GB", "uk": "GB", "ireland": "IE", "france": "FR", "germany": "DE",
    "italy": "IT", "spain": "ES", "portugal": "PT", "netherlands": "NL", "belgium": "BE", "luxembourg": "LU",
    "switzerland": "CH", "austria": "AT", "denmark": "DK", "sweden": "SE", "norway": "NO", "finland": "FI",
    "iceland": "IS", "poland": "PL", "czech republic": "CZ", "czechia": "CZ", "hungary": "HU", "greece": "GR",
    "romania": "RO", "slovenia": "SI", "slovakia": "SK", "croatia": "HR", "bulgaria": "BG", "estonia": "EE",
    "latvia": "LV", "lithuania": "LT", "cyprus": "CY", "malta": "MT", "jersey": "JE", "guernsey": "GG",
    "isle of man": "IM", "bermuda": "BM", "cayman islands": "KY", "curacao": "CW", "panama": "PA",
    "japan": "JP", "china": "CN", "hong kong": "HK", "taiwan": "TW", "taiwan (republic of china)": "TW",
    "korea": "KR", "korea (south)": "KR", "south korea": "KR", "republic of korea": "KR", "korea, republic of": "KR",
    "india": "IN", "indonesia": "ID", "malaysia": "MY", "thailand": "TH", "philippines": "PH", "vietnam": "VN",
    "singapore": "SG", "australia": "AU", "new zealand": "NZ", "macau": "MO", "pakistan": "PK",
    "israel": "IL", "turkey": "TR", "turkiye": "TR", "saudi arabia": "SA", "united arab emirates": "AE",
    "qatar": "QA", "kuwait": "KW", "egypt": "EG", "south africa": "ZA", "nigeria": "NG", "morocco": "MA",
    "russia": "RU", "russian federation": "RU", "kazakhstan": "KZ", "supranational": "XS",
}
# ISIN prefixes that are not a country of risk (fund domiciles, international clearing)
_NOT_COUNTRY = {"XS", "EU", "XC", "XD", "XF", "QS"}

# geographic areas (one rule for all: continents, never single countries; keys translated in the language files)
# Countries that issuers may send as ISO codes are all placed (Caribbean with Latin America, Turkey and Russia with
# Europe as the index providers do); "Other" is left for what is not a country (supranational issuers, codes like XS).
REGIONS = ("North America", "Latin America", "Europe", "Middle East and Africa", "Asia-Pacific", "Other")
_REGION_OF = {
    **{c: "North America" for c in ("US", "CA", "BM", "PR", "GL")},
    **{c: "Latin America" for c in ("MX", "BR", "CL", "CO", "PE", "AR", "PA", "KY", "CW", "UY", "PY", "BO", "EC", "VE",
                                    "CR", "GT", "HN", "SV", "NI", "DO", "JM", "TT", "BS", "BB", "VG", "BZ", "AW", "SX",
                                    "TC", "AI", "LC", "BQ", "GY", "SR", "HT", "CU")},
    **{c: "Europe" for c in ("GB", "IE", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "LU", "CH", "AT", "DK", "SE", "NO", "FI",
                              "IS", "MT", "CY", "JE", "GG", "IM", "SI", "SK", "EE", "LV", "LT", "HR", "BG", "PL", "CZ",
                              "HU", "GR", "RO", "TR", "RU", "UA", "RS", "BA", "MK", "AL", "ME", "MD", "BY", "LI", "MC",
                              "AD", "SM", "GI", "FO", "GE", "AM", "AZ", "XK", "VA")},
    **{c: "Middle East and Africa" for c in ("IL", "SA", "AE", "QA", "KW", "EG", "ZA", "NG", "MA", "JO", "LB", "OM", "BH",
                                             "IQ", "IR", "KE", "GH", "CI", "SN", "TN", "DZ", "MU", "BW", "NA", "ZM", "ZW",
                                             "TZ", "UG", "RW", "ET", "AO", "MZ", "CM", "LY", "SC", "BJ", "BF", "ML", "GA")},
    **{c: "Asia-Pacific" for c in ("JP", "AU", "NZ", "HK", "SG", "CN", "TW", "KR", "IN", "ID", "MY", "TH", "PH", "VN",
                                    "PK", "KZ", "MO", "LK", "BD", "MN", "KH", "LA", "MM", "NP", "BN", "FJ", "PG", "UZ",
                                    "KG", "TJ", "TM", "MV")},
}
# market classification of the main index providers: developed or emerging (the others: frontier / not classified)
DEVELOPED = {"US", "CA", "GB", "IE", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "LU", "CH", "AT", "DK", "SE", "NO", "FI",
             "IS", "IL", "JP", "AU", "NZ", "HK", "SG", "BM", "JE", "GG", "IM", "MT", "CY"}
EMERGING = {"CN", "TW", "KR", "IN", "ID", "MY", "TH", "PH", "BR", "MX", "CL", "CO", "PE", "ZA", "SA", "AE", "QA", "KW",
            "EG", "PL", "CZ", "HU", "GR", "TR"}


def market_of(code):
    """Developed, Emerging, else Frontier and other (frontier markets, countries not classified, supranational)."""
    return "Developed" if code in DEVELOPED else "Emerging" if code in EMERGING else "Frontier and other"


# reference for diversification: approximate weights of the world equity market by country (free-float market
# capitalization, developed + emerging markets, end of 2025, rounded). Shown as an approximation with its date.
WORLD_AS_OF = "2025-12"
WORLD = {"US": 64.0, "JP": 4.9, "GB": 3.2, "CN": 3.0, "CA": 2.9, "FR": 2.3, "TW": 2.2, "CH": 2.1, "DE": 2.1, "IN": 1.8,
         "AU": 1.6, "KR": 1.3, "NL": 1.1, "SE": 0.8, "ES": 0.7, "IT": 0.7, "DK": 0.6, "HK": 0.5, "BR": 0.5, "SA": 0.4,
         "SG": 0.4, "ZA": 0.35, "FI": 0.2, "BE": 0.2, "IL": 0.2, "IE": 0.2, "MX": 0.2, "AE": 0.15, "ID": 0.15,
         "MY": 0.15, "TH": 0.15, "NO": 0.15, "PL": 0.1, "QA": 0.08, "KW": 0.08, "TR": 0.07, "PH": 0.06, "CL": 0.05,
         "NZ": 0.05, "AT": 0.05, "PT": 0.04, "GR": 0.05, "CO": 0.01, "PE": 0.03, "HU": 0.03, "CZ": 0.02, "EG": 0.01}


def country_of(raw):
    """ISO2 code for a country written by an issuer: a name ("United States") or already a code ("US")."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if len(s) == 2 and s.isalpha():
        return s.upper()
    return COUNTRIES.get(re.sub(r"\s+", " ", s.lower()), "")


def region_of(code):
    return _REGION_OF.get(code or "", "Other")


def isin_country(isin):
    """Country of a single stock from its ISIN (the issuer's country: for shares, usually where the company is
    based). Not used for funds, whose ISIN says where the fund is domiciled (IE, LU), not what it holds."""
    c = (isin or "")[:2].upper()
    return "" if c in _NOT_COUNTRY or not c.isalpha() else c


def isin_check_digit(first11):
    """The 12th character of an ISIN (ISO 6166, Luhn on the letters turned into numbers)."""
    digits = "".join(str(int(ch, 36)) for ch in first11.upper())
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch) * (2 if i % 2 == 0 else 1)
        total += n // 10 + n % 10
    return str((10 - total % 10) % 10)


def valid_isin(isin):
    """Format and check digit (ISO 6166)."""
    s = str(isin or "").strip().upper()
    return bool(ISIN_RE.match(s)) and isin_check_digit(s[:-1]) == s[-1]


# ------------------------------------------------------------------ network (issuers' hosts only)

class NotFound(Exception):
    """The issuer does not publish this ISIN."""


class Unavailable(Exception):
    """The issuer could not be reached, refused, or its file changed format."""


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
            raise Unavailable(f"redirect to {u.hostname}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _http(url, body=None, headers=None):
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
        raise Unavailable(f"host not allowed: {u.hostname}")
    from .app import VERSION
    h = {"User-Agent": f"HomeCoin/{VERSION}", "Accept": "*/*", **(headers or {})}
    if body is not None:
        body = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=h, method="POST" if body is not None else "GET")
    try:
        with urllib.request.build_opener(_Redirects).open(req, timeout=TIMEOUT) as r:
            data = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise NotFound() from e
        raise Unavailable(f"HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise Unavailable(str(getattr(e, "reason", e))[:120]) from e
    if len(data) > MAX_BYTES:
        raise Unavailable("file too large")
    return data


def _json(data):
    try:
        return json.loads(data)
    except ValueError as e:
        raise Unavailable("unexpected answer") from e


def _num(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("%", "").replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _row(name, isin, weight, country="", sector="", currency="", asset=""):
    return {"name": str(name or "").strip()[:120], "isin": str(isin or "").strip().upper()[:12],
            "weight": round(weight, 6), "country": country_of(country), "sector": sector_of(sector),
            "currency": str(currency or "").strip().upper()[:3], "asset": str(asset or "").strip()[:40]}


def _xlsx_rows(data):
    import openpyxl
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as e:  # not an Excel file: the issuer answered with an error page
        raise NotFound() from e
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    title = ws.title
    wb.close()
    return title, rows


# ------------------------------------------------------------------ issuers

def _ishares(isin):
    q = urllib.parse.urlencode({"country": "de", "language": "de", "siteName": "de-ishares-v2", "userType": "individual"})
    idx = _json(_http("https://www.ishares.com/varnish-api/blk-product-screener-server/api/v1/product-screener/product-data?" + q))
    un = lambda v: v.get("r") if isinstance(v, dict) and "r" in v else v  # noqa: E731
    fund = next((v for v in (idx.values() if isinstance(idx, dict) else []) if isinstance(v, dict) and un(v.get("isin")) == isin), None)
    if not fund:
        raise NotFound()
    q = urllib.parse.urlencode({"appSubType": "ISHARES", "appType": "PRODUCT_PAGE", "component": "holdings", "locale": "en_GB",
                                "portfolioId": un(fund.get("portfolioId")), "targetSite": "ishares-uk",
                                "userType": "individual", "excludeContent": "true", "includeConfig": "false"})
    d = _json(_http("https://www.ishares.com/varnish-api/uk-retail01-product-data/product-data/api/v2/get-product-data?" + q))
    try:
        cols = d["componentsByNameMap"]["holdings"]["containersByNameMap"]["all"]["dataPointsByNameMap"]
    except (KeyError, TypeError) as e:
        raise Unavailable("format changed") from e
    col = lambda k: (cols.get(k) or {}).get("value") or []  # noqa: E731
    names, n = col("issueName"), len(col("issueName"))
    pad = lambda k: (col(k) + [None] * n)[:n]  # noqa: E731
    rows = []
    for nm, w, i, c, s, cur, a in zip(names, pad("holdingPercent"), pad("isin"), pad("countryOfRisk"), pad("sectorName"),
                                      pad("marketCurrencyCode"), pad("assetClass")):
        if nm and _num(w) is not None:
            rows.append(_row(nm, i, _num(w), c, s, cur, a))
    raw = (cols.get("asOfDate") or {}).get("value")
    raw = raw[0] if isinstance(raw, list) and raw else raw
    as_of = str(un(raw) or "")
    as_of = f"{as_of[:4]}-{as_of[4:6]}-{as_of[6:8]}" if re.fullmatch(r"\d{8}", as_of) else ""
    return {"issuer": "iShares", "fund_name": un(fund.get("fundName")), "currency": un(fund.get("seriesBaseCurrencyCode")),
            "as_of": as_of, "holdings": rows}


def _header_index(rows, *needed):
    for i, r in enumerate(rows[:60]):
        cells = [str(c or "").strip() for c in r]
        if all(n in cells for n in needed):
            return i, {c: j for j, c in enumerate(cells) if c}
    raise Unavailable("format changed")


def _xtrackers(isin):
    title, rows = _xlsx_rows(_http(f"https://etf.dws.com/etfdata/export/GBR/ENG/excel/product/constituent/{isin}/"))
    h, ix = _header_index(rows, "Name", "Weighting")
    g = lambda r, k: r[ix[k]] if k in ix and ix[k] < len(r) else None  # noqa: E731
    out = []
    for r in rows[h + 1:]:
        w = _num(g(r, "Weighting"))
        if w is None or not g(r, "Name"):
            continue
        out.append(_row(g(r, "Name"), g(r, "ISIN"), w * 100, g(r, "Country"), g(r, "Industry Classification"),
                        g(r, "Currency"), g(r, "Type of Security")))
    return {"issuer": "Xtrackers", "fund_name": None, "currency": None,
            "as_of": title if re.fullmatch(r"\d{4}-\d{2}-\d{2}", title or "") else "", "holdings": out}


def _amundi(isin):
    body = {"context": {"countryCode": "DEU", "languageCode": "de", "userProfileName": "RETAIL"}, "productIds": [isin],
            "productType": "PRODUCT", "characteristics": ["SHARE_MARKETING_NAME"],
            "composition": {"compositionFields": ["date", "type", "isin", "name", "weight", "currency", "sector", "countryOfRisk"]}}
    d = _json(_http("https://www.amundietf.de/mapi/ProductAPI/getProductsData", body))
    products = d.get("products") if isinstance(d, dict) else None
    if not products:
        raise NotFound()
    p = products[0]
    data = ((p.get("composition") or {}).get("compositionData")) or []
    out, dates = [], []
    for x in data:
        c = x.get("compositionCharacteristics") or {}
        w = _num(c.get("weight"))
        if w is None or not c.get("name"):
            continue
        out.append(_row(c.get("name"), c.get("isin"), w * 100, c.get("countryOfRisk"), c.get("sector"), c.get("currency"), c.get("type")))
        if c.get("date"):
            dates.append(str(c["date"])[:10])
    return {"issuer": "Amundi", "fund_name": (p.get("characteristics") or {}).get("SHARE_MARKETING_NAME"),
            "currency": (p.get("currencies") or {}).get("BASE_CURRENCY"), "as_of": max(dates) if dates else "", "holdings": out}


def _spdr(isin):
    q = urllib.parse.urlencode({"country": "de", "language": "de", "role": "individual", "product": "etfs", "ui": "fund-finder"})
    d = _json(_http("https://www.ssga.com/bin/v1/ssmp/fund/fundfinder?" + q))
    try:
        funds = d["data"]["funds"]["etfs"]["datas"]
    except (KeyError, TypeError) as e:
        raise Unavailable("format changed") from e
    hit = next((f for f in funds if f"isin={isin}" in json.dumps(f.get("documentPdf") or "")), None)
    if not hit:
        raise NotFound()
    slug = str(hit.get("fundTicker") or "").replace("^", "").strip().lower().replace(" ", "-")
    if not re.fullmatch(r"[a-z0-9-]{2,30}", slug):
        raise Unavailable("format changed")
    _, rows = _xlsx_rows(_http(f"https://www.ssga.com/library-content/products/fund-data/etfs/emea/holdings-daily-emea-en-{slug}.xlsx"))
    as_of = ""
    for r in rows[:20]:
        if r and str(r[0] or "").strip() == "Holdings As Of:" and len(r) > 1:
            import datetime as dt
            try:
                as_of = dt.datetime.strptime(str(r[1]).strip(), "%d-%b-%Y").date().isoformat()
            except ValueError:
                pass
    h, ix = _header_index(rows, "Percent of Fund")
    g = lambda r, k: r[ix[k]] if k in ix and ix[k] < len(r) else None  # noqa: E731
    out = []
    for r in rows[h + 1:]:
        w = _num(g(r, "Percent of Fund"))
        if w is None:
            break
        out.append(_row(g(r, "Security Name"), g(r, "ISIN"), w, g(r, "Trade Country Name"), g(r, "Sector Classification"),
                        g(r, "Currency")))
    return {"issuer": "SPDR", "fund_name": hit.get("fundName"), "currency": None, "as_of": as_of, "holdings": out}


def _invesco(isin):
    d = _json(_http(f"https://dng-api.invesco.com/cache/v1/accounts/en_GB/shareclasses/{isin}/holdings/fund?idType=isin",
                    headers={"Origin": "https://www.invesco.com"}))
    if not isinstance(d, dict) or not isinstance(d.get("holdings"), list):
        raise NotFound()
    import html
    out = [_row(html.unescape(str(x.get("name") or "")), x.get("isin"), _num(x.get("weight")), "", "", x.get("currency"))
           for x in d["holdings"] if isinstance(x, dict) and x.get("name") and _num(x.get("weight")) is not None]
    return {"issuer": "Invesco", "fund_name": None, "currency": None, "as_of": str(d.get("effectiveDate") or "")[:10],
            "holdings": out}


_VG = "https://www.de.vanguard/gpx/graphql"
_VG_FUNDS = ("query FundsQuery($portIds: [String!]!) { funds(portIds: $portIds) { portId profile { portId fundFullName "
             "fundCurrency identifiers(altIds: [\"ISIN\"]) { altId altIdCode altIdValue } } } }")
_VG_HOLDINGS = ("query FundsHoldingsQuery($portIds: [String!], $securityTypes: [String!], $lastItemKey: String) { "
                "funds(portIds: $portIds) { profile { fundFullName fundCurrency primarySectorEquityClassification } } "
                "borHoldings(portIds: $portIds) { holdings(limit: 1500, securityTypes: $securityTypes, lastItemKey: $lastItemKey) { "
                "items { issuerName securityLongDescription gicsSectorDescription icbSectorDescription icbIndustryDescription "
                "marketValuePercentage sedol1 quantity ticker securityType finalMaturity effectiveDate marketValueBaseCurrency "
                "bloombergIsoCountry couponRate } totalHoldings lastItemKey } } }")


def _vanguard(isin):
    page = _http("https://www.de.vanguard/professionell/anlageprodukte")
    m = re.search(rb'<script id="serverApp-state"[^>]*>(.*?)</script>', page, re.S)
    if not m:
        raise Unavailable("format changed")
    ids = re.search(r'"portIds"\s*:\s*"([^"]+)"', m.group(1).decode("utf-8", "replace"))
    if not ids:
        raise Unavailable("format changed")
    port_ids = [p.strip() for p in ids.group(1).split(",") if p.strip()]
    hdr = {"X-Consumer-ID": "de7"}
    d = _json(_http(_VG, {"operationName": "FundsQuery", "variables": {"portIds": port_ids}, "query": _VG_FUNDS}, hdr))
    port = None
    for f in ((d.get("data") or {}).get("funds") or []):
        if any(x.get("altIdValue") == isin for x in ((f.get("profile") or {}).get("identifiers") or [])):
            port = f.get("portId")
            break
    if not port:
        raise NotFound()
    out, key, profile, dates = [], None, {}, []
    for _ in range(20):
        d = _json(_http(_VG, {"operationName": "FundsHoldingsQuery", "variables": {"portIds": [port], "lastItemKey": key},
                              "query": _VG_HOLDINGS}, hdr))
        if not isinstance(d, dict) or d.get("errors"):
            raise Unavailable("format changed")
        try:
            h = d["data"]["borHoldings"][0]["holdings"]
            profile = (d["data"].get("funds") or [{}])[0].get("profile") or profile
        except (KeyError, TypeError, IndexError) as e:
            raise Unavailable("format changed") from e
        for x in h.get("items") or []:
            w = _num(x.get("marketValuePercentage"))
            if w is None:
                continue
            out.append(_row(x.get("issuerName") or x.get("securityLongDescription"), "", w, x.get("bloombergIsoCountry"),
                            x.get("gicsSectorDescription") or x.get("icbIndustryDescription"), "", x.get("securityType")))
            if x.get("effectiveDate"):
                dates.append(str(x["effectiveDate"])[:10])
        key = h.get("lastItemKey")
        if not key:
            break
    return {"issuer": "Vanguard", "fund_name": profile.get("fundFullName"), "currency": profile.get("fundCurrency"),
            "as_of": max(dates) if dates else "", "holdings": out}


READERS = (("iShares", _ishares), ("Xtrackers", _xtrackers), ("Amundi", _amundi), ("Invesco", _invesco),
           ("SPDR", _spdr), ("Vanguard", _vanguard))
# a fund name says who the issuer is: try that one first
_HINTS = {"ishares": "iShares", "xtrackers": "Xtrackers", "amundi": "Amundi", "lyxor": "Amundi", "invesco": "Invesco",
          "spdr": "SPDR", "vanguard": "Vanguard"}


def fetch(isin, name=""):
    """Holdings of a fund from its issuer: dict (see the module docstring) or raises NotFound / Unavailable.
    The issuer named in the security's name is tried first, then the others."""
    isin = str(isin or "").strip().upper()
    if not valid_isin(isin):
        raise NotFound()
    low = str(name or "").lower()
    first = next((v for k, v in _HINTS.items() if k in low), None)
    order = sorted(READERS, key=lambda x: x[0] != first)
    errors = []
    for issuer, reader in order:
        try:
            res = reader(isin)
        except NotFound:
            continue
        except Unavailable as e:
            errors.append(f"{issuer}: {e}")
            continue
        if res["holdings"]:
            res["holdings"].sort(key=lambda r: -r["weight"])
            return res
    if errors:
        raise Unavailable("; ".join(errors)[:300])
    raise NotFound()


# the currency of a country's market: used only when an issuer gives the country but not the currency of a holding
# (Vanguard), as index providers do for currency exposure; such weights are marked as estimated
_EURO = ("IE", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "LU", "AT", "FI", "GR", "SI", "SK", "EE", "LV", "LT", "CY",
         "MT", "HR")
CURRENCY_OF = {**{c: "EUR" for c in _EURO}, "US": "USD", "CA": "CAD", "GB": "GBP", "JP": "JPY", "CH": "CHF",
               "AU": "AUD", "NZ": "NZD", "HK": "HKD", "SG": "SGD", "SE": "SEK", "NO": "NOK", "DK": "DKK", "IL": "ILS",
               "CN": "CNY", "TW": "TWD", "KR": "KRW", "IN": "INR", "BR": "BRL", "MX": "MXN", "ZA": "ZAR", "PL": "PLN",
               "CZ": "CZK", "HU": "HUF", "TR": "TRY", "SA": "SAR", "AE": "AED", "ID": "IDR", "MY": "MYR", "TH": "THB",
               "PH": "PHP", "CL": "CLP", "CO": "COP", "QA": "QAR", "KW": "KWD", "PE": "PEN", "EG": "EGP", "IS": "ISK",
               "RO": "RON", "BG": "BGN", "AR": "ARS", "VN": "VND", "PK": "PKR", "NG": "NGN", "MA": "MAD", "KZ": "KZT",
               "MO": "MOP", "BM": "BMD", "JE": "GBP", "GG": "GBP", "IM": "GBP", "PA": "USD"}


def is_synthetic(name, rows):
    """A swap-based (synthetic) fund publishes the basket it holds as collateral, not the index it tracks: its
    countries and sectors are not its real exposure."""
    return "swap" in str(name or "").lower()


def summary(rows):
    """Weights by country, region, sector and currency of a list of holdings (weights in % of the fund): only the
    part of the fund that carries the information counts; the rest is 'not available' (shown, never guessed).
    `estimated_currency`: the part whose currency was taken from the country (see CURRENCY_OF)."""
    out = {"country": {}, "region": {}, "market": {}, "sector": {}, "currency": {}, "estimated_currency": 0.0}
    for r in rows:
        w = r["weight"]
        cur = r.get("currency")
        if not cur and r.get("country") in CURRENCY_OF:
            cur = CURRENCY_OF[r["country"]]
            out["estimated_currency"] += w
        # sectors are the GICS sectors of the shares: cash, derivatives and bonds have none (they are in the asset classes)
        sector = r.get("sector") if r.get("sector") in SECTORS[:11] else ""
        # supranational issuers (XS…) have an area ("Other") but no country
        country = "" if r.get("country") in _NOT_COUNTRY else r.get("country")
        for key, val in (("country", country), ("sector", sector), ("currency", cur)):
            if val:
                out[key][val] = out[key].get(val, 0) + w
        if r.get("country"):
            for key, val in (("region", region_of(r["country"])), ("market", market_of(r["country"]))):
                out[key][val] = out[key].get(val, 0) + w
    return out


def overlap(a, b):
    """Overlap of two funds, in %: the sum of the smaller weight of each holding they share (matched by ISIN, else by
    name), on weights normalized to 100."""
    def norm(rows):
        tot = sum(r["weight"] for r in rows) or 1
        out = {}
        for r in rows:
            k = r["isin"] or re.sub(r"[^a-z0-9]", "", r["name"].lower())[:24]
            out[k] = out.get(k, 0) + r["weight"] * 100 / tot
        return out
    na, nb = norm(a), norm(b)
    return sum(min(w, nb[k]) for k, w in na.items() if k in nb)


def describe_error(exc):
    """Text for the page when a fund could not be read (translated)."""
    if isinstance(exc, NotFound):
        return i18n.t("not published by a supported issuer (iShares, Vanguard, Xtrackers, Amundi, SPDR, Invesco)")
    return i18n.t("issuer not reachable or file changed: try again later")
