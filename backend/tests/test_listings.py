"""The Apprenticeships page's career dropdown must change the mentors, NAPS and railway lists.

The logic lives in web/lib/listings.ts; this runs its checks against the live spreadsheet.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from raah import dataset

WEB = Path(__file__).resolve().parents[2] / "web"


def test_career_filter_lists():
    d = dataset.load()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({k: v for k, v in d.items() if k != "_private"}, f, default=str)
    try:
        out = subprocess.run(["npx", "tsx", "tests/listings.ts", f.name], cwd=WEB, capture_output=True, text=True)
    finally:
        os.unlink(f.name)
    assert out.returncode == 0, out.stderr
