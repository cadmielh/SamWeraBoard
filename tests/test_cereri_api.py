"""Teste pentru cereri_api.py (cererile de documente și portalul clientului final) contra emulatorului Firestore.

Rulare: tests/run_all.sh (sau `firebase emulators:exec --only firestore ... pytest tests/test_cereri_api.py`).
"""
import base64
import io
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore"
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pymupdf  # noqa: E402
from flask import Flask  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402
from PIL import Image  # noqa: E402

import alerte  # noqa: E402
import authz  # noqa: E402
import cereri_api  # noqa: E402
import fisiere  # noqa: E402
import fisiere_api  # noqa: E402
import pii_api  # noqa: E402
import vault  # noqa: E402
import workspaces_api  # noqa: E402

CONSENT = {"tos": workspaces_api.TOS_VERSION, "dpa": workspaces_api.DPA_VERSION}
CID = "clientAAAAAAAAAAA1"


def _pdf(js: bool = False, parola: bool = False) -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Dovada sediu")
    if js:
        doc.xref_set_key(doc.pdf_catalog(), "OpenAction", "<</S/JavaScript/JS(app.alert(1))>>")
    if parola:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
    return doc.tobytes()


def _png_cu_gps() -> bytes:
    im = Image.new("RGB", (40, 30), (200, 10, 10))
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (44.0, 26.0, 0.0)}           # GPSInfo
    out = io.BytesIO()
    im.save(out, "PNG", exif=exif)
    return out.getvalue()


PDF = _pdf()


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("VAULT_LOCAL_KEK", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.delenv("VAULT_KMS_KEY", raising=False)
    monkeypatch.delenv("FISIERE_BUCKET", raising=False)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setenv("FISIERE_LOCAL_DIR", str(tmp_path))
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://cabinio.web.app")
    vault._cache.clear()
    client = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "invitations", "users", "workspaceKeys", "trialClaims", "rateLimits", "portalTokens"):
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
    for bp in (workspaces_api.bp, pii_api.bp, fisiere_api.bp, cereri_api.bp):
        app.register_blueprint(bp)
    return app.test_client(), client, tmp_path


def call(c, uid, method, url, wid=None, **kw):
    hdr = {"X-Test-User": f"{uid}:{uid}@ex.ro"}
    if wid:
        hdr["X-Workspace-Id"] = wid
    return getattr(c, method)(url, headers=hdr, **kw)


def setup_ws(c, db):
    wid = call(c, "alice", "post", "/workspaces", json={"name": "Cabinet Ionescu", "consent": CONSENT}).get_json()["id"]
    ref = db.collection("workspaces").document(wid)
    ref.update({
        "members.bob": {"role": "member", "email": "bob@ex.ro"},
        "members.vera": {"role": "viewer", "email": "vera@ex.ro"},
    })
    ref.collection("clienti").document(CID).set({"denumire": "Alfa SRL"})
    return wid


ACTE = [{"eticheta": "CI – Popescu Ion", "tip": "ci", "persoanaPid": "p1"},
        {"eticheta": "Dovada sediu", "tip": "dovada_sediu"}]


def cerere(c, wid, acte=ACTE, **extra):
    r = call(c, "bob", "post", "/cereri", wid, json={"clientId": CID, "acte": acte, **extra})
    assert r.status_code == 201, r.get_json()
    j = r.get_json()
    return j["cerere"]["id"], j["link"].rsplit("/p/", 1)[1], j


def trimite(c, token, aid, data=PDF, name="poza.pdf"):
    return c.post(f"/portal/{token}/acte/{aid}", data={"fisier": (io.BytesIO(data), name)},
                  content_type="multipart/form-data")


def doc_cerere(db, wid, rid):
    return db.collection("workspaces").document(wid).collection("cereriDocumente").document(rid).get().to_dict()


def fisier(db, wid, fid):
    return db.collection("workspaces").document(wid).collection("fisiere").document(fid).get().to_dict()


# ── Cabinetul ─────────────────────────────────────────────────────────────────

def test_creare_link_si_fara_token_in_clar(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, j = cerere(c, wid, mesaj="  Vă rog   actele ", zile=7)
    assert j["link"] == f"https://cabinio.web.app/p/{token}"
    d = doc_cerere(db, wid, rid)
    assert d["stare"] == "deschisa" and d["deVerificat"] == 0 and d["mesaj"] == "Vă rog actele"
    assert [a["id"] for a in d["acte"]] == ["a1", "a2"] and all(a["stare"] == "de_trimis" for a in d["acte"])
    assert token not in str(d) and d["clientNume"] == "Alfa SRL"
    assert timedelta(days=6) < d["expiraLa"] - datetime.now(timezone.utc) <= timedelta(days=7)
    t = db.collection("portalTokens").document(d["tokenHash"]).get().to_dict()
    assert t["wid"] == wid and t["rid"] == rid and token not in str(t)
    # linkul se poate copia din nou din aplicație
    assert call(c, "alice", "get", f"/cereri/{rid}/link", wid).get_json()["link"].endswith(token)


def test_creare_validari_si_roluri(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    ok = {"clientId": CID, "acte": ACTE}
    assert call(c, "vera", "post", "/cereri", wid, json=ok).status_code == 403
    assert call(c, "bob", "post", "/cereri", wid, json={**ok, "clientId": "inexistent0000000"}).status_code == 404
    for rau in ({**ok, "acte": []}, {**ok, "acte": [{"eticheta": "  "}]}, {**ok, "acte": [{}] * 21},
                {**ok, "zile": 0}, {**ok, "zile": 61}, {**ok, "zile": "x"}):
        assert call(c, "bob", "post", "/cereri", wid, json=rau).status_code == 400
    db.collection("workspaces").document(wid).update({"billing.accessUntil": None, "billing.status": "expired"})
    assert call(c, "bob", "post", "/cereri", wid, json=ok).status_code == 402


# ── Portalul ──────────────────────────────────────────────────────────────────

def test_portal_arata_doar_ce_trebuie_si_marcheaza_deschiderea(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid, mesaj="Mulțumim")
    _, t2, _ = cerere(c, wid, mesaj="Bună ziua,\r\n\n\n\nVă rugăm   actele.\n  Mulțumim ")
    assert c.get(f"/portal/{t2}").get_json()["mesaj"] == "Bună ziua,\n\nVă rugăm actele.\nMulțumim"   # rândurile rămân
    r = c.get(f"/portal/{token}")
    assert r.status_code == 200
    j = r.get_json()
    assert j["cabinet"] == "Cabinet Ionescu" and j["mesaj"] == "Mulțumim" and j["stare"] == "deschisa"
    assert j["cerutDe"] == "bob"                                         # cine a cerut (numele contului, nu adresa)
    assert [(a["id"], a["eticheta"], a["stare"], a["fisiere"]) for a in j["acte"]] == [
        ("a1", "CI – Popescu Ion", "de_trimis", []), ("a2", "Dovada sediu", "de_trimis", [])]
    assert "Alfa" not in str(j) and "clientId" not in str(j)            # nimic despre client în afara actelor
    assert doc_cerere(db, wid, rid)["deschisaLa"]


def test_link_gresit_expirat_anulat_sau_mod_citire_raspund_la_fel(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    assert c.get("/portal/" + "x" * 32).get_json() == {"error": "link_inactiv"}
    ws = db.collection("workspaces").document(wid)
    ws.collection("cereriDocumente").document(rid).update({"expiraLa": datetime.now(timezone.utc) - timedelta(seconds=1)})
    assert c.get(f"/portal/{token}").status_code == 404
    assert call(c, "bob", "post", f"/cereri/{rid}/prelungeste", wid, json={"zile": 3}).status_code == 200
    assert c.get(f"/portal/{token}").status_code == 200
    ws.update({"billing.accessUntil": None, "billing.status": "expired"})
    assert c.get(f"/portal/{token}").get_json() == {"error": "link_inactiv"}
    ws.update({"billing.accessUntil": datetime.now(timezone.utc) + timedelta(days=5)})
    assert c.get(f"/portal/{token}").status_code == 200
    assert call(c, "bob", "post", f"/cereri/{rid}/anuleaza", wid).status_code == 200
    assert c.get(f"/portal/{token}").get_json() == {"error": "link_inactiv"}
    assert call(c, "bob", "get", f"/cereri/{rid}/link", wid).status_code == 404


def test_incarcare_prin_portal(env):
    c, db, root = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    r = trimite(c, token, "a2", name="sediu scanat.pdf")
    assert r.status_code == 201, r.get_json()
    fid = r.get_json()["fisier"]["id"]
    f = fisier(db, wid, fid)
    assert (f["sursa"], f["stare"], f["cerereId"], f["actId"], f["createdBy"]) == ("portal", "de_verificat", rid, "a2", "portal")
    assert f["nume"] == "Dovada sediu.pdf"
    folder = db.collection("workspaces").document(wid).collection("foldere").document(f["folderId"]).get().to_dict()
    assert folder["nume"] == "Primite de la client"
    assert vault.decrypt_file(wid, fid, (root / fisiere.cale(wid, fid)).read_bytes()) == PDF
    d = doc_cerere(db, wid, rid)
    assert d["acte"][1]["stare"] == "primit" and d["acte"][1]["fisiere"] == [fid] and d["deVerificat"] == 1
    assert d["deschisaLa"]                                    # o încărcare înseamnă că linkul a fost deschis
    # pe link: doar numele trimis și mărimea, fără conținut
    a2 = c.get(f"/portal/{token}").get_json()["acte"][1]
    assert a2["stare"] == "primit" and a2["fisiere"] == [{"id": fid, "nume": "sediu scanat.pdf", "marime": len(PDF)}]
    assert trimite(c, token, "a2").get_json()["error"] == "duplicat"
    assert trimite(c, token, "a9").status_code == 404


def test_pozele_se_resalveaza_ca_jpeg_fara_metadate(env):
    c, db, root = env
    wid = setup_ws(c, db)
    _, token, _ = cerere(c, wid)
    r = trimite(c, token, "a1", data=_png_cu_gps(), name="IMG_1.png").get_json()["fisier"]
    fid = r["id"]
    f = fisier(db, wid, fid)
    assert f["mime"] == "image/jpeg" and f["nume"] == "CI – Popescu Ion.jpg"
    assert r["nume"] == "IMG_1.jpg" == f["numeOriginal"]                  # extensia înlocuită, nu adăugată
    data = vault.decrypt_file(wid, fid, (root / fisiere.cale(wid, fid)).read_bytes())
    im = Image.open(io.BytesIO(data))
    assert im.format == "JPEG" and not im.getexif()


def test_fisiere_periculoase_refuzate(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    assert trimite(c, token, "a2", data=_pdf(js=True)).get_json()["error"] == "pdf_risc"
    assert trimite(c, token, "a2", data=_pdf(parola=True)).get_json()["error"] == "pdf_parola"
    heic = b"\x00\x00\x00\x18ftypheic" + os.urandom(32)
    assert trimite(c, token, "a1", data=heic, name="a.heic").get_json()["error"] == "heic"
    docx = b"PK\x03\x04" + os.urandom(40)
    assert trimite(c, token, "a1", data=docx, name="a.docx").status_code == 400
    assert doc_cerere(db, wid, rid)["deVerificat"] == 0


def test_clientul_isi_retrage_o_incarcare(env):
    c, db, root = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    fid = trimite(c, token, "a2").get_json()["fisier"]["id"]
    assert c.delete(f"/portal/{token}/fisiere/{fid}").status_code == 200
    assert fisier(db, wid, fid) is None and not (root / fisiere.cale(wid, fid)).exists()
    d = doc_cerere(db, wid, rid)
    assert d["acte"][1]["stare"] == "de_trimis" and d["deVerificat"] == 0
    assert c.delete(f"/portal/{token}/fisiere/{fid}").status_code == 404


def test_acceptare_numeste_si_muta_iar_cererea_devine_completa(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    call(c, "bob", "post", f"/clients/{CID}/documente/init", wid)           # folderele implicite
    rid, token, _ = cerere(c, wid)
    f1 = trimite(c, token, "a1", data=_png_cu_gps(), name="fata.png").get_json()["fisier"]["id"]
    img2 = io.BytesIO()
    Image.new("RGB", (20, 20), (0, 0, 255)).save(img2, "PNG")
    f2 = trimite(c, token, "a1", data=img2.getvalue(), name="verso.png").get_json()["fisier"]["id"]
    trimite(c, token, "a2")
    assert call(c, "vera", "post", f"/cereri/{rid}/acte/a1/accepta", wid).status_code == 403
    assert call(c, "bob", "post", f"/cereri/{rid}/acte/a1/accepta", wid).status_code == 200
    foldere = {s.id: s.to_dict()["nume"] for s in db.collection("workspaces").document(wid).collection("foldere").stream()}
    a, b = fisier(db, wid, f1), fisier(db, wid, f2)
    assert (a["stare"], b["stare"]) == ("acceptat", "acceptat")
    assert foldere[a["folderId"]] == "Acte identitate" == foldere[b["folderId"]]
    assert {a["nume"], b["nume"]} == {"CI – Popescu Ion.jpg", "CI – Popescu Ion (2).jpg"}
    d = doc_cerere(db, wid, rid)
    assert d["acte"][0]["stare"] == "acceptat" and d["deVerificat"] == 1 and d["stare"] == "deschisa"
    assert call(c, "bob", "post", f"/cereri/{rid}/acte/a1/accepta", wid).get_json()["error"] == "act_neprimit"
    assert trimite(c, token, "a1").get_json()["error"] == "act_acceptat"
    assert call(c, "bob", "post", f"/cereri/{rid}/acte/a2/accepta", wid).status_code == 200
    assert doc_cerere(db, wid, rid)["stare"] == "completa"
    assert c.get(f"/portal/{token}").get_json()["stare"] == "completa"
    assert trimite(c, token, "a2").get_json()["error"] == "cerere_completa"


def test_respingerea_redeschide_actul_pe_acelasi_link(env):
    c, db, root = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    fid = trimite(c, token, "a2").get_json()["fisier"]["id"]
    assert call(c, "bob", "post", f"/cereri/{rid}/acte/a2/respinge", wid, json={"motiv": " "}).status_code == 400
    r = call(c, "bob", "post", f"/cereri/{rid}/acte/a2/respinge", wid, json={"motiv": "Poza e neclară"})
    assert r.status_code == 200
    assert fisier(db, wid, fid) is None and not (root / fisiere.cale(wid, fid)).exists()
    a2 = c.get(f"/portal/{token}").get_json()["acte"][1]
    assert (a2["stare"], a2["motiv"], a2["fisiere"]) == ("respins", "Poza e neclară", [])
    trimite(c, token, "a2", data=_pdf(js=False) + b"\n%alt")
    d = doc_cerere(db, wid, rid)
    assert d["acte"][1]["stare"] == "primit" and "motiv" not in d["acte"][1] and d["deVerificat"] == 1


def test_verificarea_nu_pierde_un_fisier_venit_intre_timp(env, monkeypatch):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    trimite(c, token, "a2")
    real = cereri_api._cerere

    def cu_fisier_nou(w, r):
        ref, d = real(w, r)
        if ref:                                   # clientul mai trimite ceva exact după citirea cabinetului
            monkeypatch.setattr(cereri_api, "_cerere", real)
            trimite(c, token, "a2", data=PDF + b"\n%2")
        return ref, d

    monkeypatch.setattr(cereri_api, "_cerere", cu_fisier_nou)
    r = call(c, "bob", "post", f"/cereri/{rid}/acte/a2/respinge", wid, json={"motiv": "x"})
    assert r.get_json()["error"] == "act_modificat"
    a2 = doc_cerere(db, wid, rid)["acte"][1]
    assert a2["stare"] == "primit" and len(a2["fisiere"]) == 2


def test_limita_de_fisiere_pe_cerere(env, monkeypatch):
    c, db, _ = env
    wid = setup_ws(c, db)
    monkeypatch.setattr(cereri_api, "MAX_FISIERE_CERERE", 2)
    _, token, _ = cerere(c, wid)
    trimite(c, token, "a2")
    trimite(c, token, "a2", data=PDF + b"\n%2")
    assert trimite(c, token, "a2", data=PDF + b"\n%3").get_json()["error"] == "prea_multe_fisiere"


def test_clientul_spune_ca_nu_are_un_act(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    r = c.post(f"/portal/{token}/acte/a2/lipsa", json={"nota": "  Îl trimit   săptămâna viitoare "})
    assert r.status_code == 200
    a2 = doc_cerere(db, wid, rid)["acte"][1]
    assert (a2["stare"], a2["notaClient"]) == ("lipsa", "Îl trimit săptămâna viitoare")
    assert c.get(f"/portal/{token}").get_json()["acte"][1]["notaClient"] == "Îl trimit săptămâna viitoare"
    assert c.delete(f"/portal/{token}/acte/a2/lipsa").status_code == 200
    a2 = doc_cerere(db, wid, rid)["acte"][1]
    assert a2["stare"] == "de_trimis" and "notaClient" not in a2
    c.post(f"/portal/{token}/acte/a2/lipsa", json={})
    assert trimite(c, token, "a2").status_code == 201                   # un fișier trimis anulează „nu am”
    a2 = doc_cerere(db, wid, rid)["acte"][1]
    assert a2["stare"] == "primit" and "notaClient" not in a2
    assert c.post(f"/portal/{token}/acte/a2/lipsa", json={}).get_json()["error"] == "act_are_fisiere"


def test_actul_optional_lipsa_nu_tine_cererea_deschisa(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid, acte=[{**ACTE[0]}, {**ACTE[1], "optional": True}])
    assert doc_cerere(db, wid, rid)["acte"][1]["optional"] is True
    assert c.get(f"/portal/{token}").get_json()["acte"][1]["optional"] is True
    c.post(f"/portal/{token}/acte/a2/lipsa", json={"nota": "nu există"})
    trimite(c, token, "a1")
    assert call(c, "bob", "post", f"/cereri/{rid}/acte/a1/accepta", wid).status_code == 200
    assert doc_cerere(db, wid, rid)["stare"] == "completa"


def test_actul_obligatoriu_lipsa_tine_cererea_deschisa(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    c.post(f"/portal/{token}/acte/a2/lipsa", json={})
    trimite(c, token, "a1")
    call(c, "bob", "post", f"/cereri/{rid}/acte/a1/accepta", wid)
    assert doc_cerere(db, wid, rid)["stare"] == "deschisa"


def test_fata_si_verso_la_buletin(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    r = c.post(f"/portal/{token}/acte/a1", data={"fisier": (io.BytesIO(_png_cu_gps()), "a.png"), "parte": "verso"},
               content_type="multipart/form-data")
    fid = r.get_json()["fisier"]["id"]
    assert fisier(db, wid, fid)["parte"] == "verso" and fisier(db, wid, fid)["nume"] == "CI – Popescu Ion (verso).jpg"
    assert c.get(f"/portal/{token}").get_json()["acte"][0]["fisiere"][0]["parte"] == "verso"
    r = c.post(f"/portal/{token}/acte/a2", data={"fisier": (io.BytesIO(PDF), "s.pdf"), "parte": "verso"},
               content_type="multipart/form-data")                     # doar la buletin
    assert "parte" not in fisier(db, wid, r.get_json()["fisier"]["id"])
    call(c, "bob", "post", f"/cereri/{rid}/acte/a1/accepta", wid)
    assert fisier(db, wid, fid)["nume"] == "CI – Popescu Ion (verso).jpg"


def test_stergerea_clientului_inchide_linkurile(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    rid, token, _ = cerere(c, wid)
    h = doc_cerere(db, wid, rid)["tokenHash"]
    assert call(c, "alice", "delete", f"/clients/{CID}?fisiere=sterge", wid).status_code == 200
    assert doc_cerere(db, wid, rid) is None and not db.collection("portalTokens").document(h).get().exists
    assert c.get(f"/portal/{token}").status_code == 404


def test_stergerea_cabinetului_sterge_legaturile(env):
    c, db, _ = env
    wid = setup_ws(c, db)
    cerere(c, wid)
    cerere(c, wid)
    assert cereri_api.la_stergere_cabinet(wid) == 2
    assert not list(db.collection("portalTokens").stream())


# ── Alerta „Documente primite” ───────────────────────────────────────────────

def test_alerta_documente_primite():
    assert alerte.alerte_cerere("r1", {"deVerificat": 0, "clientId": CID}, {}) == []
    [a] = alerte.alerte_cerere("r1", {"deVerificat": 2, "clientId": CID, "clientNume": "Alfa SRL"}, {})
    assert (a.cod, a.sursa, a.titlu, a.detaliu, a.client_id) == (
        "documente_primite", "cerere:r1", "2 acte primite de verificat", "Alfa SRL", CID)
    assert a.link == f"/?open={CID}&sectiune=documente"
    assert alerte.TIPURI["documente_primite"]["roluri"] == ["admin", "member"]
