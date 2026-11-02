# CLAUDE.md — HomeCoin

Guidance for Claude Code when working in this repository. Household finance app that runs locally on Windows: Python/Flask server on `127.0.0.1`, encrypted SQLCipher database, vanilla JS single-page UI. Current version: see `VERSION` in `homecoin/app.py` (1.0.1 at the time of writing).

## Hard rules

- **Never read, copy or print the real data.** `data/` (database, `keystore.json`, `backups/`) belongs to the user. Test only with the demo (`demo-data/`) or a throwaway folder set through `HOMECOIN_DATA_DIR`, and delete it afterwards.
- **No personal or financial data anywhere outside the encrypted database**: not in code, comments, examples, demo data, commit messages, docs or screenshots. Examples stay generic (Sample Home, Anna/Marco, `VWCE.DE`).
- **Keep the temporary import code** (`X-HomeCoin-Token`, Settings → Security): the user explicitly wants it. It must never reach `/api/auth/*`, `/api/backup`, `/api/restore` or `/api/export/*`.
- **The only network call** is the optional price update to Yahoo Finance, which sends tickers only. No CDN, no telemetry, no other online service.
- Do not commit or push without the maintainer's confirmation.

## Commands (Windows, PowerShell)

Python is not on PATH: always use the project environment.

```powershell
.\setup.ps1                                   # creates .venv and installs requirements.txt (Python 3.12/3.13)
.\HomeCoin.cmd                                # real instance → http://127.0.0.1:8765 (options: --port N, --no-browser)
.\HomeCoin-Demo.cmd                           # demo on 8766, sample data recreated at every start in demo-data\
.venv\Scripts\python.exe demo.py --port 8799 --no-browser   # demo for browser tests
```

- After changing Python code, **restart the server** (stop the process listening on the port, start `HomeCoin.cmd --no-browser` again). Static files only need a page reload. A restart locks HomeCoin and revokes the import code.
- Set `PYTHONIOENCODING=utf-8` when launching from tools (emoji in console output).
- In the browser use `http://127.0.0.1:<port>`, not `localhost` (Host check). A demo login takes ~2 s (scrypt).
- There is **no automated test suite** in the repository. Test with the Flask test client on a throwaway data folder:
  ```python
  os.environ["HOMECOIN_DATA_DIR"] = tmp   # BEFORE importing homecoin: db reads it at import time
  from homecoin.app import create_app
  app = create_app(8765); app.config["SERVER_NAME"] = "127.0.0.1:8765"
  # write requests need headers {"X-HomeCoin": "1", "X-Portfolio": "<space id>"} and a local Origin
  ```
  or in the browser against the demo, checking the console for errors.
- git is the one bundled with GitHub Desktop (`%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`).

## Architecture

```
run.py            waitress server on 127.0.0.1 (6 threads), opens the browser; starts LOCKED
demo.py           sets HOMECOIN_DATA_DIR=demo-data + HOMECOIN_DEMO=1, rebuilds sample data, then run.main()
homecoin/
  app.py          create_app(port): security guard, all /api/* routes, VERSION, input helpers (as_int, as_text, tx_date…)
  db.py           SQLCipher connection, SCHEMA + SCHEMA_VERSION (14) + idempotent migrate(), default categories, backups
  security.py     Vault: keystore (DEK wrapped by password and recovery key, scrypt N=2^17, AES-GCM), sessions,
                  auto-lock, failed-attempt delay (persisted), import token, data-folder ACL check/restrict
  services.py     account balances, recurring processing (lock + duplicate-date guard), investment-plan buys, Categorizer
  forecast.py     variable/expected recurring items (median of last 6), regular flows, payee_key
  split.py        fair split (equal savings rate), contributions incl. cross-space transfers
  tools.py        mortgage/amortization, emergency fund, goals, investments (positions, average cost, XIRR), Yahoo prices,
                  savings/net worth
  importer.py     CSV/TXT/XLSX statement parsing and column detection (Italian and English header aliases)
  audit.py        activity log (12 months retention)
  util.py         money/number parsing, dates, shared constants (TECH_CATEGORIES, BALANCE_ADJUSTMENT…), STOPWORDS
  demo.py         sample data (two spaces, 18 months)
static/           index.html, js/app.js (whole SPA, hash routes), js/theme.js, css/app.css, img/logo.svg, vendor/chart.umd.min.js
icon/             app icons generated from static/img/logo.svg
docs/images/      README screenshots (from the demo)
```

Key concepts:
- **Spaces** (`portfolios`, internal name; UI "space"): type `family` (Household) or `personal`. The client sends the active space in the `X-Portfolio` header (`?pf=` for export links); server helpers `pf()`, `PF_ACCOUNTS`, `own_account`, `visible_tx`. Transfers to accounts of other spaces are visible in both, are not income/expense, and count in net worth.
- **Optional tabs** per space: `portfolios.features` (JSON). Core tabs are fixed; `OPTIONAL_FEATURES` = budget, obiettivi, emergenza, calendario, mutuo, ripartizione, investimenti, risparmio; hiding a tab never deletes data.
- **Amounts are integer cents** everywhere in the API and DB.
- **Number input**: one parser everywhere (`util.parse_number` server side, `normNum`/`parseMoney`/`parseSignedMoney`/`parseQty` in app.js). For money "1.500" = 1500; for quantities and prices "9.014" = 9.014. Display uses the European format (`it-IT`, "1.234,56 €") even though the UI is English.
- **Monthly balance** (`tools.savings`): saved = month surplus (income − spent − other spaces), never the change in cash; "invested" = buys − sells of non-money-market securities, shown separately; money-market ETFs (`asset_class` `monetario`) count as cash.
- **Investment plans**: a recurring transfer with `holding_id` buys units automatically at an estimated price (`external_id` `pac:<rid>:<date>`, note "estimated price"); editing the trade marks it "verified price"; unverified after 30 days → reminder.
- **Security guard**: Host check (DNS rebinding), `Sec-Fetch-Site: cross-site` rejected, writes need `X-HomeCoin: 1` + local Origin (CSRF), strict CSP, Permissions-Policy, no server signature, session cookie `hc_session_{port}` (`hc_session_demo_{port}` in demo), all `/api/*` except `/api/auth/*` return 401 while locked.
- **Database**: encrypted at rest, temp store in memory, `secure_delete`; automatic encrypted backup at the first unlock of every start (last 15); restore runs `migrate()`.

## Conventions

- **Language**: everything user-visible, code comments and docs in **US English** (sentence case labels). Exceptions on purpose:
  - internal codes stay Italian because they are stored in existing databases: route keys (`#/movimenti`), feature keys, account type codes (`corrente`, `investimenti`…), asset classes (`azioni`, `monetario`, `liquidità`, `non specificato`…), categorizer sources `'regola'`/`'storico'`;
  - legacy Italian category names with a role in calculations must keep working next to the English ones (`Rettifica saldo`, `Altri investimenti (esclusi)`, `Versamenti conto casa`, `Versament%`, `prezzo stimato`): never rename user data, accept both spellings.
- **Versioning**: one numbering, same locally and on GitHub (SemVer from 1.0.0). A release updates `VERSION` in `homecoin/app.py`, `CHANGELOG.md` (newest first), the README badge and footer, and `SECURITY.md` if the supported line changes. The schema has its own `SCHEMA_VERSION`; add migrations to `db.migrate()` idempotently.
- **Style**: plain Python with small helpers, no framework beyond Flask; vanilla JS, no build step, no npm (Node is not installed). Match the existing compact style and comment density.
- **Guards over trust**: validate inputs server side (plausible dates 1990..today+366, integer bounds, unique names case-insensitive), block destructive changes that would corrupt data (selling units not owned, deleting accounts/holdings with trades, type changes with impact) and warn in the UI where a block is too strong.
- **Suggestions from history** exist where they help (transaction description/account/amount/category, recurring item name, rule keywords); deliberately **not** on notes (free text) or the Transactions search.
- **Logo**: edit `static/img/logo.svg`; the icons in `icon/` are regenerated from it with a maintainer script kept outside the repository.

## Decisions already taken (do not reopen without asking)

- Price source stays **Yahoo Finance**; Investing.com was rejected (no API, scraping forbidden by its terms). Codes not quoted as-is (Morningstar `0P…`, ISIN) are resolved to the full Yahoo symbol (e.g. `.F`).
- Mortgage: fixed / variable / mixed rate (index + spread); APR and ancillary costs are deliberately out of scope.
- Variable recurring items record nothing on their own: they link the real transaction (keyword + plausible amount) and forecast from the median of the last 6.
- Calendar: "cash in accounts" (operating accounts only) is distinct from the emergency fund "available reserve" (accounts + uninvested broker cash + money-market ETFs).
- Estimated regular income/expenses only for significant amounts (≥ 50 € and ≥ 5% of the largest).
- CSV/Excel exports are unencrypted by choice, with a warning and formula-injection protection.
- Few, broad categories; rules only for frequent payees.

## Known gaps

- No automated tests in the repo: the maintainer keeps a regression + fuzz suite outside it (made-up data only); last full run on 1.0.1.
- `util.STOPWORDS` contains Italian bank words only (adding English ones would change payee keys of existing data).
- Activity-log rows written before the translation stay in Italian; old investment-plan notes may read half Italian, half English.
- Windows only (launchers, data-folder ACL); the Python code is untested elsewhere.
