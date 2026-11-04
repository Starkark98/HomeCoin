# CLAUDE.md — HomeCoin

Guidance for Claude Code when working in this repository. Household finance app that runs locally on Windows: Python/Flask server on `127.0.0.1`, encrypted SQLCipher database, vanilla JS single-page UI. Current version: see `VERSION` in `homecoin/app.py` (1.3.1 at the time of writing).

## Hard rules

- **Never read, copy or print the real data.** The data folder (`%LOCALAPPDATA%\HomeCoin\data` from 1.2.0; `data/` in the program folder up to 1.1.0, renamed `data.migrated-*` after the move: database, `keystore.json`, `backups/`) belongs to the user. Never call `db.migrate_data_folder()` without explicit throwaway `src`/`dst` in tests. Test only with the demo (`demo-data/`) or a throwaway folder set through `HOMECOIN_DATA_DIR`, and delete it afterwards.
- **No personal or financial data anywhere outside the encrypted database**: not in code, comments, examples, demo data, commit messages, docs or screenshots. Examples stay generic (Sample Home, Anna/Marco, `VWCE.DE`).
- **Keep the temporary import code** (`X-HomeCoin-Token`, Settings → Security): the user explicitly wants it. It must never reach `/api/auth/*`, `/api/backup`, `/api/restore` or `/api/export/*`.
- **Only two network calls**, both optional: the price update to Yahoo Finance (tickers only) and the update check/download from GitHub releases (`updater.py`: HTTPS to GitHub hosts only, nothing about the user sent). No CDN, no telemetry, no other online service. Neither runs in the demo.
- **Updates are signed.** Never weaken `updater.py`: Ed25519 signature on the manifest with the embedded `PUBLIC_KEY`, newer version only, size + SHA-256 of every file, ZIP paths validated, git working trees never updated. The private key lives outside the repository (maintainer only); changing `PUBLIC_KEY` cuts off every installed copy.
- Do not commit or push without the maintainer's confirmation.
- **Honest attribution, everywhere:** every idea, feature, concept and design choice is the maintainer's (Starkark98); the code is written with the support of Claude Code. The project is free; its purpose is to help people take care of their money and build good habits (not charity). Never invent other purposes.
- **The README is the user guide** (the in-app *Help* opens it): plain English, step by step, and the correct technical term next to each plain explanation (e.g. "the annual return that accounts for when you added money: XIRR, a money-weighted return"). Accessible but professional. **Every change to the software updates the guide in the same change**: the feature's section, the screenshots when the UI changes (`dev\shots\capture.ps1` on the demo, maintainer side), the contents list. The guide follows the app menu: basics → Everyday → Planning → Wealth → Tools → Your data. It must always match the current software. The "Why it exists" text is the maintainer's own words: never rewrite it.

## Commands (Windows, PowerShell)

Python is not on PATH: always use the project environment.

```powershell
.\setup.ps1                                   # creates .venv, installs requirements.lock with --require-hashes (Python 3.12–3.14, not the Store one)
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
- Installer: built outside the repository by the maintainer (Inno Setup, per user, Python 3.14 embeddable + `requirements.lock`), program in `%LOCALAPPDATA%\Programs\HomeCoin`, shortcuts run `python\pythonw.exe run.py`. The code must keep working both from the ZIP (`.venv`, console) and installed (embedded Python, no console). First start: `LOCK_VIEWS.setup → recovery(key, first) → welcome` in app.js.
- git is the one bundled with GitHub Desktop (`%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`).

## Architecture

```
run.py            waitress server on 127.0.0.1 (6 threads), opens the browser; starts LOCKED; moves the data of
                  versions up to 1.1 once (db.migrate_data_folder); works without a console (pythonw: errors in a
                  message box); --background = no browser (start with Windows); POST /api/auth/quit stops it
                  (app.config["HC_EXIT"] replaces os._exit in tests)
demo.py           sets HOMECOIN_DATA_DIR=demo-data + HOMECOIN_DEMO=1, rebuilds sample data, then run.main()
homecoin/
  app.py          create_app(port): security guard, all /api/* routes, VERSION, input helpers (as_int, as_text, tx_date…)
  db.py           data folder (default_data_dir, migrate_data_folder: one-time verified move from the program folder),
                  SQLCipher connection, SCHEMA + SCHEMA_VERSION (14) + idempotent migrate(), default categories, backups
  security.py     Vault: keystore (DEK wrapped by password and recovery key, scrypt N=2^17, AES-GCM), sessions,
                  auto-lock, failed-attempt delay (persisted), import token, data-folder ACL check/restrict
  services.py     account balances, recurring processing (lock + duplicate-date guard), investment-plan buys, Categorizer
  forecast.py     variable/expected recurring items (median of last 6), regular flows, payee_key
  split.py        fair split (equal savings rate), contributions incl. cross-space transfers
  tools.py        mortgage/amortization, emergency fund, goals, investments (positions, average cost, XIRR), Yahoo prices,
                  savings/net worth
  importer.py     CSV/TXT/XLSX statement parsing and column detection (Italian and English header aliases)
  audit.py        activity log (12 months retention)
  updater.py      signed updates from GitHub releases: check (latest release, signed manifest), download (size + SHA-256),
                  apply (installer: silent /HCUPDATE=1 run that reopens HomeCoin; ZIP: in-place copy with rollback and
                  pip --require-hashes when requirements.lock changes); install_kind() = installer | zip | dev | unknown
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
- **Reference currency** (1.1.0; eight since 1.3): one per installation, `EUR USD GBP JPY CHF CAD AUD INR`, setting `currency` (global, no `@space`), `util.CURRENCIES` (namedtuple: symbol, locale, decimal, thousands, digits, prefix, space, name) mirrored by `CURRENCIES` in app.js, `util.currency_of`, `PUT /api/settings/currency` (needs `confirm: true`). It is a **label: amounts are never converted** (still integer cents, also for the yen, which is shown with 0 decimals). Each currency uses its country's format (CHF `'` thousands as Chrome/Edge write it, INR lakh grouping, JPY via `en-JP` for the plain ¥). Market prices are converted into it (`{base}{cur}=X`, London pence handled); `price_eur` keeps its historical name but holds the price in the reference currency, and a change clears it and `price_history`. UI: `setCurrency()` sets `CUR`, `CUR_SYM`, `LOCALE`, `DEC`, `DIGITS`, `SYM_FIRST` and the formatters; **never test a currency code for formatting** (use `DEC`, `DIGITS`, `money`, `money0`, `moneyK`, `moneyInput`, `moneyPlaceholder`, `num`, `CUR_SYM`). Server texts use `util.fmt_money`/`fmt_decimal` (half away from zero, like Intl). Loan indexes: `tools.RATE_INDEX_GROUPS` keyed by currency (first = default), UI offers only the current currency's plus a loan's saved index; any index stays valid server side.
- **Number input**: one parser everywhere (`util.parse_number` server side, `normNum`/`parseMoney`/`parseSignedMoney`/`parseQty` in app.js). For money "1.500" = 1500 in euro (in dollars the dot is always the decimal separator); for quantities and prices "9.014" = 9.014. Display follows the reference currency.
- **Rebalancing** (1.1.0): `tools.rebalance` + `GET/POST /api/investments/rebalance` (POST calculates, `save: true` stores the settings in `rebalance@<space>`). Mode `class` (asset classes + `liquidità` = broker cash, `non specificato` = accounts valued as a whole) or `security` (`h:<holding id>`, `cash`, `acc:<account id>`); values are the same as the Allocation chart; buys only (new money to the gaps) or buys and sells (exactly to target); `excluded {class: [...], security: [...]}` leaves rows out (a security excluded in `security` also leaves its class); a threshold of 0 = not used. It never records trades.
- **Monthly balance** (`tools.savings`): saved = month surplus (income − spent − other spaces), never the change in cash; "invested" = buys − sells of non-money-market securities, shown separately; money-market ETFs (`asset_class` `monetario`) count as cash.
- **Investment plans**: a recurring transfer with `holding_id` buys units automatically at an estimated price (`external_id` `pac:<rid>:<date>`, note "estimated price"); editing the trade marks it "verified price"; unverified after 30 days → reminder.
- **Security guard**: Host check (DNS rebinding), `Sec-Fetch-Site: cross-site` rejected, writes need `X-HomeCoin: 1` + local Origin (CSRF), strict CSP, Permissions-Policy, no server signature, session cookie `hc_session_{port}` (`hc_session_demo_{port}` in demo), all `/api/*` except `/api/auth/*` return 401 while locked.
- **Database**: encrypted at rest, temp store in memory, `secure_delete`; automatic encrypted backup at the first unlock of every start (last 15); restore runs `migrate()`. `keystore.json` is read and written only through `security.read_keystore`/`write_keystore` (one lock + cache: on Windows `os.replace` fails while another thread has the file open).
- **Updates** (1.2.1): `GET /api/update` (`?check=1` now, `?auto=1` at most every 20 h if `update_auto`), `PUT /api/update/settings`, `POST /api/update/apply` (session only: `/api/update*` is closed to the import code; backup `*-update.db` first; then exit via `HC_EXIT`, restart via `HC_RESTART` in tests). Settings keys `update_auto`, `update_checked`, `update_info` (global). UI: `loadUpdate()`, chip `#update-chip`, dot `#nav-update-dot`, Settings → Updates tab.
- **UI layout** (1.2.1): sidebar groups Everyday / Planning / Wealth / Tools (`.nav-group`, hidden when empty); rare actions in the top-right **⋯** menu; Settings tabs `SETTINGS_TABS` (`#/impostazioni?tab=general|spaces|security|data|updates`). New settings go in the tab where a user would look for them; keep the top bar for daily actions only.
- **Space color** (1.3.1): `applySpaceColor()` sets `--space`/`--space-ink`/`--space-fill`; used only for small "where am I" accents (active menu item, `#quick-add`, selected `.seg` tab line, `.toast.space`). Semantic colors (warnings, income/expense, charts, confirm buttons) never follow the space.
- **Redraws keep the focus** (1.3.1): `snapFocus()`/`restoreFocus()` around `route()` and calculators that re-render their own inputs (rebalancing); give re-rendered inputs an id or `data-k` + class so they can be found again.
- **Calculator warnings** (1.2.2): tools return `warnings`/`notes` lists of `{level: 'warn'|'info', text}` for what can make a result misleading (missing or stale prices, data gaps, inputs that cannot be acted on); the UI shows them with `calcNotes()`. Hard errors stay 400s; a new calculator gets both.
- **Demo** (`homecoin/demo.py`): must keep showing every feature with made-up data; when a feature is added, add sample data for it. `GET /api/demo/statement.csv` (demo only) feeds Import → "Try it with a sample bank statement".

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
- Mortgage: fixed / variable / mixed rate (index + spread); indexes per reference currency, list in `tools.RATE_INDEX_GROUPS` and `RATE_INDEXES` in app.js, default by reference currency, current value typed by hand (no download); APR, ARM caps and ancillary costs are deliberately out of scope.
- Currencies (1.3): eight, chosen for the widest reach with few currencies; no CNY (Yahoo is blocked in mainland China and the UI is English). Number format = the currency's country, no separate format setting.
- Variable recurring items record nothing on their own: they link the real transaction (keyword + plausible amount) and forecast from the median of the last 6.
- Calendar: "cash in accounts" (operating accounts only) is distinct from the emergency fund "available reserve" (accounts + uninvested broker cash + money-market ETFs).
- Estimated regular income/expenses only for significant amounts (≥ 50 € and ≥ 5% of the largest).
- CSV/Excel exports are unencrypted by choice, with a warning and formula-injection protection.
- Few, broad categories; rules only for frequent payees.

## Known gaps

- No automated tests in the repo: the maintainer keeps a regression + fuzz suite outside it (made-up data only); last full run on 1.3.1.
- Automatic updates only work once the GitHub repository is public (the API returns 404 for a private one without a token) and for releases published with their signed manifest.
- `util.STOPWORDS` contains Italian bank words only (adding English ones would change payee keys of existing data).
- Activity-log rows written before the translation stay in Italian; old investment-plan notes may read half Italian, half English.
- Windows only (launchers, data-folder ACL); the Python code is untested elsewhere.
