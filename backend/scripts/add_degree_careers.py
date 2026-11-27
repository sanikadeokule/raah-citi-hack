"""Add degree-type careers (BSc CS, BCA, BTech CSE, BCom, computer diploma) to raah-dataset.xlsx.

Run from backend/:  python scripts/add_degree_careers.py [path-to-xlsx]
Idempotent: rows whose ID already exists are left alone. Edit the sheet afterwards if a figure is wrong.
Pay comes from Occupation_Earnings (PLFS 2025 'Graduate' / 'Professionals' / 'Technicians'), not from a degree-specific source,
and the Income status column says so.
"""
import sys
from pathlib import Path

import openpyxl

PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "raah-dataset.xlsx"
PLFS = ("https://www.mospi.gov.in/uploads/latestReleases/latest_release_1774607827733_3e8964a9-268b-4cc9-ad65-cfc8a9e32f08_"
        "Press_note_AR_PLFS_2025_23032025_V2.1_26032026_final.pdf ; https://indialabourobservatory.com/data/plfs-2025/earnings/")
CET = "https://cetcell.mahacet.org/ (MHT-CET is the Maharashtra entrance test for engineering)"
STATUS = "Salaried reference only (PLFS 2025 national average) - no degree-specific pay sourced"

# id, name, category, entry path, min qualification, group, source, tags, min class, stream, demand
ROWS = [
    ("CAR47", "BSc Computer Science (3-year degree)", "STEM (degree)",
     "Class 12 (any stream; Maths helps) → B.Sc Computer Science at a college → IT jobs or further study",
     "Class 12", "Graduate", PLFS, "computers; programming; maths; technology; reading", 12, "any", 4),
    ("CAR48", "BCA - Bachelor of Computer Applications (3-year degree)", "STEM (degree)",
     "Class 12 (any stream) → BCA at a college → software / IT support jobs or MCA",
     "Class 12", "Graduate", PLFS, "computers; programming; technology; office", 12, "any", 4),
    ("CAR49", "BTech / BE Computer Science or IT (4-year degree)", "STEM (degree)",
     "Class 12 Science (PCM) → MHT-CET / JEE → B.E./B.Tech Computer Science or IT",
     "Class 12 Science (PCM)", "Professionals", CET + " ; " + PLFS, "computers; programming; engineering; maths; technology", 12, "science", 5),
    ("CAR50", "BCom - Bachelor of Commerce (3-year degree)", "Non-STEM / degree",
     "Class 12 (any stream; Commerce helps) → B.Com at a college → accounts, banking, CA / MBA paths",
     "Class 12", "Graduate", PLFS, "business; accounts; maths; office; computers", 12, "any", 4),
    ("CAR51", "Diploma in Computer / IT Engineering (3-year polytechnic)", "STEM (diploma)",
     "Class 10 → polytechnic diploma in Computer or IT engineering → technician jobs, or direct 2nd-year BTech",
     "Class 10", "Technicians and associate professionals", PLFS, "computers; programming; technology; engineering; maths", 10, "any", 4),
]

wb = openpyxl.load_workbook(PATH)
ci, cp = wb["Careers_Income"], wb["Career_Profile"]
head = [c.value for c in ci[1]]
have = {r[0].value for r in ci.iter_rows(min_row=2)}
for cid, name, cat, path, minq, group, src, tags, mc, stream, demand in ROWS:
    if cid in have:
        continue
    row = {"ID": cid, "Career": name, "Category": cat, "Entry path": path, "Minimum qualification": minq,
           "Income while training": "—", "Income after training / entry pay": f"See Occupation_Earnings: {group}",
           "Income type": "Salaried reference", "Source": src, "Last checked": "2026-11-17",
           "Earnings group (Occupation_Earnings)": group, "Income status": STATUS}
    ci.append([row.get(h) for h in head])
    cp.append([cid, name, tags, mc, stream, demand, "App input for matching - demand is an estimate, edit freely"])
    print("added", cid, name)
wb.save(PATH)
