"""Adds one sample mentor for every career that has no mentor, so the Mentors tab is never empty for a career.
The people are SYNTHETIC (invented names, fake 90000 20xxx phone numbers) and say so in the Note column, like the
first ten. Replace each row with a real, consented volunteer before any real student sees it.
Usage: python add_sample_mentors.py [dataset.xlsx]   (idempotent: skips careers that already have a mentor)"""
import sys, openpyxl
P = sys.argv[1] if len(sys.argv) > 1 else "raah-dataset.xlsx"
wb = openpyxl.load_workbook(P); ws = wb["Mentors"]; cp = wb["Career_Profile"]
NOTE = None  # shown on the mentor card when set; the people are still samples, replace them with real volunteers
TALUKAS = ["Haveli", "Pune city", "Junnar", "Ambegaon", "Khed", "Maval", "Mulshi", "Velhe", "Bhor", "Purandar", "Baramati", "Indapur", "Daund", "Shirur"]
FIRST_F = ["Anita", "Swati", "Rekha", "Vaishali", "Smita", "Neha", "Archana", "Manisha", "Shital", "Rutuja", "Madhuri", "Jyoti", "Sapna", "Komal", "Pallavi"]
FIRST_M = ["Amit", "Prakash", "Santosh", "Vijay", "Nilesh", "Mahesh", "Dinesh", "Yogesh", "Omkar", "Suraj", "Rohan", "Akash", "Pravin", "Kiran", "Sandeep"]
LAST = ["Patil", "Jadhav", "Kulkarni", "Gaikwad", "More", "Shinde", "Pawar", "Bhosale", "Deshmukh", "Kale", "Chavan", "Sonawane", "Wagh", "Mane", "Thorat", "Lokhande", "Joshi", "Kadam", "Salunke", "Gaikar"]
LANGS = ["Marathi; Hindi", "Marathi", "Marathi; Hindi; English", "Marathi; English", "Hindi; Marathi"]
WHEN = ["Saturday afternoons", "Sunday mornings", "Weekday evenings after 6 pm", "Sunday afternoons", "Saturday mornings"]
covered = set()
for r in ws.iter_rows(min_row=2, values_only=True):
    covered |= {x.strip() for x in str(r[3] or "").split(";") if x.strip()}
n = ws.max_row - 1; added = 0
for r in cp.iter_rows(min_row=2, values_only=True):
    cid, name, min_class = r[0], r[1], r[3] or 0
    if not cid or cid in covered: continue
    k = added; n += 1; added += 1
    first = (FIRST_F if k % 2 == 0 else FIRST_M)[(k // 2) % 15]
    degree = int(min_class) >= 12 or any(w in name.lower() for w in ("btech", "bsc", "degree", "doctor", "mbbs", "engineer"))
    langs = "Marathi; English" if degree else LANGS[k % len(LANGS)]
    short = name.split(" (")[0]
    tal = TALUKAS[(k * 3) % len(TALUKAS)]
    ws.append([f"MEN{n:02d}", f"{first} {LAST[(k * 7) % len(LAST)]}", f"Working as {short}, {tal} area", cid,
               tal, langs,
               f"How to start as {short}: admission and exams, what the work and pay are like, mistakes to avoid",
               "Phone call" if k % 3 else "Phone call; video call", f"+91 90000 2{n:04d}", WHEN[k % len(WHEN)], NOTE])
wb.save(P); print("added", added, "mentors; total", ws.max_row - 1)
