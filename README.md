<p align="center"><img src="static/img/logo.svg" alt="HomeCoin logo" width="120"></p>

# HomeCoin *by Starkark98*

![Version](https://img.shields.io/badge/version-1.2.1-8b5cf6)
![Python](https://img.shields.io/badge/Python-3.12%20%7C%203.13%20%7C%203.14-3776AB?logo=python&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
![Data](https://img.shields.io/badge/data-encrypted%2C%20on%20your%20PC-16a34a)
![License](https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-d97706)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support%20the%20project-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/starkark98)

**Household finances on your own PC — encrypted, private, no cloud.**

Track expenses, income, accounts, recurring payments, budgets, a mortgage and investments, for the whole household and for yourself. HomeCoin runs as a small local web app on `127.0.0.1`: no account, no subscription, no external services. The database is **encrypted (AES-256)** and opens only with your password.

![HomeCoin dashboard](docs/images/01-dashboard.png)

> **Get it:** download **`HomeCoin-Setup-<version>.exe`** from **Releases** and run it — no administrator rights, nothing else to install. **Want to see it first?** The [demo version](#demo-version) opens HomeCoin with two sample spaces and 18 months of made-up data; your real data is never touched.

---

## Why it exists

Money is personal, and understanding your own shouldn't be a privilege.

There are plenty of banks, apps and advisors ready to tell you what to do with your money. Far fewer simply help you *see* it: where it goes, what you are really saving, how long the mortgage still has to run, whether the household split is fair, what your investments have actually returned. That clarity usually comes with a subscription, an account in someone else's cloud, or a vocabulary you have to learn first.

HomeCoin is my attempt to change that, one household at a time. It is free. It runs on your own PC, and your data stays there, encrypted. It speaks plainly: income, spending, savings, goals. The tools that usually sit behind a paywall or a financial advisor's desk are there for anyone: mortgage schedules, fair splits, rebalancing, XIRR.

No ads, no tracking, nobody selling your habits. Just your numbers, clear enough to decide for yourself.

**Financial power, free and in everyone's hands.** That's the whole idea.

---

## Contents

- [Why it exists](#why-it-exists)
- [Why HomeCoin](#why-homecoin)
- [Screenshots](#screenshots)
- [Features](#features)
- [Requirements](#requirements)
- [Install (recommended)](#install-recommended)
- [Quick start with the ZIP](#quick-start-with-the-zip)
- [Updates](#updates)
- [Demo version](#demo-version)
- [Security and privacy](#security-and-privacy)
- [Limitations](#limitations)
- [Getting help](#getting-help)
- [Support the project](#support-the-project)
- [Contributing](#contributing)
- [Project structure](#project-structure)
- [Maintainer](#maintainer)
- [Built with AI assistance](#built-with-ai-assistance)
- [Disclaimer](#disclaimer)
- [Trademarks](#trademarks)
- [License](#license)

---

## Why HomeCoin

- **Your data stays yours.** A local server, an encrypted database, encrypted backups. HomeCoin goes online only for two optional things: price updates (it sends nothing but the tickers to Yahoo Finance) and the update check (it asks GitHub for the latest version).
- **For the household and for you.** Separate *spaces* (household, personal, business…) with transfers between them, a fair split of shared expenses, a mortgage planner and shared goals.
- **Little manual work.** Bank statement import, recurring payments recorded automatically, categories and fields suggested from your history.
- **Clear at a glance.** Dashboard, reports, a calendar of upcoming payments with projected cash, light and dark theme.

## Screenshots

All taken from the demo version, with made-up data.

| | |
|---|---|
| ![Dashboard, dark theme](docs/images/02-dashboard-dark.png) | ![Transactions](docs/images/03-transactions.png) |
| **Dark theme** — follows your system, or choose it | **Transactions** — filters, search, bulk edit, export |
| ![New transaction with suggestions from history](docs/images/04-new-transaction.png) | ![Calendar](docs/images/05-calendar.png) |
| **New transaction** — account, amount and category suggested from history | **Calendar** — confirmed and estimated payments, projected cash |
| ![Fair split](docs/images/06-fair-split.png) | ![Reports](docs/images/07-reports.png) |
| **Fair split** — fair contributions between household members | **Reports** — categories by month, averages, Excel export |
| ![Investments](docs/images/08-investments.png) | |
| **Investments** — value, invested, return, allocation | |

## Features

| Area | What it does |
|---|---|
| **Spaces** | Several separate books in one HomeCoin (e.g. a *Family* household space, a *Personal* space, a business), each with its own accounts, categories, rules and reports; switcher at the top left; transfers to accounts of other spaces count in net worth, not as income or expenses |
| **Dashboard** | Net worth, income, expenses (with contributions to other spaces shown separately), savings, charts by category, month and balance, budgets, upcoming payments |
| **Transactions** | Expenses, income and transfers; filters, search, bulk edit, duplicate, CSV/Excel export; 👁 excludes an item from reports and totals (it stays in the balance) |
| **Smart fill** | Category suggested by keyword rules and by history; previously used descriptions offered under the field (one per payee) with the usual account, destination and last amount; new recurring items named after past transactions; keywords suggested for new rules |
| **Accounts** | Current and savings accounts, cards, cash and investment accounts; balances, transfers, archiving; warnings when changing an account type would change how its data is counted |
| **Recurring** | Mortgages and loans in installments (progress, remaining, interest), subscriptions, scheduled transfers and investment plans (each payment buys units automatically) — recorded automatically when due; *variable* recurring items (e.g. a salary that changes slightly every month) link the real transaction and forecast amount and day from recent months |
| **Import** | CSV, TXT and XLSX bank statements: column detection, separate debit/credit or signed amount, automatic categorization, duplicate detection (including installments generated by recurring items) |
| **Reports** | Same periods as the dashboard (month, 3/6/12 months, year, all); category × month heatmap, stacked chart with average and interactive legend, Excel export |
| **Budgets** | Monthly budget per category, editable inline, spent, 3-month average, overspending alerts |
| **Calendar** | Upcoming payments for the next 1–12 months (including transfers coming from other spaces) on a monthly grid, with confirmed and estimated amounts, projected cash and the lowest point of the period |
| **Mortgage & loans** | Fixed, variable or mixed rate (e.g. 3% fixed for 5 years, then Euribor 3M + spread, or a 5/1 ARM on SOFR or the 1-year Treasury), European or US indexes, amortization schedule with payment recalculation when the rate changes, interest paid and remaining, early-repayment simulation (APR and ancillary costs excluded) |
| **Fair split** | (household spaces) How much each person should contribute so that everyone saves the same share of their income; based on actual expenses, actual contributions or amounts entered by hand; categories proportional, split equally or excluded; rounding, minimum, safety margin; comparison with actual contributions and update of the recurring items |
| **Goals & emergency fund** | Savings goals with the monthly amount needed (and each person's share in a household); emergency fund with the months of expenses covered by the available reserve |
| **Investments & savings** | Trades with average cost and realized/unrealized gains; value, invested, gain, return %, XIRR, allocation; prices from Yahoo Finance (the only online feature, sends only tickers); **rebalancing calculator** (target allocation per asset class or per security, accounts, classes and securities to count, drift threshold in points and/or relative to the target, new money only or buys and sells); savings rate and net worth |
| **Drill-down** | Click categories, cells, bars and items → Transactions already filtered |
| **Categories** | Colors and icons, monthly budgets, automatic rules |
| **Activity log** | Important events of the last 12 months, filterable: sign-ins (including failed attempts), security, changes, deletions, imports and exports; no noise |
| **Optional tabs** | Always present: Dashboard, Transactions, Accounts, Recurring, Import, Categories, Reports, Activity log, Settings. Per space you turn on the others: Budgets, Goals, Emergency fund, Calendar, Mortgage, Fair split, Investments, Savings. Hiding a tab never deletes its data |
| **Settings** | Five tabs: *General* (theme, reference currency € or $, help), *Spaces*, *Security* (security check, password, recovery key, auto-lock), *Backup & data* (encrypted backup and restore, export, data folder) and *Updates* |
| **Updates** | Settings → Updates checks GitHub for a new release (automatically once a day, or on demand) and installs it with one click, after verifying the maintainer's signature and every file's SHA-256 — see [Updates](#updates) |

The menu groups the tabs by what you do with them: **Everyday** (transactions, accounts, recurring, calendar), **Planning** (budgets, goals, emergency fund, mortgage, fair split), **Wealth** (investments, savings, reports) and **Tools** (import, categories, activity log, settings). Less frequent actions (theme, help, support, close) are in the **⋯** menu at the top right.

The interface is in English. The **reference currency** is euro or US dollar (Settings), for the whole installation: it is a label, amounts are never converted, so choose the currency your accounts are kept in. The number format follows it: in euro `1.234,56 €`, which is also how you type them (`1.500` = 1,500 €, `1.234,56`, `1234.56`); in dollars `$1,234.56` (`1,500` = $1,500, `1.5` = $1.50).

Version history is in [CHANGELOG.md](CHANGELOG.md).

## Requirements

- Windows 10 or 11 (64-bit)
- A modern browser (Edge, Chrome, Firefox)
- Only for the ZIP version: Python **3.12**, **3.13** or **3.14** from python.org (for example `winget install Python.Python.3.12 --scope user`; the Microsoft Store version is not supported). The installer brings its own Python.

## Install (recommended)

1. Download **`HomeCoin-Setup-<version>.exe`** from the latest release and run it. No administrator rights are needed: HomeCoin is installed for your Windows user only, in `%LOCALAPPDATA%\Programs\HomeCoin`, with its own private copy of Python. Windows may warn that the file comes from an unknown publisher (the installer is not code-signed yet): check the SHA-256 published with the release, then choose *More info → Run anyway*.
2. Choose whether you want a desktop shortcut and whether HomeCoin should start with Windows (locked, without opening the browser).
3. HomeCoin opens in the browser and guides you through the first start: your **password**, the **recovery key** (keep it safe: without the password and the recovery key the data cannot be recovered by anyone), the **currency** and your first space and account.
4. HomeCoin runs in the background, without a window. Open it from the Start menu or the desktop shortcut; close it from the **⋯** menu at the top right (*Close HomeCoin*), where you also find this documentation (*Help*) and the Ko-fi page to support the project.

To update, use Settings → Updates (see [Updates](#updates)) or run the new installer: your data is never touched. Uninstalling removes the program and keeps the data (it tells you where it is). Already using the ZIP version? Download an encrypted backup there (Settings → Backup), install, and restore it in Settings → Restore with the password it was made with.

## Quick start with the ZIP

1. Download the ZIP of the latest release (or clone the repository) and extract it into a folder of yours, for example `C:\Tools\HomeCoin`.
2. Run **`setup.ps1`** once (right-click → *Run with PowerShell*): it creates the local Python environment `.venv` and installs the dependencies, at the exact versions of `requirements.lock`, each checked against its SHA-256.
3. Double-click **`HomeCoin.cmd`**: the browser opens `http://127.0.0.1:8765`.
4. On first start you create your password and receive a **recovery key**. Keep it somewhere safe: without the password and the recovery key the data cannot be recovered by anyone.
5. To stop HomeCoin, close the terminal window (or use 🔒 to lock it without closing).

After an update, run `setup.ps1` again for any new dependency.

**Where your data is.** In `%LOCALAPPDATA%\HomeCoin\data` (for example `C:\Users\you\AppData\Local\HomeCoin\data`), shown in Settings: outside the program folder, so updating or deleting the program never touches it, and outside Documents, which is often synced to OneDrive. It is not a temporary folder, and only your Windows user (plus SYSTEM and administrators) can open it. Up to version 1.1 the data was in the `data` folder inside the program folder: on the first start of 1.2 it is moved automatically, every file is checked against the original, and the old folder is kept as `data.migrated-<date>` until you delete it. If anything goes wrong, HomeCoin does not start and the data stays where it was. The automatic backups live next to the data: download an encrypted backup now and then (Settings → Backup) and keep it somewhere else, such as a USB drive or the cloud.

Options: `HomeCoin.cmd --port 9000`, `HomeCoin.cmd --no-browser`.

## Updates

When a new version is published, a small **⬆ HomeCoin x.y.z is available** label appears at the top and a dot on Settings. Settings → **Updates** shows what's new and installs it with one click:

- **Installed version:** the new installer runs by itself in the background and HomeCoin reopens; the open page reloads on its own.
- **ZIP version:** the program files are replaced in place (a copy of the previous ones is kept, and any new library is installed with `requirements.lock` first); HomeCoin restarts.

How it stays safe:
- only **published releases** are offered, never test builds or single commits, and never an older version;
- every release carries a **manifest signed by the maintainer** (Ed25519). HomeCoin checks the signature with the public key built into the program and refuses anything else, even if it comes from GitHub;
- every downloaded byte is checked against the **SHA-256** in the signed manifest before anything is installed; downloads come only from GitHub;
- an encrypted **backup** of the database is saved first, and the data folder is never part of an update;
- nothing is installed until you click **Update**.

The automatic check runs at most once a day after you sign in and sends nothing about you or your data; you can turn it off in Settings → Updates. A development copy (a git working tree) never updates itself.

## Demo version

Two sample spaces with 18 months of **made-up data**, in a separate folder (`demo-data` in the program folder) recreated at every start, on port 8766 (it can run next to HomeCoin). You enter with one click, online features are off, and your real data is never read or touched. It is meant for trying HomeCoin out, for screenshots and for testing changes, so the installer creates no shortcut for it.

The demo shows every feature with realistic data: a household space (joint account, grocery card, cash, an archived account, a mixed-rate mortgage and a fixed-rate car loan, a variable water bill, fair split between two people, budgets, goals, rules and a few transactions still to categorize) and a personal space (salary, credit card, deposit account, a broker with ETFs, a money market fund, gold, an investment plan, a partial sale, coupons and fees, a pension fund valued from statements, a saved rebalancing target). On the Import page, **Try it with a sample bank statement** loads a made-up statement to see column detection, rules and duplicate detection at work.

- **ZIP version:** double-click **`HomeCoin-Demo.cmd`**.
- **Installed version:** run `"%LOCALAPPDATA%\Programs\HomeCoin\python\pythonw.exe" "%LOCALAPPDATA%\Programs\HomeCoin\demo.py"` (for example from *Win + R*); close it with **⏻**.

## Security and privacy

- **Encrypted database:** SQLite with SQLCipher 4 (AES-256) in `homecoin.db` in the data folder; an encrypted copy is saved automatically at the first unlock of every start in `backups\` (last 15).
- **Keys:** the data key is random and stored in `keystore.json` (data folder) only in encrypted form — one copy protected by the password, one by the recovery key, both with **scrypt N=2^17** (≈128 MB per attempt). The password is never stored. **Without the password or the recovery key the data cannot be recovered.** When you copy the `data` folder, always copy `keystore.json` too.
- **Passwords:** at least 8 characters; trivial ones are refused (e.g. "password123", "12345678", one repeated character).
- **Sessions:** the server starts locked — no data is reachable until you enter the password; the session is an HttpOnly/SameSite=Strict cookie with a different name per instance (HomeCoin and the demo do not interfere); one active session; auto-lock after inactivity (5 minutes to 2 hours); growing delay after 3 wrong passwords, **kept across server restarts**.
- **Backups and exports:** downloadable backups (`.hcbackup`) are encrypted (AES-256-GCM with the data key) and open only in HomeCoin, with the password or recovery key valid when the backup was made; the file carries the data key only in its password-protected form, so keep backups as safe as the password is strong. CSV/Excel exports are **unencrypted**: HomeCoin reminds you before every download, and texts that would start with `=` `+` `-` `@` are written as text (no active formulas in Excel).
- **Database hygiene:** temporary tables in memory only, deleted rows overwritten (`secure_delete`).
- **Data folder:** Settings → Security check also verifies who can access the data folder; *Restrict to my user* makes it accessible only to your Windows user (plus SYSTEM and administrators), with automatic verification and rollback if something goes wrong.
- **Network:** the server listens only on `127.0.0.1` and does not disclose its name or version; requests with a different Host are refused (DNS rebinding protection) and requests the browser marks as coming from other sites (`Sec-Fetch-Site: cross-site`) are rejected. Writes require a dedicated header and a local origin (CSRF protection); strict Content-Security-Policy, no iframes, a Permissions-Policy that denies camera, microphone, location, payments and devices.
- **Temporary import code:** for your own local import scripts; it cannot use the security functions or take data out in bulk (backup, restore, exports), and it is revoked when HomeCoin restarts or locks.
- **Activity log:** important events (sign-ins, failed attempts, changes, deletions, exports) in the encrypted database, kept for 12 months.
- **No external resources:** Chart.js is bundled in `static\vendor`. The two deliberate, optional exceptions are *Update prices* in Investments, which sends only the tickers to Yahoo Finance, and the update check, which asks the GitHub API for the latest release. The *Help* and *Support* links open GitHub and Ko-fi in a new tab only when you click them.
- **Signed updates:** see [Updates](#updates). The signing key never leaves the maintainer's PC; the program contains only the public key.
- **Dependencies:** installed only from ready-made packages at exact versions, each checked against its SHA-256 (`requirements.lock`), and checked for known vulnerabilities before every release.
- To use a different data folder, set the environment variable `HOMECOIN_DATA_DIR` (it is never moved automatically).

## Limitations

- Windows only (launch scripts, data-folder protection); the Python code itself is portable but untested elsewhere.
- One user per installation: HomeCoin is a personal tool, not a multi-user server. Do not expose it on a network.
- Bank import depends on the statement format: columns are detected automatically, but some exports may need a quick check in the preview.
- Prices come from Yahoo Finance and can be delayed, incomplete or missing for some funds.
- One currency per installation (euro or US dollar): amounts in other currencies are not supported. Securities quoted in other currencies are converted into the reference currency with the exchange rates available on Yahoo Finance. Mortgage indexes (Euribor, SOFR, Treasury, Prime) are not downloaded: enter their current value by hand.

## Getting help

- **Something does not work?** Open an issue with the **Bug report** template. Reproduce it with the demo version and **never attach real data** (no database, backups, statements, amounts or names).
- **An idea?** Open an issue with the **Feature request** template.
- **A security problem?** Do not open a public issue: follow [SECURITY.md](SECURITY.md).

## Support the project

HomeCoin is free. If it is useful to you, consider giving the project a star on GitHub or buying me a coffee on Ko-fi:

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/starkark98)

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Project structure

```
homecoin/   app.py (Flask API) · db.py (encrypted schema, backups) · security.py (password, keys, data folder)
            services.py (balances, recurring items, categorization) · forecast.py (estimates) · split.py (fair split)
            tools.py (mortgage, investments, prices) · importer.py (CSV/Excel) · audit.py (activity log)
            updater.py (signed updates) · demo.py (sample data) · util.py (amounts, dates)
static/     index.html · css/app.css · js/app.js · js/theme.js · img/logo.svg · vendor/chart.umd.min.js
icon/       app icons
docs/       images used by this README
run.py      starts the server (waitress) and the browser    demo.py    starts the demo version
setup.ps1   Python environment and dependencies              HomeCoin.cmd / HomeCoin-Demo.cmd    double-click launchers
```

## Maintainer

HomeCoin is created and maintained by **Starkark98**. Version history is in [CHANGELOG.md](CHANGELOG.md).

## Built with AI assistance

In the spirit of transparency: HomeCoin was developed with the assistance of **[Claude Code](https://www.anthropic.com/claude-code)**, Anthropic's AI coding assistant, which helped write, review and debug the code and the documentation. The maintainer defined the goals and the design, directed the work, reviewed the results and is responsible for the project.

As with any tool, read the source and evaluate the results critically before relying on them (see [Disclaimer](#disclaimer)).

## Disclaimer

HomeCoin is provided **"as is", without warranty of any kind**, express or implied, as stated in the [LICENSE](LICENSE).

- Calculations, estimates, forecasts and amortization schedules are **indicative**. They may be incomplete or inaccurate and **do not replace** bank statements, contracts, tax documents or the advice of a qualified professional.
- HomeCoin **does not provide financial, investment, tax or legal advice**. Decisions based on its figures are your own responsibility.
- Security prices come from a third-party service and may be delayed, incomplete or wrong.
- Keep your password and recovery key safe and make regular backups: without them the encrypted data cannot be recovered by anyone, including the author.
- In no event shall the author or contributors be liable for any claim, damages or other liability, including data loss, financial loss or decisions taken on the basis of HomeCoin, arising from the use of or inability to use this software.
- HomeCoin is an **independent project**, not affiliated with, endorsed by or supported by any bank, broker or data provider mentioned in this documentation.

## Trademarks

Microsoft, Windows and Microsoft Edge are trademarks of the Microsoft group of companies. Google Chrome is a trademark of Google LLC. Firefox is a trademark of the Mozilla Foundation. Yahoo and Yahoo Finance are trademarks of Yahoo Inc. Excel is a trademark of Microsoft Corporation. Python is a trademark of the Python Software Foundation. Claude and Claude Code are trademarks of Anthropic, PBC. All other trademarks are the property of their respective owners. Their use here is for identification purposes only and does not imply endorsement.

## License

Copyright (c) 2026 Starkark98. Released under the **MIT License with the [Commons Clause](https://commonsclause.com/)** condition: see [LICENSE](LICENSE) for the full text. The bundled Chart.js library keeps its own MIT license.

In plain words (the LICENSE file is what legally applies):

| You can | You cannot |
|---|---|
| Use it for free, at home or at work | **Sell** it, alone or bundled with other software |
| Use it for your household, your family or your own business | Offer paid hosting, support or **services whose value derives entirely or substantially from it** (for example selling bookkeeping services built on it) |
| Modify it and share it, including modified versions, **free of charge** | Remove the copyright notice or the license text |

Any copy or modified version must keep the [LICENSE](LICENSE) file, including the Commons Clause.

Because of the Commons Clause, HomeCoin is **source-available** software, not "open source" in the OSI sense.

**Commercial use not covered above?** If you would like to sell, bundle or offer services based on HomeCoin, contact **Starkark98** through GitHub to ask for a separate commercial license.

---

*HomeCoin by **Starkark98** · v1.2.1 · see the [changelog](CHANGELOG.md)*
