"""Loads every Maharashtra government ITI (DVET EOI, Annexures 1-3) and every engineering college (State CET Cell seat matrix
2024-25) into Training_Centres. Needs: pdfplumber, pdftotext, indiapins (India Post office coordinates).
Usage: python load_statewide_centres.py <EOI.pdf> <SeatMatrix.pdf> [dataset.xlsx]
Run centres_statewide_and_fees.py afterwards to fill fees and the Career IDs column."""
import re, sys, subprocess, collections
import openpyxl, pdfplumber, indiapins
EOI, SEAT = sys.argv[1], sys.argv[2]
P = sys.argv[3] if len(sys.argv) > 3 else "raah-dataset.xlsx"
D = "2026-11-28"
ALIAS = {"ahilyanagar": "ahmednagar", "chh. sambhaji nagar": "aurangabad", "chhatrapati sambhajinagar": "aurangabad", "dharashiv": "osmanabad",
         "mumbai shahar": "mumbai", "raigad": "raigad", "beed": "beed"}
# ---- India Post offices in Maharashtra
offs = []
for p in indiapins.pincodes_in_state("Maharashtra"):
    for o in indiapins.matching(str(p)):
        if str(o.get("State")).upper() == "MAHARASHTRA" and o.get("District"):
            try: la, lo = float(o["Latitude"]), float(o["Longitude"])
            except Exception: continue
            if 15 < la < 23 and 72 < lo < 81:
                nm = re.sub(r"\s+(S\.O|B\.O|H\.O|G\.P\.O).*$", "", o["Name"], flags=re.I).strip().lower()
                offs.append((nm, o["District"].lower(), la, lo))
bydist = collections.defaultdict(list)
for nm, d, la, lo in offs: bydist[d].append((la, lo))
def dkey(d):
    d = (d or "").lower().strip(); return ALIAS.get(d, d)
PLACE_ALIAS = {"aurangabad": "chhatrapati sambhajinagar", "osmanabad": "dharashiv", "ahmednagar": "ahilyanagar", "chh. sambhaji nagar": "chhatrapati sambhajinagar"}
GENERIC = set("college of engineering technology institute institution education society trust campus group management studies and the for women polytechnic faculty university department tal dist district taluka at post sanstha mandal shikshan prasarak vidya pratishthan foundation school sciences research centre center academy".split())
def resolve(place, district=None):
    pl = (place or "").lower().strip()
    pl = PLACE_ALIAS.get(pl, pl)
    dk = dkey(district)
    cands = [o for o in offs if (o[0] == pl or o[0].startswith(pl + " ") or o[0].startswith(pl + "(")) and (not dk or o[1] == dk)]
    if not cands and not dk:
        cands = [o for o in offs if o[0] == pl]
    if cands:
        return sum(c[2] for c in cands) / len(cands), sum(c[3] for c in cands) / len(cands), "place"
    pts = bydist.get(dk)
    if pts:
        return sum(a for a, _ in pts) / len(pts), sum(b for _, b in pts) / len(pts), "district"
    return None
wb = openpyxl.load_workbook(P)
tc, tk = wb["Training_Centres"], wb["Talukas"]
h = [c.value for c in tc[1]]; col = {n: i + 1 for i, n in enumerate(h)}
tk_h = [c.value for c in tk[1]]
have_tal = {str(r[0].value).strip().lower() for r in tk.iter_rows(min_row=2) if r[4].value == "Maharashtra"}
tal_district = {}
def ensure_taluka(name, district, point):
    k = name.lower()
    if k in have_tal or not point: return
    tk.append([name, round(point[0], 4), round(point[1], 4), "Approximate point from India Post pincode locations", "Maharashtra", district]); have_tal.add(k)
# ---- remove rows this script replaces
dele = [r[0].row for r in tc.iter_rows(min_row=2) if r[col["Type"] - 1].value == "College of Engineering" or "mahaswayam" in str(r[col["Source"] - 1].value)]
for ri in reversed(dele): tc.delete_rows(ri)
next_id = lambda: "CEN%02d" % tc.max_row
existing = " ".join(str(r[col["Name"] - 1].value).lower() for r in tc.iter_rows(min_row=2))
# ---- ITIs
pdf = pdfplumber.open(EOI)
iti = []
for pn in range(19, 35):
    for t in pdf.pages[pn].extract_tables():
        for r in t:
            if r and r[0] and r[0].strip().isdigit() and r[1] and "GITI" in r[1]:
                iti.append((" ".join(r[1].split()), (r[2] or "").strip()))
SRC = "https://www.mahaswayam.gov.in/public/img/news/EOI_PPP_DVET_13Oct2025_vf.pdf (Annexures 1-3)"
added = 0
for name, dist in iti:
    if dist.lower() == "pune": continue  # the 16 Pune ITIs are already in the sheet with their NCVT codes
    tal = re.search(r"Tal:\s*([^,]+?)\s*,\s*Dist", name)
    segs = [s.strip() for s in name.split(",")]
    place = next((s for s in segs if s and not s.upper().startswith("GITI") and not s.startswith("(") and not s.startswith("Tal:") and not s.startswith("Dist:")), dist)
    place = re.sub(r"\s*\(.*?\)", "", place).strip() or place
    tname = (tal.group(1) if tal else place).strip()
    pt = resolve(tname, dist) or resolve(place, dist)
    ensure_taluka(tname, dist, pt)
    tc.append([next_id(), name.replace(f", Dist: {dist}", "").replace("GITI,", "GITI").replace("GITI (", "GITI (").strip(), "Government ITI", tname, dist,
               f"Tal: {tname}, Dist: {dist}", "ITI trades (Craftsman Training Scheme)", None, None, None, None, None,
               "Government ITI listed in the DVET Maharashtra PPP EOI (13 Oct 2025); location is placed at its town or taluka, so distance is approximate", SRC, D, None])
    added += 1
print("ITIs added", added)
# ---- engineering colleges from the seat matrix
txt = subprocess.run(["pdftotext", "-layout", SEAT, "-"], capture_output=True, text=True).stdout.split("\n")
pat = re.compile(r"^\s*(\d{5}) - (.+?)\s*$"); cpat = re.compile(r"^\s+(\d{10})\s+(\S.*?)\s{2,}")
inst, cur = {}, None
for i, l in enumerate(txt):
    m = pat.match(l)
    if m:
        cur = m.group(1)
        if cur not in inst:
            inst[cur] = {"name": m.group(2).strip(), "status": txt[i + 1].strip().split("  ")[0], "courses": []}
        continue
    m = cpat.match(l)
    if m and cur and m.group(2) not in inst[cur]["courses"]: inst[cur]["courses"].append(m.group(2))
SEATSRC = "https://fe2025.mahacet.org/2024/2024SeatMatrix.pdf"
GOVF = "About ₹80,000 a year (government engineering college; ₹80,850 in the first year at Government College of Engineering Karad, 2024-25, with development fee)"
PVTF = "About ₹1,50,000 a year (typical private or aided engineering college; top private colleges charge ₹3-5 lakh a year)"
unres = 0
for code, v in inst.items():
    name = v["name"]
    tail = re.split(r"[,]", name)[-1].strip()
    place = re.sub(r"^(tal\.?|dist\.?)\s*", "", tail, flags=re.I).strip(" .()")
    pt = resolve(place)
    if not pt:
        toks = [t for t in re.split(r"[\s,().\-/]+", name) if len(t) > 3 and t.lower() not in GENERIC]
        for t in reversed(toks):
            r2 = resolve(t) if any(o[0] == PLACE_ALIAS.get(t.lower(), t.lower()) or o[0].startswith(PLACE_ALIAS.get(t.lower(), t.lower()) + " ") for o in offs) else None
            if r2 and r2[2] == "place":
                pt, place = r2, t; break
    unres += pt is None
    dist = None
    if pt:
        best = min(offs, key=lambda o: (o[2] - pt[0]) ** 2 + (o[3] - pt[1]) ** 2); dist = best[1].title()
    ensure_taluka(place, dist or "", pt)
    courses = v["courses"]
    cs = ", ".join(courses[:10]) + (f" and {len(courses) - 10} more" if len(courses) > 10 else "")
    gov = v["status"].lower().startswith("government") or v["status"].lower().startswith("university")
    tc.append([next_id(), name, "College of Engineering", place, dist, place + (f", {dist}" if dist else ""), cs or "Engineering degree programmes", None,
               GOVF if gov else PVTF, code, None, None,
               f"Status: {v['status']}. Listed in the State CET Cell provisional seat matrix for CAP round I, A.Y. 2024-25; located at its town, so distance is approximate", SEATSRC, D, None])
print("engineering added", len(inst), "unresolved places", unres)
wb.save(P)
