"""Money layer (SANDBOX): ISO 20022 pain.001.001.09 payment instructions,
Account-Aggregator-style consent with synthetic bank data, and a signed skills passport.

No real money moves. Payout amounts for scholarships are read from the dataset
(Scholarships 'Amount' cell), so they change when the spreadsheet changes.
"""
from __future__ import annotations

import hashlib
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import dataset

router = APIRouter(prefix="/api/money", tags=["money (sandbox)"])

NS = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"
XSD = Path(__file__).resolve().parent.parent / "schemas" / "pain.001.001.09.xsd"
SIGNING_KEY = os.environ.get("RAAH_SIGNING_KEY", "dev-only-signing-key-change-me-in-env-file")
LEDGER: list[dict] = []
CONSENTS: dict[str, dict] = {}


class Payee(BaseModel):
    name: str
    account: str
    ifsc: str
    student_id: str | None = None


class PaymentIn(BaseModel):
    kind: str = "scholarship"  # scholarship | stipend | teacher_payout
    scheme_id: str | None = None
    amount: float | None = None  # required for stipend / teacher payouts
    payees: list[Payee]
    purpose: str | None = None


def scheme_instalment(scheme: dict) -> float:
    b = scheme["benefit"]
    if b.get("per_year"):
        return float(b["per_year"]["low"])
    if b.get("per_month"):
        return float(b["per_month"]["low"] * (b.get("months_per_year") or 12))
    raise HTTPException(422, f"{scheme['id']} has no cash amount in the dataset (fee reimbursement only)")


def _el(parent, tag, text=None, **attrs):
    e = ET.SubElement(parent, f"{{{NS}}}{tag}", attrs)
    if text is not None:
        e.text = str(text)
    return e


def build_pain001(kind: str, payees: list[Payee], amount: float, purpose: str) -> tuple[str, str]:
    ET.register_namespace("", NS)
    msg_id = "RAAH-" + uuid.uuid4().hex[:16].upper()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    doc = ET.Element(f"{{{NS}}}Document")
    root = _el(doc, "CstmrCdtTrfInitn")
    hdr = _el(root, "GrpHdr")
    _el(hdr, "MsgId", msg_id)
    _el(hdr, "CreDtTm", now.isoformat().replace("+00:00", "Z"))
    _el(hdr, "NbOfTxs", len(payees))
    _el(hdr, "CtrlSum", f"{amount * len(payees):.2f}")
    _el(_el(hdr, "InitgPty"), "Nm", "Raah Disbursement Desk (sandbox)")

    pmt = _el(root, "PmtInf")
    _el(pmt, "PmtInfId", msg_id + "-1")
    _el(pmt, "PmtMtd", "TRF")
    _el(pmt, "NbOfTxs", len(payees))
    _el(pmt, "CtrlSum", f"{amount * len(payees):.2f}")
    tp = _el(pmt, "PmtTpInf")
    _el(_el(tp, "SvcLvl"), "Prtry", "DBT")
    _el(_el(tp, "CtgyPurp"), "Cd", "GOVT" if kind == "scholarship" else "SALA")
    _el(_el(pmt, "ReqdExctnDt"), "Dt", (date.today() + timedelta(days=1)).isoformat())
    _el(_el(pmt, "Dbtr"), "Nm", "Scholarship Disbursement Account (sandbox)")
    dacct = _el(pmt, "DbtrAcct")
    _el(_el(_el(dacct, "Id"), "Othr"), "Id", "000000000000")
    _el(_el(_el(pmt, "DbtrAgt"), "FinInstnId"), "BICFI", "SNDBXXINXXX")
    for i, p in enumerate(payees, 1):
        tx = _el(pmt, "CdtTrfTxInf")
        pid = _el(tx, "PmtId")
        _el(pid, "InstrId", f"{msg_id}-{i}")
        _el(pid, "EndToEndId", f"{(p.student_id or 'P')}-{msg_id[-6:]}-{i}")
        _el(_el(tx, "Amt"), "InstdAmt", f"{amount:.2f}", Ccy="INR")
        agt = _el(_el(tx, "CdtrAgt"), "FinInstnId")
        cs = _el(agt, "ClrSysMmbId")
        _el(_el(cs, "ClrSysId"), "Prtry", "IFSC")
        _el(cs, "MmbId", p.ifsc)
        _el(_el(tx, "Cdtr"), "Nm", p.name)
        _el(_el(_el(_el(tx, "CdtrAcct"), "Id"), "Othr"), "Id", p.account)
        _el(_el(tx, "RmtInf"), "Ustrd", purpose[:140])
    xml = ET.tostring(doc, encoding="unicode", xml_declaration=False)
    return msg_id, '<?xml version="1.0" encoding="UTF-8"?>\n' + xml


def validate(xml: str) -> dict:
    """Validate against the official XSD when it is present (backend/schemas/), else structural checks."""
    try:
        from lxml import etree
    except ImportError:  # pragma: no cover
        etree = None
    if etree is not None and XSD.exists():
        schema = etree.XMLSchema(etree.parse(str(XSD)))
        doc = etree.fromstring(xml.encode())
        ok = schema.validate(doc)
        return {"method": "official XSD pain.001.001.09", "valid": ok,
                "errors": [str(e) for e in schema.error_log][:5]}
    root = ET.fromstring(xml)
    need = ["GrpHdr/MsgId", "GrpHdr/CreDtTm", "GrpHdr/NbOfTxs", "PmtInf/PmtInfId", "PmtInf/Dbtr", "PmtInf/CdtTrfTxInf"]
    ns = {"p": NS}
    missing = [n for n in need if root.find("p:CstmrCdtTrfInitn/" + "/".join("p:" + x for x in n.split("/")), ns) is None]
    return {"method": "structural checks (add backend/schemas/pain.001.001.09.xsd for full XSD validation)",
            "valid": not missing, "errors": missing}


@router.post("/payments")
def create_payment(body: PaymentIn):
    d = dataset.get()
    purpose = body.purpose or ""
    if body.kind == "scholarship":
        scheme = next((s for s in d["scholarships"] if s["id"] == body.scheme_id), None)
        if not scheme:
            raise HTTPException(404, "scheme not in dataset")
        amount = body.amount or scheme_instalment(scheme)
        purpose = purpose or f"{scheme['id']} {scheme['name']}"
        source = {"sheet": "Scholarships", "id": scheme["id"], "cell": scheme["amount_text"], "url": scheme["source"]}
    else:
        if not body.amount:
            raise HTTPException(422, "amount needed for stipend / teacher payouts")
        amount, source = body.amount, None
        purpose = purpose or body.kind.replace("_", " ")
    msg_id, xml = build_pain001(body.kind, body.payees, amount, purpose)
    v = validate(xml)
    entry = {"msg_id": msg_id, "kind": body.kind, "amount": amount, "count": len(body.payees),
             "status": "initiated", "created": datetime.now(timezone.utc).isoformat(), "purpose": purpose}
    LEDGER.append(entry)
    return {"msg_id": msg_id, "xml": xml, "validation": v, "amount_each": amount, "amount_source": source,
            "ledger": entry, "sandbox": True}


@router.get("/ledger")
def ledger():
    # pacs.002-style progression for the demo: initiated -> accepted -> credited
    now = datetime.now(timezone.utc)
    for e in LEDGER:
        age = (now - datetime.fromisoformat(e["created"])).total_seconds()
        e["status"] = "credited" if age > 20 else ("accepted" if age > 8 else "initiated")
    return LEDGER


# ------------------------------------------------------------------ Account Aggregator (synthetic)

class ConsentIn(BaseModel):
    student_id: str
    family_member: str = "Parent"
    purpose: str = "Check bank account is active and income band matches, for scholarship DBT"
    declared_income_annual: float | None = None


@router.post("/aa/consent")
def aa_consent(body: ConsentIn):
    cid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    c = {"consentId": cid, "status": "ACTIVE", "createTimestamp": now.isoformat(),
         "ConsentDetail": {"consentStart": now.isoformat(), "consentExpiry": (now + timedelta(days=1)).isoformat(),
                           "consentMode": "VIEW", "fetchType": "ONETIME", "consentTypes": ["PROFILE", "SUMMARY", "TRANSACTIONS"],
                           "fiTypes": ["DEPOSIT"], "Purpose": {"code": "105", "text": body.purpose},
                           "DataLife": {"unit": "DAY", "value": 1}, "Frequency": {"unit": "HOUR", "value": 1}},
         "student_id": body.student_id, "declared_income_annual": body.declared_income_annual, "sandbox": True}
    CONSENTS[cid] = c
    return c


def _synthetic_deposit(student_id: str) -> dict:
    seed = int(hashlib.sha256(student_id.encode()).hexdigest()[:8], 16)
    monthly_credit = 9000 + seed % 9000
    txns = []
    today = date.today()
    bal = 4000 + seed % 6000
    for m in range(6, 0, -1):
        d0 = (today.replace(day=1) - timedelta(days=30 * m)).replace(day=5)
        bal += monthly_credit
        txns.append({"txnId": f"T{m}C", "type": "CREDIT", "mode": "UPI", "amount": f"{monthly_credit:.2f}",
                     "currentBalance": f"{bal:.2f}", "valueDate": d0.isoformat(), "narration": "AGRI PRODUCE SALE / WAGES"})
        spend = monthly_credit * 0.85
        bal -= spend
        txns.append({"txnId": f"T{m}D", "type": "DEBIT", "mode": "CASH", "amount": f"{spend:.2f}",
                     "currentBalance": f"{bal:.2f}", "valueDate": (d0 + timedelta(days=10)).isoformat(), "narration": "ATM WDL"})
    return {"Account": {"type": "deposit", "maskedAccNumber": "XXXXXXXX" + str(seed)[-4:], "version": "1.1",
                        "linkedAccRef": str(uuid.UUID(int=seed)),
                        "Profile": {"Holders": {"type": "SINGLE", "Holder": {"name": "Parent of " + student_id, "ckycCompliance": "true"}}},
                        "Summary": {"currentBalance": f"{bal:.2f}", "currency": "INR", "type": "SAVINGS", "status": "ACTIVE",
                                    "branch": "Sandbox Gramin Branch", "ifscCode": "SNDB0000001",
                                    "openingDate": "2019-04-01", "facility": "NONE"},
                        "Transactions": {"startDate": txns[0]["valueDate"], "endDate": txns[-1]["valueDate"], "Transaction": txns}}}


@router.get("/aa/fi-data")
def aa_fi_data(consent_id: str):
    c = CONSENTS.get(consent_id)
    if not c:
        raise HTTPException(404, "consent not found or revoked")
    fi = _synthetic_deposit(c["student_id"])
    credits = [float(t["amount"]) for t in fi["Account"]["Transactions"]["Transaction"] if t["type"] == "CREDIT"]
    est = sum(credits) / max(len(credits), 1) * 12
    declared = c.get("declared_income_annual")
    match = declared is None or abs(est - declared) / max(declared, 1) <= 0.35
    return {"consentId": consent_id, "fiType": "DEPOSIT", "schema": "ReBIT FI Deposit v1.1 (synthetic data)", "FI": fi,
            "analysis": {"account_active": fi["Account"]["Summary"]["status"] == "ACTIVE",
                         "estimated_income_annual": round(est), "declared_income_annual": declared,
                         "income_band_matches": match,
                         "ready_for_dbt": fi["Account"]["Summary"]["status"] == "ACTIVE" and match},
            "sandbox": True}


# ------------------------------------------------------------------ skills passport

class PassportIn(BaseModel):
    student_id: str
    name: str
    lessons: list[dict] = []
    quizzes: list[dict] = []
    certificates: list[dict] = []


@router.post("/passport")
def passport(body: PassportIn):
    now = datetime.now(timezone.utc)
    vc = {"@context": ["https://www.w3.org/2018/credentials/v1", "https://purl.imsglobal.org/spec/ob/v3p0/context.json"],
          "type": ["VerifiableCredential", "OpenBadgeCredential"], "issuer": {"id": "did:web:raah.example", "name": "Raah (demo)"},
          "issuanceDate": now.isoformat(),
          "credentialSubject": {"id": f"urn:raah:student:{body.student_id}", "name": body.name,
                                "achievements": {"lessons": body.lessons, "quizzes": body.quizzes, "certificates": body.certificates}}}
    token = jwt.encode({"vc": vc, "iat": int(now.timestamp())}, SIGNING_KEY, algorithm="HS256")
    vc["proof"] = {"type": "JwtProof2020", "jwt": token, "note": "HS256 demo key; use an Ed25519 DID key in production"}
    return vc


@router.post("/passport/verify")
def verify_passport(token: dict):
    try:
        jwt.decode(token.get("jwt", ""), SIGNING_KEY, algorithms=["HS256"])
        return {"valid": True}
    except jwt.PyJWTError as e:
        return {"valid": False, "error": str(e)}
