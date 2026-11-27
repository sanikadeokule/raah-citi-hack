"""Tag the free courses and the lessons so Learn can show what fits a student's gaps.

Run from backend/:  python scripts/tag_courses_lessons.py [path-to-xlsx]
- Courses gets two columns: "Career IDs (use ;)" (careers the course serves) and "Skill tags (use ;)" (tags from Career_Profile).
- Lessons with an empty "Interest tags" cell get the tags of the careers they are about (the most common ones, up to 5).
Idempotent: filled cells are never overwritten. Edit the sheet afterwards if a tag is wrong.
"""
import collections
import sys
from pathlib import Path

import openpyxl

PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "raah-dataset.xlsx"

# course id: (career ids, skill tags)
COURSES = {
    "CRS01": ("CAR01; CAR39", "electrical; wiring; installing; hands-on"),
    "CRS02": ("CAR36; CAR60", "electrical; installing; environment; technology"),
    "CRS03": ("CAR35", "phones; electronics; fixing things; technology"),
    "CRS04": ("CAR38; CAR65", "sales; customer service; business; talking to people"),
    "CRS05": ("CAR37", "farming; animals; animal care; business"),
    "CRS06": ("CAR17", "sales; talking to people; business; customer service"),
    "CRS07": ("CAR01; CAR02", "electrical; wiring; electronics; technology"),
    "CRS08": ("CAR35", "phones; electronics; fixing things; technology"),
    "CRS09": ("CAR55", "physical fitness; sports; health"),
    "CRS10": ("CAR55; CAR25", "health; community health; biology"),
    "CRS11": ("CAR22; CAR23; CAR49; CAR51", "maths; engineering; science"),
    "CRS12": ("CAR22; CAR23; CAR49; CAR51", "engineering; machines; science"),
    "CRS13": ("", "accounts; banking; record keeping"),
    "CRS14": ("CAR24; CAR25", "health; women's health; community health; biology"),
    "CRS15": ("", "health; science; manufacturing"),
    "CRS16": ("", "hands-on; using tools; creativity"),
    "CRS17": ("", "hands-on; using tools; creativity"),
    "CRS18": ("", "hands-on; using tools; creativity"),
    "CRS19": ("CAR34", "beauty; art; customer service; hands-on"),
    "CRS20": ("CAR34", "beauty; art; customer service; hands-on"),
    "CRS21": ("CAR38; CAR65", "sales; customer service; business; organising"),
    "CRS22": ("CAR38; CAR65", "sales; customer service; business; talking to people"),
    "CRS23": ("CAR38; CAR17", "sales; talking to people; business; customer service"),
    "CRS24": ("CAR24; CAR25", "health; patient care; hospital work; first aid"),
    "CRS25": ("CAR24; CAR25", "health; patient care; hospital work; first aid"),
    "CRS26": ("CAR36; CAR60", "electrical; installing; environment; technology"),
}

wb = openpyxl.load_workbook(PATH)
vocab = set()
career_tags = {}
for r in wb["Career_Profile"].iter_rows(min_row=2, values_only=True):
    ts = [t.strip() for t in str(r[2] or "").split(";") if t.strip()]
    career_tags[r[0]] = ts
    vocab |= set(ts)
vocab.add("cooking")

cs = wb["Courses"]
head = [c.value for c in cs[1]]
for name in ("Career IDs (use ;)", "Skill tags (use ;)"):
    if name not in head:
        cs.cell(row=1, column=len(head) + 1, value=name)
        head.append(name)
ci, ti, ii = head.index("Career IDs (use ;)") + 1, head.index("Skill tags (use ;)") + 1, head.index("ID") + 1
for row in range(2, cs.max_row + 1):
    cid = cs.cell(row=row, column=ii).value
    if cid not in COURSES:
        continue
    ids, tags = COURSES[cid]
    bad = [t for t in tags.split("; ") if t not in vocab] + [c for c in ids.split("; ") if c and c not in career_tags]
    assert not bad, (cid, bad)
    if not cs.cell(row=row, column=ci).value:
        cs.cell(row=row, column=ci, value=ids or None)
    if not cs.cell(row=row, column=ti).value:
        cs.cell(row=row, column=ti, value=tags)

ls = wb["Lessons"]
lh = [c.value for c in ls[1]]
ids_col, tag_col = lh.index("Career IDs (use ;)") + 1, lh.index("Interest tags (use ;)") + 1
filled = 0
for row in range(2, ls.max_row + 1):
    careers = [c.strip() for c in str(ls.cell(row=row, column=ids_col).value or "").split(";") if c.strip()]
    if ls.cell(row=row, column=tag_col).value or not careers:
        continue
    count = collections.Counter(t for c in careers for t in career_tags.get(c, []))
    if count:
        ls.cell(row=row, column=tag_col, value="; ".join(t for t, _ in count.most_common(5)))
        filled += 1
wb.save(PATH)
print("lessons tagged:", filled)
