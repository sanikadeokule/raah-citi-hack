"""Add the career roadmap data to raah-dataset.xlsx.

Run from backend/:  python scripts/add_roadmap_sheet.py [path-to-xlsx]

- New sheet Roadmap_Stages: one generic stage template per path type (ITI, diploma, degree, engineering,
  nursing, government exam, defence, apprenticeship, short skill course ...). The app picks the stages that are
  still ahead of the student's current class and adds up fees, scholarships, stipends and first salary.
- New column 'Roadmap path' in Career_Profile: which template each career follows.

Idempotent: the sheet is only written if it does not exist yet, and a career's path is only filled if blank,
so edits made in Excel are kept. Every fee here is either from the Exams / Stipend_Rates sheets (sourced),
from a career's Plan_Inputs row, or marked 'Estimate - not verified'.
"""
import sys
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill

PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "raah-dataset.xlsx"
EST = "Estimate - not verified, replace with a sourced figure"
COEP = "https://www.coeptech.ac.in/wp-content/uploads/2026/09/Revised-Fee-Structure_First-Year_UG-_2026-27-3.pdf"
COEP_STATUS = ("Sourced - COEP Technological University Pune, first-year fee 2026-27: ₹11,760/yr payable for "
               "SC/ST/OBC-NCL (tuition reimbursed), ₹1,56,464/yr for Open; x4 years. Private colleges can cost more")
DGT = "https://rdsdewestbengal.dgt.gov.in/sites/default/files/2026-01/20250915_Upward%20revision_15.09.25.PDF"
NAPS = "https://www.apprenticeshipindia.gov.in"
DAY = "2026-11-17"

HEAD = ["Path type", "Step", "Kind", "Stage", "Stage (hi)", "Stage (mr)", "From class", "To class", "Months",
        "Fee low (₹, whole stage)", "Fee high (₹, whole stage)", "Use ₹ plan fees", "Course tags",
        "Exam IDs (use ;)", "Stipend category (Stipend_Rates)", "What to do", "Fee source / status", "Source", "Last checked"]

# shared stages ----------------------------------------------------------------------------------------------
S910 = ("school", "Finish Class 9-10 (SSC board)", "कक्षा 9-10 पूरी करें (SSC बोर्ड)", "इयत्ता 9-10 पूर्ण करा (SSC बोर्ड)",
        8, 10, 24, 0, 10000, "", "", "", "",
        "Pass the SSC (Class 10) board exam. Keep your marksheet safe: most admissions use Class 10 marks.", EST, "")


def s1112(stream_en, stream_hi, stream_mr, what):
    return ("school", f"Class 11-12 ({stream_en})", f"कक्षा 11-12 ({stream_hi})", f"इयत्ता 11-12 ({stream_mr})",
            10, 12, 24, 5000, 40000, "", "post_matric", "", "", what, EST, "")


ANY = s1112("any stream", "कोई भी स्ट्रीम", "कोणतीही शाखा", "Take admission in a junior college (11th) and pass the HSC (Class 12) board exam.")
SCI = s1112("Science - PCM", "विज्ञान - PCM", "विज्ञान - PCM", "Choose Science with Physics, Chemistry and Maths in 11th; pass HSC (Class 12).")
BIO = s1112("Science - Biology preferred", "विज्ञान - जीवविज्ञान", "विज्ञान - जीवशास्त्र",
            "Science with Biology is best for nursing; English is required. Pass HSC (Class 12).")


def exam(ids, en, hi, mr, what):
    return ("exam", en, hi, mr, "", "", 0, "", "", "", "", ids, "", what, "Sourced - fee from the Exams sheet", "")


def exam_est(en, hi, mr, low, high, what):
    return ("exam", en, hi, mr, "", "", 0, low, high, "", "", "", "", what, EST, "")


def course(en, hi, mr, months, low, high, tags, what, use_plan="", status=EST, src=""):
    return ("course", en, hi, mr, "", "", months, low, high, use_plan, tags, "", "", what, status, src)


def earn(en, hi, mr, months, stipend_cat, what):
    return ("earn", en, hi, mr, "", "", months, 0, 0, "", "", "", stipend_cat, what,
            "Sourced - stipend from Stipend_Rates (DGT minimum) or the career's live listing", DGT)


def job(what):
    return ("job", "First job", "पहली नौकरी", "पहिली नोकरी", "", "", 0, "", "", "", "", "", "", what,
            "Income from Careers_Income / Occupation_Earnings", "")


ITI_ADM = exam("EX01", "ITI admission (CAP, Class 10 marks)", "ITI प्रवेश (CAP, कक्षा 10 के अंक)", "ITI प्रवेश (CAP, दहावीचे गुण)",
               "Apply online at admission.dvet.gov.in in May-July. Merit list from Class 10 marks, no entrance test.")
ITI = course("Government ITI (2-year trade)", "सरकारी ITI (2 वर्ष ट्रेड)", "शासकीय ITI (2 वर्षे ट्रेड)", 24, 2000, 20000,
             "post_matric; iti_govt", "Study the trade at a Government ITI; pass the NCVT/SCVT trade test.", "yes")
ITI_APP = earn("Paid apprenticeship (1 year)", "पेड अप्रेंटिसशिप (1 वर्ष)", "मानधनासह अप्रेंटिसशिप (1 वर्ष)", 12,
               "ITI (NSC/SCVT) holder", "Register on apprenticeshipindia.gov.in and join a company or railway workshop. You earn a stipend.")

PATHS = {
    "iti": [S910, ITI_ADM, ITI, ITI_APP, job("Apply to companies where you did the apprenticeship, or MSEDCL / railways / factories near you.")],
    "railway_apprentice": [S910, ITI_ADM, ITI,
                           ("earn", "Railway Act Apprentice (1 year)", "रेलवे एक्ट अप्रेंटिस (1 वर्ष)", "रेल्वे अ‍ॅक्ट अप्रेंटिस (1 वर्ष)",
                            "", "", 12, 0, 0, "", "", "EX07", "ITI (NSC/SCVT) holder",
                            "Apply to the Central Railway notice (Aug-Sep). Merit = average of Class 10 % and ITI %.",
                            "Sourced - fee from Exams, stipend from Stipend_Rates", DGT),
                           job("Railway Group D posts keep a share of seats for course-completed Act Apprentices; also apply to industry.")],
    "govt_alp": [S910, ITI_ADM, ITI,
                 exam_est("RRB Assistant Loco Pilot exam", "RRB सहायक लोको पायलट परीक्षा", "RRB सहाय्यक लोको पायलट परीक्षा", 250, 500,
                          "Watch for the RRB ALP notice (CEN). Computer test, aptitude test and medical."),
                 job("Join as Assistant Loco Pilot (Pay Level 2) after training.")],
    "diploma": [S910,
                exam("EX02", "Polytechnic admission (Class 10 marks)", "पॉलिटेक्निक प्रवेश (कक्षा 10 के अंक)", "पॉलिटेक्निक प्रवेश (दहावीचे गुण)",
                     "Register on the DTE Maharashtra portal in May-June. Merit list from Class 10 marks."),
                course("Polytechnic diploma (3 years)", "पॉलिटेक्निक डिप्लोमा (3 वर्ष)", "पॉलिटेक्निक डिप्लोमा (3 वर्षे)", 36, 20000, 150000,
                       "post_matric; diploma", "Study at a government or aided polytechnic. After the diploma you can also join BTech in the 2nd year."),
                earn("Diploma apprenticeship (1 year)", "डिप्लोमा अप्रेंटिसशिप (1 वर्ष)", "डिप्लोमा अप्रेंटिसशिप (1 वर्ष)", 12,
                     "Diploma holder (any stream)", "Technician apprenticeship through apprenticeshipindia.gov.in / NATS. You earn a stipend."),
                job("Technician / junior engineer jobs, or direct second-year BTech.")],
    "degree": [S910, ANY,
               course("3-year degree at a college", "कॉलेज में 3 वर्ष की डिग्री", "महाविद्यालयात 3 वर्षांची पदवी", 36, 15000, 150000,
                      "post_matric; ug", "Take admission in a government or aided college affiliated to SPPU; apply for MahaDBT scholarships every year."),
               job("Apply for jobs, a graduate apprenticeship, or a master's degree.")],
    "science_research": [S910, SCI,
                         course("B.Sc (3 years)", "B.Sc (3 वर्ष)", "B.Sc (3 वर्षे)", 36, 15000, 150000, "post_matric; ug; science_degree",
                                "Study B.Sc in a natural science; check INSPIRE-SHE if you are in the top 1% of Class 12."),
                         course("M.Sc (2 years)", "M.Sc (2 वर्ष)", "M.Sc (2 वर्षे)", 24, 20000, 150000, "post_matric; pg; science_degree",
                                "Master's degree; then research fellowships, labs or teaching."),
                         job("Research fellow, lab scientist or teacher.")],
    "engineering": [S910, SCI,
                    exam("EX03", "MHT-CET (or JEE Main)", "MHT-CET (या JEE Main)", "MHT-CET (किंवा JEE Main)",
                         "Register for MHT-CET in Class 12 (Nov-Jan). College seats are given by CET score."),
                    course("B.E. / B.Tech (4 years)", "B.E. / B.Tech (4 वर्ष)", "B.E. / B.Tech (4 वर्षे)", 48, 47040, 625856,
                           "post_matric; ug; engineering", "Study at a government or aided engineering college through CAP rounds.",
                           status=COEP_STATUS, src=COEP),
                    job("Campus placement or apply as a software / engineering trainee.")],
    "engineering_apprentice": [S910, SCI,
                               exam("EX03", "MHT-CET (or JEE Main)", "MHT-CET (या JEE Main)", "MHT-CET (किंवा JEE Main)",
                                    "Register for MHT-CET in Class 12 (Nov-Jan). College seats are given by CET score."),
                               course("B.E. / B.Tech (4 years)", "B.E. / B.Tech (4 वर्ष)", "B.E. / B.Tech (4 वर्षे)", 48, 47040, 625856,
                                      "post_matric; ug; engineering", "Study at a government or aided engineering college through CAP rounds.",
                                      status=COEP_STATUS, src=COEP),
                               earn("Graduate apprenticeship (1 year)", "ग्रेजुएट अप्रेंटिसशिप (1 वर्ष)", "पदवीधर अप्रेंटिसशिप (1 वर्ष)", 12,
                                    "Graduate / degree apprentice", "Graduate apprenticeship at a plant through NATS. You earn a stipend."),
                               job("Production / maintenance engineer.")],
    "nursing_gnm": [S910, BIO,
                    exam("EX04", "MH Nursing CET", "MH नर्सिंग CET", "MH नर्सिंग CET", "Register in Jan-Feb, exam in May."),
                    course("GNM nursing diploma (3 years)", "GNM नर्सिंग डिप्लोमा (3 वर्ष)", "GNM नर्सिंग डिप्लोमा (3 वर्षे)", 36, 60000, 300000,
                           "post_matric; nursing_diploma", "Study GNM at a nursing school; register with the Maharashtra Nursing Council.", "yes"),
                    job("Staff nurse in a hospital; after 2 years you can take AIIMS NORCET for Nursing Officer.")],
    "nursing_anm": [S910, ANY,
                    course("ANM course (2 years)", "ANM कोर्स (2 वर्ष)", "ANM अभ्यासक्रम (2 वर्षे)", 24, 30000, 120000,
                           "post_matric; nursing_diploma", "ANM at an MSBNPE nursing school; register with the Maharashtra Nursing Council.", "yes"),
                    job("ANM at a primary health centre, sub-centre or hospital.")],
    "govt_class10": [S910,
                     exam_est("Apply online (merit list or exam)", "ऑनलाइन आवेदन (मेरिट या परीक्षा)", "ऑनलाइन अर्ज (गुणवत्ता यादी किंवा परीक्षा)", 0, 500,
                              "Watch for the notice (India Post GDS / RRB). Keep Class 10 marksheet, caste and domicile certificates ready."),
                     job("Join after document check and training.")],
    "defence_10": [S910,
                   exam_est("Agniveer registration + online exam (CEE)", "अग्निवीर पंजीकरण + ऑनलाइन परीक्षा", "अग्निवीर नोंदणी + ऑनलाइन परीक्षा", 250, 550,
                            "Register on joinindianarmy / joinindiannavy; online exam, then physical and medical tests."),
                   job("4-year Agniveer service with training; Seva Nidhi on exit.")],
    "defence_12": [S910, SCI,
                   exam_est("Agniveer Vayu registration + online exam", "अग्निवीर वायु पंजीकरण + ऑनलाइन परीक्षा", "अग्निवीर वायु नोंदणी + ऑनलाइन परीक्षा", 250, 550,
                            "Register on agnipathvayu.cdac.in; online test, then physical and medical tests."),
                   job("4-year Agniveer service with training; Seva Nidhi on exit.")],
    "apprentice": [S910,
                   exam_est("Register for apprenticeship (free)", "अप्रेंटिसशिप के लिए पंजीकरण (मुफ़्त)", "अप्रेंटिसशिपसाठी नोंदणी (मोफत)", 0, 0,
                            "Make a profile on apprenticeshipindia.gov.in and apply to listings near you."),
                   earn("Paid apprenticeship (1 year)", "पेड अप्रेंटिसशिप (1 वर्ष)", "मानधनासह अप्रेंटिसशिप (1 वर्ष)", 12, "Class 10 pass",
                        "Learn on the job at the company. You earn a stipend from day one."),
                   job("Many companies keep good apprentices as full-time staff.")],
    "apprentice_12": [S910, ANY,
                      exam_est("Register for apprenticeship (free)", "अप्रेंटिसशिप के लिए पंजीकरण (मुफ़्त)", "अप्रेंटिसशिपसाठी नोंदणी (मोफत)", 0, 0,
                               "Make a profile on apprenticeshipindia.gov.in and apply to listings near you."),
                      earn("Paid apprenticeship (1 year)", "पेड अप्रेंटिसशिप (1 वर्ष)", "मानधनासह अप्रेंटिसशिप (1 वर्ष)", 12, "Class 12 pass",
                           "Learn on the job at the company. You earn a stipend from day one."),
                      job("Many companies keep good apprentices as full-time staff.")],
    "skill_short": [course("Short skill course", "छोटा कौशल कोर्स", "लघु कौशल्य अभ्यासक्रम", 3, 0, 5000, "skill_short",
                           "Free or low-cost Skill India Digital course; buy basic tools.", "yes"),
                    ("earn", "Practice with a local shop", "किसी दुकान में अभ्यास", "स्थानिक दुकानात सराव", "", "", 6, 0, 0, "", "", "", "",
                     "Work under someone experienced to build speed and customers. Pay varies, often none.", EST, ""),
                    job("Your own work or shop; earnings depend on customers.")],
}

CAREER_PATH = {
    **{f"CAR{i:02d}": "iti" for i in (1, 2, 3, 4, 5, 6, 7, 8, 9, 21)},
    **{f"CAR{i:02d}": "apprentice" for i in (10, 11, 12, 13, 14, 15, 16, 17, 18, 44, 45, 46)},
    "CAR19": "apprentice_12", "CAR20": "apprentice_12",
    "CAR22": "engineering_apprentice", "CAR23": "diploma", "CAR51": "diploma",
    "CAR24": "nursing_gnm", "CAR25": "nursing_anm",
    "CAR26": "defence_10", "CAR42": "defence_10", "CAR43": "defence_12",
    "CAR27": "govt_class10", "CAR28": "govt_class10", "CAR29": "govt_class10",
    "CAR30": "railway_apprentice", "CAR41": "govt_alp", "CAR31": "science_research",
    "CAR32": "degree", "CAR47": "degree", "CAR48": "degree", "CAR50": "degree", "CAR49": "engineering",
    **{f"CAR{i:02d}": "skill_short" for i in range(33, 40)},
}

wb = openpyxl.load_workbook(PATH)
if "Roadmap_Stages" not in wb.sheetnames:
    ws = wb.create_sheet("Roadmap_Stages")
    ws.append(HEAD)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1B3A6B")
    for path, stages in PATHS.items():
        for i, s in enumerate(stages, start=1):
            kind, en, hi, mr, fc, tc, months, low, high, use_plan, tags, exams, stip, what, status, src = s
            ws.append([path, i, kind, en, hi, mr, fc if fc != "" else None, tc if tc != "" else None, months,
                       low if low != "" else None, high if high != "" else None, use_plan or None, tags or None,
                       exams or None, stip or None, what, status, src or None, DAY])
    for col, w in zip("ABCDEFGHIJKLMNOPQRS", (20, 6, 8, 38, 30, 30, 9, 9, 8, 14, 14, 10, 26, 12, 30, 70, 60, 50, 12)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "B2"
    print("added sheet Roadmap_Stages")

cp = wb["Career_Profile"]
head = [c.value for c in cp[1]]
if "Roadmap path" not in head:
    cp.cell(row=1, column=len(head) + 1, value="Roadmap path").font = Font(bold=True)
    head.append("Roadmap path")
col = head.index("Roadmap path") + 1
for r in range(2, cp.max_row + 1):
    cid = cp.cell(row=r, column=1).value
    if cid in CAREER_PATH and not cp.cell(row=r, column=col).value:
        cp.cell(row=r, column=col, value=CAREER_PATH[cid])

if "README" in wb.sheetnames:
    rd = wb["README"]
    if not any(r[0] and "Roadmap_Stages" in str(r[0]) for r in rd.iter_rows(values_only=True)):
        rd.append(["Roadmap_Stages: stage template per path type (Career_Profile 'Roadmap path'); fees are per whole stage. "
                   "Blank fee + Exam IDs = fee from Exams; Stipend category = Stipend_Rates row; 'Use ₹ plan fees' = take the "
                   "career's Plan_Inputs fees + materials. Rows marked 'Estimate - not verified' need a sourced figure."])
wb.save(PATH)
print("saved", PATH)
