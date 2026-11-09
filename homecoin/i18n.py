"""Interface languages: the server's texts (error messages, warnings, activity log) and the names of the default
categories, spaces and accounts.

The texts are written in English in the code and looked up, by their English text, in static/i18n/<language>.json
(the same files the browser uses). A text without a translation stays in English. Placeholders use {name}.
"""
import json
import threading
from pathlib import Path

LANGUAGES = {  # code -> name in its own language (order of the menus)
    "en": "English",
    "es": "Español",
    "pt-BR": "Português (Brasil)",
    "de": "Deutsch",
    "fr": "Français",
    "it": "Italiano",
}
DEFAULT_LANGUAGE = "en"
LANG = {"code": DEFAULT_LANGUAGE}  # current one: from the keystore (it is chosen before the data can be opened)

I18N_DIR = Path(__file__).resolve().parent.parent / "static" / "i18n"
_cache = {}
_lock = threading.Lock()


def best_match(accept_language):
    """The interface language closest to the browser's (Accept-Language header), for the first start."""
    for part in (accept_language or "").split(","):
        tag = part.split(";")[0].strip()
        if not tag:
            continue
        if tag in LANGUAGES:
            return tag
        base = tag.split("-")[0].lower()
        if base == "pt":
            return "pt-BR"
        if base in LANGUAGES:
            return base
    return DEFAULT_LANGUAGE


def set_language(code):
    LANG["code"] = code if code in LANGUAGES else DEFAULT_LANGUAGE
    return LANG["code"]


def table(code=None):
    """Translations of a language: {English text: translated text}."""
    code = code or LANG["code"]
    if code == DEFAULT_LANGUAGE or code not in LANGUAGES:
        return {}
    with _lock:
        if code not in _cache:
            try:
                data = json.loads((I18N_DIR / f"{code}.json").read_text(encoding="utf-8"))
                _cache[code] = {k: v for k, v in data.items() if isinstance(v, str) and v and not k.startswith("@")}
            except (OSError, ValueError):
                _cache[code] = {}
        return _cache[code]


class _Keep(dict):
    def __missing__(self, key):  # a placeholder without a value stays as it is
        return "{" + key + "}"


def t(text, code=None, **values):
    """The text in the current language (English if there is no translation), with {placeholders} filled in."""
    out = table(code).get(text, text)
    return out.format_map(_Keep(values)) if values else out


def tn(one, other, n, code=None, **values):
    """Singular or plural by n: French uses the singular for 0 and 1, the other languages only for 1."""
    code = code or LANG["code"]
    single = n in (0, 1) if code == "fr" else n == 1
    return t(one if single else other, code, n=n, **values)


# ---------------------------------------------------------------- default categories, spaces and accounts
# Every default category has a fixed code (categories.code): the code, not the name, is what the program relies on,
# so the name can be in any language and the user can rename it. Names: en, es, pt-BR, de, fr, it.
CATEGORY_NAMES = {
    "mortgage": ("Mortgage & loans", "Hipoteca y préstamos", "Financiamentos e empréstimos", "Kredite & Darlehen",
                 "Prêts & crédits", "Mutuo e finanziamenti"),
    "groceries": ("Groceries", "Supermercado", "Supermercado", "Lebensmittel", "Courses", "Spesa"),
    "restaurants": ("Restaurants & bars", "Restaurantes y bares", "Restaurantes e bares", "Restaurants & Bars",
                    "Restaurants & bars", "Ristoranti e bar"),
    "home": ("Home & furniture", "Hogar y muebles", "Casa e móveis", "Haushalt & Möbel", "Maison & mobilier",
             "Casa e arredo"),
    "utilities": ("Utilities", "Suministros", "Contas da casa", "Nebenkosten", "Factures du foyer", "Utenze"),
    "transport": ("Transport", "Transporte", "Transporte", "Mobilität", "Transports", "Trasporti"),
    "travel": ("Travel", "Viajes", "Viagens", "Reisen", "Voyages", "Viaggi"),
    "shopping": ("Shopping & gifts", "Compras y regalos", "Compras e presentes", "Shopping & Geschenke",
                 "Shopping & cadeaux", "Shopping e regali"),
    "health": ("Health & personal care", "Salud y cuidado personal", "Saúde e cuidados pessoais",
               "Gesundheit & Körperpflege", "Santé & soins", "Salute e cura della persona"),
    "bank": ("Bank & insurance", "Banco y seguros", "Banco e seguros", "Bank & Versicherungen", "Banque & assurances",
             "Banca e assicurazioni"),
    "other": ("Other", "Otros", "Outros", "Sonstiges", "Autres", "Altro"),
    "other_income": ("Other income", "Otros ingresos", "Outras receitas", "Sonstige Einnahmen", "Autres revenus",
                     "Altre entrate"),
    "contributions": ("Contributions to household", "Aportaciones al hogar", "Contribuições para a casa",
                      "Beiträge zum Haushalt", "Contributions au foyer", "Contributi alla casa"),
    "subscriptions": ("Subscriptions", "Suscripciones", "Assinaturas", "Abos", "Abonnements", "Abbonamenti"),
    "sport": ("Sport & leisure", "Deporte y ocio", "Esporte e lazer", "Sport & Freizeit", "Sport & loisirs",
              "Sport e tempo libero"),
    "books": ("Books & learning", "Libros y formación", "Livros e estudos", "Bücher & Weiterbildung",
              "Livres & formation", "Libri e formazione"),
    "taxes": ("Taxes", "Impuestos", "Impostos", "Steuern", "Impôts", "Tasse"),
    "salary": ("Salary", "Sueldo", "Salário", "Gehalt", "Salaire", "Stipendio"),
    "interest": ("Interest", "Intereses", "Juros", "Zinsen", "Intérêts", "Interessi"),
    # system categories (created by import scripts): excluded from savings and invested amounts
    "balance_adjustment": ("Balance adjustment", "Ajuste de saldo", "Ajuste de saldo", "Saldokorrektur",
                           "Ajustement de solde", "Rettifica saldo"),
    "other_investments": ("Other investments (excluded)", "Otras inversiones (excluidas)",
                          "Outros investimentos (excluídos)", "Sonstige Anlagen (ausgeschlossen)",
                          "Autres placements (exclus)", "Altri investimenti (esclusi)"),
}
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
_LANG_INDEX = {code: i for i, code in enumerate(LANGUAGES)}


def category_name(code, lang=None):
    names = CATEGORY_NAMES[code]
    return names[_LANG_INDEX.get(lang or LANG["code"], 0)]


def all_names(code):
    """Every name a default category may have (all languages and older versions): for recognizing it."""
    return set(CATEGORY_NAMES[code]) | set(LEGACY_NAMES.get(code, ()))


def code_of_name(name):
    """Code of a default category from one of its names (any language), or None."""
    low = (name or "").strip().lower()
    for code in CATEGORY_NAMES:
        if low in {n.lower() for n in all_names(code)}:
            return code
    return None


MONTHS = {  # short month names (same as MONTH_NAMES in app.js), for the Excel report
    "en": "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec",
    "es": "ene feb mar abr may jun jul ago sep oct nov dic",
    "pt-BR": "jan fev mar abr mai jun jul ago set out nov dez",
    "de": "Jan Feb Mär Apr Mai Jun Jul Aug Sep Okt Nov Dez",
    "fr": "jan fév mar avr mai juin juil août sep oct nov déc",
    "it": "gen feb mar apr mag giu lug ago set ott nov dic",
}


def month_name(month, lang=None):
    """Short name of a month (1-12) in the interface language."""
    return MONTHS.get(lang or LANG["code"], MONTHS["en"]).split()[month - 1]


# texts translated through a variable (t(label)), listed here so that the translation files include them: account and
# trade types and space types in activity log details, the counters of a bundle import, the bulk-edit log actions
DYNAMIC_TEXTS = (
    "current account", "savings account", "credit card", "prepaid card", "cash", "investment account", "other",
    "buy", "sell", "split", "capital return", "interest", "dividend", "fee", "Family", "Personal",
    "accounts", "transactions", "trades", "securities",
    "Multiple transactions deleted", "Category changed on multiple transactions", "Transactions excluded from reports",
    "Transactions included in reports",
)


def estimated_markers():
    """"estimated price" in every language (and the Italian of older databases): the note of an automatic investment
    plan purchase whose price still has to be verified contains one of these."""
    return {t("estimated price", code) for code in LANGUAGES} | {"prezzo stimato"}


SPACE_NAMES = {  # default name of a new space by type
    "family": ("Family", "Familia", "Família", "Familie", "Famille", "Famiglia"),
    "personal": ("Personal", "Personal", "Pessoal", "Persönlich", "Personnel", "Personale"),
}
MAIN_ACCOUNT = ("Main account", "Cuenta principal", "Conta principal", "Hauptkonto", "Compte principal",
                "Conto principale")


def space_name(ptype, lang=None):
    return SPACE_NAMES[ptype][_LANG_INDEX.get(lang or LANG["code"], 0)]


def main_account_name(lang=None):
    return MAIN_ACCOUNT[_LANG_INDEX.get(lang or LANG["code"], 0)]
