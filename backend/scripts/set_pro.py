"""Turn Raah Pro on or off for a student account (there is no payment flow yet).

    cd backend
    python scripts/set_pro.py 9876543210          # Pro on
    python scripts/set_pro.py 9876543210 --off    # Pro off
    python scripts/set_pro.py --list              # who has Pro

Uses the same database as the app (DATABASE_URL in backend/.env).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raah import db  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("phone", nargs="?", help="the student's 10-digit mobile number")
    ap.add_argument("--off", action="store_true", help="remove Pro instead of granting it")
    ap.add_argument("--list", action="store_true", help="list accounts that have Pro")
    args = ap.parse_args()
    with db.connect() as con:
        if args.list:
            for r in con.execute("SELECT id, name, phone, role FROM users WHERE is_pro = 1 ORDER BY id").fetchall():
                print(f"{r['id']:>5}  {r['role']:<8} {r['phone']:<11} {r['name'] or ''}")
            return
        if not args.phone:
            ap.error("give a mobile number, or --list")
        cur = con.execute("UPDATE users SET is_pro = ? WHERE phone = ? AND role = 'student'",
                          (0 if args.off else 1, args.phone[-10:]))
    if cur.rowcount == 0:
        raise SystemExit(f"no student is registered with {args.phone}")
    print(f"Raah Pro {'off' if args.off else 'on'} for {args.phone}. They see it after reopening the app.")


if __name__ == "__main__":
    main()
