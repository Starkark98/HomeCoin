# Contributing to HomeCoin

Thanks for your interest in improving HomeCoin!

## Reporting bugs and suggesting ideas

- Search the existing **Issues** first: your problem may already be known.
- Use the **Bug report** or **Feature request** template.
- **Never post real data**: no amounts, names, accounts, bank statements, databases or backups. Reproduce the problem with the [demo version](README.md#try-the-demo-first).
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Pull requests

1. For anything beyond a small fix, **open an issue first** to discuss the change.
2. Keep pull requests focused: one fix or feature per pull request.
3. Update the user guide (`README.md`, which the in-app *Help* opens) in the same pull request whenever you change what users see or do: the section of the feature, and the screenshot if the page changed. Plain words, with the correct technical term next to them.
4. **Every new text in all languages.** Write it in English inside `T('…')` (page, `static/js/app.js`) or `i18n.t("…")` (server, `homecoin/`), with `{name}` placeholders for values and `tn('{n} file', '{n} files', n)` whenever a number is followed by a word, and add its translation to each file in `static/i18n/`. The English text is the key: never build a sentence from pieces (a number and a word, or two `T()` around a value), because other languages need another word order or plural form (Polish has three, Japanese none: see the `"plural"` rule in each file). If you can't translate a language, say so in the pull request.
5. Add your change to `CHANGELOG.md`. The maintainer sets `VERSION` in `homecoin/app.py` and publishes the releases.

## Ground rules

- **Local only.** The server listens on `127.0.0.1`; no cloud, accounts, telemetry, CDNs or external resources. Only two outbound calls exist, both optional: the price update (tickers only, to Yahoo Finance) and the update check (the latest release, from GitHub).
- **Signed updates.** Releases are signed by the maintainer and HomeCoin installs nothing without a valid signature (`homecoin/updater.py`). Changes must never weaken these checks.
- **Data always encrypted.** Nothing of the user's data may be written outside the encrypted database (logs, temporary files, caches). Unencrypted exports stay an explicit user action, with a warning.
- **Request security.** Writes go through the existing checks (dedicated header, local origin, session); every value entered or imported goes through `esc()` before it reaches the HTML.
- **Separate spaces.** Every read and write stays inside the active space; transfers to other spaces are read-only on the other side.
- **No unnecessary dependencies.** Python with Flask, waitress, SQLCipher, openpyxl and cryptography; plain JavaScript without frameworks; interface in eleven languages.
- **Backward compatibility.** Existing databases must keep working: never rename stored codes. Default and system categories are recognized by their fixed code (`categories.code`), never by their name, which can be in any language.
- **Translations welcome.** Corrections to the translations are a great first contribution: open an issue with the *Translation* template, or a pull request that changes only `static/i18n/<language>.json`. A new language is one new file there: copy the `"@meta"` block of a similar language (its format is described at the top of `homecoin/i18n.py`) and translate every text; nothing in the code lists the languages.

## Testing your change

- Run the demo (`HomeCoin-Demo.cmd` in the ZIP version) and check the pages you touched, in light and dark theme and at least in English and in German (the longest texts), with the browser console free of errors. If you add a feature, add sample data for it to the demo (`homecoin/demo.py`).
- For automated tests use a temporary data folder (environment variable `HOMECOIN_DATA_DIR`), never your real data folder (`%LOCALAPPDATA%\HomeCoin\data`).
- Before every release the maintainer also runs a regression and fuzz test suite (made-up data only).

## Dependencies

`requirements.txt` lists the accepted ranges; `requirements.lock` pins the exact versions with their SHA-256 and is what `setup.ps1` installs (`pip install --require-hashes --only-binary=:all:`). To move to new versions: install and test them, check them with `pip-audit`, then regenerate the lock with the wheels for Windows 64-bit and Python 3.12, 3.13 and 3.14 (`pip download --no-deps --only-binary=:all: --platform win_amd64 --python-version 3.12 …`, same for 3.13 and 3.14, and the SHA-256 of each file). The installer bundles Python 3.14 with the same locked libraries.

## License of contributions

By submitting a contribution you confirm that you have the right to do so and you agree that it is released under the project's [license](LICENSE) (MIT with the Commons Clause), and that the maintainer may also include it in versions offered under a separate commercial license.
