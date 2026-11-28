"""Loads MSBTE-affiliated institutes (2026-27) into Training_Centres: polytechnics, pharmacy colleges, paramedical/DMLT institutes.
Input JSON comes from online.msbte.co.in/msbte26/auth/search-institute (Advanced search, all defaults); rows are
[sr, inst_code, inst_id, status, region, type, "NAME - District", intake, enrolled].
Usage: python load_msbte_institutes.py <msbte_institutes_2026.json> [dataset.xlsx]   (needs indiapins, openpyxl)"""
import re, sys, json, collections
import openpyxl, indiapins
J = sys.argv[1]; P = sys.argv[2] if len(sys.argv) > 2 else "raah-dataset.xlsx"
D = "2026-11-28"; SRC = "https://online.msbte.co.in/msbte26/auth/search-institute (MSBTE 2026-27 affiliated institutes)"
PLACE_ALIAS = {"chhatrapati sambhaji nagar": "aurangabad", "dharashiv": "osmanabad", "ahilyanagar": "ahmednagar"}
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
def mean(c):
    c = [x[-2:] for x in c]; return sum(x[0] for x in c) / len(c), sum(x[1] for x in c) / len(c)
GENERIC = set("college of engineering technology technical institute education society trust campus management studies and the for women polytechnic sanstha mandal shikshan prasarak pharmacy pharmaceutical diploma paramedical medical science sciences research centre center academy foundation education's society's".split())
def locate(name, district):
    dk = PLACE_ALIAS.get(district.lower(), district.lower())
    toks = [t.strip(".,()'\\").lower() for t in re.split(r"[\s,/]+", name)]
    toks = [t for t in toks if len(t) > 3 and t not in GENERIC]
    for t in reversed(toks):
        c = [o for o in offs if (o[0] == t or o[0].startswith(t + " ")) and (o[1] == dk or dk in ("undefined", ""))]
        if c: return t.title(), mean(c), "place"
    if dk in bydist: return district, mean(bydist[dk]), "district"
    return district, None, None
def cls(n):
    u = n.upper()
    if re.search(r"ARCHITECT|INTERIOR|FIRE|SAFETY|DESIGN|HMCT|HOTEL|MANAGEMENT|COMMERCE|ARTS", u) and "POLYTECH" not in u: return None
    if "PHARM" in u: return "pharm"
    if re.search(r"PARAMEDIC|PARA MEDIC|DMLT|MLT|LABORATORY|MEDICAL|HEALTH|PATHOLOGY|NURSING|HOSPITAL", u): return "para"
    return "poly"
d = json.load(open(J)); ids = {}
for k, v in d.items():
    if k != "cols":
        for r in v: ids.setdefault(r[2], r)
wb = openpyxl.load_workbook(P); tc, tk = wb["Training_Centres"], wb["Talukas"]
h = [c.value for c in tc[1]]; col = {n: i for i, n in enumerate(h)}
dele = [r[0].row for r in tc.iter_rows(min_row=2) if "online.msbte.co.in" in str(r[col["Source"]].value)]
for ri in reversed(dele): tc.delete_rows(ri)
have_tal = {str(r[0].value).strip().lower() for r in tk.iter_rows(min_row=2) if r[4].value == "Maharashtra"}
nid = lambda: "CEN%02d" % tc.max_row
FEE = {"poly": {"gov": "About ₹7,000 a year (government or aided polytechnic; about ₹19,850 for the full 3-year course at Government Polytechnic Karad)",
                "pvt": "About ₹55,000 a year (typical private unaided polytechnic, DTE fee range ₹40,000-70,000; government ₹7,000)"},
       "pharm": {"gov": "About ₹30,000 a year (government pharmacy: ₹25,000-40,000)", "pvt": "About ₹60,000 a year (private D.Pharm or B.Pharm: ₹60,000-1,20,000)"},
       "para": {"gov": "About ₹15,000 a year (government paramedical course)", "pvt": "About ₹40,000 a year (private DMLT, X-ray or paramedical diploma: ₹30,000-60,000)"}}
TYPE = {"poly": "Polytechnic", "pharm": "Allied health / pharmacy college", "para": "Allied health / pharmacy college"}
COURSE = {"poly": "Diploma engineering (3 years, MSBTE)", "pharm": "D.Pharm / pharmacy programmes", "para": "Paramedical diplomas (DMLT, X-ray, etc.)"}
CAR = {"poly": "CAR23;CAR51", "pharm": "CAR53", "para": "CAR52;CAR54;CAR55"}
cnt = collections.Counter(); nocoord = 0
# MSBTE lists some institutes twice under one name (two institute codes); show each name once per district, keeping the larger intake
best = {}
for r in ids.values():
    if r[3] != "Affiliated": continue
    full = r[6].replace("\\'", "'"); name, _, dist = full.rpartition(" - ")
    c = cls(name)
    if not c: continue
    if name.strip().upper() == "GOVERNMENT POLYTECHNIC" and dist not in ("", "undefined"):
        name = f"Government Polytechnic, {dist}"  # many districts have an institute with just this name
    k = (" ".join(name.lower().split()), dist)
    def intake(x):
        try: return int(x[7])
        except Exception: return 0
    if k not in best or intake(r) > intake(best[k][0]): best[k] = (r, name, dist, c)
for r, name, dist, c in best.values():
    place, pt, how = locate(name, dist)
    if dist == "undefined": dist = ""
    gov = r[5].lower().startswith("government")
    if pt and place.lower() not in have_tal:
        tk.append([place, round(pt[0], 4), round(pt[1], 4), "Approximate point from India Post pincode locations", "Maharashtra", dist]); have_tal.add(place.lower())
    nocoord += pt is None
    t = "Government Polytechnic" if c == "poly" and gov else TYPE[c]
    try: seats = int(r[7])
    except Exception: seats = None
    tc.append([nid(), " ".join(name.split()), t, place, dist, f"{place}, {dist}".strip(", "), COURSE[c], seats,
               FEE[c]["gov" if gov else "pvt"], r[1], None, None,
               f"MSBTE 2026-27 affiliated ({r[5]}); yearly intake {r[7]}; located at its town or district, so distance is approximate", SRC, D, CAR[c]])
    cnt[c] += 1
print(dict(cnt), "no coordinates:", nocoord)
wb.save(P)
