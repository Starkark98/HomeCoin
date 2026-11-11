"""Helper functions: amounts, dates, recurrences, description normalization."""
import calendar
import datetime as dt
import re
import unicodedata
from collections import namedtuple
from decimal import ROUND_HALF_UP, Decimal, DecimalException

from . import i18n
FREQUENCIES = {
    "weekly": ("d", 7),
    "monthly": ("m", 1),
    "bimonthly": ("m", 2),
    "quarterly": ("m", 3),
    "semiannual": ("m", 6),
    "yearly": ("m", 12),
}
# factor to convert an amount into its monthly equivalent
MONTHLY_FACTOR = {
    "weekly": 52 / 12, "monthly": 1, "bimonthly": 1 / 2,
    "quarterly": 1 / 3, "semiannual": 1 / 6, "yearly": 1 / 12,
}

# system categories with a role in the calculations, recognized by their fixed code (categories.code); these are all the
# names they may have (every language, and the Italian of older databases), used to give them the code when created
from .i18n import all_names as _all_names  # noqa: E402
BALANCE_ADJUSTMENT = _all_names("balance_adjustment")
# trades on securities that were not imported (excluded from reports, counted as invested in Savings)
OTHER_INVESTMENTS = _all_names("other_investments")
# system transactions excluded from reports: neither income nor spending (adjustments stay a separate line of the balance)
TECH_CATEGORIES = BALANCE_ADJUSTMENT | OTHER_INVESTMENTS
SYSTEM_CODES = ("balance_adjustment", "other_investments")
TECH_CODES_SQL = "'balance_adjustment', 'other_investments'"

# reference currency of the whole installation: a label only (amounts are never converted); market prices are converted
# into it. Each currency uses the number format of its main country. This is the only table: the browser gets it
# through /i18n.js. Adding a currency = one line here (+ its name in the translation files):
#   symbol, UI locale (Intl), decimal and thousands separators, decimals shown, symbol before the number, space between,
#   English name, short label of the picker (tells the dollars apart), rounding choices of the fair split (whole units),
#   countries (ISO codes) whose browsers get it suggested, date format of the Excel exports, loan indexes (first =
#   default; the schedule uses the value typed by hand), other ways the currency is written in bank files
Currency = namedtuple("Currency", "symbol locale decimal thousands digits prefix space name short steps regions "
                                  "date_excel indexes marks")
_EURO_AREA = ("AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT",
              "SI", "SK", "AD", "MC", "SM", "VA", "ME", "XK")
CURRENCIES = {
    "EUR": Currency("€", "it-IT", ",", ".", 2, False, True, "Euro", "€", (1, 5, 10, 50), _EURO_AREA, "DD/MM/YYYY",
                    ("Euribor 3M", "Euribor 1M", "Euribor 6M", "Euribor 12M"), ("EUR",)),                    # 1.234,56 €
    # also the official currency of Ecuador, El Salvador and Panama
    "USD": Currency("$", "en-US", ".", ",", 2, True, False, "US dollar", "US$", (1, 5, 10, 50),
                    ("US", "PR", "GU", "VI", "AS", "MP", "EC", "SV", "PA", "TL"), "MM/DD/YYYY",
                    ("SOFR 30-day average", "Term SOFR 1M", "Term SOFR 3M", "Term SOFR 6M", "US Treasury 1Y (CMT)",
                     "US Prime Rate"), ("US$", "USD")),                                                       # $1,234.56
    "GBP": Currency("£", "en-GB", ".", ",", 2, True, False, "British pound", "£", (1, 5, 10, 50), ("GB", "IM", "JE", "GG"),
                    "DD/MM/YYYY", ("Bank of England Bank Rate", "SONIA"), ("GBP",)),                          # £1,234.56
    # CHF 1'234.56, as Chrome and Edge write it
    "CHF": Currency("CHF", "de-CH", ".", "'", 2, True, True, "Swiss franc", "CHF", (1, 5, 10, 50), ("CH", "LI"),
                    "DD.MM.YYYY", ("SARON",), ("Fr.",)),
    "CAD": Currency("$", "en-CA", ".", ",", 2, True, False, "Canadian dollar", "C$", (1, 5, 10, 50), ("CA",), "YYYY-MM-DD",
                    ("Canadian prime rate", "CORRA"), ("CA$", "C$", "CAD")),                                  # $1,234.56
    "AUD": Currency("$", "en-AU", ".", ",", 2, True, False, "Australian dollar", "A$", (1, 5, 10, 50), ("AU",),
                    "DD/MM/YYYY", ("RBA cash rate", "BBSW 3M"), ("AU$", "A$", "AUD")),                        # $1,234.56
    # $1,234.56; also suggested in the Spanish-speaking countries without their own currency here (the closest peso)
    "MXN": Currency("$", "es-MX", ".", ",", 2, True, False, "Mexican peso", "MX$", (10, 50, 100, 500),
                    ("MX", "AR", "BO", "CR", "CU", "DO", "GT", "HN", "NI", "PE", "PY", "UY", "VE"), "DD/MM/YYYY",
                    ("TIIE 28", "TIIE de Fondeo"), ("MX$", "MXN")),
    # $ 1.235 (es-CO: no-break space after the symbol, no decimals in the browsers); UVR: inflation-linked unit of mortgages
    "COP": Currency("$", "es-CO", ",", ".", 0, True, True, "Colombian peso", "COL$", (1000, 5000, 10000, 50000), ("CO",),
                    "DD/MM/YYYY", ("IBR", "UVR (inflation-linked)", "DTF"), ("COL$", "COP")),
    # $1.235 without decimals; mortgages are mostly in UF, the inflation-linked unit
    "CLP": Currency("$", "es-CL", ",", ".", 0, True, False, "Chilean peso", "CLP$", (1000, 5000, 10000, 50000), ("CL",),
                    "DD-MM-YYYY", ("UF (inflation-linked)", "TPM (monetary policy rate)"), ("CLP$", "CLP")),
    # R$ 1.234,56; IPCA: inflation, for inflation-linked loans
    "BRL": Currency("R$", "pt-BR", ",", ".", 2, True, True, "Brazilian real", "R$", (1, 5, 10, 50), ("BR",), "DD/MM/YYYY",
                    ("TR", "IPCA", "Selic", "CDI"), ("R$", "BRL")),
    # R 1 234,56 (en-ZA: comma decimals, no-break space for thousands); JIBAR ends in 2026, replaced by ZARONIA
    "ZAR": Currency("R", "en-ZA", ",", " ", 2, True, True, "South African rand", "R", (10, 50, 100, 500),
                    ("ZA", "LS", "NA", "SZ"), "YYYY/MM/DD", ("Prime lending rate (South Africa)", "SARB repo rate", "ZARONIA"),
                    ("ZAR",)),
    "NZD": Currency("$", "en-NZ", ".", ",", 2, True, False, "New Zealand dollar", "NZ$", (1, 5, 10, 50), ("NZ", "CK", "NU"),
                    "DD/MM/YYYY", ("RBNZ official cash rate (OCR)",), ("NZ$", "NZD")),                      # $1,234.56
    # Singapore, Hong Kong, Philippines, India: English interface. SORA replaced SIBOR/SOR in Singapore loans
    "SGD": Currency("$", "en-SG", ".", ",", 2, True, False, "Singapore dollar", "S$", (1, 5, 10, 50), ("SG",), "DD/MM/YYYY",
                    ("SORA 3M (compounded)", "SORA 1M (compounded)"), ("S$", "SGD")),                         # $1,234.56
    "HKD": Currency("HK$", "en-HK", ".", ",", 2, True, False, "Hong Kong dollar", "HK$", (10, 50, 100, 500), ("HK",),
                    "DD/MM/YYYY", ("HIBOR 1M", "Hong Kong prime rate"), ("HKD",)),                          # HK$1,234.56
    # ₱1,234.56; dates month first as in the US
    "PHP": Currency("₱", "en-PH", ".", ",", 2, True, False, "Philippine peso", "₱", (10, 50, 100, 500), ("PH",),
                    "MM/DD/YYYY", ("BSP policy rate",), ("PHP", "Php")),
    # ₹12,34,567.89: Indian grouping in lakh and crore (util.LAKH)
    "INR": Currency("₹", "en-IN", ".", ",", 2, True, False, "Indian rupee", "₹", (10, 50, 100, 500), ("IN",), "DD/MM/YYYY",
                    ("RBI repo rate", "MCLR 1Y"), ("INR", "Rs.", "Rs")),
    # United Arab Emirates and Malaysia: English interface; EIBOR / standardised base rate (SBR, from the OPR)
    "AED": Currency("AED", "en-AE", ".", ",", 2, True, True, "UAE dirham", "AED", (10, 50, 100, 500), ("AE",), "DD/MM/YYYY",
                    ("EIBOR 3M", "EIBOR 1M"), ("Dhs", "Dh")),                                              # AED 1,234.56
    "MYR": Currency("RM", "en-MY", ".", ",", 2, True, True, "Malaysian ringgit", "RM", (1, 5, 10, 50), ("MY",),
                    "DD/MM/YYYY", ("SBR (standardised base rate)", "OPR (overnight policy rate)"), ("MYR",)),  # RM 1,234.56
    # Nordic crowns (English interface): 1 234,56 kr · 1.234,56 kr.
    "SEK": Currency("kr", "sv-SE", ",", " ", 2, False, True, "Swedish krona", "SEK", (10, 50, 100, 500), ("SE",),
                    "YYYY-MM-DD", ("STIBOR 3M", "SWESTR", "Riksbank policy rate"), ("SEK",)),
    "NOK": Currency("kr", "nb-NO", ",", " ", 2, False, True, "Norwegian krone", "NOK", (10, 50, 100, 500), ("NO", "SJ"),
                    "DD.MM.YYYY", ("NIBOR 3M", "NOWA", "Norges Bank policy rate"), ("NOK",)),
    "DKK": Currency("kr.", "da-DK", ",", ".", 2, False, True, "Danish krone", "DKK", (10, 50, 100, 500), ("DK", "FO", "GL"),
                    "DD-MM-YYYY", ("CIBOR 3M", "CITA"), ("DKK",)),
    # Israel (English interface; en-IL avoids the right-to-left marks of he-IL) and Czech Republic
    "ILS": Currency("₪", "en-IL", ".", ",", 2, True, False, "Israeli new shekel", "₪", (10, 50, 100, 500), ("IL",),
                    "DD/MM/YYYY", ("Bank of Israel prime rate", "CPI-linked (inflation)"), ("ILS", "NIS")),  # ₪1,234.56
    "CZK": Currency("Kč", "cs-CZ", ",", " ", 2, False, True, "Czech koruna", "Kč", (10, 50, 100, 500), ("CZ",),
                    "DD.MM.YYYY", ("PRIBOR 3M", "CNB 2W repo rate"), ("CZK",)),                       # 1 234,56 Kč
    # Taiwan: Chunghwa Post 2-year deposit rate = the base of index-linked mortgages; NT$ tells it from the US dollar
    "TWD": Currency("$", "zh-TW", ".", ",", 2, True, False, "New Taiwan dollar", "NT$", (10, 50, 100, 500), ("TW",),
                    "YYYY/MM/DD", ("Chunghwa Post 2-year deposit rate", "CBC discount rate"), ("NT$", "TWD")),
    # ₩1,234,568 without decimals; COFIX = the base of most variable mortgages
    "KRW": Currency("₩", "ko-KR", ".", ",", 0, True, False, "South Korean won", "₩", (1000, 5000, 10000, 50000), ("KR",),
                    "YYYY-MM-DD", ("COFIX (new)", "CD 91-day rate", "Bank of Korea base rate"), ("KRW", "원")),
    # 1 234,56 zł (thousands with a no-break space, always grouped); new loans move from WIBOR to POLSTR (2026-2027)
    "PLN": Currency("zł", "pl-PL", ",", " ", 2, False, True, "Polish złoty", "zł", (1, 5, 10, 50), ("PL",),
                    "DD.MM.YYYY", ("WIBOR 3M", "WIBOR 6M", "POLSTR 1M (compounded)"), ("PLN", "zł", "zl")),
    # ¥1,235 without decimals (en-JP: the plain ¥ of Japanese bank files, not the full-width ￥ of ja-JP)
    "JPY": Currency("¥", "en-JP", ".", ",", 0, True, False, "Japanese yen", "¥", (100, 500, 1000, 5000), ("JP",),
                    "YYYY/MM/DD", ("Short-term prime rate (Japan)", "TONA", "TIBOR 3M"), ("JPY", "円", "￥")),
}
CURRENCY = {"code": "EUR"}  # current one, loaded from the settings when HomeCoin is unlocked (activity log texts)
# date format of the Excel exports, as in the currency's country (the UI shows "02 Nov 26", the same everywhere)
DATE_EXCEL = {code: c.date_excel for code, c in CURRENCIES.items()}
# symbols and codes stripped from typed or imported amounts (longest first: "US$" before "$")
_MONEY_MARKS = re.compile("|".join(re.escape(m) for m in sorted(
    {c.symbol for c in CURRENCIES.values()} | {m for c in CURRENCIES.values() for m in c.marks}, key=len, reverse=True)))


def currency_of(db):
    r = db.execute("SELECT value FROM settings WHERE key = 'currency'").fetchone()
    return r[0] if r and r[0] in CURRENCIES else "EUR"


LAKH = {"INR"}  # currencies grouped in lakh and crore: 12,34,567 (as Intl en-IN does)


def _group(int_part, sep, lakh=False):
    """Thousands groups of a string of digits: 1.234.567 · 1,234,567 · 1'234'567 · 12,34,567 (lakh)."""
    digits = str(int(int_part))
    if not lakh or len(digits) <= 3:
        return f"{int(digits):,}".replace(",", sep)
    head, groups = digits[:-3], [digits[-3:]]
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return sep.join([head] + groups if head else groups)


def fmt_number(value, code=None, digits=None):
    """A number in the format of the currency's country, without the symbol: 1.234,5 · 1,234.5 · 1'234.5."""
    code = code or CURRENCY["code"]
    c = CURRENCIES[code]
    digits = c.digits if digits is None else digits
    # half away from zero, like the browser (Intl.NumberFormat): 0.005 → 0.01, not the "round half to even" of Python
    d = Decimal(str(abs(value))).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    int_part, _, frac = f"{d:f}".partition(".")
    out = _group(int_part, c.thousands, code in LAKH)
    return ("−" if value < 0 and d else "") + out + (c.decimal + frac if frac else "")


def fmt_money(cents, code=None):
    """Amount for texts written by the server (activity log, warnings): 1.234,56 € · $1,234.56 · CHF 1'234.56 · R$ 1.234,56."""
    code = code or CURRENCY["code"]
    c = CURRENCIES[code]
    n = fmt_number(abs(cents) / 100, code)
    sign = "−" if cents < 0 and n.strip("0.,'") else ""  # no "−0" when the amount rounds to zero
    sp = " " if c.space else ""
    return f"{sign}{c.symbol}{sp}{n}" if c.prefix else f"{sign}{n}{sp}{c.symbol}"


def fmt_decimal(value, code=None):
    """A plain decimal (a rate in %, a quantity) with the decimal separator of the currency's country: 3,1 or 3.1."""
    return f"{value:g}".replace(".", CURRENCIES[code or CURRENCY["code"]].decimal)


DATE_FORMATS = (
    "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y年%m月%d日",
    "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%Y%m%d",
)
# month first, as in US bank statements (03/04/2026 = March 4): used only when the file is in that order
DATE_FORMATS_MDY = (
    "%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y", "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y年%m月%d日",
    "%m/%d/%y", "%m-%d-%y", "%m.%d.%y", "%Y%m%d",
)
# default order of the day and month when a file does not show it (all days 1-12): the currency's country
DATE_ORDER_DEFAULT = {"USD": "mdy", "PHP": "mdy"}

STOPWORDS = {
    "pagamento", "pagam", "pag", "pos", "carta", "del", "della", "dello", "dei", "delle", "presso",
    "bonifico", "addebito", "accredito", "sdd", "sepa", "fav", "favore", "per", "con", "the",
    "operazione", "op", "ord", "ordinante", "beneficiario", "rif", "num", "data", "ora", "ita",
    "italia", "eur", "euro", "contactless", "debit", "credit", "mastercard", "visa", "maestro",
    "apple", "pay", "google", "web", "internet", "ins", "disposizione", "cro", "trn", "tramite",
}


def parse_number(value):
    """Quantity or unit price typed by hand (IT/EN formats): "1.234,5" · "1234,5" · "1,234.5" · "9.014" (= 9,014).
    If both separators are present, the last one is the decimal; repeated dots (or commas) are thousands. None if empty."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        v = float(value)  # also from JSON: NaN and Infinity are not numbers here either
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError(i18n.t("invalid number"))
        return v
    s = _MONEY_MARKS.sub("", str(value).strip()).replace("’", "").replace(" ", "").replace(" ", "").replace("'", "").replace("−", "-")
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", "") if s.count(",") > 1 else s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    v = float(s)  # ValueError if it is not a number
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError(i18n.t("invalid number"))
    return v


MAX_CENTS = 10 ** 13  # 100 billion euros: larger amounts in a statement are typos or garbage, not money


def _cents(d):
    """Decimal in euros → cents; None if not finite or out of range (e.g. "9e999999" or a 1e308 Excel cell)."""
    try:
        if not d.is_finite():  # "NaN", "inf" (e.g. empty cells exported by other programs)
            return None
        cents = int((d * 100).quantize(Decimal("1")))
    except (DecimalException, ValueError, OverflowError):
        return None
    return cents if abs(cents) <= MAX_CENTS else None


def parse_amount(value):
    """Convert an amount (number or text, IT/EN formats) into signed cents. None if invalid."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return _cents(Decimal(str(value)))
    s = str(value).strip()
    if not s:
        return None
    s = _MONEY_MARKS.sub("", s).replace("’", "").replace("−", "-").replace(" ", "").replace(" ", "").replace("'", "")
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1]
    if s.endswith("-"):
        neg, s = True, s[:-1]
    if s.startswith("-"):
        neg, s = not neg, s[1:]
    elif s.startswith("+"):
        s = s[1:]
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    elif s.count(".") > 1 or (s.count(".") == 1 and len(s.split(".")[1]) == 3):
        s = s.replace(".", "")
    try:
        cents = _cents(Decimal(s))
    except (DecimalException, ValueError):
        return None
    if cents is None:
        return None
    return -cents if neg else cents


def parse_date(value, order="dmy"):
    """Convert dates (objects, Excel serials, day-first/ISO text; month-first with order="mdy") into datetime.date.
    None if invalid."""
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value != value or value in (float("inf"), float("-inf")):  # NaN/infinity (JSON or Excel cells)
            return None
        if 20000 < value < 80000:  # Excel serial
            return dt.date(1899, 12, 30) + dt.timedelta(days=int(value))
        value = str(int(value))
    s = str(value).strip().split(" ")[0].split("T")[0]
    for fmt in (DATE_FORMATS_MDY if order == "mdy" else DATE_FORMATS):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def iso(d):
    return d.isoformat() if d else None


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def occurrence(start, frequency, n):
    """Date of the n-th occurrence (0 = first) of a recurrence."""
    unit, step = FREQUENCIES[frequency]
    if unit == "d":
        return start + dt.timedelta(days=step * n)
    return add_months(start, step * n)


def _hungarian(a):
    """Minimum-cost assignment of every row of matrix a (rows <= columns) to a distinct column: {row: column}."""
    n, m = len(a), len(a[0])
    inf = float("inf")
    u, v, p, way = [0] * (n + 1), [0] * (m + 1), [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [inf] * (m + 1), [False] * (m + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], inf, 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = a[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    return {p[j] - 1: j - 1 for j in range(1, m + 1) if p[j]}


def best_pairs(left, right, cost):
    """Pair items of two lists one to one, each at most once: as many pairs as possible, then the lowest total cost.
    cost(l, r) is a number, or None when the two cannot be the same thing. Unlike taking the closest first, repeated
    similar items (the same amount every week) never leave one unpaired that had a partner.
    Returns [(left index, right index)]."""
    edges = {}
    for i, l in enumerate(left):
        for j, r in enumerate(right):
            c = cost(l, r)
            if c is not None:
                edges[(i, j)] = c
    # independent groups (connected components) are solved separately: small matrices
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for i, j in edges:
        parent[find(("l", i))] = find(("r", j))
    groups = {}
    for i, j in edges:
        g = groups.setdefault(find(("l", i)), (set(), set()))
        g[0].add(i)
        g[1].add(j)
    out = []
    for ls, rs in groups.values():
        ls, rs = sorted(ls), sorted(rs)
        big = 1 + len(ls) * (1 + max(edges[e] for e in edges if e[0] in ls))  # a missing pair costs more than all
        flip = len(ls) > len(rs)
        rows, cols = (rs, ls) if flip else (ls, rs)
        mat = [[edges.get((c, r) if flip else (r, c), big) for c in cols] for r in rows]
        for ri, ci in _hungarian(mat).items():
            i, j = (cols[ci], rows[ri]) if flip else (rows[ri], cols[ci])
            if (i, j) in edges:
                out.append((i, j))
    return sorted(out)


def months_between(d1, d2):
    """Number of calendar months touched by the interval [d1, d2]."""
    return max(1, (d2.year - d1.year) * 12 + d2.month - d1.month + 1)


def normalize_desc(text):
    """Short key of a bank description, used to recognize similar transactions."""
    # letters of any alphabet (ł, ü, ß, カ, 日…); NFKC: the half-width ｶﾅ of Japanese bank files = full-width カナ
    s = re.sub(r"[\W\d_]+", " ", unicodedata.normalize("NFKC", text or "").lower())
    # words of 3+ letters; in Chinese, Japanese and Korean 2 characters already make a word ("월급", "薪資")
    tokens = [t for t in s.split() if (len(t) >= 3 or (len(t) == 2 and any(ord(ch) >= 0x1100 for ch in t)))
              and t not in STOPWORDS]
    return " ".join(tokens[:3])


def rule_matches(pattern, text):
    """The pattern must start at the beginning of a word; if short (<=3 characters) it must also be a whole word."""
    p = re.escape(pattern.strip().lower())
    if not p:
        return False
    tail = r"(?![a-z0-9])" if len(pattern.strip()) <= 3 else ""
    return re.search(r"(?<![a-z0-9])" + p + tail, (text or "").lower()) is not None
