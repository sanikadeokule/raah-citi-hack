"""Adds a "Career type" column to Career_Profile (Vocational / Diploma / Degree / Government job) from each career's roadmap path.
Shown as a small tag on the career cards. Edit a cell in the sheet to change a career's tag.
Usage: python add_career_type.py [dataset.xlsx]"""
import sys, openpyxl
P = sys.argv[1] if len(sys.argv) > 1 else "raah-dataset.xlsx"
TYPE = {"skill_short": "Vocational", "iti": "Vocational", "apprentice": "Vocational", "apprentice_12": "Vocational", "railway_apprentice": "Vocational",
        "diploma": "Diploma", "nursing_gnm": "Diploma", "nursing_anm": "Diploma",
        "degree": "Degree", "engineering": "Degree", "science_research": "Degree", "medical": "Degree", "engineering_apprentice": "Degree",
        "govt_class10": "Government job", "govt_alp": "Government job", "defence_10": "Government job", "defence_12": "Government job", "police": "Government job"}
wb = openpyxl.load_workbook(P); ws = wb["Career_Profile"]
h = [c.value for c in ws[1]]
if "Career type" not in h:
    ws.cell(1, len(h) + 1, "Career type"); h.append("Career type")
col = h.index("Career type") + 1; path = h.index("Roadmap path")
miss = []
for row in ws.iter_rows(min_row=2):
    if not row[0].value: continue
    t = TYPE.get(str(row[path].value or "").strip())
    if t is None: miss.append(row[0].value)
    elif not row[col - 1].value: row[col - 1].value = t
wb.save(P); print("set", ws.max_row - 1 - len(miss), "missing", miss)
