"""Add the app's editable input sheets to raah-dataset.xlsx.

Safe to re-run: a sheet that already exists is left untouched, so your edits
are never overwritten. Delete a sheet in Excel first if you want it re-seeded.

Usage:  python scripts/add_app_sheets.py [path/to/raah-dataset.xlsx]
"""
import sys
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

DEFAULT = Path(__file__).resolve().parents[3] / "raah-dataset.xlsx"
EST = "Estimate - not verified, replace with a sourced figure"

HEAD_FILL = PatternFill("solid", fgColor="1F4E79")
HEAD_FONT = Font(bold=True, color="FFFFFF")
NOTE_FILL = PatternFill("solid", fgColor="FFF2CC")

SHEETS = {}

# ---------------------------------------------------------------- Assumptions
SHEETS["Assumptions"] = (
    ["Key", "Value", "Unit", "What it is used for", "Source / status"],
    [
        ["fare_per_km", 1.0, "₹ per km", "Commute cost = km × 2 (return) × fare × study days", EST + " (MSRTC student pass rate)"],
        ["study_days_per_year", 220, "days", "Days a student travels to the institute each year", EST],
        ["hostel_cost_per_month", 3000, "₹ per month", "Used instead of commute when hostel = yes", EST],
        ["working_days_per_month", 22, "days", "Turns the PLFS casual daily wage (CAR40) into a monthly baseline", EST],
        ["income_low_factor", 0.75, "× median", "Low income = median × this, when the source gives only one figure", "App assumption (shown on screen)"],
        ["income_high_factor", 1.25, "× median", "High income = median × this, when the source gives only one figure", "App assumption (shown on screen)"],
        ["payback_horizon_months", 120, "months", "How far the payback chart looks ahead", "App setting"],
        ["stack_scholarships", 0, "0 = no, 1 = yes", "0: only the single best eligible scholarship counts (most schemes forbid holding two)", "App setting"],
        ["default_family_contribution_per_month", 0, "₹ per month", "Starting value of the what-if slider", "App setting"],
        ["max_commute_slider_km", 60, "km", "Upper end of the commute slider", "App setting"],
        ["months_paid_per_year", 10, "months", "Monthly scholarship allowances are paid for this many months a year (e.g. SCH09, SCH17 say 10)", "From SCH09 / SCH17 text"],
    ],
)

# ---------------------------------------------------------------- Plan_Inputs
# Blank cells mean "take it from the dataset sheets" (see README).
SHEETS["Plan_Inputs"] = (
    ["Plan ID", "Career ID", "Path shown to student", "Steps (use ; between steps)", "Course months",
     "Earning-while-training months", "Course fees total (₹)", "Exam / admission fees (₹)", "Materials / tools (₹)",
     "Linked course ID", "Course tags", "Centre type", "Income low (₹/month)", "Income median (₹/month)",
     "Income high (₹/month)", "Fee source / status"],
    [
        ["PLN01", "CAR25", "ANM nursing (after Class 12)", "Class 11-12 (any stream); ANM course at an MSBNPE school (2 yrs); Register with Maharashtra Nursing Council; Job: sub-centre / hospital", 48, 0, 80000, 3000, 6000, None, "post_matric; nursing_diploma", "Nursing school (ANM)", None, None, None, EST],
        ["PLN02", "CAR32", "B.Sc degree (govt / aided college)", "Class 11-12 science; 3-year B.Sc; Job or further study", 60, 0, 30000, 3000, 6000, None, "post_matric; ug; science_degree", None, None, None, None, EST],
        ["PLN03", "CAR01", "Electrician via Govt ITI", "Govt ITI Electrician (2 yrs); NAPS / railway apprenticeship (1 yr, paid); Job: electrician / MSEDCL / industry", 24, 12, 4000, 1000, 5000, None, "post_matric; iti_govt", "Government ITI", None, None, None, EST],
        ["PLN04", "CAR24", "GNM nursing (after Class 12)", "Class 11-12; GNM diploma (3 yrs); Register as nurse; Job: hospital / NORCET", 60, 0, 180000, 5000, 8000, None, "post_matric; nursing_diploma", "Nursing school (GNM)", None, None, None, EST],
        ["PLN05", "CAR34", "Beautician (short skill course)", "Free Skill India / NCERT beauty course; Practice in a salon; Own salon / home service", 4, 0, 0, 0, 5000, "CRS19", "skill_short", None, None, None, None, EST],
        ["PLN06", "CAR33", "Tailoring (short course + own work)", "Skill India tailoring course; Buy a sewing machine; Own tailoring work", 3, 0, 0, 0, 10000, None, "skill_short", None, None, None, None, EST],
        ["PLN07", "CAR35", "Mobile phone repair", "Free SIDH Mobile Phone Hardware Repair course; Work in a repair shop; Own shop", 3, 0, None, 0, 8000, "CRS03", "skill_short", None, None, None, None, EST],
    ],
)

# ---------------------------------------------------------------- Eligibility_Rules
# Value "@income" = the number in the Scholarships "Income limit" cell for that scheme.
SHEETS["Eligibility_Rules"] = (
    ["Scheme ID", "Field", "Operator", "Value", "Label shown to student", "Document needed", "Where to get it"],
    [
        ["SCH01", "class", "in", "9;10;11;12", "Studying in Class 9-12", None, None],
        ["SCH01", "exams_passed", "has", "nmms", "Selected in NMMS exam (Class 8)", None, None],
        ["SCH01", "marks_pct", ">=", "55; SC=50; ST=50", "≥55% marks (50% SC/ST)", "marksheet_7", "Your school"],
        ["SCH01", "school_type", "in", "government;aided;local_body", "Govt / aided / local body school", "school_bonafide", "Your school office"],
        ["SCH01", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH02", "class", "in", "9;10", "Studying in Class 9-10", None, None],
        ["SCH02", "category", "in", "OBC;EBC;DNT", "OBC / EBC / DNT category", "caste_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH02", "school_type", "in", "government", "Government school", None, None],
        ["SCH02", "family_income_annual", "<", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH03", "course_tags", "any", "post_matric", "Studying after Class 10", None, None],
        ["SCH03", "category", "in", "OBC;EBC;DNT", "OBC / EBC / DNT category", "caste_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH03", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH03", "documents", "has", "marksheet_10", "Last marksheet", "marksheet_10", "Your school"],
        ["SCH04", "class", "in", "9;11", "Entering Class 9 or 11", None, None],
        ["SCH04", "category", "in", "OBC;EBC;DNT", "OBC / EBC / DNT category", "caste_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH04", "marks_pct", ">=", "60", "≥60% in Class 8 or 10", "marksheet_10", "Your school"],
        ["SCH04", "school_type", "in", "top_class", "Admitted to a notified Top Class School", None, None],
        ["SCH04", "has_bank_account", "is", "true", "Aadhaar-seeded bank account", "bank_passbook", "Any bank branch / India Post Payments Bank"],
        ["SCH04", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH05", "class", "in", "9;10", "Studying in Class 9-10", None, None],
        ["SCH05", "category", "in", "SC", "SC category", "caste_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH05", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH06", "class", "in", "1;2;3;4;5;6;7;8;9;10", "Studying in Class 1-10", None, None],
        ["SCH06", "parent_hazardous_occupation", "is", "true", "Parent works in a listed unclean / hazardous occupation", "occupation_certificate", "Gram panchayat / municipal office"],
        ["SCH07", "course_tags", "any", "post_matric", "Studying after Class 10", None, None],
        ["SCH07", "category", "in", "SC", "SC category", "caste_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH07", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH08", "course_tags", "any", "ug;pg", "Enrolled in UG / PG", None, None],
        ["SCH08", "class12_percentile", ">=", "80", "Above 80th percentile in Class 12", "marksheet_12", "Your junior college"],
        ["SCH08", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH09", "gender", "in", "F", "Girl student", None, None],
        ["SCH09", "course_tags", "any", "aicte_technical", "1st year of an AICTE degree / diploma", "admission_letter", "Your institute"],
        ["SCH09", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH10", "disability_pct", ">=", "40", "Disability of 40% or more", "disability_certificate", "District civil hospital (UDID card)"],
        ["SCH10", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH11", "course_tags", "any", "science_degree", "B.Sc / M.Sc in natural sciences", None, None],
        ["SCH11", "class12_top1pct", "is", "true", "Top 1% in Class 12 board (or JEE/NEET rank)", "marksheet_12", "Your junior college"],
        ["SCH12", "course_tags", "any", "technical_professional", "Technical / professional course via CAP", "cap_document", "CAP admission letter"],
        ["SCH12", "category", "in", "General;EWS;EBC", "EBC / EWS (open category)", None, None],
        ["SCH12", "domicile", "in", "Maharashtra", "Maharashtra domicile", "domicile_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH12", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH13", "stays_in_hostel", "is", "true", "Lives in hostel / rented room for studies", "hostel_proof", "Hostel warden / rent agreement"],
        ["SCH13", "course_tags", "any", "post_matric", "Studying after Class 10", None, None],
        ["SCH13", "domicile", "in", "Maharashtra", "Maharashtra domicile", "domicile_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH13", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH14", "course_tags", "any", "iti_govt", "Trainee at a Government ITI", None, None],
        ["SCH14", "domicile", "in", "Maharashtra", "Maharashtra domicile", "domicile_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH14", "has_bank_account", "is", "true", "Aadhaar-seeded bank account", "bank_passbook", "Any nationalised bank branch"],
        ["SCH14", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH15", "gender", "in", "F", "Girl student", None, None],
        ["SCH15", "course_tags", "any", "medical_degree", "MBBS / BDS / B.Sc Nursing etc.", None, None],
        ["SCH15", "category", "in", "General;EWS;EBC;SEBC", "Admitted under General or SEBC", None, None],
        ["SCH15", "domicile", "in", "Maharashtra", "Maharashtra domicile", "domicile_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH15", "family_income_annual", "<", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH16", "course_tags", "any", "post_matric", "Studying after Class 10", None, None],
        ["SCH16", "category", "in", "OBC", "OBC category", "caste_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH16", "domicile", "in", "Maharashtra", "Maharashtra resident", "domicile_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH16", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH17", "course_tags", "any", "post_matric", "Studying after Class 10", None, None],
        ["SCH17", "category", "in", "SC;Navbouddha", "SC / Navbouddha category", "caste_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH17", "domicile", "in", "Maharashtra", "Maharashtra resident", "domicile_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
        ["SCH17", "family_income_annual", "<=", "@income", "Family income within limit", "income_certificate", "Tehsil office or Aaple Sarkar Seva Kendra"],
    ],
)

# ---------------------------------------------------------------- Career_Profile (matching)
CP = [
    # id, tags, min class, stream, local demand
    ("CAR01", "electrical; hands-on; machines; fixing things", 10, "any", 5),
    ("CAR02", "electrical; outdoor; hands-on", 10, "any", 4),
    ("CAR03", "machines; hands-on; manufacturing", 10, "any", 5),
    ("CAR04", "machines; hands-on; metal", 10, "any", 4),
    ("CAR05", "vehicles; machines; fixing things", 10, "any", 4),
    ("CAR06", "machines; precision; manufacturing", 10, "any", 4),
    ("CAR07", "art; hands-on; manufacturing", 10, "any", 3),
    ("CAR08", "wood; hands-on; building", 10, "any", 3),
    ("CAR09", "fixing things; electrical; machines", 10, "any", 4),
    ("CAR10", "computers; machines; precision", 10, "any", 4),
    ("CAR11", "vehicles; manufacturing; teamwork", 8, "any", 5),
    ("CAR12", "electronics; manufacturing", 10, "any", 4),
    ("CAR13", "science; health; manufacturing", 10, "any", 3),
    ("CAR14", "organising; logistics; leadership", 10, "any", 4),
    ("CAR15", "machines; art; manufacturing", 10, "any", 3),
    ("CAR16", "discipline; outdoor; helping people", 10, "any", 3),
    ("CAR17", "talking to people; sales; travel", 10, "any", 4),
    ("CAR18", "computers; organising; office", 10, "any", 3),
    ("CAR19", "talking to people; office; organising", 12, "any", 3),
    ("CAR20", "computers; fixing things; helping people", 12, "any", 4),
    ("CAR21", "languages; office; typing", 10, "any", 2),
    ("CAR22", "engineering; maths; machines", 12, "science", 4),
    ("CAR23", "engineering; maths; machines", 10, "any", 4),
    ("CAR24", "helping people; health; biology", 12, "any", 5),
    ("CAR25", "helping people; health; biology; community", 12, "any", 5),
    ("CAR26", "discipline; sports; outdoor; country", 10, "any", 3),
    ("CAR27", "government job; outdoor; discipline", 10, "any", 3),
    ("CAR28", "government job; community; office", 10, "any", 3),
    ("CAR29", "government job; community; travel", 10, "any", 3),
    ("CAR30", "machines; government job; hands-on", 10, "any", 4),
    ("CAR31", "science; biology; research; maths", 12, "science", 2),
    ("CAR32", "science; biology; reading; teaching; office", 12, "any", 3),
    ("CAR33", "art; design; clothes; hands-on", 0, "any", 3),
    ("CAR34", "art; beauty; talking to people", 0, "any", 4),
    ("CAR35", "electronics; fixing things; phones", 0, "any", 4),
    ("CAR36", "electrical; outdoor; environment", 0, "any", 4),
    ("CAR37", "animals; farming; business", 0, "any", 4),
    ("CAR38", "sales; talking to people; business", 0, "any", 4),
    ("CAR39", "electrical; building; hands-on", 0, "any", 4),
]
SHEETS["Career_Profile"] = (
    ["Career ID", "Interest tags (use ;)", "Min class", "Stream needed", "Local demand (1-5)", "Status"],
    [[i, t, c, s, d, "App input for matching - demand is an estimate, edit freely"] for i, t, c, s, d in CP],
)

# ---------------------------------------------------------------- Talukas
TALUKAS = [
    ("Haveli", 18.5204, 73.8567), ("Pune city", 18.5204, 73.8567), ("Junnar", 19.2083, 73.8756),
    ("Ambegaon", 19.0301, 73.7980), ("Khed", 18.8590, 73.8850), ("Maval", 18.7464, 73.6416),
    ("Mulshi", 18.5236, 73.6110), ("Velhe", 18.2886, 73.6380), ("Bhor", 18.1512, 73.8443),
    ("Purandar", 18.3378, 74.0310), ("Baramati", 18.1514, 74.5815), ("Indapur", 18.1170, 75.0270),
    ("Daund", 18.4636, 74.5800), ("Shirur", 18.8270, 74.3740),
]
SHEETS["Talukas"] = (
    ["Taluka", "Lat", "Lon", "Status"],
    [[t, a, o, "Approximate taluka HQ point; used only when a centre has no Lat/Lon"] for t, a, o in TALUKAS],
)

# ---------------------------------------------------------------- Demo_Students
SHEETS["Demo_Students"] = (
    ["Student ID", "Name", "Age", "Gender", "Class", "Taluka", "Lat", "Lon", "Language", "Marks %",
     "Interests (use ;)", "Category", "Family income (₹/year)", "Max commute (km)", "Can stay in hostel",
     "School type", "Domicile", "Documents (use ;)", "Has bank account", "Exams passed (use ;)", "Note"],
    [
        ["STU01", "Priya", 15, "F", 10, "Junnar", 19.2000, 73.8800, "mr", 72, "helping people; biology; health",
         "OBC", 180000, 20, "no", "government", "Maharashtra", "aadhaar; marksheet_10; caste_certificate; domicile_certificate",
         "yes", None, "Hero demo profile (synthetic)"],
        ["STU02", "Rohan", 16, "M", 10, "Khed", 18.8600, 73.8900, "mr", 61, "machines; fixing things; electrical",
         "SC", 120000, 30, "yes", "government", "Maharashtra", "aadhaar; marksheet_10; caste_certificate; income_certificate",
         "yes", None, "Demo profile (synthetic)"],
        ["STU03", "Sana", 17, "F", 12, "Baramati", 18.1500, 74.5800, "hi", 84, "computers; maths; science",
         "General", 300000, 40, "yes", "aided", "Maharashtra", "aadhaar; marksheet_10; marksheet_12; income_certificate; domicile_certificate",
         "yes", None, "Demo profile (synthetic)"],
    ],
)


def style(ws, n_cols):
    for c in ws[1]:
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "B2"
    for col in ws.columns:
        letter = col[0].column_letter
        longest = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[letter].width = min(max(12, longest + 2), 60)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")


def main(path):
    wb = openpyxl.load_workbook(path)
    added = []
    for name, (head, rows) in SHEETS.items():
        if name in wb.sheetnames:
            continue
        ws = wb.create_sheet(name)
        ws.append(head)
        for r in rows:
            ws.append(r)
        style(ws, len(head))
        added.append(name)
    if "README" in wb.sheetnames and added:
        rd = wb["README"]
        rd.append([None])
        rd.append(["App input sheets (added for the Raah app; edit them like any other sheet, the app reloads on save)"])
        notes = {
            "Assumptions": "Assumptions - fare per km, study days, hostel cost etc. Yellow-flagged values are estimates to replace.",
            "Plan_Inputs": "Plan_Inputs - one row per career path for the cost & payback card. Blank income cells are filled from Careers_Income.",
            "Eligibility_Rules": "Eligibility_Rules - rule-by-rule checks per scholarship. Value '@income' reads the Income limit cell from Scholarships.",
            "Career_Profile": "Career_Profile - interest tags, minimum class and local demand used to rank careers.",
            "Talukas": "Talukas - approximate taluka points, used for distance only when a centre has no Lat/Lon.",
            "Demo_Students": "Demo_Students - synthetic hero profiles (Priya etc.) for the demo.",
        }
        for n in added:
            rd.append([notes.get(n, n)])
    wb.save(path)
    print("added:", added or "nothing (all sheets already exist)")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT)
