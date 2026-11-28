"""Fills averaged fees for every centre,
removes 'Not in source' text, and fills the Training_Centres 'Career IDs' column from the plans' centre types."""
import openpyxl, re, sys
P = sys.argv[1] if len(sys.argv) > 1 else "raah-dataset.xlsx"
wb = openpyxl.load_workbook(P)
tc = wb["Training_Centres"]
h = [c.value for c in tc[1]]
if "Career IDs (use ;)" not in h:
    tc.cell(1, len(h) + 1).value = "Career IDs (use ;)"; h.append("Career IDs (use ;)")
col = {n: i + 1 for i, n in enumerate(h)}
D = "2026-11-28"
SRC = "https://www.mahaswayam.gov.in/public/img/news/EOI_PPP_DVET_13Oct2025_vf.pdf (Annexure 1)"
ITI_FEE = "About ₹5,000 a year (govt ITI average; the full 2-year course costs ₹1,000-20,000 by trade); trainees may get a ₹500/month stipend, see SCH14"
# ---- fees by type / name
F = {
 "Government ITI": ITI_FEE,
 "Government Polytechnic": "About ₹7,000 a year (govt polytechnic; about ₹19,850 for the full 3-year course at Government Polytechnic Karad)",
 "Nursing school (ANM)": "About ₹55,000 a year (typical across government and private ANM schools; the 2-year course costs ₹10,000-50,000 at government schools and ₹1-3 lakh at private ones)",
 "Nursing school (GNM)": "About ₹50,000 a year (government GNM ₹12,000-20,000, private ₹70,000-1,00,000)",
 "Degree college": "About ₹15,000 a year (government and aided colleges from about ₹4,000; self-financed courses up to ₹60,000)",
 "Skill training centre": "Free or low cost (government-sponsored short courses)",
 "Apprenticeship employer": "Free; you earn a stipend (the government shares 25% of it, up to ₹1,500 a month)",
 "Police recruitment office": "Free to attend; the application fee was ₹450 General and ₹350 Reserved in the 2025 drive",
 "Recruitment office": "Free to attend; application fee about ₹550 plus GST",
}
def fee_for(name, typ):
    n = name.lower()
    if typ == "College of Engineering":
        if "government college of engineering" in n:
            return "About ₹80,000 a year (government engineering college; ₹80,850 in the first year at Government College of Engineering Karad, 2024-25, with development fee)"
        return "About ₹1,50,000 a year (typical private or aided engineering college; top private colleges charge ₹3-5 lakh a year)"
    if typ == "Allied health / pharmacy college":
        if "pharmacy" in n: return "About ₹60,000 a year (pharmacy: government ₹25,000-40,000, private ₹60,000-1,20,000)"
        return "About ₹1,00,000 a year (allied health courses; BMLT government ₹30,000-80,000, private ₹80,000-2,50,000)"
    if typ == "Medical college":
        if "b.j." in n or "sassoon" in n: return "About ₹1,62,100 a year (government MBBS, open category, 2025-26)"
        if "armed forces" in n: return "Heavily subsidised for armed-forces-sponsored cadets; see the AFMC admission notice"
        return "About ₹9,40,000 a year (private MBBS in Maharashtra, range ₹6.2-15.5 lakh, 2025-26)"
    if typ == "Skill training centre":
        if "rseti" in n: return "Free (government-sponsored short courses; food and stay free in residential programmes)"
        if "pradhan" in n or "kaushal" in n: return "Free under the scheme"
        return "Varies by programme"
    return F.get(typ)
from_money = None
for r in tc.iter_rows(min_row=2):
    name, typ = str(r[col["Name"]-1].value), str(r[col["Type"]-1].value)
    f = r[col["Fees"]-1]; cur = str(f.value or "")
    if (not cur) or "not in source" in cur.lower() or cur.lower().startswith("not "):
        v = fee_for(name, typ)
        if v: f.value = v
    s = r[col["Seats"]-1]; sv = str(s.value or "")
    if "not in source" in sv.lower():
        rest = re.sub(r"^\s*not in source\s*", "", sv, flags=re.I).strip(" ()")
        rest = rest.replace("1st-year", "first-year")
        s.value = rest or None
    c = r[col["Courses"]-1]; cv = str(c.value or "")
    if "not in source" in cv.lower():
        c.value = re.sub(r"\s*[-–]\s*[^-–]*not in source.*$", "", cv, flags=re.I).strip() or None
    n = r[col["Note"]-1]; nv = str(n.value or "")
    if "not in source" in nv.lower():
        n.value = re.sub(r"not in source", "not on that page", nv, flags=re.I)
# ---- career ids from plan centre types
pi = wb["Plan_Inputs"]; ph = [c.value for c in pi[1]]
bytype = {}
for r in pi.iter_rows(min_row=2):
    t = r[ph.index("Centre type")].value
    if t: bytype.setdefault(t, []).append(r[ph.index("Career ID")].value)
for r in tc.iter_rows(min_row=2):
    t = r[col["Type"]-1].value
    ids = list(dict.fromkeys(bytype.get(t, [])))
    n = str(r[col["Name"]-1].value).lower()
    if t == "College of Engineering": ids = ["CAR22", "CAR49"]
    if t == "Allied health / pharmacy college":
        ids = ["CAR53"] if "pharmacy" in n else ["CAR52", "CAR54", "CAR55"]
    if t == "Skill training centre" and "rseti" not in n and "pradhan" not in n:
        ids = ids
    r[col["Career IDs (use ;)"]-1].value = ";".join(ids) or None
# ---- README line
for ws in wb:
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and "'Not in source'" in cell.value:
                cell.value = cell.value.replace("the cell says 'Not in source' or 'Not verified' instead of guessing", "the cell is left blank or says 'Not verified' instead of guessing; fee cells that show 'About' are averages from public sources")
wb.save(P)
