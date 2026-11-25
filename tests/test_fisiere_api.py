"""Teste pentru fisiere_api.py (+ ștergerea clientului din pii_api.py) contra emulatorului Firestore.

Rulare: tests/run_all.sh (sau `firebase emulators:exec --only firestore ... pytest tests/test_fisiere_api.py`).
"""
import base64
import json
import io
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore"
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import fisiere  # noqa: E402
import fisiere_api  # noqa: E402
import pii_api  # noqa: E402
import vault  # noqa: E402
import workspaces_api  # noqa: E402

CONSENT = {"tos": workspaces_api.TOS_VERSION, "dpa": workspaces_api.DPA_VERSION}
CID = "clientAAAAAAAAAAA1"
CID2 = "clientBBBBBBBBBBB2"
PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"
JPG = b"\xff\xd8\xff\xe0" + os.urandom(64)


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    monkeypatch.delenv("FISIERE_BUCKET", raising=False)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setenv("FISIERE_LOCAL_DIR", str(tmp_path))
    vault._cache.clear()
    client = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "invitations", "users", "workspaceKeys", "trialClaims", "rateLimits"):
        for d in client.collection(coll).stream():
            client.recursive_delete(d.reference)
    monkeypatch.setattr(authz, "db", lambda: client)

    def fake_authenticate():
        from flask import request
        raw = request.headers.get("X-Test-User", "")
        if not raw:
            raise authz.AuthError(401)
        uid, email = raw.split(":")
        return authz.Principal(uid=uid, email=email, name=uid, provider="google.com")

    monkeypatch.setattr(authz, "authenticate", fake_authenticate)
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024
    for bp in (workspaces_api.bp, pii_api.bp, fisiere_api.bp):
        app.register_blueprint(bp)
    return app.test_client(), client, tmp_path


def call(c, uid, method, url, wid=None, **kw):
    hdr = {"X-Test-User": f"{uid}:{uid}@ex.ro"}
    if wid:
        hdr["X-Workspace-Id"] = wid
    return getattr(c, method)(url, headers=hdr, **kw)


def setup_ws(c, db):
    wid = call(c, "alice", "post", "/workspaces", json={"name": "Cabinet", "consent": CONSENT}).get_json()["id"]
    ref = db.collection("workspaces").document(wid)
    ref.update({
        "members.bob": {"role": "member", "email": "bob@ex.ro"},
        "members.vera": {"role": "viewer", "email": "vera@ex.ro"},
    })
    ref.collection("clienti").document(CID).set({"denumire": "Alfa SRL"})
    ref.collection("clienti").document(CID2).set({"denumire": "Beta SRL"})
    return wid


def upload(c, uid, wid, data=PDF, name="act.pdf", cid=CID, folder=None, **form):
    fields = {"fisier": (io.BytesIO(data), name), "clientId": cid, **form}
    if folder:
        fields["folderId"] = folder
    return call(c, uid, "post", "/fisiere", wid, data=fields, content_type="multipart/form-data")


def fisiere_db(db, wid, **where):
    out = []
    for s in db.collection("workspaces").document(wid).collection("fisiere").stream():
        d = s.to_dict()
        if all(d.get(k) == v for k, v in where.items()):
            out.append({"id": s.id, **d})
    return out


def contor(db, wid):
    return db.collection("workspaces").document(wid).collection("contoare").document("fisiere").get().to_dict() or {}


def test_incarcare_descarcare_criptat(env):
    c, db, root = env
    wid = setup_ws(c, db)
    r = upload(c, "bob", wid, name="CI Ștefan.pdf")
    assert r.status_code == 201, r.get_json()
    f = r.get_json()["fisier"]
    assert f["nume"] == "CI Ștefan.pdf" and f["mime"] == "application/pdf" and f["marime"] == len(PDF)
    brut = (root / fisiere.cale(wid, f["id"])).read_bytes()
    assert PDF not in brut

    r = call(c, "vera", "get", f"/fisiere/{f['id']}/continut", wid)
    assert r.status_code == 200 and r.data == PDF
    assert r.headers["Content-Type"] == "application/pdf"
    assert "attachment" in r.headers["Content-Disposition"] and "UTF-8''CI%20%C8%98tefan.pdf" in r.headers["Content-Disposition"]
    assert r.headers["Cache-Control"] == "private, no-store"
    assert "sandbox" in r.headers["Content-Security-Policy"]
    assert contor(db, wid) == {"octeti": len(PDF), "numar": 1}

    log = [s.to_dict() for s in db.collection("workspaces").document(wid).collection("auditLog").stream()]
    actiuni = {e["action"] for e in log}
    assert {"fisier.upload", "fisier.download"} <= actiuni
    assert all("Ștefan" not in str(e.get("meta")) for e in log)        # numele fișierului nu ajunge în jurnal


def test_roluri(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    assert upload(c, "vera", wid).status_code == 403                    # viewer: doar citire
    assert upload(c, "mallory", wid).status_code == 403                 # nu e membru


def test_documentele_merg_in_orice_cabinet(env):
    # Funcția e pornită pentru toți (fără comutator per cabinet): un cabinet nou încarcă direct.
    c, db, _ = env
    wid2 = call(c, "carol", "post", "/workspaces", json={"name": "Altul", "consent": CONSENT}).get_json()["id"]
    db.collection("workspaces").document(wid2).collection("clienti").document(CID).set({"denumire": "X"})
    assert upload(c, "carol", wid2).status_code == 201


def test_fisier_din_alt_cabinet_nu_e_accesibil(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    fid = upload(c, "bob", wid).get_json()["fisier"]["id"]
    wid2 = call(c, "carol", "post", "/workspaces", json={"name": "Altul", "consent": CONSENT}).get_json()["id"]
    assert call(c, "carol", "get", f"/fisiere/{fid}/continut", wid2).status_code == 404
    assert call(c, "carol", "delete", f"/fisiere/{fid}", wid2).status_code == 404


def test_tip_refuzat_si_marime(env, monkeypatch):
    c, db, _ = env
    wid = setup_ws(c, db)
    r = upload(c, "bob", wid, data=b"MZ\x90\x00" + b"\x00" * 100, name="factura.pdf")
    assert r.status_code == 400 and r.get_json()["error"] == "tip_nepermis"
    monkeypatch.setattr(fisiere, "MAX_BYTES", 100)
    r = upload(c, "bob", wid, data=PDF + b"\x00" * 200)
    assert r.status_code == 413 and r.get_json()["error"] == "fisier_prea_mare"
    assert fisiere_db(db, wid) == []


def test_client_inexistent(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    assert upload(c, "bob", wid, cid="clientZZZZZZZZZZZ9").status_code == 404


def test_duplicat_si_nume_libere(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    assert upload(c, "bob", wid).status_code == 201
    r = upload(c, "bob", wid, name="alt nume.pdf")
    assert r.status_code == 409 and r.get_json()["error"] == "duplicat" and r.get_json()["existent"]["nume"] == "act.pdf"
    r = upload(c, "bob", wid, duplicat="permite")
    assert r.status_code == 201 and r.get_json()["fisier"]["nume"] == "act (2).pdf"
    r = upload(c, "bob", wid, data=JPG, name="ACT.jpg")
    assert r.get_json()["fisier"]["nume"] == "ACT.jpg"
    # același conținut la alt client nu e duplicat
    assert upload(c, "bob", wid, cid=CID2).status_code == 201


def test_cota_cabinetului(env, monkeypatch):
    c, db, _ = env
    wid = setup_ws(c, db)
    monkeypatch.setattr(fisiere, "LIMITA_CABINET", len(PDF) + 10)
    assert upload(c, "bob", wid).status_code == 201
    r = upload(c, "bob", wid, data=JPG, name="a.jpg")
    assert r.status_code == 409 and r.get_json()["error"] == "spatiu_depasit"


def test_foldere_mutare_redenumire(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    r = call(c, "bob", "post", f"/clients/{CID}/documente/init", wid)
    assert [f["nume"] for f in r.get_json()["foldere"]] == list(fisiere.FOLDERE_IMPLICITE)
    assert call(c, "bob", "post", f"/clients/{CID}/documente/init", wid).get_json() == {"foldere": [], "init": False}
    acte = next(f["id"] for f in r.get_json()["foldere"] if f["nume"] == "Acte identitate")

    r = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": None, "nume": "acte IDENTITATE"})
    assert r.status_code == 409 and r.get_json()["error"] == "nume_existent"
    sub = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": acte, "nume": "2024"}).get_json()["folder"]

    fid = upload(c, "bob", wid).get_json()["fisier"]["id"]
    r = call(c, "bob", "patch", f"/fisiere/{fid}", wid, json={"folderId": sub["id"], "nume": "CI Ion"})
    assert r.status_code == 200 and r.get_json()["fisier"]["nume"] == "CI Ion.pdf"
    assert fisiere_db(db, wid)[0]["folderId"] == sub["id"]

    # un folder al altui client nu poate fi țintă
    alt = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID2, "parentId": None, "nume": "X"}).get_json()["folder"]
    r = call(c, "bob", "patch", f"/fisiere/{fid}", wid, json={"folderId": alt["id"]})
    assert r.status_code == 400 and r.get_json()["error"] == "folder_invalid"

    # ciclu: folderul nu poate intra în propriul subfolder
    r = call(c, "bob", "patch", f"/foldere/{acte}", wid, json={"parentId": sub["id"]})
    assert r.status_code == 409 and r.get_json()["error"] == "folder_ciclu"

    # numele ocupat în folderul țintă
    upload(c, "bob", wid, data=JPG, name="CI Ion.pdf", folder=None)
    r = call(c, "bob", "patch", f"/fisiere/{fid}", wid, json={"folderId": None})
    assert r.status_code == 200      # „CI Ion.pdf.jpg” ≠ „CI Ion.pdf”
    r = call(c, "bob", "patch", f"/fisiere/{fid}", wid, json={"nume": "CI Ion.pdf.jpg"})
    assert r.status_code == 200 and r.get_json()["fisier"]["nume"] == "CI Ion.pdf.jpg.pdf"


def test_adancime_maxima(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    parent = None
    for i in range(fisiere.MAX_ADANCIME):
        r = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": parent, "nume": f"n{i}"})
        assert r.status_code == 201
        parent = r.get_json()["folder"]["id"]
    r = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": parent, "nume": "prea adânc"})
    assert r.status_code == 409 and r.get_json()["error"] == "folder_prea_adanc"


def test_stergere_folder_cu_continut(env):
    c, db, root = env
    wid = setup_ws(c, db)
    d = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": None, "nume": "Acte"}).get_json()["folder"]
    s = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": d["id"], "nume": "Vechi"}).get_json()["folder"]
    f1 = upload(c, "bob", wid, folder=d["id"]).get_json()["fisier"]["id"]
    upload(c, "bob", wid, data=JPG, name="b.jpg", folder=s["id"])
    keep = upload(c, "bob", wid, data=JPG + b"x", name="rad.jpg").get_json()["fisier"]["id"]

    r = call(c, "bob", "delete", f"/foldere/{d['id']}", wid)
    assert r.status_code == 409 and r.get_json() == {"error": "folder_negol", "fisiere": 2, "foldere": 1}
    r = call(c, "bob", "delete", f"/foldere/{d['id']}?recursiv=1", wid)
    assert r.status_code == 200
    assert [f["id"] for f in fisiere_db(db, wid)] == [keep]
    assert not (root / fisiere.cale(wid, f1)).exists()
    assert contor(db, wid)["numar"] == 1


def test_stergere_fisier_fara_abonament(env):
    c, db, root = env
    wid = setup_ws(c, db)
    fid = upload(c, "bob", wid).get_json()["fisier"]["id"]
    db.collection("workspaces").document(wid).update({"billing.accessUntil": None, "billing.status": "expired"})
    assert upload(c, "bob", wid, data=JPG, name="a.jpg").status_code == 402
    assert call(c, "vera", "get", f"/fisiere/{fid}/continut", wid).status_code == 200
    assert call(c, "bob", "delete", f"/fisiere/{fid}", wid).status_code == 200
    assert not (root / fisiere.cale(wid, fid)).exists()
    assert contor(db, wid) == {"octeti": 0, "numar": 0}


def test_stergere_client_arhiveaza_implicit(env):
    c, db, root = env
    wid = setup_ws(c, db)
    d = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": None, "nume": "Acte"}).get_json()["folder"]
    s = call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": d["id"], "nume": "2024"}).get_json()["folder"]
    fid = upload(c, "bob", wid, folder=s["id"]).get_json()["fisier"]["id"]
    other = upload(c, "bob", wid, cid=CID2).get_json()["fisier"]["id"]

    r = call(c, "alice", "delete", f"/clients/{CID}", wid)
    assert r.status_code == 200 and r.get_json()["fisiere"] == {"fisiere": 1, "mod": "arhiveaza"}
    arh = fisiere_db(db, wid, arhivat=True)
    assert len(arh) == 1 and arh[0]["id"] == fid
    assert arh[0]["clientId"] is None and arh[0]["clientNume"] == "Alfa SRL" and arh[0]["cale"] == "Acte / 2024"
    assert (root / fisiere.cale(wid, fid)).exists()
    assert [s.id for s in db.collection("workspaces").document(wid).collection("foldere").stream()] == []
    # arhivat: se descarcă, nu se mută, se șterge
    assert call(c, "vera", "get", f"/fisiere/{fid}/continut", wid).data == PDF
    assert call(c, "bob", "patch", f"/fisiere/{fid}", wid, json={"folderId": None}).status_code == 409
    assert call(c, "bob", "delete", f"/fisiere/{fid}", wid).status_code == 200
    assert fisiere_db(db, wid)[0]["id"] == other


def test_stergere_client_cu_fisiere(env):
    c, db, root = env
    wid = setup_ws(c, db)
    fid = upload(c, "bob", wid).get_json()["fisier"]["id"]
    r = call(c, "alice", "delete", f"/clients/{CID}?fisiere=sterge", wid)
    assert r.status_code == 200 and r.get_json()["fisiere"]["mod"] == "sterge"
    assert fisiere_db(db, wid) == []
    assert not (root / fisiere.cale(wid, fid)).exists()
    assert contor(db, wid) == {"octeti": 0, "numar": 0}


def test_stergere_client_fara_documente(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    assert call(c, "alice", "delete", f"/clients/{CID}", wid).status_code == 200


def test_foldere_implicite_ale_cabinetului(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    assert call(c, "bob", "put", "/fisiere/setari", wid, json={"foldereImplicite": ["Acte"]}).status_code == 403   # doar adminul
    r = call(c, "alice", "put", "/fisiere/setari", wid, json={"foldereImplicite": ["acte", "ACTE"]})
    assert r.status_code == 409 and r.get_json()["error"] == "nume_existent"
    r = call(c, "alice", "put", "/fisiere/setari", wid, json={"foldereImplicite": ["  Contracte ", "Acte/vechi"]})
    assert r.get_json()["foldereImplicite"] == ["Contracte", "Acte vechi"]
    assert call(c, "alice", "put", "/fisiere/setari", wid, json={"foldereImplicite": ["x"] * 11}).status_code == 400

    r = call(c, "bob", "post", f"/clients/{CID}/documente/init", wid)
    assert sorted(f["nume"] for f in r.get_json()["foldere"]) == ["Acte vechi", "Contracte"]

    # folderele șterse nu reapar; o listă nouă nu schimbă un client deja pregătit
    for s in db.collection("workspaces").document(wid).collection("foldere").stream():
        call(c, "bob", "delete", f"/foldere/{s.id}", wid)
    call(c, "alice", "put", "/fisiere/setari", wid, json={"foldereImplicite": ["Nou"]})
    assert call(c, "bob", "post", f"/clients/{CID}/documente/init", wid).get_json()["init"] is False
    assert list(db.collection("workspaces").document(wid).collection("foldere").stream()) == []

    # listă goală: clientul nou pornește fără foldere
    call(c, "alice", "put", "/fisiere/setari", wid, json={"foldereImplicite": []})
    assert call(c, "bob", "post", f"/clients/{CID2}/documente/init", wid).get_json() == {"foldere": [], "init": True}


def test_init_cere_membru_si_client_existent(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    assert call(c, "vera", "post", f"/clients/{CID}/documente/init", wid).status_code == 403
    assert call(c, "bob", "post", "/clients/clientZZZZZZZZZZZ9/documente/init", wid).status_code == 404


def test_stergerea_clientului_sterge_marcajul(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    call(c, "bob", "post", f"/clients/{CID}/documente/init", wid)
    call(c, "alice", "delete", f"/clients/{CID}", wid)
    assert not db.collection("workspaces").document(wid).collection("documenteClienti").document(CID).get().exists


def test_incarcare_in_timpul_stergerii_clientului_nu_lasa_orfani(env, monkeypatch):
    """Clientul dispare între verificarea de la început și înregistrarea metadatelor: fișierul nu rămâne nicăieri."""
    c, db, root = env
    wid = setup_ws(c, db)
    original = fisiere.salveaza

    def salveaza_si_sterge_clientul(w, fid, data):
        original(w, fid, data)
        db.collection("workspaces").document(w).collection("clienti").document(CID).delete()

    monkeypatch.setattr(fisiere, "salveaza", salveaza_si_sterge_clientul)
    assert upload(c, "bob", wid).status_code == 404
    assert fisiere_db(db, wid) == []
    assert not any(p.is_file() for p in root.rglob("*"))
    assert contor(db, wid) == {}


def _docx():
    import io as _io
    import zipfile as _zf
    buf = _io.BytesIO()
    with _zf.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w/>")
    return buf.getvalue()


def test_copie_document_generat_in_folderul_cabinetului(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    doc = _docx()
    # clientul nu are încă foldere: folderul copiilor se creează la nevoie
    r = upload(c, "bob", wid, data=doc, name="Act constitutiv.docx", destinatie="generate")
    assert r.status_code == 201, r.get_json()
    f = r.get_json()["fisier"]
    foldere = {s.id: s.to_dict() for s in db.collection("workspaces").document(wid).collection("foldere").stream()}
    assert foldere[f["folderId"]]["nume"] == "Documente generate" and foldere[f["folderId"]]["parentId"] is None
    assert f["sursa"] == "generat"
    # clientul a fost pregătit cu folderele implicite, deci deschiderea fișei nu mai are ce crea
    assert sorted(d["nume"] for d in foldere.values()) == sorted(fisiere.FOLDERE_IMPLICITE)
    assert call(c, "bob", "post", f"/clients/{CID}/documente/init", wid).get_json()["init"] is False
    # o nouă generare cu același conținut nu e tratată ca duplicat: se păstrează ca versiune nouă
    r = upload(c, "bob", wid, data=doc, name="Act constitutiv.docx", destinatie="generate")
    assert r.status_code == 201 and r.get_json()["fisier"]["nume"] == "Act constitutiv (2).docx"
    assert len([s for s in db.collection("workspaces").document(wid).collection("foldere").stream()]) == 3


def test_folderul_copiilor_se_alege_in_setari(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    r = call(c, "alice", "put", "/fisiere/setari", wid, json={"folderGenerate": " Generate/2026 "})
    assert r.status_code == 200 and r.get_json() == {"folderGenerate": "Generate 2026"}
    # lista implicită rămâne neatinsă când se schimbă doar folderul copiilor
    assert "foldereImplicite" not in db.collection("workspaces").document(wid).collection("setari").document("documente").get().to_dict()
    call(c, "bob", "post", "/foldere", wid, json={"clientId": CID, "parentId": None, "nume": "generate 2026"})
    f = upload(c, "bob", wid, data=_docx(), name="x.docx", destinatie="generate").get_json()["fisier"]
    d = db.collection("workspaces").document(wid).collection("foldere").document(f["folderId"]).get().to_dict()
    assert d["nume"] == "generate 2026"          # folderul existent, găsit fără deosebire de majuscule
    assert call(c, "alice", "put", "/fisiere/setari", wid, json={}).status_code == 400


def test_spatiul_cabinetelor_doar_pentru_super_admin(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    upload(c, "bob", wid)
    assert call(c, "alice", "get", "/admin/fisiere/spatiu").status_code == 403      # admin de cabinet, nu super admin
    db.collection("users").document("root").set({"isSuperAdmin": True})
    r = call(c, "root", "get", "/admin/fisiere/spatiu").get_json()
    assert r["limita"] == fisiere.LIMITA_CABINET
    assert r["cabinete"][wid] == {"octeti": len(PDF), "numar": 1}


def _png() -> bytes:
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 10, 10)).save(b, "PNG")
    return b.getvalue()


def test_editarea_inlocuieste_continutul_si_pastreaza_originalul(env):
    c, db, root = env
    wid = setup_ws(c, db)
    png = _png()
    fid = upload(c, "bob", wid, data=png, name="CI Ion.png").get_json()["fisier"]["id"]
    edit = lambda data, name="CI Ion.jpg": call(c, "bob", "put", f"/fisiere/{fid}/continut", wid,  # noqa: E731
                                                data={"fisier": (io.BytesIO(data), name)}, content_type="multipart/form-data")
    assert call(c, "vera", "put", f"/fisiere/{fid}/continut", wid, data={"fisier": (io.BytesIO(JPG), "a.jpg")},
                content_type="multipart/form-data").status_code == 403
    r = edit(JPG)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["fisier"]["nume"] == "CI Ion.jpg" and r.get_json()["fisier"]["editat"] is True
    d = fisiere_db(db, wid)[0]
    assert d["mime"] == "image/jpeg" and d["marime"] == len(JPG) and d["original"]["obiect"] == fid
    assert call(c, "bob", "get", f"/fisiere/{fid}/continut", wid).data == JPG
    assert call(c, "bob", "get", f"/fisiere/{fid}/continut?versiune=original", wid).data == png
    assert contor(db, wid)["octeti"] == len(png) + len(JPG)

    # o a doua editare înlocuiește doar versiunea editată; originalul rămâne primul
    jpg2 = b"\xff\xd8\xff\xe0" + os.urandom(80)
    prima = d["obiect"]
    assert edit(jpg2).status_code == 200
    d = fisiere_db(db, wid)[0]
    assert d["original"]["obiect"] == fid and d["obiect"] != prima
    assert not (root / fisiere.cale(wid, prima)).exists()
    assert contor(db, wid)["octeti"] == len(png) + len(jpg2)

    # revenirea la original: conținutul, numele și tipul de dinainte; versiunea editată dispare
    r = call(c, "bob", "post", f"/fisiere/{fid}/original", wid)
    assert r.status_code == 200 and r.get_json()["fisier"]["nume"] == "CI Ion.png" and r.get_json()["fisier"]["editat"] is False
    d = fisiere_db(db, wid)[0]
    assert "original" not in d and d["mime"] == "image/png" and d["obiect"] == fid
    assert call(c, "bob", "get", f"/fisiere/{fid}/continut", wid).data == png
    assert contor(db, wid)["octeti"] == len(png)
    assert call(c, "bob", "post", f"/fisiere/{fid}/original", wid).status_code == 404


def test_stergerea_unui_fisier_editat_sterge_ambele_versiuni(env):
    c, db, root = env
    wid = setup_ws(c, db)
    png = _png()
    fid = upload(c, "bob", wid, data=png, name="a.png").get_json()["fisier"]["id"]
    call(c, "bob", "put", f"/fisiere/{fid}/continut", wid, data={"fisier": (io.BytesIO(JPG), "a.jpg")},
         content_type="multipart/form-data")
    nou = fisiere_db(db, wid)[0]["obiect"]
    assert call(c, "bob", "delete", f"/fisiere/{fid}", wid).status_code == 200
    assert not (root / fisiere.cale(wid, fid)).exists() and not (root / fisiere.cale(wid, nou)).exists()
    assert contor(db, wid) == {"octeti": 0, "numar": 0}


def test_editarea_doar_pentru_poze_si_pdf(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    fid = upload(c, "bob", wid, data=b"text simplu", name="a.txt").get_json()["fisier"]["id"]
    r = call(c, "bob", "put", f"/fisiere/{fid}/continut", wid, data={"fisier": (io.BytesIO(JPG), "a.jpg")},
             content_type="multipart/form-data")
    assert r.get_json()["error"] == "tip_nepermis"
    fid = upload(c, "bob", wid, data=PDF, name="a.pdf").get_json()["fisier"]["id"]
    r = call(c, "bob", "put", f"/fisiere/{fid}/continut", wid, data={"fisier": (io.BytesIO(JPG), "a.jpg")},
             content_type="multipart/form-data")
    assert r.get_json()["error"] == "tip_nepermis"                      # PDF-urile se modifică prin /pagini
    fid = upload(c, "bob", wid, data=_png(), name="b.png").get_json()["fisier"]["id"]
    r = call(c, "bob", "put", f"/fisiere/{fid}/continut", wid, data={"fisier": (io.BytesIO(PDF), "b.pdf")},
             content_type="multipart/form-data")
    assert r.get_json()["error"] == "tip_nepermis"                      # o poză rămâne poză
    r = call(c, "bob", "post", f"/fisiere/{fid}/pagini", wid, content_type="multipart/form-data",
             data={"date": "[1, 2]", "pagina_0": (io.BytesIO(JPG), "p.jpg")})
    assert r.status_code == 400


def _poza(w: int, h: int, culoare=(30, 90, 200)) -> bytes:
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (w, h), culoare).save(b, "JPEG")
    return b.getvalue()


def test_tipar_buletin_fata_verso_la_marime_reala(env):
    import fitz
    c, db, _ = env
    wid = setup_ws(c, db)
    f1 = upload(c, "bob", wid, data=_poza(856, 540), name="CI Ion (față).jpg").get_json()["fisier"]["id"]
    f2 = upload(c, "bob", wid, data=_poza(856, 540, (200, 30, 30)), name="CI Ion (verso).jpg").get_json()["fisier"]["id"]
    assert call(c, "vera", "post", "/fisiere/tipar", wid, json={"fisiere": [f1, f2], "aspect": "ci"}).status_code == 403
    r = call(c, "bob", "post", "/fisiere/tipar", wid, json={"fisiere": [f1, f2], "aspect": "ci"})
    assert r.status_code == 201, r.get_json()
    f = r.get_json()["fisier"]
    assert f["nume"] == "CI Ion – față-verso.pdf" and f["mime"] == "application/pdf" and f["sursa"] == "generat"
    doc = fitz.open(stream=call(c, "bob", "get", f"/fisiere/{f['id']}/continut", wid).data, filetype="pdf")
    assert doc.page_count == 1 and round(doc[0].rect.width) == 595                     # A4
    imagini = doc[0].get_image_info()
    assert len(imagini) == 2
    latime_mm = (imagini[0]["bbox"][2] - imagini[0]["bbox"][0]) * 25.4 / 72
    assert abs(latime_mm - 85.6) < 0.5                                                 # mărimea reală a cardului


def test_tipar_pagini_a4_din_poze_si_pdf(env):
    import fitz
    c, db, _ = env
    wid = setup_ws(c, db)
    src = fitz.open()
    src.new_page(width=842, height=595)
    src.new_page()
    pdf2 = src.tobytes()
    a = upload(c, "bob", wid, data=_poza(600, 900), name="Contract p1.jpg").get_json()["fisier"]["id"]
    b = upload(c, "bob", wid, data=pdf2, name="anexa.pdf").get_json()["fisier"]["id"]
    r = call(c, "bob", "post", "/fisiere/tipar", wid, json={"fisiere": [a, b], "aspect": "pagina"})
    assert r.status_code == 201 and r.get_json()["fisier"]["nume"] == "Contract p1 – pentru tipar.pdf"
    doc = fitz.open(stream=call(c, "bob", "get", f"/fisiere/{r.get_json()['fisier']['id']}/continut", wid).data, filetype="pdf")
    assert [(round(p.rect.width), round(p.rect.height)) for p in doc] == [(595, 842), (842, 595), (595, 842)]


def test_tipar_refuzuri(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    p = upload(c, "bob", wid, data=PDF, name="a.pdf").get_json()["fisier"]["id"]
    i = upload(c, "bob", wid, data=_poza(10, 10), name="a.jpg").get_json()["fisier"]["id"]
    j = upload(c, "bob", wid, data=_poza(10, 10, (1, 2, 3)), name="b.jpg", cid=CID2).get_json()["fisier"]["id"]
    tip = lambda ids, aspect="ci": call(c, "bob", "post", "/fisiere/tipar", wid, json={"fisiere": ids, "aspect": aspect}).get_json()  # noqa: E731
    assert tip([p])["error"] == "tip_nepermis"                       # buletinul: doar poze
    assert tip([i, j])["error"] == "tipar_invalid"                   # clienți diferiți
    assert tip([i, i])["error"] == "tipar_invalid"
    assert tip([i], "altceva")["error"] == "tipar_invalid"


def _pdf_pagini(n: int) -> bytes:
    import fitz
    doc = fitz.open()
    for i in range(n):
        doc.new_page().insert_text((72, 72), f"Pagina {i + 1}")
    return doc.tobytes()


def test_pagini_pdf_ordine_rotire_stergere(env):
    import fitz
    c, db, _ = env
    wid = setup_ws(c, db)
    pdf = _pdf_pagini(3)
    fid = upload(c, "bob", wid, data=pdf, name="Contract.pdf").get_json()["fisier"]["id"]
    pag = lambda body: call(c, "bob", "post", f"/fisiere/{fid}/pagini", wid, json=body)  # noqa: E731
    assert pag({"pagini": [{"p": 0}, {"p": 0}]}).get_json()["error"] == "pagini_invalide"
    assert pag({"pagini": [{"p": 5}]}).get_json()["error"] == "pagini_invalide"
    assert pag({"pagini": [{"p": 0, "r": 45}]}).get_json()["error"] == "pagini_invalide"

    r = pag({"pagini": [{"p": 2}, {"p": 0, "r": 90}]})                # a doua pagină ștearsă, ordinea inversată
    assert r.status_code == 200 and r.get_json()["fisier"]["editat"] is True
    doc = fitz.open(stream=call(c, "bob", "get", f"/fisiere/{fid}/continut", wid).data, filetype="pdf")
    assert [p.get_text().strip() for p in doc] == ["Pagina 3", "Pagina 1"] and doc[1].rotation == 90
    assert call(c, "bob", "get", f"/fisiere/{fid}/continut?versiune=original", wid).data == pdf

    r = pag({"pagini": [{"p": 1}], "copie": True})                    # copie: din versiunea curentă
    assert r.status_code == 201 and r.get_json()["fisier"]["nume"] == "Contract (editat).pdf"
    nou = fitz.open(stream=call(c, "bob", "get", f"/fisiere/{r.get_json()['fisier']['id']}/continut", wid).data, filetype="pdf")
    assert [p.get_text().strip() for p in nou] == ["Pagina 1"]
    jpg = upload(c, "bob", wid, data=JPG, name="a.jpg").get_json()["fisier"]["id"]
    assert call(c, "bob", "post", f"/fisiere/{jpg}/pagini", wid, json={"pagini": [{"p": 0}]}).get_json()["error"] == "tip_nepermis"


def test_unire_in_pdf_pastreaza_paginile_si_transforma_poza(env):
    import fitz
    c, db, _ = env
    wid = setup_ws(c, db)
    src = fitz.open()
    src.new_page(width=300, height=400).insert_text((20, 40), "Anexa")
    a = upload(c, "bob", wid, data=_pdf_pagini(2), name="Contract.pdf").get_json()["fisier"]["id"]
    b = upload(c, "bob", wid, data=src.tobytes(), name="Anexa.pdf").get_json()["fisier"]["id"]
    i = upload(c, "bob", wid, data=_poza(600, 400), name="Chitanta.jpg").get_json()["fisier"]["id"]
    r = call(c, "bob", "post", "/fisiere/tipar", wid, json={"fisiere": [a, b, i], "aspect": "unire"})
    assert r.status_code == 201 and r.get_json()["fisier"]["nume"] == "Contract – unit.pdf"
    doc = fitz.open(stream=call(c, "bob", "get", f"/fisiere/{r.get_json()['fisier']['id']}/continut", wid).data, filetype="pdf")
    assert [(round(p.rect.width), round(p.rect.height)) for p in doc] == [(595, 842), (595, 842), (300, 400), (842, 595)]
    assert doc[2].get_text().strip() == "Anexa"                          # paginile PDF rămân cu textul lor
    # o singură poză: „Transformă în PDF”, cu același nume
    r = call(c, "bob", "post", "/fisiere/tipar", wid, json={"fisiere": [i], "aspect": "unire"})
    assert r.get_json()["fisier"]["nume"] == "Chitanta.pdf"


def test_pagina_pdf_editata_ca_poza_inlocuieste_pagina(env):
    import fitz
    c, db, _ = env
    wid = setup_ws(c, db)
    fid = upload(c, "bob", wid, data=_pdf_pagini(3), name="Scan.pdf").get_json()["fisier"]["id"]
    date = json.dumps({"pagini": [{"p": 0}, {"p": 1}, {"p": 2, "r": 90}]})
    r = call(c, "bob", "post", f"/fisiere/{fid}/pagini", wid, content_type="multipart/form-data",
             data={"date": date, "pagina_1": (io.BytesIO(_poza(400, 300)), "p.jpg")})
    assert r.status_code == 200, r.get_json()
    doc = fitz.open(stream=call(c, "bob", "get", f"/fisiere/{fid}/continut", wid).data, filetype="pdf")
    assert doc.page_count == 3 and doc[0].get_text().strip() == "Pagina 1"
    assert doc[1].get_text().strip() == "" and len(doc[1].get_images()) == 1   # pagina 2: poza editată
    assert round(doc[1].rect.width) == 595 and round(doc[1].rect.height) == 446   # lățimea paginii, proporția pozei
    assert doc[2].rotation == 90
    r = call(c, "bob", "post", f"/fisiere/{fid}/pagini", wid, content_type="multipart/form-data",
             data={"date": date, "pagina_1": (io.BytesIO(b"text"), "p.txt")})
    assert r.get_json()["error"] == "tip_nepermis"
