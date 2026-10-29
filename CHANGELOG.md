# Changelog

All notable changes to HomeCoin are listed here, newest first.

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
