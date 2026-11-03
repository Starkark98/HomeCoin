# Changelog

All notable changes to HomeCoin are listed here, newest first.

## 1.2.2 — 2026-11-03

**Calculators warn when the result could mislead**
- Rebalancing: securities without a price (not counted), negative broker cash, prices estimated from the last trade or more than 7 days old, a pension-fund-style valuation older than 3 months, targets that do not add up to 100% (with how much to add or remove), new money not enough to reach every target, amounts on accounts valued as a whole (nothing to buy or sell there), targets of rows left out, sales with taxes and fees not included, no drift threshold.
- Goals: target date already passed, the same account used by several goals (progress counted twice), linked account below zero.
- Emergency fund: fewer than 6 months of expenses recorded (the average is too low), no expenses, negative reserve.
- Early repayment simulation: installment already paid (what-if on the past), loan already repaid, rate not specified (0%), an amount larger than the residual debt (and how much is enough).

**Interface**
- The **⋯** menu is tidier: aligned icons, Settings next to the theme switch (which now says what it will do: *Dark theme* or *Light theme*), Help and Support marked as external links, *Close HomeCoin* apart at the bottom; Esc closes it.

**Documentation**
- The README is now a complete user guide (opened by *Help* in the app): install, first start, every page step by step, your data, updates, privacy, common questions. Plain words, with the correct technical terms next to them.

**API**
- Creating a trade returns its id, like the other creations.

## 1.2.1 — 2026-11-02

**Updates from HomeCoin**
- Settings → **Updates**: checks GitHub for a new published release (automatically once a day after sign-in, can be turned off, or with *Check now*) and installs it with one click. The installed version runs the new installer silently and reopens; the ZIP version replaces its program files in place (keeping a copy of the old ones, installing new libraries from `requirements.lock` first) and restarts.
- Every release is signed by the maintainer (Ed25519 manifest with the size and SHA-256 of each file): HomeCoin refuses unsigned or altered releases, older versions and downloads from anywhere but GitHub, and saves an encrypted database backup before installing. The data folder is never part of an update; a development copy (git) never updates itself.
- A new version shows a small label at the top and a dot on Settings, nothing more.

**Cleaner interface**
- The menu is grouped: Everyday, Planning, Wealth, Tools. Group titles hide themselves when a space has none of their tabs.
- The top bar keeps only what you use every day (hide amounts, lock, new transaction); theme, help, support and *Close HomeCoin* are in the **⋯** menu.
- Settings in five tabs: General, Spaces, Security, Backup & data, Updates. The import code moved to Security → Advanced.
- Better layout on narrow screens (settings rows and top bar wrap).

**Demo**
- Much richer sample data, so every feature can be seen at work: cash and an archived account, a fixed-rate car loan next to the mixed-rate mortgage, a variable bill linked by keyword, categorization rules and transactions still to categorize, an excluded transaction, notes, budgets in both spaces, four goals, a credit card paid off monthly, a money market fund, gold, a partial sale with realized gain, coupons, interest and fees, a pension fund valued from statements, a saved rebalancing target, an activity log and the backup reminder.
- Import → **Try it with a sample bank statement** loads a made-up statement (some rows already present, to see duplicate detection).

**Fixes**
- Sign-in, password changes and other operations could rarely fail with an error on Windows when the key file was being read at the same moment (`keystore.json` cannot be replaced while open). Reads and writes of the key file are now serialized and briefly retried.

## 1.2.0 — 2026-11-02

**Installer**
- `HomeCoin-Setup-<version>.exe`: per-user installation without administrator rights, with its own private copy of Python 3.14 (official build, signed by the Python Software Foundation) and the libraries already included, so nothing else needs to be installed. Start menu shortcut, optional desktop shortcut and optional start with Windows (locked, no browser). Updating = running the new installer; uninstalling keeps the data. The demo with made-up data is included without a shortcut (for testing: see README → Demo version).
- **❔ Help** and **☕ Donate** at the top right open the documentation on GitHub and the Ko-fi page in a new browser tab (only when clicked; no referrer is sent).
- HomeCoin runs in the background without a console window; **⏻ Close HomeCoin** (top right and in Settings) locks and stops it, and clicking the shortcut again just opens the page if it is already running.

**Rebalancing**
- Asset classes or single securities can be left out of the calculation (for example a long-term holding or the broker's cash): they stay listed as "not counted", with their value, and their targets are ignored. A security left out "by security" is also left out of its class.
- A drift threshold of 0 means "not used", like an empty field.

**First start**
- A guided first start: password, recovery key (with confirmation that you saved it), currency, first space (household or personal, with its default categories and tabs), main account and its balance.

**Data folder**
- The data moves to `%LOCALAPPDATA%\HomeCoin\data`: per user, outside the program folder (updating or deleting the program never touches it) and outside Documents (often synced to OneDrive). It is moved automatically once, on the first start: every file is checked against the original (size and SHA-256) before switching, the old folder is kept as `data.migrated-<date>` until you delete it, and if anything goes wrong HomeCoin does not start and nothing changes.
- Settings shows the data folder, any old copy left to delete, and when you last downloaded an encrypted backup (reminder after 30 days).

**Installation**
- Dependencies are installed at exact versions, each checked against its SHA-256 (`requirements.lock`, `pip install --require-hashes`, ready-made packages only, for Python 3.12, 3.13 and 3.14), and checked with `pip-audit`.
- `setup.ps1` refuses the Microsoft Store Python, which would hide the data folder inside its own package.

## 1.1.0 — 2026-11-02

**Reference currency**
- Euro or US dollar for the whole installation (Settings → Appearance). It is a label: amounts are never converted, so choose the currency your accounts are kept in. A warning explains this before the change.
- The number format follows the currency: `1.234,56 €` or `$1,234.56`, also when typing amounts, in exports to Excel and in the activity log.
- Security prices are converted into the reference currency; prices downloaded before a change are cleared, to be updated again.
- Bank statement import also recognizes amounts written with `$` or `USD`.

**Mortgages and loans**
- Variable and mixed-rate loans can use European indexes (Euribor 1M, 3M, 6M, 12M) or United States ones (SOFR 30-day average, Term SOFR 1M, 3M, 6M, 1-year Treasury CMT, Prime Rate). The default follows the reference currency; a "mixed" rate also covers hybrid ARMs (e.g. 5/1). As before, the current index value is entered by hand.

**Rebalancing calculator** (Investments)
- 🧭 Target allocation per asset class (with the broker's uninvested cash) or per security, choosing which investment accounts to count.
- Drift from the target in percentage points, with a threshold in points and/or relative to the target; rows out of the threshold are highlighted.
- What to do: invest only new money in the items below target, or buy and sell to get exactly back to the targets; amounts split among the securities already owned, with the approximate number of units.
- "Use current weights" to start from today's allocation; settings saved per space. It is a calculator: no trade is recorded.

## 1.0.1 — 2026-11-02

Bug fixes found by automated testing. No change to the database or to how existing data is counted.

**Import**
- CSV files with old Mac line endings (carriage return only) or a line break inside a cell can be imported instead of failing with a server error.
- Absurd amounts in a bank statement (e.g. `9e999999` as text or a huge number in an Excel cell) are reported as invalid rows instead of stopping the analysis.
- Bundle import: a transaction can no longer get a category of the opposite type (an expense with an income category); trade amounts and fees follow the same limits as everywhere else.

**Investments**
- Trades: quantity × price is checked against the usual amount limit, so huge values are rejected with a clear message instead of a server error or an out-of-range amount.
- A trade that refers to a nonexistent security is rejected even when the security id is 0.
- Quantities given as `NaN` or `Infinity` are rejected.

**Robustness**
- Malformed requests (wrong value types, an invalid space header, an invalid report year) get a clear error message instead of a server error.

## 1.0.0 — 2026-10-29

First public release.

**Spaces and accounts**
- Several separate spaces in one HomeCoin (household, personal, business), each with its own accounts, categories, rules and reports; transfers between spaces count in net worth, not as income or expenses.
- Optional tabs per space: Dashboard, Transactions, Accounts, Recurring, Import, Categories, Reports, Activity log and Settings are always present; Budgets, Goals, Emergency fund, Calendar, Mortgage, Fair split, Investments and Savings can be turned on or off. Hiding a tab never deletes its data.
- Current and savings accounts, cards, cash and investment accounts, with warnings when changing an account type would change how its data is counted.

**Transactions and automation**
- Expenses, income and transfers with filters, search, bulk edit, duplicate, exclusion from reports and CSV/Excel export.
- Recurring items recorded automatically when due: mortgage and loan installments (progress, remaining, interest), subscriptions, scheduled transfers and investment plans that buy units automatically; variable recurring items (e.g. a salary) that link the real transaction and forecast its amount and day.
- Import of CSV, TXT and Excel bank statements with column detection, automatic categorization and duplicate detection.
- Suggestions from history: previously used descriptions offered under the field with the usual account, destination, amount and category; names for new recurring items from past transactions; keyword rules and suggested new rules.

**Analysis and tools**
- Dashboard with net worth, income, expenses, savings and charts; reports by category and month with heatmap and Excel export; drill-down from every chart to the transactions.
- Calendar of upcoming payments with confirmed and estimated amounts and projected cash; monthly budgets per category; goals; emergency fund with the months of expenses covered.
- Mortgage with fixed, variable or mixed rate, amortization schedule and early-repayment simulation.
- Fair split of shared expenses: how much each person should contribute so that everyone saves the same share of their income, compared with actual contributions, with update of the recurring items.
- Investments: trades with average cost, realized/unrealized gains, return and XIRR, allocation, prices from Yahoo Finance (only tickers are sent); savings rate and net worth.

**Security and privacy**
- Encrypted database and backups (SQLCipher 4, AES-256) with password and recovery key (scrypt), auto-lock and a growing delay after wrong passwords.
- Server bound to `127.0.0.1` with protection against cross-site requests, CSRF and DNS rebinding; strict Content-Security-Policy; no external resources.
- Security check in Settings (database, data folder restricted to your user, keys, auto-lock); activity log of important events for 12 months; temporary import code with reduced permissions.
- Demo version with made-up data (`HomeCoin-Demo.cmd`), separate from the real data.
