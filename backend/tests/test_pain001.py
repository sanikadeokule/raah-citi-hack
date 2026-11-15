"""pain.001 files: structural checks without the schema, XSD validation once a schema is present."""
from raah import money

PAYEES = [money.Payee(name="Priya Patil", account="1234567890", ifsc="SBIN0000123", student_id="S01")]
NS = money.NS


def xsd(body: str) -> str:
    return (f'<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="{NS}" targetNamespace="{NS}" '
            f'elementFormDefault="qualified">{body}</xs:schema>')


def test_structural_checks_without_schema(monkeypatch, tmp_path):
    monkeypatch.setattr(money, "XSD", tmp_path / "missing.xsd")
    _, xml = money.build_pain001("scholarship", PAYEES, 5000, "test")
    v = money.validate(xml)
    assert v["valid"] and v["method"].startswith("structural")


def test_xsd_is_used_when_present_and_reports_errors(monkeypatch, tmp_path):
    _, xml = money.build_pain001("scholarship", PAYEES, 5000, "test")
    loose = tmp_path / "loose.xsd"
    loose.write_text(xsd('<xs:element name="Document"><xs:complexType><xs:sequence>'
                         '<xs:any processContents="skip"/></xs:sequence></xs:complexType></xs:element>'))
    monkeypatch.setattr(money, "XSD", loose)
    assert money.validate(xml) == {"method": "official XSD pain.001.001.09", "valid": True, "errors": []}

    strict = tmp_path / "strict.xsd"
    strict.write_text(xsd('<xs:element name="Document"><xs:complexType><xs:sequence>'
                          '<xs:element name="Nothing"/></xs:sequence></xs:complexType></xs:element>'))
    monkeypatch.setattr(money, "XSD", strict)
    v = money.validate(xml)
    assert v["valid"] is False and "CstmrCdtTrfInitn" in v["errors"][0]


def test_wrong_schema_file_is_reported(monkeypatch, tmp_path):
    other = tmp_path / "other.xsd"
    other.write_text('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:other"/>')
    monkeypatch.setattr(money, "XSD", other)
    _, xml = money.build_pain001("scholarship", PAYEES, 5000, "test")
    v = money.validate(xml)
    assert v["valid"] is False and "urn:other" in v["errors"][0]
