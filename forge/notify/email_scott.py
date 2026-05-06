"""
Email Scott when the autonomous run hits a question that genuinely needs a
human decision. Uses the same Outlook-COM pattern as
forge/worker/license_watcher.py (proven working 2026-05-06).

Usage from another script:
    from forge.notify.email_scott import email_scott
    email_scott(
        subject="[Forge] Need decision on profile rule",
        body="Profile 70.075 stick W12 has no matching pattern in corpus...",
        what_id_do_by_default="Fall back to rule engine and flag low-confidence."
    )

Falls back to writing to a local queue file if Outlook COM fails — the
queue can be flushed manually.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

QUEUE_DIR = Path.home() / ".forge-notify-queue"
RECIPIENT = "scott@textor.com.au"


def email_scott(subject: str, body: str, what_id_do_by_default: str = "") -> bool:
    """Send an email via Outlook desktop COM. Returns True on success.

    Subject is auto-prefixed with [Forge] if not already.
    Body gets a footer with the default-action and timestamp.
    """
    if not subject.startswith("[Forge]"):
        subject = f"[Forge] {subject}"

    full_body = body.rstrip()
    if what_id_do_by_default:
        full_body += "\n\n---\nWhat I'll do by default if I don't hear from you: " + what_id_do_by_default
    full_body += f"\n\n---\nSent at {time.strftime('%Y-%m-%d %H:%M:%S')} from autonomous Forge run."

    try:
        # Lazy import — only on Windows + only when sending
        import win32com.client  # type: ignore
        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)  # 0 = MailItem
        mail.To = RECIPIENT
        mail.Subject = subject
        mail.Body = full_body
        mail.Send()
        return True
    except Exception as e:
        # Queue to disk for later replay
        QUEUE_DIR.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d-%H%M%S")
        path = QUEUE_DIR / f"{ts}.json"
        path.write_text(
            json.dumps({"subject": subject, "body": full_body, "to": RECIPIENT,
                        "queued_reason": str(e), "queued_at": ts}, indent=2),
            encoding="utf-8",
        )
        print(f"[notify] outlook COM failed ({e}); queued at {path}")
        return False


if __name__ == "__main__":
    # Self-test
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject", default="[Forge] notify pipeline self-test")
    ap.add_argument("--body", default="Self-test — if you see this, the email path works.")
    args = ap.parse_args()
    ok = email_scott(args.subject, args.body, what_id_do_by_default="(none — this is a test)")
    print("OK" if ok else "FAILED (see queue)")
