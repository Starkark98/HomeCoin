# Contributing to HomeCoin

Thanks for your interest in improving HomeCoin!

## Reporting bugs and suggesting ideas

- Search the existing **Issues** first: your problem may already be known.
- Use the **Bug report** or **Feature request** template.
- **Never post real data**: no amounts, names, accounts, bank statements, databases or backups. Reproduce the problem with the demo version (`HomeCoin-Demo.cmd`).
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Pull requests

1. For anything beyond a small fix, **open an issue first** to discuss the change.
2. Keep pull requests focused: one fix or feature per pull request.
3. Update `README.md` and `CHANGELOG.md` when you change behavior, and `VERSION` in `homecoin/app.py` for a new release.

## Ground rules

- **Local only.** The server listens on `127.0.0.1`; no cloud, accounts, telemetry, CDNs or external resources. The only outbound call allowed is the price update (tickers only).
- **Data always encrypted.** Nothing of the user's data may be written outside the encrypted database (logs, temporary files, caches). Unencrypted exports stay an explicit user action, with a warning.
- **Request security.** Writes go through the existing checks (dedicated header, local origin, session); every value entered or imported goes through `esc()` before it reaches the HTML.
- **Separate spaces.** Every read and write stays inside the active space; transfers to other spaces are read-only on the other side.
- **No unnecessary dependencies.** Python with Flask, waitress, SQLCipher, openpyxl and cryptography; plain JavaScript without frameworks; interface in English.
- **Backward compatibility.** Existing databases must keep working: never rename stored codes, and keep recognizing the names of system categories created by older versions.

## Testing your change

- Run the demo (`HomeCoin-Demo.cmd`) and check the tabs you touched, in light and dark theme, with the browser console free of errors.
- For automated tests use a temporary data folder (environment variable `HOMECOIN_DATA_DIR`), never your real data folder (`%LOCALAPPDATA%\HomeCoin\data`).

## Dependencies

`requirements.txt` lists the accepted ranges; `requirements.lock` pins the exact versions with their SHA-256 and is what `setup.ps1` installs (`pip install --require-hashes --only-binary=:all:`). To move to new versions: install and test them, check them with `pip-audit`, then regenerate the lock with the wheels for Windows 64-bit and Python 3.12 and 3.13 (`pip download --no-deps --only-binary=:all: --platform win_amd64 --python-version 3.12 …`, same for 3.13, and the SHA-256 of each file).

## License of contributions

By submitting a contribution you confirm that you have the right to do so and you agree that it is released under the project's [license](LICENSE) (MIT with the Commons Clause), and that the maintainer may also include it in versions offered under a separate commercial license.
