"""Give each career its own income instead of one national PLFS average.

Adds to raah-dataset.xlsx:
  * sheet Occupation_Earnings: PLFS 2025 average monthly earnings by occupation
    division (NCO-2015 / ISCO-08 major group), by education level, and for the
    self-employed by industry; men / women / everyone, all India / rural / urban.
  * columns on Careers_Income: which Occupation_Earnings row a career uses, pay in
    year 1 / 3 / 5 where an official pay scale gives it, and an income status
    ("Sourced ..." or "Estimate ...").

Safe to re-run: Occupation_Earnings is only created if missing, and on
Careers_Income only empty cells are filled, so edits made in Excel are kept.
A career's income text is replaced by the link only while it still holds the
old generic PLFS sentence.

Usage:  python scripts/add_income_detail.py [path/to/raah-dataset.xlsx]
"""
import sys
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

DEFAULT = Path(__file__).resolve().parents[2] / "raah-dataset.xlsx"
CHECKED = "2026-11-16"
HEAD_FILL = PatternFill("solid", fgColor="1F4E79")
HEAD_FONT = Font(bold=True, color="FFFFFF")
NOTE_FILL = PatternFill("solid", fgColor="FFF2CC")

ILO = "https://indialabourobservatory.com/data/plfs-2025/earnings/"
MOSPI = ("https://www.mospi.gov.in/uploads/latestReleases/latest_release_1774607827733_3e8964a9-268b-4cc9-ad65-cfc8a9e32f08"
         "_Press_note_AR_PLFS_2025_23032025_V2.1_26032026_final.pdf")
PAY_MATRIX = "https://www.nii.res.in/sites/default/files/2023-10/7TH_CPC_INFORMATION_%26_GOVERNMENT_ORDERS.pdf"
AGNIPATH = "https://pib.gov.in/PressReleasePage.aspx?PRID=1833747"

OCC_HEAD = ["Group", "Kind", "Covers (NCO-2015 / ISCO-08)",
            "All India male (₹/month)", "All India female (₹/month)", "All India everyone (₹/month)",
            "Rural male (₹/month)", "Rural female (₹/month)", "Rural everyone (₹/month)",
            "Urban male (₹/month)", "Urban female (₹/month)", "Urban everyone (₹/month)",
            "Period", "Source", "Last checked", "Notes"]

REG = "Regular wage/salaried, by occupation"
EDU = "Regular wage/salaried, by education"
SE = "Self-employed, by industry (last 30 days)"
PERIOD = "PLFS Jan-Dec 2025, current weekly status"
SRC = f"{ILO} ; {MOSPI}"
NOTE = ("Computed by India Labour Observatory from MoSPI PLFS 2025 unit-level data (CC BY 4.0), Table 7.3/7.2/7.9. "
        "Its all-occupation averages (₹24,217 male / ₹18,353 female) match the MoSPI press note exactly. "
        "Not a MoSPI-printed table.")

# figures exactly as printed on the source page (rounded rupees)
OCC_ROWS = [
    ["Craft and related trades workers", REG, "Division 7: electricians, wiremen, fitters, welders, mechanics, machinists, carpenters, painters, tailors, electronics repairers",
     17293, 11021, 16773, 15857, 11110, 15532, 18538, 10967, 17819],
    ["Plant and machine operators and assemblers", REG, "Division 8: machine operators, assembly-line workers, packing machine operators",
     17516, 12165, 17301, 16433, 11902, 16257, 18889, 12471, 18618],
    ["Clerical support workers", REG, "Division 4: office assistants, stenographers, stock / warehouse clerks",
     25177, 21484, 24289, 21827, 16844, 20901, 27649, 23546, 26514],
    ["Service and sales workers", REG, "Division 5: security guards, shop / field sales, hairdressers and beauticians",
     17363, 9957, 15541, 15567, 7827, 13632, 18645, 11532, 16914],
    ["Technicians and associate professionals", REG, "Division 3: diploma technicians, nursing associates (ANM), ICT support, HR / employment agents",
     30429, 17875, 26175, 24196, 12606, 18966, 34053, 25458, 31909],
    ["Professionals", REG, "Division 2: engineers, scientists",
     42937, 31354, 38466, 34389, 23669, 30424, 47640, 35164, 42717],
    ["Graduate", EDU, "Regular wage employees whose highest education is a graduate degree (any job)",
     34450, 27687, 32683, 26361, 20385, 24910, 38785, 31065, 36694],
    ["Self-employed: manufacturing", SE, "Own-account / employer / helper in manufacturing (incl. home-based tailoring)",
     22073, 5175, 13510, 16490, 4468, 9760, 28096, 6444, 18722],
    ["Self-employed: trade, hotels and restaurants", SE, "Own shops, retail, eateries",
     21817, 10424, 20319, 17009, 9120, 15837, 26689, 12227, 25049],
    ["Self-employed: agriculture", SE, "Own farm / livestock incl. dairy",
     14057, 5423, 11328, 13851, 5417, 11174, 17769, 5545, 14225],
]

CRAFT, PLANT, CLER, SERV, TECH, PROF, GRAD = (r[0] for r in OCC_ROWS[:7])
SE_MFG, SE_TRADE, SE_AGRI = (r[0] for r in OCC_ROWS[7:])

OCC_OK = "Sourced - PLFS 2025 occupation average"
PAY_OK = "Sourced - official pay scale"
RANGE_OK = "Sourced - published pay range"
EMPLOYEE = "Sourced - PLFS 2025 occupation average for employees; own-shop earnings not sourced"

# career -> (earnings group, status)
GROUP = {
    "CAR01": (CRAFT, OCC_OK), "CAR02": (CRAFT, OCC_OK), "CAR03": (CRAFT, OCC_OK), "CAR04": (CRAFT, OCC_OK),
    "CAR05": (CRAFT, OCC_OK), "CAR06": (CRAFT, OCC_OK), "CAR07": (CRAFT, OCC_OK), "CAR08": (CRAFT, OCC_OK),
    "CAR09": (CRAFT, OCC_OK), "CAR10": (CRAFT, OCC_OK),  # CNC operator = ISCO 7223, a craft occupation
    "CAR11": (PLANT, OCC_OK), "CAR12": (PLANT, OCC_OK), "CAR13": (PLANT, OCC_OK), "CAR15": (PLANT, OCC_OK),
    "CAR14": (CLER, OCC_OK), "CAR18": (CLER, OCC_OK), "CAR21": (CLER, OCC_OK),
    "CAR16": (SERV, OCC_OK), "CAR17": (SERV, OCC_OK),
    "CAR19": (TECH, OCC_OK), "CAR20": (TECH, OCC_OK), "CAR23": (TECH, OCC_OK), "CAR25": (TECH, OCC_OK),
    "CAR22": (PROF, OCC_OK), "CAR31": (PROF, OCC_OK),
    "CAR32": (GRAD, "Sourced - PLFS 2025 average for graduates in regular jobs"),
    "CAR33": (SE_MFG, "Sourced - PLFS 2025 self-employed average for the industry (not tailoring only)"),
    "CAR34": (SERV, EMPLOYEE), "CAR35": (CRAFT, EMPLOYEE),
    "CAR36": (CRAFT, OCC_OK), "CAR39": (CRAFT, OCC_OK),
    "CAR37": (SE_AGRI, "Sourced - PLFS 2025 self-employed average for the industry (not dairy only)"),
    "CAR38": (SE_TRADE, "Sourced - PLFS 2025 self-employed average for the industry"),
    # added in the dataset expansion (present only once that is merged)
    "CAR44": (PLANT, OCC_OK), "CAR45": (PLANT, OCC_OK), "CAR46": (CRAFT, OCC_OK),
}

# career -> (year 1, year 3, year 5, source); basic pay / package per month, as printed
L1 = (18000, 19100, 20300, "7th CPC Pay Matrix Level 1, cells 1/3/5 (3% yearly increment), basic pay before DA: " + PAY_MATRIX)
L2 = (19900, 21100, 22400, "7th CPC Pay Matrix Level 2, cells 1/3/5 (3% yearly increment), basic pay before DA: " + PAY_MATRIX)
L7 = (44900, 47600, 50500, "7th CPC Pay Matrix Level 7, cells 1/3/5 (3% yearly increment), basic pay before DA: " + PAY_MATRIX)
AGNI = (30000, 36500, None, "Agnipath customised package year 1 / year 3 (₹33,000 yr 2, ₹40,000 yr 4); the 4-year term ends before year 5: " + AGNIPATH)
PATH = {"CAR24": L7, "CAR26": AGNI, "CAR27": L1, "CAR41": L2, "CAR42": AGNI, "CAR43": AGNI}
STATUS_ONLY = {"CAR28": RANGE_OK, "CAR29": RANGE_OK}

NEW_COLS = ["Earnings group (Occupation_Earnings)", "Pay year 1 (₹/month)", "Pay year 3 (₹/month)",
            "Pay year 5 (₹/month)", "Pay growth source", "Income status"]
GENERIC = "avg earnings of regular wage/salaried workers ₹24,217"
GENERIC_SE = "avg earnings of self-employed ₹17,914"
INCOME_COL = "Income after training / entry pay"


def head_style(cell):
    cell.fill, cell.font = HEAD_FILL, HEAD_FONT
    cell.alignment = Alignment(wrap_text=True, vertical="top")


def add_occupation_sheet(wb) -> bool:
    if "Occupation_Earnings" in wb.sheetnames:
        return False
    ws = wb.create_sheet("Occupation_Earnings", wb.sheetnames.index("Careers_Income") + 1)
    ws.append(OCC_HEAD)
    for r in OCC_ROWS:
        ws.append(r + [PERIOD, SRC, CHECKED, NOTE])
    for c in ws[1]:
        head_style(c)
    for col, w in zip("ABCDEFGHIJKLMNOP", [34, 30, 50] + [12] * 9 + [26, 60, 12, 60]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "B2"
    return True


def update_careers(wb) -> int:
    ws = wb["Careers_Income"]
    head = [c.value for c in ws[1]]
    for name in NEW_COLS:
        if name not in head:
            ws.cell(row=1, column=len(head) + 1, value=name)
            head_style(ws.cell(row=1, column=len(head) + 1))
            ws.column_dimensions[ws.cell(row=1, column=len(head) + 1).column_letter].width = 28
            head.append(name)
    col = {h: i + 1 for i, h in enumerate(head)}
    changed = 0

    def fill(row, name, value):
        nonlocal changed
        c = ws.cell(row=row, column=col[name])
        if value is not None and (c.value is None or str(c.value).strip() == ""):
            c.value = value
            changed += 1

    for row in range(2, ws.max_row + 1):
        cid = ws.cell(row=row, column=col["ID"]).value
        if not cid:
            continue
        if cid in GROUP:
            grp, status = GROUP[cid]
            fill(row, NEW_COLS[0], grp)
            fill(row, "Income status", status)
            inc = ws.cell(row=row, column=col[INCOME_COL])
            if GENERIC in str(inc.value or "") or GENERIC_SE in str(inc.value or ""):
                inc.value = f"See Occupation_Earnings: {grp}"
                changed += 1
            src = ws.cell(row=row, column=col["Source"])
            if ILO not in str(src.value or ""):
                src.value = (str(src.value or "").strip() + " ; " + ILO).strip(" ;")
                changed += 1
            ws.cell(row=row, column=col["Last checked"], value=CHECKED)
        elif cid in PATH:
            y1, y3, y5, src = PATH[cid]
            fill(row, "Pay year 1 (₹/month)", y1)
            fill(row, "Pay year 3 (₹/month)", y3)
            fill(row, "Pay year 5 (₹/month)", y5)
            fill(row, "Pay growth source", src)
            fill(row, "Income status", PAY_OK)
        elif cid in STATUS_ONLY:
            fill(row, "Income status", STATUS_ONLY[cid])
        elif "baseline" not in str(ws.cell(row=row, column=col["Category"]).value or "").lower():
            fill(row, "Income status", "Estimate - no career-specific figure sourced yet")
        st = ws.cell(row=row, column=col["Income status"])
        if str(st.value or "").lower().startswith("estimate"):
            st.fill = NOTE_FILL
    return changed


def update_readme(wb, added: bool):
    if "README" not in wb.sheetnames:
        return
    rd = wb["README"]
    lines = [str(r[0]) for r in rd.iter_rows(values_only=True) if r and r[0]]
    for r in rd.iter_rows():
        v = r[0].value
        if isinstance(v, str) and v.startswith("PLFS figures are national averages for all regular-salaried"):
            r[0].value = ("PLFS figures are averages per occupation division (Occupation_Earnings), not per trade: "
                          "electrician and welder share the craft-trades figure. Low/high = rural/urban average.")
    if added and not any(x.startswith("Occupation_Earnings") for x in lines):
        rd.append(["Occupation_Earnings - PLFS 2025 average monthly earnings by occupation division, education and "
                   "self-employed industry; men/women, all India/rural/urban. Careers_Income links a row by name in "
                   "'Earnings group'. Pay year 1/3/5 columns hold official pay-scale steps where they exist."])


def main(path: Path):
    wb = openpyxl.load_workbook(path)
    added = add_occupation_sheet(wb)
    n = update_careers(wb)
    update_readme(wb, added)
    wb.save(path)
    print(f"{path}: Occupation_Earnings {'added' if added else 'kept'}, {n} Careers_Income cells filled")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT)
