"""Download the official ISO 20022 pain.001.001.09 schema into backend/schemas/.

    python scripts/fetch_iso_schema.py

Once the file is there, every payment file the money layer generates is validated
against it (the response says "official XSD pain.001.001.09"). If the download is
blocked, get the file from the ISO 20022 message catalogue
(https://www.iso20022.org/iso-20022-message-definitions, Payments Initiation, pain.001.001.09)
and save it as backend/schemas/pain.001.001.09.xsd.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx

URL = "https://www.iso20022.org/sites/default/files/documents/messages/pain/schemas/pain.001.001.09.xsd"
NS = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"
OUT = Path(__file__).resolve().parents[1] / "schemas" / "pain.001.001.09.xsd"


def main() -> int:
    try:
        r = httpx.get(URL, timeout=60, follow_redirects=True)
        r.raise_for_status()
    except httpx.HTTPError as e:
        print(f"download failed ({type(e).__name__}); save the file by hand, see the note at the top of this script")
        return 1
    if f'targetNamespace="{NS}"' not in r.text:
        print("downloaded file is not the pain.001.001.09 schema; save it by hand, see the note at the top of this script")
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(r.content)
    print(f"saved {OUT} ({len(r.content):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
