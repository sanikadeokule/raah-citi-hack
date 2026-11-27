"""Add 15 careers expected to be in demand (health, digital, green energy, logistics, hospitality, retail).

Run from backend/:  python scripts/add_demand_careers.py [path-to-xlsx]
Idempotent: rows whose ID already exists are left alone.
Pay comes from Occupation_Earnings (PLFS 2025 groups), not from a career-specific source, and the Income status says so.
Demand scores are estimates (Career_Profile status column says so) - edit freely.
"""
import sys
from pathlib import Path

import openpyxl

PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "raah-dataset.xlsx"
PLFS = ("https://www.mospi.gov.in/uploads/latestReleases/latest_release_1774607827733_3e8964a9-268b-4cc9-ad65-cfc8a9e32f08_"
        "Press_note_AR_PLFS_2025_23032025_V2.1_26032026_final.pdf ; https://indialabourobservatory.com/data/plfs-2025/earnings/")
STATUS = "Salaried reference only (PLFS 2025 national average) - no career-specific pay sourced"
WEAK = " Group average may overstate pay for this role (gig / junior pay varies widely)."
T, C, S, P, R, M = ("Technicians and associate professionals", "Clerical support workers", "Service and sales workers",
                    "Professionals", "Craft and related trades workers", "Plant and machine operators and assemblers")

# id, name, category, entry path, min qualification, group, tags, min class, stream, demand, roadmap path, extra status
ROWS = [
 ("CAR52", "Medical Lab Technician (DMLT / B.Sc MLT)", "Health",
  "Class 12 Science → DMLT diploma or B.Sc MLT → lab at a hospital or diagnostic centre", "Class 12 Science", T,
  "health; biology; science; precision; hospital work; hands-on", 12, "science", 4, "diploma", ""),
 ("CAR53", "Pharmacy Assistant (D.Pharm)", "Health",
  "Class 12 Science → D.Pharm (2 years) → pharmacy or hospital store", "Class 12 Science", T,
  "health; science; customer service; record keeping; precision", 12, "science", 4, "diploma", ""),
 ("CAR54", "Radiology / X-ray Technician", "Health",
  "Class 12 Science → diploma in radiology → hospital or scan centre", "Class 12 Science", T,
  "health; technology; hospital work; precision; patient care", 12, "science", 4, "diploma", ""),
 ("CAR55", "Physiotherapy Assistant", "Health",
  "Class 12 Science → diploma or BPT → clinic or hospital", "Class 12 Science", T,
  "health; helping people; physical fitness; patient care; biology", 12, "science", 4, "diploma", ""),
 ("CAR56", "Data Entry / Back-office Operator", "Digital",
  "Class 10 or 12 → typing and computer course → office or BPO", "Class 10", C,
  "computers; typing; data entry; office; record keeping", 10, "any", 3, "skill_short", ""),
 ("CAR57", "Customer Support / BPO Executive", "Digital",
  "Class 12 → communication and computer basics → support or call centre", "Class 12", S,
  "customer service; talking to people; languages; computers; helping users", 12, "any", 4, "skill_short", ""),
 ("CAR58", "Web / App Developer (short-course path)", "Digital",
  "Class 12 → 6-12 month coding course or BCA → junior developer", "Class 12", P,
  "programming; computers; technology; problem solving; creativity", 12, "any", 4, "skill_short", WEAK),
 ("CAR59", "Graphic / Digital Designer", "Digital",
  "Class 12 → design course → studio, agency or freelance", "Class 12", T,
  "design; art; creativity; computers; technology", 12, "any", 3, "skill_short", ""),
 ("CAR60", "Solar Plant Technician (operation and maintenance)", "Green energy",
  "ITI Electrician or Class 10 → solar PV technician course → plant maintenance", "Class 10", R,
  "electrical; installing; environment; outdoor; technology; hands-on", 10, "any", 5, "iti", ""),
 ("CAR61", "Electric Vehicle (EV) Technician", "Green energy",
  "ITI or diploma → EV maintenance short course → dealer or service centre", "Class 10", R,
  "vehicles; electrical; electronics; fixing things; technology", 10, "any", 5, "iti", ""),
 ("CAR62", "Delivery / Last-mile Partner", "Logistics",
  "Class 10 plus driving licence → gig platform or courier", "Class 10", S,
  "driving; logistics; outdoor; being your own boss; travel", 10, "any", 4, "skill_short", WEAK),
 ("CAR63", "Commercial Vehicle Driver (HMV)", "Logistics",
  "Class 8-10 → LMV then HMV licence → transport company", "Class 10", M,
  "driving; vehicles; logistics; travel; heavy machines", 10, "any", 4, "skill_short", ""),
 ("CAR64", "Hotel / Restaurant Staff (front office, kitchen, service)", "Hospitality",
  "Class 10 or 12 → hotel management certificate or diploma → hotel or restaurant", "Class 10", S,
  "customer service; talking to people; teamwork; languages; cooking", 10, "any", 4, "skill_short", ""),
 ("CAR65", "Retail Store Associate", "Retail",
  "Class 10 or 12 → store job → supervisor", "Class 10", S,
  "sales; customer service; talking to people; teamwork; record keeping", 10, "any", 4, "skill_short", ""),
 ("CAR66", "Warehouse / Cold-chain Associate", "Logistics",
  "Class 10 → on-job training → e-commerce or food warehouse", "Class 10", C,
  "logistics; organising; physical fitness; teamwork; record keeping", 10, "any", 4, "skill_short", ""),
]

wb = openpyxl.load_workbook(PATH)
ci, cp = wb["Careers_Income"], wb["Career_Profile"]
head = [c.value for c in ci[1]]
have = {r[0].value for r in ci.iter_rows(min_row=2)}
for cid, name, cat, path, minq, group, tags, mc, stream, demand, rpath, extra in ROWS:
    if cid in have:
        continue
    row = {"ID": cid, "Career": name, "Category": cat, "Entry path": path, "Minimum qualification": minq,
           "Income while training": "—", "Income after training / entry pay": f"See Occupation_Earnings: {group}",
           "Income type": "Salaried reference", "Source": PLFS, "Last checked": "2026-11-27",
           "Earnings group (Occupation_Earnings)": group, "Income status": STATUS + extra}
    ci.append([row.get(h) for h in head])
    cp.append([cid, name, tags, mc, stream, demand, "App input for matching - demand is an estimate, edit freely", rpath])
    print("added", cid, name)
wb.save(PATH)
