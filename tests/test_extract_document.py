"""Ruta /fisiere/<fid>/extract: OCR pe un act păstrat în documentele clientului (decriptat pe server), pe emulator."""
import base64
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import azure_extractor  # noqa: E402
import local_extractor  # noqa: E402

WID, FID = "wsExtractAAAAAAA01", "fidExtractAAAAAA01"
JPG = b"\xff\xd8\xff\xe0" + b"act" * 50


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent/none.json")
    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    monkeypatch.delenv("FISIERE_BUCKET", raising=False)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setenv("FISIERE_LOCAL_DIR", str(tmp_path))
    import app as app_module
    import authz
    import fisiere
    import vault
    from google.cloud import firestore as gcf
    vault._cache.clear()
    db = gcf.Client(project="demo-samwera")
    monkeypatch.setattr(authz, "db", lambda: db)
    monkeypatch.setattr(app_module, "_verify", lambda *a, **k: "uid")
    monkeypatch.setattr(app_module, "_audit", lambda *a, **k: None)
    monkeypatch.setattr(app_module.limiter, "enabled", False)
    ws = db.collection("workspaces").document(WID)
    db.collection("workspaceKeys").document(WID).delete()      # fiecare test are propria cheie locală a vault-ului
    ws.set({"name": "W"})
    fisiere.salveaza(WID, FID, JPG)
    ws.collection("fisiere").document(FID).set({"clientId": "cli1", "nume": "CI Ion.jpg", "mime": "image/jpeg", "marime": len(JPG)})
    yield app_module.app.test_client(), db
    db.recursive_delete(ws)
    db.collection("workspaceKeys").document(WID).delete()
    vault._cache.clear()


def test_actul_pastrat_ajunge_decriptat_la_ocr(env, monkeypatch):
    c, db = env
    primit = {}

    def azure(data, filename):
        primit["data"], primit["nume"] = data, filename
        return azure_extractor.RomanianIDData(cnp="1960515012349", nume="POPESCU", prenume="ION", adresa="Jud.CJ Str. X")

    monkeypatch.setattr(azure_extractor, "extract_from_bytes", azure)
    monkeypatch.setattr(local_extractor, "_quality_score", lambda f: 1.0)
    r = c.post(f"/fisiere/{FID}/extract", headers={"X-Workspace-Id": WID})
    assert r.status_code == 200, r.get_json()
    assert primit == {"data": JPG, "nume": "act.jpg"}      # numele trimis la OCR vine din tipul verificat, nu din cel editabil
    body = r.get_json()
    assert body["cnp"] == "1960515012349" and body["nume"] == "POPESCU" and set(body) >= {"serie_numar", "valabila_pana_la"}
    log = [s.to_dict() for s in db.collection("workspaces").document(WID).collection("auditLog").stream()]
    assert any(e["action"] == "fisier.download" and e["meta"] == {"scop": "ocr"} for e in log)


def test_document_din_alt_cabinet_sau_de_alt_tip(env, monkeypatch):
    c, db = env
    monkeypatch.setattr(azure_extractor, "extract_from_bytes", lambda *a: pytest.fail("OCR nu trebuia apelat"))
    altul = db.collection("workspaces").document("wsAltulBBBBBBBB02")
    altul.set({"name": "Altul"})
    try:
        # cabinet străin cu funcția activă: documentul nu există acolo
        assert c.post(f"/fisiere/{FID}/extract", headers={"X-Workspace-Id": "wsAltulBBBBBBBB02"}).status_code == 404
    finally:
        altul.delete()
    # tipul verificat decide: un .docx redenumit „act.jpg” tot nu ajunge la OCR
    db.collection("workspaces").document(WID).collection("fisiere").document(FID).update(
        {"nume": "act.jpg", "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"})
    assert c.post(f"/fisiere/{FID}/extract", headers={"X-Workspace-Id": WID}).status_code == 400
