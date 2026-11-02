"""Helper functions: amounts, dates, recurrences, description normalization."""
import calendar
import datetime as dt
import re
from decimal import Decimal, DecimalException

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

# system categories with a role in the calculations. Older databases keep the Italian names, so both are recognized.
BALANCE_ADJUSTMENT = {"Balance adjustment", "Rettifica saldo"}
# trades on securities that were not imported (excluded from reports, counted as invested in Savings)
OTHER_INVESTMENTS = {"Other investments (excluded)", "Altri investimenti (esclusi)"}
# system transactions excluded from reports: neither income nor spending (adjustments stay a separate line of the balance)
TECH_CATEGORIES = BALANCE_ADJUSTMENT | OTHER_INVESTMENTS

DATE_FORMATS = (
    "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%Y/%m/%d",
    "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%Y%m%d",
)

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
            raise ValueError("invalid number")
        return v
    s = str(value).strip().replace("€", "").replace(" ", "").replace(" ", "").replace("'", "").replace("−", "-")
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
        raise ValueError("invalid number")
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
    s = s.replace("€", "").replace("EUR", "").replace(" ", "").replace(" ", "").replace("'", "")
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


def parse_date(value):
    """Convert dates (objects, Excel serials, IT/ISO text) into datetime.date. None if invalid."""
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
    for fmt in DATE_FORMATS:
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
