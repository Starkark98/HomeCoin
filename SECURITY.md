# Security policy

## Supported versions

Only the **latest release** of HomeCoin receives fixes. Please update before reporting a problem.

| Version | Supported |
|---|---|
| 2.4.x (latest) | Yes |
| Older versions | No: update from Settings → Updates or install the latest release |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report them privately through GitHub: open the **Security** tab of this repository and click **Report a vulnerability**. Include:

- a description of the problem and its possible impact;
- the steps or a minimal example to reproduce it;
- the HomeCoin version (Settings → General → About HomeCoin, or at the bottom of the menu), whether it is the installed or the ZIP version, and the Windows and browser versions involved.

**Never include real data**: no database, backups, `keystore.json`, recovery keys, passwords, bank statements, amounts or names. Use the [demo version](README.md#try-the-demo-first) or made-up examples.

## What to expect

HomeCoin is maintained in spare time, so handling is **best effort**. The aim is to acknowledge a report within a few days, agree on a fix and publish a new release before any public disclosure. Please allow reasonable time for a fix before disclosing the issue publicly.

## Scope

Examples of relevant reports: access to the data without the password or the recovery key, weaknesses in the encryption of the database, the keystore or the backups, script code injected through data entered or imported (for example a crafted description or CSV file), requests accepted from other websites or other computers (CSRF, DNS rebinding), the temporary import code reaching functions it should not, an update installed without a valid signature, or data sent anywhere other than the tickers used for price updates and the update check on GitHub.

Out of scope: attacks that require control of the user's Windows account while HomeCoin is unlocked (for example malware reading the browser's memory), weak passwords chosen by the user despite the warnings, and the loss of both the password and the recovery key.
