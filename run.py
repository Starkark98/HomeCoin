"""HomeCoin launcher: local server on 127.0.0.1, then opens the browser."""
import argparse
import socket
import threading
import webbrowser

from waitress import serve

from homecoin import db
from homecoin.app import VERSION, create_app


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    p = argparse.ArgumentParser(description="HomeCoin - household finance manager")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true", help="do not open the browser at startup")
    args = p.parse_args()
    url = f"http://127.0.0.1:{args.port}/"

    if port_in_use(args.port):
        print(f"HomeCoin seems to be already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return

    db.DATA_DIR.mkdir(parents=True, exist_ok=True)  # the database opens only after unlocking with the password
    app = create_app(args.port)
    print(f"\n  🪙  HomeCoin {VERSION} · by Starkark98\n  ➜  {url}\n  Encrypted data in: {db.DATA_DIR}\n  Close this window (or press Ctrl+C) to stop the server.\n")
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    serve(app, host="127.0.0.1", port=args.port, threads=6, ident="HomeCoin", _quiet=True)


if __name__ == "__main__":
    main()
