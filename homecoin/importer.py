"""Reading CSV / Excel bank statements and automatic column detection."""
import csv
import datetime as dt
import io
import re

import openpyxl

from .util import parse_amount, parse_date

MAX_ROWS = 20000

# keywords per column, in order of preference (Italian and English bank exports; substring match on the header)
FIELD_KEYWORDS = {
    "date": ["data operazione", "data contabile", "data movimento", "transaction date", "posting date", "booking date",
             "data", "date", "giorno", "valuta"],
    "description": ["descrizione", "causale", "dettagli", "dettaglio", "description", "details", "narrative", "operazione",
                    "beneficiario", "esercente", "merchant", "memo", "payee", "note"],
    "amount": ["importo", "amount", "ammontare", "valore", "euro", "eur"],
    "debit": ["uscite", "addebiti", "addebito", "dare", "debit", "prelievi", "withdrawal", "money out", "paid out",
              "spese"],
    "credit": ["entrate", "accrediti", "accredito", "avere", "credit", "versamenti", "deposit", "money in", "paid in"],
    "category": ["categoria", "category"],
}
HEADER_HINTS = {kw for kws in FIELD_KEYWORDS.values() for kw in kws}


def _clean_cell(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, str):
        return v.strip()
    return v


def _decode(data):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("File encoding not recognized")


def read_table(filename, data):
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext in ("xlsx", "xlsm"):
        try:
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:  # corrupted file or not xlsx
            raise ValueError(f"Cannot read the Excel file: {exc}") from exc
        best = []
        for ws in wb.worksheets:
            rows = []
            for r in ws.iter_rows(values_only=True):
                if len(rows) >= MAX_ROWS:
                    break
                rows.append([_clean_cell(c) for c in r])
            rows = [r for r in rows if any(c not in (None, "") for c in r)]
            if len(rows) > len(best):
                best = rows
        wb.close()
        rows = best
    elif ext in ("csv", "txt", "tsv"):
        text = _decode(data)
        sample = text[:8000].replace("\r\n", "\n").replace("\r", "\n")  # the sniffer only splits lines on \n
        try:
            delim = csv.Sniffer().sniff(sample, delimiters=";,\t|").delimiter
        except csv.Error:
            delim = ";" if sample.count(";") >= sample.count(",") else ","
        try:  # newline="": any line ending (\n, \r\n, old Mac \r) and line breaks inside quoted cells
            rows = [[c.strip() for c in r] for r in csv.reader(io.StringIO(text, newline=""), delimiter=delim)]
        except csv.Error as exc:
            raise ValueError(f"Cannot read the CSV file: {exc}") from exc
        rows = [r for r in rows if any(c for c in r)][:MAX_ROWS]
    elif ext == "xls":
        raise ValueError("The old .xls format is not supported: save the file as .xlsx or .csv")
    else:
        raise ValueError("Unsupported format: use .csv, .xlsx or .txt")

    if not rows:
        raise ValueError("The file contains no data")
    width = max(len(r) for r in rows)
    rows = [list(r) + [None] * (width - len(r)) for r in rows]
    # drop completely empty trailing columns
    while width and all(r[width - 1] in (None, "") for r in rows):
        width -= 1
        rows = [r[:width] for r in rows]
    return rows


def _norm(v):
    return re.sub(r"\s+", " ", str(v or "").strip().lower())


def detect_header(rows):
    for i, row in enumerate(rows[:25]):
        cells = [_norm(c) for c in row]
        hits = sum(1 for c in cells if c and any(h in c for h in HEADER_HINTS))
        if hits >= 2:
            return i
    return -1


def guess_mapping(headers):
    cells = [_norm(h) for h in headers]
    mapping, used = {}, set()
    for field in ("date", "debit", "credit", "amount", "description", "category"):
        mapping[field] = None
        for kw in FIELD_KEYWORDS[field]:
            idx = next((i for i, c in enumerate(cells) if i not in used and kw in c), None)
            if idx is not None:
                mapping[field] = idx
                used.add(idx)
                break
    if mapping["amount"] is not None:
        # with a single amount column, separate credit/debit columns are not needed
        for f in ("debit", "credit"):
            if mapping[f] is not None:
                used.discard(mapping[f])
                mapping[f] = None
    return mapping


_DM = re.compile(r"^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\D|$)")


def detect_date_order(rows, col, default="dmy"):
    """Order of day and month in a date column: "dmy" (31/12/2026) or "mdy" (12/31/2026, US statements).
    Decided by the values themselves (a first number over 12 is a day, a second number over 12 is a day);
    when every value fits both (days 1-12 only) the default of the currency's country is used.
    Returns (order, source) with source "file" or "default"."""
    if col is None:
        return default, "default"
    day_first = month_first = 0
    for r in rows[:MAX_ROWS]:
        v = r[col] if col < len(r) else None
        if not isinstance(v, str):
            continue  # Excel dates and serial numbers carry no ambiguity
        m = _DM.match(v)
        if not m:
            continue
        a, b = int(m.group(1)), int(m.group(2))
        if a > 12 and b <= 12:
            day_first += 1
        elif b > 12 and a <= 12:
            month_first += 1
    if day_first and not month_first:
        return "dmy", "file"
    if month_first and not day_first:
        return "mdy", "file"
    if day_first and month_first:  # inconsistent file: the majority wins, the rest shows up as invalid dates
        return ("dmy" if day_first >= month_first else "mdy"), "file"
    return default, "default"


def _is_date(v):
    return parse_date(v) is not None or parse_date(v, "mdy") is not None


def guess_mapping_from_data(rows, mapping):
    """Without headers, infer the date/amount/description columns from the values."""
    sample = rows[:30]
    width = len(sample[0]) if sample else 0
    def ratio(col, fn):
        vals = [r[col] for r in sample if r[col] not in (None, "")]
        return sum(1 for v in vals if fn(v)) / len(vals) if vals else 0
    taken = {v for v in mapping.values() if v is not None}
    if mapping["date"] is None:
        for c in range(width):
            if c not in taken and ratio(c, _is_date) > 0.8:
                mapping["date"] = c
                taken.add(c)
                break
    if mapping["amount"] is None and mapping["debit"] is None and mapping["credit"] is None:
        for c in range(width):
            if c not in taken and ratio(c, lambda v: parse_amount(v) is not None and not _is_date(v)) > 0.8:
                mapping["amount"] = c
                taken.add(c)
                break
    if mapping["description"] is None:
        best, best_len = None, 0
        for c in range(width):
            if c in taken:
                continue
            avg = sum(len(str(r[c] or "")) for r in sample) / max(1, len(sample))
            if avg > best_len:
                best, best_len = c, avg
        mapping["description"] = best
    return mapping


def parse_rows(rows, header_row, mapping, invert=False, date_order="dmy"):
    """Return the normalized transactions: date, description, amount (cents), kind, raw_category.
    date_order: "dmy" or "mdy" for dates written as text (see detect_date_order)."""
    out = []
    data = rows[header_row + 1:] if header_row >= 0 else rows
    for i, r in enumerate(data):
        def cell(field):
            idx = mapping.get(field)
            return r[idx] if idx is not None and idx < len(r) else None

        d = parse_date(cell("date"), date_order)
        desc = str(cell("description") or "").strip()
        if mapping.get("amount") is not None:
            cents = parse_amount(cell("amount"))
        else:
            deb = parse_amount(cell("debit"))
            cre = parse_amount(cell("credit"))
            if deb is None and cre is None:
                cents = None
            else:
                cents = abs(cre or 0) - abs(deb or 0)
        error = None
        if d is None:
            error = "Invalid date"
        elif cents is None or cents == 0:
            error = "Amount missing or zero"
        if d is None and not cents:
            continue  # header, total or balance row: skip it silently
        if cents and invert:
            cents = -cents
        out.append({
            "row": i + 1,
            "date": d.isoformat() if d else None,
            "description": desc[:200],
            "amount": abs(cents) if cents else 0,
            "kind": "income" if (cents or 0) > 0 else "expense",
            "raw_category": str(cell("category") or "").strip(),
            "error": error,
        })
    return out
