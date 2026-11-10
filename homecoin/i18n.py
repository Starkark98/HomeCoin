"""Interface languages: the server's texts (error messages, warnings, activity log) and the names of the default
categories, spaces and accounts.

Each language is one file, static/i18n/<code>.json (the same file the browser uses):
- "@meta": what the program needs to know about the language (see LANGUAGE_FILE_FORMAT below);
- every other key is an English text of the code with its translation. A text without a translation stays in English.
  Placeholders use {name}. For a plural ("{n} files"), languages with more than two forms (plural rule "pl") give an
  object {"few": "...", "many": "...", "other": "..."} instead of a string.
Adding a language = adding its file: nothing in the code lists the languages.
"""
import json
import threading
from pathlib import Path

LANGUAGE_FILE_FORMAT = """\
"@meta": {
  "name":         name of the language in itself, shown in the menus ("Polski")
  "plural":       "one" (singular only for 1), "zero_one" (singular for 0 and 1, French),
                  "pl" (one / few / many: Polish, Czech, Ukrainian…), "none" (no plural: Japanese, Chinese…)
  "currency":     currency suggested at the first start when the browser's country says nothing
  "months":       12 short month names, as shown in charts and dates
  "date_pattern", "month_pattern": optional, the order of a date and of a month in the interface, with {d} {j} {mon}
                  {m} {y} {yy} (day with 2 digits, day without leading zero, month name, month number, year, 2-digit
                  year). Default "{d} {mon} {y}" and "{mon} {yy}"; Japanese "{y}年{m}月{j}日" and "{yy}年{m}月"
  "month_words":  full month names, lowercase: ignored when grouping payers ("Salary March" = "Salary April")
  "categories":   name of every default category, by code (same codes as en.json)
  "spaces":       {"family": ..., "personal": ...} default names of new spaces
  "main_account": name of the first account
  "encodings":    text encodings of the country's bank CSV files, tried after UTF-8 (e.g. ["cp1250"])
  "import":       optional, extra column headers of the country's bank files: {"date": [...], "description": [...],
                  "amount": [...], "debit": [...], "credit": [...], "category": [...]}
  "statement":    sample bank statement of the demo: {"header", "card", "decimal", "value_date", "date"}
}"""

DEFAULT_LANGUAGE = "en"
LANG = {"code": DEFAULT_LANGUAGE}  # current one: from the keystore (it is chosen before the data can be opened)

I18N_DIR = Path(__file__).resolve().parent.parent / "static" / "i18n"
_cache = {}
_lock = threading.Lock()


def _load_meta():
    metas = {}
    for f in sorted(I18N_DIR.glob("*.json")):
        try:
            meta = json.loads(f.read_text(encoding="utf-8")).get("@meta")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(meta, dict) and meta.get("name") and len(meta.get("months") or ()) == 12:
            metas[f.stem] = meta
    if DEFAULT_LANGUAGE not in metas:
        raise RuntimeError(f"{I18N_DIR / 'en.json'} is missing or damaged")
    return metas


META = _load_meta()
# code -> name in its own language, in alphabetical order of the names (order of the menus)
LANGUAGES = {code: META[code]["name"] for code in sorted(META, key=lambda c: META[c]["name"].casefold())}


def meta(code=None):
    return META.get(code or LANG["code"]) or META[DEFAULT_LANGUAGE]


def best_match(accept_language):
    """The interface language closest to the browser's (Accept-Language header), for the first start."""
    for part in (accept_language or "").split(","):
        tag = part.split(";")[0].strip()
        if not tag:
            continue
        for code in LANGUAGES:
            if code.lower() == tag.lower():
                return code
        base = tag.split("-")[0].lower()
        for code in LANGUAGES:  # "pt-PT" or "pt" -> "pt-BR", "nl-BE" -> "nl"
            if code.split("-")[0].lower() == base:
                return code
    return DEFAULT_LANGUAGE


def set_language(code):
    LANG["code"] = code if code in LANGUAGES else DEFAULT_LANGUAGE
    return LANG["code"]


def table(code=None):
    """Translations of a language: {English text: translated text (or plural forms)}."""
    code = code or LANG["code"]
    if code == DEFAULT_LANGUAGE or code not in LANGUAGES:
        return {}
    with _lock:
        if code not in _cache:
            try:
                data = json.loads((I18N_DIR / f"{code}.json").read_text(encoding="utf-8"))
                _cache[code] = {k: v for k, v in data.items()
                                if not k.startswith("@") and ((isinstance(v, str) and v) or isinstance(v, dict))}
            except (OSError, ValueError):
                _cache[code] = {}
        return _cache[code]


class _Keep(dict):
    def __missing__(self, key):  # a placeholder without a value stays as it is
        return "{" + key + "}"


def _fill(out, values):
    return out.format_map(_Keep(values)) if values else out


def t(text, code=None, **values):
    """The text in the current language (English if there is no translation), with {placeholders} filled in."""
    out = table(code).get(text, text)
    if isinstance(out, dict):  # a plural text used on its own: its general form
        out = out.get("other") or text
    return _fill(out, values)


def plural_category(n, code=None):
    """CLDR plural category of n in a language: "one", "few", "many" or "other"."""
    rule = meta(code).get("plural", "one")
    if rule == "none":
        return "other"
    if rule == "zero_one":
        return "one" if 0 <= n < 2 else "other"
    if rule == "pl":
        if n != int(n):
            return "other"  # fractions: "1,5 godziny"
        n = abs(int(n))
        if n == 1:
            return "one"
        return "few" if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else "many"
    return "one" if n == 1 else "other"


def tn(one, other, n, code=None, **values):
    """Singular or plural by n, following the language's plural rule. {n} is filled in."""
    code = code or LANG["code"]
    cat = plural_category(n, code)
    key = one if cat == "one" else other
    out = table(code).get(key, key)
    if isinstance(out, dict):  # forms of a language with more plurals (also "one" when singular and plural share a text)
        out = out.get(cat) or out.get("other") or key
    return _fill(out, {"n": n, **values})


# ---------------------------------------------------------------- default categories, spaces and accounts
# Every default category has a fixed code (categories.code): the code, not the name, is what the program relies on,
# so the name can be in any language and the user can rename it. The names are in "@meta" of each language file.
CATEGORY_CODES = tuple(META[DEFAULT_LANGUAGE]["categories"])
SYSTEM_CODES = ("balance_adjustment", "other_investments")
# names used by older versions: recognized when the codes are assigned to an existing database
LEGACY_NAMES = {
    "contributions": ("Versamenti conto casa",),
    "mortgage": ("Mutuo / Affitto",),
    "utilities": ("Bollette",),
    "transport": ("Auto & Carburante",),
    "home": ("Arredamento",),
    "bank": ("Assicurazioni",),
}


def category_name(code, lang=None):
    return meta(lang).get("categories", {}).get(code) or META[DEFAULT_LANGUAGE]["categories"][code]


def all_names(code):
    """Every name a default category may have (all languages and older versions): for recognizing it."""
    names = {m.get("categories", {}).get(code) for m in META.values()} - {None}
    return names | set(LEGACY_NAMES.get(code, ()))


_NAME_TO_CODE = {}


def code_of_name(name):
    """Code of a default category from one of its names (any language), or None."""
    if not _NAME_TO_CODE:
        for code in CATEGORY_CODES:
            for n in all_names(code):
                _NAME_TO_CODE.setdefault(n.strip().casefold(), code)
    return _NAME_TO_CODE.get((name or "").strip().casefold())


def month_name(month, lang=None):
    """Short name of a month (1-12) in the interface language."""
    return meta(lang)["months"][month - 1]


DATE_PATTERN = "{d} {mon} {y}"   # "05 Nov 2026"; Japanese: "{y}年{m}月{j}日"
MONTH_PATTERN = "{mon} {yy}"     # "Nov 26" (charts); Japanese: "{yy}年{m}月"


def month_label(month, year, lang=None):
    """A month with its year, e.g. for the columns of the Excel report: "Nov 2026", "2026年11月"."""
    pattern = meta(lang).get("month_pattern", MONTH_PATTERN).replace("{yy}", "{y}")
    return pattern.format(mon=month_name(month, lang), m=month, y=year)


def month_words():
    """Month names of every language (full and short, lowercase): ignored when grouping payers."""
    out = set()
    for m in META.values():
        out |= {w.casefold() for w in m.get("month_words", ())} | {w.casefold().rstrip(".") for w in m["months"]}
    return out


def encodings():
    """Text encodings of bank files to try after UTF-8: the interface language's first, then the others."""
    out = list(meta().get("encodings", ()))
    for m in META.values():
        out += [e for e in m.get("encodings", ()) if e not in out]
    return out


def import_keywords():
    """Extra column headers of bank files from the language files: {field: [keyword, ...]}."""
    out = {}
    for code in LANGUAGES:
        for field, words in (META[code].get("import") or {}).items():
            out.setdefault(field, []).extend(w for w in words if w not in out[field])
    return out


def statement(lang=None):
    """Format of the demo's sample bank statement in a language."""
    return meta(lang).get("statement") or META[DEFAULT_LANGUAGE]["statement"]


# texts translated through a variable (t(label)), listed here so that the translation files include them: account and
# trade types and space types in activity log details, the bulk-edit log actions
DYNAMIC_TEXTS = (
    "current account", "savings account", "credit card", "prepaid card", "cash", "investment account", "other",
    "buy", "sell", "split", "capital return", "interest", "dividend", "fee", "Family", "Personal",
    "Multiple transactions deleted", "Category changed on multiple transactions", "Transactions excluded from reports",
    "Transactions included in reports",
)


def estimated_markers():
    """"estimated price" in every language (and the Italian of older databases): the note of an automatic investment
    plan purchase whose price still has to be verified contains one of these."""
    return {t("estimated price", code) for code in LANGUAGES} | {"prezzo stimato"}


def space_name(ptype, lang=None):
    return meta(lang).get("spaces", {}).get(ptype) or META[DEFAULT_LANGUAGE]["spaces"][ptype]


def main_account_name(lang=None):
    return meta(lang).get("main_account") or META[DEFAULT_LANGUAGE]["main_account"]
