"""The Discover answer checks in web/lib/questions.ts (marks, age, exam choices, wording in en/mr/hi)."""
import shutil
import subprocess
from pathlib import Path

import pytest

WEB = Path(__file__).resolve().parents[2] / "web"


@pytest.mark.skipif(not (WEB / "node_modules" / ".bin" / "tsx").exists() or not shutil.which("node"), reason="web deps not installed")
def test_question_checks():
    r = subprocess.run([str(WEB / "node_modules" / ".bin" / "tsx"), "tests/questions.ts"], cwd=WEB, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr + r.stdout
