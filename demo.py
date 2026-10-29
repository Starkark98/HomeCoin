"""HomeCoin demo version: sample data in a separate folder (demo-data), recreated at every start.

It never reads or writes the real data folder. Default port 8766, so it can run next to HomeCoin
(8765) in the same browser: each instance has its own session cookie.
"""
import os
import shutil
import socket
import sys
import time
import webbrowser
from pathlib import Path

BASE = Path(__file__).resolve().parent
DEMO_DIR = BASE / "demo-data"
DEMO_PORT = 8766
# the data folder must be set BEFORE importing HomeCoin (the db module reads it at import time)
os.environ["HOMECOIN_DATA_DIR"] = str(DEMO_DIR)
os.environ["HOMECOIN_DEMO"] = "1"

from homecoin import db as dbm, demo, security  # noqa: E402

assert dbm.DATA_DIR == DEMO_DIR, "the demo must use only its own folder"


def port_arg():
    if "--port" in sys.argv:
        return int(sys.argv[sys.argv.index("--port") + 1])
    sys.argv += ["--port", str(DEMO_PORT)]
    return DEMO_PORT


def in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def wipe():
    """Delete the previous demo (retry briefly if Windows still holds some file open)."""
    for _ in range(10):
        shutil.rmtree(DEMO_DIR, ignore_errors=True)
        if not DEMO_DIR.exists():
            return
        time.sleep(0.5)
    raise SystemExit(f"Cannot recreate the demo: close the other demo windows and try again ({DEMO_DIR})")


def fresh():
    """Always a clean demo: delete the demo folder and recreate it with the sample data."""
    wipe()
    DEMO_DIR.mkdir(parents=True)
    vault = security.Vault()
    vault.setup(demo.PASSWORD)
    demo.build()
    vault.lock_now()


if __name__ == "__main__":
    port = port_arg()
    if in_use(port):  # demo already open: do not recreate it under the running server, just open the browser
        print(f"The demo is already running at http://127.0.0.1:{port}/")
        if "--no-browser" not in sys.argv:
            webbrowser.open(f"http://127.0.0.1:{port}/")
        sys.exit(0)
    print("Preparing the demo with sample data…")
    fresh()
    import run  # noqa: E402
    run.main()
