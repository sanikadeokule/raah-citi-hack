"""Add a visible INR 1 Razorpay test module to the local demo SQLite database."""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--database",
        default=str(Path.home() / "AppData/Local/Temp/raah-citi-hack-dev.db"),
        help="SQLite database used by the local Raah demo",
    )
    args = parser.parse_args()
    path = Path(args.database)
    if not path.is_file():
        raise SystemExit(f"Demo database not found: {path}")

    title = "TEST - Razorpay Checkout: Money Basics"
    quiz = json.dumps([
        {"q": "What is a budget for?", "options": ["Planning income and spending", "Borrowing without a plan"], "answer": 0},
        {"q": "What is a useful saving habit?", "options": ["Save regularly", "Spend all income immediately"], "answer": 0},
    ])
    with sqlite3.connect(path) as con:
        con.execute("PRAGMA foreign_keys = ON")
        teacher = con.execute(
            "SELECT id FROM users WHERE phone = ? AND role = ?", ("9000000001", "teacher")
        ).fetchone()
        if teacher:
            teacher_id = teacher[0]
        else:
            teacher_id = con.execute(
                "INSERT INTO users (phone, role, name, pin_hash, created_at) VALUES (?, ?, ?, NULL, ?)",
                ("9000000001", "teacher", "Raah Demo Teacher", int(time.time())),
            ).lastrowid

        module = con.execute(
            "SELECT id FROM modules WHERE teacher_id = ? AND title = ?", (teacher_id, title)
        ).fetchone()
        if module:
            module_id = module[0]
        else:
            module_id = con.execute(
                "INSERT INTO modules (teacher_id, title, lang, lesson, quiz, price_model, price, published, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
                (
                    teacher_id,
                    title,
                    "en",
                    "A short demo lesson for trying the Raah payment flow. Learn to compare needs and wants, "
                    "make a simple budget, and save a small amount regularly. This is sample content created "
                    "only for local testing.",
                    quiz,
                    "per_module",
                    1.0,
                    int(time.time()),
                ),
            ).lastrowid

    print(f"Published module {module_id}: {title} (INR 1.00)")


if __name__ == "__main__":
    main()
