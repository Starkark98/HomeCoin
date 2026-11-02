"""HomeCoin launcher: local server on 127.0.0.1, then opens the browser.

Works with a console (HomeCoin.cmd) or without one (pythonw.exe, used by the installer's shortcuts): without a console,
messages that need attention are shown in a Windows message box. --background: no browser (start with Windows)."""
import argparse
import socket
import sys
import threading
import webbrowser

from waitress import serve

from homecoin import db
from homecoin.app import VERSION, create_app

NO_CONSOLE = sys.stdout is None  # pythonw.exe: print() writes nowhere


def tell(text, error=False):
    """Message for the user: on the console, or in a message box when there is no console (errors only)."""
    if not NO_CONSOLE:
        print(text)
    elif error and sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text.strip(), "HomeCoin", 0x10)  # error icon


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    p = argparse.ArgumentParser(description="HomeCoin - household finance manager")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true", help="do not open the browser at startup")
    p.add_argument("--background", action="store_true", help="start locked without opening the browser (start with Windows)")
    args = p.parse_args()
    url = f"http://127.0.0.1:{args.port}/"
    browser = not (args.no_browser or args.background)

    if port_in_use(args.port):  # already running (e.g. the shortcut clicked again): just open the page
        tell(f"HomeCoin seems to be already running at {url}")
        if browser:
            webbrowser.open(url)
        return

    try:  # data of a version up to 1.1.0 (program folder\data): moved once to the per-user data folder, verified
        moved = db.migrate_data_folder()
    except db.MigrationError as exc:
        tell(f"\n  ⚠️  HomeCoin could not move your data to {db.DATA_DIR}: {exc}\n"
             f"  Nothing was changed: your data is still in {db.LEGACY_DATA_DIR}.\n"
             "  Fix the problem and start HomeCoin again (or set HOMECOIN_DATA_DIR to that folder to keep using it).\n", error=True)
        raise SystemExit(1)
    if moved and moved["moved"]:
        tell(f"\n  📦  Data moved ({moved['files']} files, verified) to {moved['new']}\n"
             f"      The old copy stays in {moved['old']}: delete it once you have checked that everything is there.")
    elif moved:
        tell(f"\n  ℹ️  An old data folder is still in {moved['old']} and is not used (data in {moved['new']}).")
    db.DATA_DIR.mkdir(parents=True, exist_ok=True)  # the database opens only after unlocking with the password
    app = create_app(args.port)
    tell(f"\n  🪙  HomeCoin {VERSION} · by Starkark98\n  ➜  {url}\n  Encrypted data in: {db.DATA_DIR}\n"
         "  Close this window (or press Ctrl+C, or use Close HomeCoin in the app) to stop the server.\n")
    if browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    try:
        serve(app, host="127.0.0.1", port=args.port, threads=6, ident="HomeCoin", _quiet=True)
    except OSError as exc:  # e.g. the port taken by another program in the meantime
        tell(f"HomeCoin cannot start on port {args.port}: {exc}", error=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
