"""Fill the Talukas sheet with every state / UT, its districts and talukas (postal taluk), with an approximate map point.

Sources (both public, offline):
  * India Post pincode directory (data.gov.in OGD), via the npm package @optiwari.india/pincode-india (MIT):
    indian-pincode.json gives pincode -> state, district, taluk.
  * the PyPI package indiapins 1.1.0 (pins.json.bz2): pincode -> post-office latitude / longitude.
A taluka's point is the median of its pincodes' points. Talukas already in the sheet are kept as they are (same state + name).
Usage: python add_state_talukas.py <indian-pincode.json> <pins.json.bz2> [dataset.xlsx]
"""
import bz2, collections, json, statistics, sys
from pathlib import Path
import openpyxl

STATE_NAME = {"ANDAMAN & NICOBAR ISLANDS": "Andaman and Nicobar Islands", "JAMMU & KASHMIR": "Jammu and Kashmir",
              "DADRA & NAGAR HAVELI": "Dadra and Nagar Haveli", "DAMAN & DIU": "Daman and Diu", "CHATTISGARH": "Chhattisgarh",
              "PONDICHERRY": "Puducherry"}
STATUS = "Approximate point from India Post pincode locations"


def title(s):
    s = " ".join(str(s).replace("_", " ").split())
    return s.title().replace("&", "and")


def main(pin_json, pins_bz2, xlsx):
    taluk = {}
    for x in json.load(open(pin_json)).values():
        t, s, d = (x.get("taluk") or "").strip(), (x.get("state") or "").strip(), (x.get("district") or "").strip()
        if t and t.upper() != "NA" and s and d:
            taluk[str(x["pincode"])] = (STATE_NAME.get(s.upper(), title(s)), title(d), title(t))
    pts = collections.defaultdict(list)
    for line in bz2.open(pins_bz2, "rt"):
        if not line.strip():
            continue
        r = json.loads(line)
        la, lo = r.get("Latitude"), r.get("Longitude")
        try:
            la, lo = float(la), float(lo)
        except (TypeError, ValueError):
            continue
        if 6 <= la <= 38 and 68 <= lo <= 98:
            pts[str(r["Pincode"])].append((la, lo))
    groups = collections.defaultdict(list)
    for pin, key in taluk.items():
        if pin in pts:
            la = statistics.median(p[0] for p in pts[pin]); lo = statistics.median(p[1] for p in pts[pin])
            groups[key].append((la, lo))
    wb = openpyxl.load_workbook(xlsx)
    ws = wb["Talukas"]
    head = [c.value for c in ws[1]]
    for col in ("State", "District"):
        if col not in head:
            ws.cell(1, ws.max_column + 1, col)._style = ws.cell(1, 1)._style
            head.append(col)
    si, di = head.index("State") + 1, head.index("District") + 1
    existing = set()
    for r in range(2, ws.max_row + 1):
        if not ws.cell(r, si).value:
            ws.cell(r, si, "Maharashtra"); ws.cell(r, di, "Pune")  # the original Pune-area rows
        existing.add((ws.cell(r, si).value, str(ws.cell(r, 1).value).lower()))
    n = 0
    for (s, d, t), ps in sorted(groups.items()):
        if (s, t.lower()) in existing:
            continue
        existing.add((s, t.lower()))
        row = ws.max_row + 1
        for c, v in enumerate([t, round(statistics.median(p[0] for p in ps), 4), round(statistics.median(p[1] for p in ps), 4), STATUS, s, d], 1):
            ws.cell(row, c, v)
        n += 1
    wb.save(xlsx)
    print(n, "talukas added;", len({k[0] for k in groups}), "states / UTs")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).resolve().parents[2] / "raah-dataset.xlsx"))
