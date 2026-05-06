"""
Forge License Watcher

Polls Detailer's license status. When Detailer becomes reachable (i.e. Scott
disconnects VPN so the online activation server is reachable), publishes a
push notification to ntfy.sh.

Usage:
  python license_watcher.py [--interval 60] [--topic <ntfy_topic>]

Defaults to a private topic baked in at install time. Scott installs the free
'ntfy' mobile app, subscribes to that topic, and gets push notifications. He
can also forward ntfy notifications to email from inside the app.

Exit conditions:
  - License OK detected → publishes notification, exits 0
  - Ctrl-C → exits 0 silently
  - Unrecoverable error → exits 1
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

EXE_PATH = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"

# Private topic — generated 2026-05-06, do not share publicly. Scott subscribes
# in the ntfy mobile app.
DEFAULT_TOPIC = "hytek-forge-SGco7_PAu1tbz67pnGiuNg"
NTFY_HOST = "https://ntfy.sh"
DEFAULT_EMAIL = os.environ.get("FORGE_NOTIFY_EMAIL", "scott@textor.com.au")

# Quick license check: launch Detailer, wait briefly, look at title, kill.
LAUNCH_SETTLE_SEC = 12
WAIT_FOR_TITLE_SEC = 30


def _import_deps():
    global psutil, Application
    import psutil as _psutil
    from pywinauto import Application as _Application
    psutil = _psutil
    Application = _Application


def kill_zombies():
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if "Detailer" in (p.info["name"] or ""):
                psutil.Process(p.info["pid"]).kill()
        except Exception:
            pass


def find_pid():
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if "Detailer" in (p.info["name"] or ""):
                return p.info["pid"]
        except Exception:
            pass
    return None


def license_status():
    """
    Return one of:
      "OK"             — main window has 'License valid' in title
      "BLOCKED"        — TfrmLicenseNotice is up (online activation failed)
      "UNKNOWN"        — couldn't determine within timeout
    """
    if not Path(EXE_PATH).exists():
        return "UNKNOWN"
    kill_zombies()
    time.sleep(2)
    subprocess.Popen([EXE_PATH], cwd=os.path.dirname(EXE_PATH))
    pid = None
    for _ in range(40):
        time.sleep(0.5)
        pid = find_pid()
        if pid:
            break
    if not pid:
        kill_zombies()
        return "UNKNOWN"
    time.sleep(LAUNCH_SETTLE_SEC)
    try:
        app = Application(backend="win32").connect(process=pid)
        end = time.time() + WAIT_FOR_TITLE_SEC
        license_seen_since = None
        while time.time() < end:
            try:
                wins = list(app.windows())
            except Exception:
                wins = []
            license_dialog = False
            main_title = None
            for w in wins:
                try:
                    if not w.is_visible():
                        continue
                    cls = w.class_name()
                    if cls == "TfrmLicenseNotice":
                        license_dialog = True
                    elif cls.startswith("Tfrm") and cls != "TfrmLicenseNotice":
                        try:
                            main_title = w.window_text() or ""
                        except Exception:
                            pass
                except Exception:
                    pass
            if main_title and "License valid" in main_title:
                return "OK"
            if license_dialog:
                license_seen_since = license_seen_since or time.time()
                if time.time() - license_seen_since > 5:
                    return "BLOCKED"
            time.sleep(0.5)
        return "UNKNOWN"
    finally:
        kill_zombies()


def send_email_via_outlook(to: str, subject: str, body: str) -> bool:
    """Send an email by driving Outlook COM via PowerShell. Requires Outlook
    desktop installed + signed in (verified working on Scott's PC 2026-05-06)."""
    ps_script = (
        "$ol = New-Object -ComObject Outlook.Application; "
        "$m = $ol.CreateItem(0); "
        f"$m.To = '{to}'; "
        f"$m.Subject = '{subject.replace(chr(39), chr(39)*2)}'; "
        f"$m.Body = '{body.replace(chr(39), chr(39)*2)}'; "
        "$m.Send(); "
        "Write-Output 'SENT_OK'"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            capture_output=True, text=True, timeout=30,
        )
        ok = "SENT_OK" in (r.stdout or "")
        if not ok:
            print(f"[watcher] outlook send failed: rc={r.returncode} stdout={r.stdout!r} stderr={r.stderr!r}",
                  file=sys.stderr, flush=True)
        return ok
    except Exception as e:
        print(f"[watcher] outlook send exception: {e}", file=sys.stderr, flush=True)
        return False


def publish_ntfy(topic: str, title: str, message: str, priority: str = "high",
                 tags: str = "white_check_mark", email: str | None = None):
    url = f"{NTFY_HOST}/{topic}"
    headers = {
        "Title": title,
        "Priority": priority,
        "Tags": tags,
        "Content-Type": "text/plain; charset=utf-8",
    }
    if email:
        # ntfy.sh forwards the message to this address as a real email.
        headers["Email"] = email
    req = urllib.request.Request(url, data=message.encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        return True
    except Exception as e:
        print(f"[watcher] ntfy publish failed: {e}", file=sys.stderr, flush=True)
        return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--interval", type=int, default=60, help="Poll interval seconds")
    p.add_argument("--topic", default=os.environ.get("NTFY_TOPIC", DEFAULT_TOPIC))
    p.add_argument("--email", default=DEFAULT_EMAIL, help="Email to forward via ntfy")
    p.add_argument("--max-hours", type=float, default=12, help="Give up after N hours")
    args = p.parse_args()

    try:
        _import_deps()
    except ImportError as e:
        print(f"[watcher] missing deps: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"[watcher] starting. topic={args.topic} interval={args.interval}s", flush=True)
    print(f"[watcher] subscribe at: https://ntfy.sh/{args.topic}", flush=True)

    deadline = time.time() + args.max_hours * 3600
    poll_n = 0
    while time.time() < deadline:
        poll_n += 1
        try:
            status = license_status()
        except Exception as e:
            status = "UNKNOWN"
            print(f"[watcher] poll {poll_n}: exception {e}", flush=True)
        print(json.dumps({"poll": poll_n, "ts": int(time.time()), "status": status}), flush=True)
        if status == "OK":
            subject = "Forge: FRAMECAD Detailer is reachable"
            body = (
                "License is now valid (verified by launching Detailer and "
                "reading the title bar). Forge worker can run.\n\n"
                "Open Claude Code to resume the session — Claude will pick up "
                "from forge/docs/HANDOVER-2026-05-06.md.\n\n"
                f"Detected by license_watcher.py poll #{poll_n} at "
                f"{time.strftime('%Y-%m-%d %H:%M:%S')}."
            )
            email_ok = send_email_via_outlook(args.email, subject, body)
            ntfy_ok = publish_ntfy(
                args.topic, subject, body,
                priority="high", tags="white_check_mark,construction",
            )
            print(f"[watcher] email_ok={email_ok} ntfy_ok={ntfy_ok}; exiting 0", flush=True)
            sys.exit(0)
        time.sleep(args.interval)

    timeout_msg = f"Watcher polled for {args.max_hours}h without seeing a valid license. Investigate."
    send_email_via_outlook(args.email, "Forge watcher timed out", timeout_msg)
    publish_ntfy(args.topic, "Forge watcher timed out", timeout_msg,
                 priority="default", tags="warning")
    print("[watcher] deadline reached, exiting 1", flush=True)
    sys.exit(1)


if __name__ == "__main__":
    main()
