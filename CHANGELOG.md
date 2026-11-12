# Changelog

All notable changes to HomeCoin are listed here, newest first.

## 2.4.0 — 2026-11-12

- **Variable recurring items keep their expected date**: while waiting for a payment that has not arrived yet, the card showed today as its date, so it moved one day forward every day; now it shows the expected date (and "expected since" after a week). New **＋ Record the one that arrived** on the card: a new transaction already filled in like the item, to correct with the real amount and date; it is linked to the item.
- **Investments: the opening balance counts as money put in.** Money already in an investment account when it was added (for example a pension fund with years of history) was counted as gain, so gain, return and XIRR came out far too high; now it counts as a contribution made when the account starts.
- **Tidier screens:** compact recurring cards (monthly amount, dates and payments recorded on one line, smaller buttons); full category names in the chart legends of Dashboard and Reports; the current month in Savings is marked *in progress* instead of showing a loss before the salary arrives; shorter Emergency fund subtitle; the date column of Transactions is no longer cut; *Use the average* is offered in Budgets only when there is an average.
- **Reports moved to Everyday** in the menu (after Calendar), next to the pages about where the money goes; the guide follows the new order.
- Two texts in Settings (shortcuts, full backup) are now whole sentences in every language.
- Demo: sample descriptions now match their categories.

## 2.3.0 — 2026-11-11

- **Turn expenses into transfers to another space** (category window → *Turn into transfers…*): money moved to another space but recorded as expenses becomes transfers, visible in both spaces. You tick the accounts the money reaches (one or more): each expense goes to the account where its money really arrived, found from the records of that space. An expense received in two accounts is split into two transfers. The rest goes to a default account or stays an expense, and every row's account can be changed. A preview comes first, row by row, with the effect on spending, savings and balances of both spaces. Money already recorded is never counted twice: similar amount and close date (adjustable, by default 2% and 5 days, up to 100% of the smaller amount and 31 days; a pairing whose amounts differ by more than 2% is only proposed, in red, until you tick it), with the best overall pairing, so repeated similar amounts are paired correctly, and any pairing can be unticked. The same income in the destination account is replaced, and an expense already recorded as a transfer to that account is deleted as a duplicate. Recurring items are never changed by themselves: the category's recurring expenses become recurring transfers only if you tick them, each to the account of its matching recurring income (or split in two), with warnings for the same money already planned elsewhere. A similar income in another account of that space is flagged, and a backup is saved before the change.
- **Recurring transfers between spaces, one item in both**: when a recurring item is a transfer, *Where does the money go?* lets you choose another space. Such a recurring transfer is shown in the receiving space too, read-only (it is changed only where it was created). **Reconcile** (button on the item, and proposed when you save one) finds the same money recorded in other ways and proposes, line by line, what to fix: link the transfers already recorded, turn the expenses of those due dates into the transfer (including the past payments of a recurring expense changed into a transfer), delete incomes that record the same money twice, and remove other recurring items for the same money. An income with no matching transfer stays, unless you tick it. A preview with the effect on both spaces comes first, and a backup is saved before the change.
- **Backups in your hands** (Settings → Backup & data): see and open the backup folder, or choose another one (a USB drive, a synced folder; if it cannot be reached HomeCoin falls back to the default one); backups at start and/or every day or week; how many to keep (3–200); before which operations; one by hand. **Compare and restore** each backup with the current data (transactions, recurring items, accounts, categories, rules): put back deleted rows and take changed ones back to how they were, one by one, or restore everything.
- **Money recorded twice in an account** (account card → ⋯): an income and a transfer for the same money, a generated transfer and the same one entered by hand, an import done twice; the most coherent record is kept. **Compare an account with an automatic backup** from the same menu.
- **Filters with several values** in Transactions: several accounts, types and categories at once.
- **Clearer summaries**: Accounts shows money available, investments, credit cards and net worth; Goals shows the total, what is set aside, the monthly amount needed and the goals reached; Recurring shows fixed expenses, income and transfers (the remaining debt stays in Mortgage and loans).
- **Tidier windows**: fields, menus and choice buttons stay within their box with long texts and long translations; menus inside lists show their whole text; the buttons at the bottom of a window wrap instead of leaving it; the conversion and reconciliation previews show one card per record (date, description, amount, then what happens) instead of a cramped table with its own scroll bar. The category filter lists were unreadable (the ticks took all the space): fixed. Summary boxes line up in equal columns; account cards keep their actions on one line; the transactions table always shows the amount; list titles wrap instead of being cut. Lighter pages: the long explanations of Calendar, Investments and Savings are behind *ℹ️ How it works*; every page starts with its summary boxes; the money-out box reads *Spending* and *To other spaces*.
- **Notes suggested from the description**: in a new transaction, the Notes field proposes the notes you wrote recently for the same or a similar description (most used and most recent first); pick one with a click or keep typing to filter them.

## 2.2.0 — 2026-11-10

**Two more languages and seventeen more currencies**, each written the way its country writes it, with its loan indexes:
- **繁體中文 (Traditional Chinese)** with the **New Taiwan dollar (TWD)** `$1,234.56`, also for Hong Kong; **한국어 (Korean)** with the **South Korean won (KRW)** `₩1,235`. Bank files from Taiwan (Big5) and Korea (EUC-KR) are read with the right characters; dates in their order (`2026年11月10日`, `2026. 11. 10.`);
- **Colombian peso (COP)** `$ 1.235` and **Chilean peso (CLP)** `$1.235`, without decimals (IBR, UVR, DTF; UF and TPM);
- **South African rand (ZAR)** `R 1 234,56` (prime lending rate, SARB repo rate, ZARONIA);
- **New Zealand dollar (NZD)** `$1,234.56` (official cash rate);
- **Singapore dollar (SGD)** `$1,234.56` (SORA), **Hong Kong dollar (HKD)** `HK$1,234.56` (HIBOR, prime rate);
- **Philippine peso (PHP)** `₱1,234.56` (BSP policy rate; bank statements with the month first, as in the US);
- **Indian rupee (INR)** `₹12,34,567.89`, grouped in lakh and crore (RBI repo rate, MCLR);
- **UAE dirham (AED)** `AED 1,234.56` (EIBOR) and **Malaysian ringgit (MYR)** `RM 1,234.56` (SBR, OPR);
- **Swedish krona (SEK)** and **Norwegian krone (NOK)** `1 234,56 kr`, **Danish krone (DKK)** `1.234,56 kr.` (STIBOR, SWESTR; NIBOR, NOWA; CIBOR, CITA);
- **Israeli new shekel (ILS)** `₪1,234.56` and **Czech koruna (CZK)** `1 234,56 Kč`.
For Singapore, Hong Kong, the Philippines, India, the Emirates, Malaysia, the Nordic countries, Israel and the Czech Republic the interface is in English; for Colombia and Chile in Spanish.

**Fixes**
- Ecuador, El Salvador and Panama use the US dollar: at the first start HomeCoin now proposes it instead of the Mexican peso.
- Fair split: a change made just before leaving the page is saved too.
- Regular payments: payees with two-character names in Chinese, Japanese or Korean (e.g. 월급, 薪資) are now grouped.
- Better wording in every language: the last sentences built from pieces around bold words are now whole sentences, and
  counts like "1 excluded" use the singular form where the language has one ("1 escluso", "1 sélectionnée").
- Mortgage: no error in the background when you leave the page while the early repayment simulation is about to run.

## 2.1.0 — 2026-11-10

**Three more languages, two more currencies**
- The interface now also speaks **Nederlands**, **Polski** and **日本語** (Japanese): nine languages in all. The language menu lists them in alphabetical order of their own names.
- New currencies: **Polish złoty (PLN)**, written `1 234,56 zł`, with WIBOR 3M/6M and POLSTR for loans; **Japanese yen (JPY)**, without decimals, with the short-term prime rate, TONA and TIBOR. HomeCoin proposes them at the first start in Poland and Japan.
- Dates follow the order of the language: `10 Nov 2026`, `2026年11月10日`.
- Polish uses its three plural forms (1 transakcja, 2 transakcje, 5 transakcji); Japanese has none.

**Better wording in every language**
- Sentences that were built from pieces (a number, then a word) are now whole sentences, so each language can use its own word order and the right plural: "1 transaction", "2 transactions" also in English, where some messages said "1 transactions".
- Fixed English words that were never translated: "Uncategorized" in reports and fair split, the title of the New category window, "currently" in recurring items, "excluded" in fair split, the counters of a bundle import, and a few others.

**Import**
- Bank files from Poland (Windows-1250) and Japan (Shift-JIS) are read with the right characters, and their column headers are recognized; Japanese dates `2026/12/31` and `2026年12月31日` too.
- Banks that write every amount as positive and the direction in another column (*Af/Bij* at ING Netherlands, *S/H* at many German banks) are imported with the right sign.
- Payers and payees in any alphabet are recognized when grouping regular payments (before, letters such as ł, ß or Japanese were ignored).

**Fixes**
- The fair split could fail to open after an invalid setting was saved.
- The demo could not start in a language whose bank statements write dates year first.

**Under the hood**
- Each language is a single file (`static/i18n/<language>.json`) with its translations and its data (plural rule, months, date order, default categories, bank-file headers and encodings). Each currency is one line of `util.CURRENCIES`, which the browser receives too. Adding a language or a currency no longer touches the code.

## 2.0.0 — 2026-11-09

**Six languages**
- The whole interface is now available in **English, Español, Português (Brasil), Deutsch, Français and Italiano**: menus, pages, messages, warnings, dates, the activity log, exports and the demo.
- Choose the language at the first start (it is proposed from your browser) or later in Settings → General. It is kept with the keys, so the sign-in screen uses it too.
- New spaces get their default categories in the chosen language. Changing language never renames the categories you already have.
- A new *Translation* issue template makes it easy to report a wrong or clumsy text.

**Currencies**
- New: **Mexican peso (MXN)** and **Brazilian real (BRL)**, with their number format and loan indexes (TIIE 28 and TIIE de Fondeo; TR, IPCA, Selic and CDI).
- At the first start HomeCoin proposes the currency of your country, from the browser and the chosen language.

**Import and export**
- Bank statements are recognized with column headers in all six languages, accents included.
- CSV and Excel exports use the interface language for headers and sheet names, and can be imported back in any language.

**Under the hood**
- Default and system categories now have a fixed code, so HomeCoin recognizes them in any language. Existing databases get the codes automatically, without renaming anything.
- Fix: the fair split found the household contributions category only by its English or Italian name.
- Investment plan notes, activity log details and the demo banner are translated too; the estimated-price reminder works whatever the language of the note.
- Security policy updated to the supported 2.0.x line.

## 1.4.0 — 2026-11-09

**US bank statements**
- Importing a statement with dates written month first (12/31/2026, as US banks do) no longer reads them the wrong way round: before, 03/04/2026 became April 3 and 12/31/2026 was refused. HomeCoin now reads the order from the dates in the file; when every date fits both orders it assumes the one of your currency's country and asks you to check it. A new *Date format* box in the columns step lets you change it.

**Constant-principal loans**
- New repayment method for loans: **constant principal** (Italian amortization, *SAC* in Brazil), next to the constant installment (French amortization). Every installment repays the same share of the debt plus the interest on the rest, so installments go down over time.
- HomeCoin records each installment with its own amount from the schedule; Recurring, Calendar, Mortgage and loans, the emergency fund and the early-repayment simulation all use it. Works with fixed, variable and mixed rates.
- The demo's car loan now uses constant principal.

**Documentation**
- User guide: the date format of imported statements, the two repayment methods, new screenshots.
- README: new "Why it exists" text.
- Automatic backups described exactly: one at every start, and before every import, restore and update.
- User guide checked against the app and made more precise: the Settings → General tab (About HomeCoin with the version), when automatic backups are made, what "cash" means in the Calendar, how variable recurring items are forecast, the auto-lock times, and two new answers in "Questions and problems" (which version you have, a page missing from the menu).
- Contributing guide, security policy and bug report template brought up to date: where to find the version (Settings → General → About HomeCoin), the demo for both the installed and the ZIP version, the signed update check from GitHub among the outbound calls, Python 3.14 in the dependency lock, and the rule to update the user guide with every change.

## 1.3.1 — 2026-11-03

**Smoother calculators**
- After a recalculation the cursor stays where you were: in the rebalancing calculator (and on pages that reload after a change, like the emergency fund target) moving to the next field with Tab or a click no longer loses the focus, the selection or what you were typing.

**Your space's color**
- The color of the active space now tints a few small accents: the highlighted page in the menu, the **＋ New transaction** button, the line under the selected tab and the space-switch message. Warnings, amounts, charts and confirmations keep the same colors in every space; very light colors get dark text to stay readable.

**Fixes**
- **Change password** never accepted the confirmation: the dialog read the "new password" field of the sign-in screen (same name, hidden in the page) instead of its own. The dialog now uses only its own fields, and the sign-in form is cleared as soon as HomeCoin is unlocked, so the password typed to sign in no longer stays in the page.
- **Security check → data folder**: on PCs where a company policy restricts PowerShell ("constrained language mode", common on work PCs) the check said "cannot be checked on this system" and *Restrict to my user* failed. Both now use the standard Windows tools `icacls` and `whoami`, which are not affected.

**Guide**
- `SECURITY.md`: supported version updated (1.3.x) and signed updates in the scope of reports.
- The user guide (README) follows the app menu: the basics, then Everyday, Planning, Wealth and Tools. Each page has its screenshot right in its section, all taken again from the current version, with four new ones (budgets, mortgage, rebalancing, settings).

## 1.3.0 — 2026-11-03

**Eight currencies**
- Besides the euro and the US dollar: **British pound, Japanese yen, Swiss franc, Canadian dollar, Australian dollar and Indian rupee**. Each is written the way its country writes it: £1,234.56 · ¥1,235 (no decimals) · CHF 1'234.56 · ₹1,23,456.78 (lakh and crore grouping). Amounts are still never converted; security prices are converted into the chosen currency.
- Mortgage and loan indexes per currency, and only those of your currency are offered: Bank of England Bank Rate and SONIA, Short-term prime rate, TIBOR and TONA, SARON, Canadian prime rate and CORRA, RBA cash rate and BBSW, RBI repo rate and MCLR. A loan keeps its index if you change currency.
- The currency picker (first start and Settings → General) is a list with the name and an example of the format.
- Typed and imported amounts understand the new symbols and codes (£, ¥, ￥, ₹, CHF, C$, A$, Rs.) and the Swiss and Indian separators; the activity log and the "hide amounts" eye follow the currency too.
- Exports follow the currency's country: in Excel the currency symbol and the date order (e.g. MM/DD/YYYY in the US, YYYY/MM/DD in Japan); in CSV comma decimals with ";" between columns for the euro, dot decimals with "," elsewhere, so the file opens correctly in a spreadsheet of that country.
- Fair split: rounding choices fit the currency (e.g. ¥100–¥5,000, ₹10–₹500).

**Updates**
- If a file is missing from a release on GitHub, Settings → Updates now says which one, instead of "No published release found".

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
