"""Discover's sweet-spot logic (web/lib/ikigai.ts) must work on the live spreadsheet.

It turns typed answers into the dataset's tags, checks pay and openings from the data, and ranks careers by how
many of the four circles overlap. The checks live in web/tests/ikigai.ts.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from raah import dataset

WEB = Path(__file__).resolve().parents[2] / "web"


def test_sweet_spots():
    d = dataset.load()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({k: v for k, v in d.items() if k != "_private"}, f, default=str)
    try:
        out = subprocess.run(["npx", "tsx", "tests/ikigai.ts", f.name], cwd=WEB, capture_output=True, text=True)
    finally:
        os.unlink(f.name)
    assert out.returncode == 0, out.stderr
    assert "ikigai ok" in out.stdout
