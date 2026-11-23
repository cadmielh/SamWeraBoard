"""Teste fără emulator pentru fisiere.py: tipul după conținut, numele, stocarea locală, criptarea."""
import base64
import io
import os
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fisiere  # noqa: E402
import vault  # noqa: E402

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for n, d in files.items():
            zf.writestr(n, d)
    return buf.getvalue()


DOCX = _zip({"[Content_Types].xml": b"<Types/>", "word/document.xml": b"<w/>"})


@pytest.mark.parametrize("data,nume,tip", [
    (PDF, "act.pdf", fisiere.PDF),
    (b"\r\n" + PDF, "act.pdf", fisiere.PDF),
    (JPG, "ci.jpeg", fisiere.JPEG),
    (PNG, "x", fisiere.PNG),
    (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "x.webp", fisiere.WEBP),
    (b"\x00\x00\x00\x18ftypheic" + b"\x00" * 16, "IMG_1.HEIC", fisiere.HEIC),
    (DOCX, "contract.docx", fisiere.DOCX),
    (_zip({"[Content_Types].xml": b"<Types/>", "xl/workbook.xml": b"<w/>"}), "b.xlsx", fisiere.XLSX),
    (_zip({"mimetype": fisiere.ODT.mime.encode(), "content.xml": b"<x/>"}), "a.odt", fisiere.ODT),
    (OLE, "vechi.doc", fisiere.DOC),
    (OLE, "mail.msg", fisiere.MSG),
    ("<?xml version='1.0'?><Factura/>".encode(), "efactura.xml", fisiere.XML),
    ("Notă: șțăîâ".encode(), "note.txt", fisiere.TXT),
    ("a;b\nc;ş".encode("cp1250"), "date.csv", fisiere.CSV),
    (b"\x30\x82\x01\x00" + b"\x00" * 10, "act.pdf.p7s", fisiere.P7S),
])
def test_detecteaza_tip(data, nume, tip):
    assert fisiere.detecteaza_tip(data, nume) == tip


@pytest.mark.parametrize("data,nume,code", [
    (b"", "gol.pdf", "fisier_gol"),
    (b"MZ\x90\x00" + b"\x00" * 64, "factura.pdf", "tip_nepermis"),         # executabil redenumit
    (_zip({"a.txt": b"x"}), "arhiva.zip", "tip_nepermis"),
    (_zip({"[Content_Types].xml": b"<Types macroEnabled/>", "word/document.xml": b"<w/>"}), "m.docx", "fisier_macro"),
    (_zip({"[Content_Types].xml": b"<Types/>", "word/document.xml": b"<w/>", "word/vbaProject.bin": b"x"}), "m.docx", "fisier_macro"),
    (OLE, "fara-extensie", "tip_nepermis"),
    (b"<html><script>alert(1)</script></html>", "pagina.html", "tip_nepermis"),
    (b"\x00\x01binar", "x.txt", "tip_nepermis"),
    # „%PDF-” în interior nu face din fișier un PDF: arhiva/executabilul/macro-ul rămân refuzate
    (_zip({"%PDF-.txt": b"x"}), "a.pdf", "tip_nepermis"),
    (b"MZ\x90\x00" + b"\x00" * 40 + b"%PDF-1.7", "x.pdf", "tip_nepermis"),
    (_zip({"[Content_Types].xml": b"<Types macroEnabled/>", "%PDF-": b"", "word/document.xml": b"<w/>"}), "m.docm", "fisier_macro"),
])
def test_tipuri_refuzate(data, nume, code):
    with pytest.raises(fisiere.FisierRefuzat) as e:
        fisiere.detecteaza_tip(data, nume)
    assert e.value.code == code


def test_nume_fisier_pastreaza_diacriticele_si_corecteaza_extensia():
    assert fisiere.nume_fisier("CI Ștefănescu Ioana.PDF", fisiere.PDF) == "CI Ștefănescu Ioana.pdf"
    assert fisiere.nume_fisier("act.pdf", fisiere.JPEG) == "act.pdf.jpg"
    assert fisiere.nume_fisier("poza.jpeg", fisiere.JPEG) == "poza.jpeg"
    assert fisiere.nume_fisier("../../etc/passwd", fisiere.TXT) == "etc passwd.txt"
    assert fisiere.nume_fisier("a\x00b\nc.pdf", fisiere.PDF) == "a b c.pdf"
    assert fisiere.nume_fisier("", fisiere.PDF) == "document.pdf"
    assert fisiere.nume_fisier("...", fisiere.PDF) == "document.pdf"
    lung = fisiere.nume_fisier("x" * 500 + ".pdf", fisiere.PDF)
    assert lung.endswith(".pdf") and len(lung) == fisiere.MAX_NUME + 4


def test_redenumeste_pastreaza_extensia():
    assert fisiere.redenumeste("Contract semnat", "c.docx") == "Contract semnat.docx"
    assert fisiere.redenumeste("Contract.docx", "c.docx") == "Contract.docx"
    assert fisiere.redenumeste("Contract.pdf", "c.docx") == "Contract.pdf.docx"
    with pytest.raises(fisiere.FisierRefuzat):
        fisiere.redenumeste("  / ", "c.docx")


def test_nume_folder():
    assert fisiere.nume_folder("  Acte   2024 ") == "Acte 2024"
    assert fisiere.nume_folder("a/b") == "a b"
    with pytest.raises(fisiere.FisierRefuzat):
        fisiere.nume_folder("..")


def test_mime_sigur():
    assert fisiere.mime_sigur("application/pdf") == "application/pdf"
    assert fisiere.mime_sigur("text/html") == "application/octet-stream"
    assert fisiere.mime_sigur(None) == "application/octet-stream"


@pytest.fixture()
def local(tmp_path, monkeypatch):
    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    monkeypatch.delenv("FISIERE_BUCKET", raising=False)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setenv("FISIERE_LOCAL_DIR", str(tmp_path))
    vault._cache.clear()
    keys = {}
    monkeypatch.setattr(vault, "_get_dek", lambda wid: keys.setdefault(wid, os.urandom(32)))
    return tmp_path


def test_salveaza_citeste_sterge_criptat(local):
    fisiere.salveaza("wsAAAAAAAAAA", "fidAAAAAAAAAA", PDF)
    brut = (local / fisiere.cale("wsAAAAAAAAAA", "fidAAAAAAAAAA")).read_bytes()
    assert PDF not in brut and brut.startswith(b"CBF1")
    assert fisiere.citeste("wsAAAAAAAAAA", "fidAAAAAAAAAA") == PDF
    fisiere.sterge("wsAAAAAAAAAA", "fidAAAAAAAAAA")
    assert fisiere.citeste("wsAAAAAAAAAA", "fidAAAAAAAAAA") is None


def test_obiect_mutat_sub_alt_id_nu_se_decripteaza(local):
    fisiere.salveaza("wsAAAAAAAAAA", "fidAAAAAAAAAA", PDF)
    src = local / fisiere.cale("wsAAAAAAAAAA", "fidAAAAAAAAAA")
    dst = local / fisiere.cale("wsAAAAAAAAAA", "fidBBBBBBBBBB")
    dst.write_bytes(src.read_bytes())
    with pytest.raises(vault.VaultError):
        fisiere.citeste("wsAAAAAAAAAA", "fidBBBBBBBBBB")


def test_nu_suprascrie_un_obiect_existent(local):
    fisiere.salveaza("wsAAAAAAAAAA", "fidAAAAAAAAAA", PDF)
    with pytest.raises(FileExistsError):
        fisiere.salveaza("wsAAAAAAAAAA", "fidAAAAAAAAAA", JPG)


def test_sterge_cabinet(local):
    fisiere.salveaza("wsAAAAAAAAAA", "f1AAAAAAAAAA", PDF)
    fisiere.salveaza("wsAAAAAAAAAA", "f2AAAAAAAAAA", PDF)
    fisiere.salveaza("wsBBBBBBBBBB", "f3AAAAAAAAAA", PDF)
    assert fisiere.sterge_cabinet("wsAAAAAAAAAA") == 2
    assert fisiere.citeste("wsBBBBBBBBBB", "f3AAAAAAAAAA") == PDF


def test_director_local_refuzat_in_cloud(local, monkeypatch):
    monkeypatch.setenv("K_SERVICE", "api")
    assert not fisiere.configurata()
    with pytest.raises(fisiere.StocareIndisponibila):
        fisiere.stocare()
    assert fisiere.sterge_cabinet("wsAAAAAAAAAA") == 0
