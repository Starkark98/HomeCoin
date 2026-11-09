"""Helper functions: amounts, dates, recurrences, description normalization."""
import calendar
import datetime as dt
import re
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
# into it. Each currency uses the number format of its main country (same table as CURRENCIES in app.js):
# code -> symbol, UI locale, decimal and thousands separators, decimals shown, symbol before the number, space after it
Currency = namedtuple("Currency", "symbol locale decimal thousands digits prefix space name")
CURRENCIES = {
    "EUR": Currency("€", "it-IT", ",", ".", 2, False, True, "Euro"),               # 1.234,56 €
    "USD": Currency("$", "en-US", ".", ",", 2, True, False, "US dollar"),          # $1,234.56
    "GBP": Currency("£", "en-GB", ".", ",", 2, True, False, "British pound"),      # £1,234.56
    "CHF": Currency("CHF", "de-CH", ".", "'", 2, True, True, "Swiss franc"),       # CHF 1'234.56 (as Chrome and Edge write it)
    "CAD": Currency("$", "en-CA", ".", ",", 2, True, False, "Canadian dollar"),    # $1,234.56
    "AUD": Currency("$", "en-AU", ".", ",", 2, True, False, "Australian dollar"),  # $1,234.56
    "MXN": Currency("$", "es-MX", ".", ",", 2, True, False, "Mexican peso"),       # $1,234.56
    "BRL": Currency("R$", "pt-BR", ",", ".", 2, True, True, "Brazilian real"),     # R$ 1.234,56
}
CURRENCY = {"code": "EUR"}  # current one, loaded from the settings when HomeCoin is unlocked (activity log texts)
# date format of the Excel exports, as in the currency's country (the UI shows "02 Nov 26", the same everywhere)
DATE_EXCEL = {"EUR": "DD/MM/YYYY", "USD": "MM/DD/YYYY", "GBP": "DD/MM/YYYY", "CHF": "DD.MM.YYYY",
              "CAD": "YYYY-MM-DD", "AUD": "DD/MM/YYYY", "MXN": "DD/MM/YYYY", "BRL": "DD/MM/YYYY"}
# symbols and codes stripped from typed or imported amounts (longest first: "US$" before "$")
_MONEY_MARKS = re.compile(r"US\$|C\$|A\$|CA\$|AU\$|MX\$|R\$|CHF|Fr\.|EUR|USD|GBP|CAD|AUD|MXN|BRL|[€$£]")


def currency_of(db):
    r = db.execute("SELECT value FROM settings WHERE key = 'currency'").fetchone()
    return r[0] if r and r[0] in CURRENCIES else "EUR"


def _group(int_part, sep):
    """Thousands groups of a string of digits: 1.234.567 · 1,234,567 · 1'234'567."""
    return f"{int(int_part):,}".replace(",", sep)


def fmt_number(value, code=None, digits=None):
    """A number in the format of the currency's country, without the symbol: 1.234,5 · 1,234.5 · 1'234.5."""
    c = CURRENCIES[code or CURRENCY["code"]]
    digits = c.digits if digits is None else digits
    # half away from zero, like the browser (Intl.NumberFormat): 0.005 → 0.01, not the "round half to even" of Python
    d = Decimal(str(abs(value))).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    int_part, _, frac = f"{d:f}".partition(".")
    out = _group(int_part, c.thousands)
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
    "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d",
    "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%Y%m%d",
)
# month first, as in US bank statements (03/04/2026 = March 4): used only when the file is in that order
DATE_FORMATS_MDY = (
    "%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y", "%Y-%m-%d", "%Y/%m/%d",
    "%m/%d/%y", "%m-%d-%y", "%m.%d.%y", "%Y%m%d",
)
# default order of the day and month when a file does not show it (all days 1-12): the currency's country
DATE_ORDER_DEFAULT = {"USD": "mdy"}

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


def months_between(d1, d2):
    """Number of calendar months touched by the interval [d1, d2]."""
    return max(1, (d2.year - d1.year) * 12 + d2.month - d1.month + 1)


def normalize_desc(text):
    """Short key of a bank description, used to recognize similar transactions."""
    s = re.sub(r"[^a-zà-ù ]+", " ", (text or "").lower())
    tokens = [t for t in s.split() if len(t) >= 3 and t not in STOPWORDS]
    return " ".join(tokens[:3])


def rule_matches(pattern, text):
    """The pattern must start at the beginning of a word; if short (<=3 characters) it must also be a whole word."""
    p = re.escape(pattern.strip().lower())
    if not p:
        return False
    tail = r"(?![a-z0-9])" if len(pattern.strip()) <= 3 else ""
    return re.search(r"(?<![a-z0-9])" + p + tail, (text or "").lower()) is not None
