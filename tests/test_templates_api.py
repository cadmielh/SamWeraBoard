"""Teste pentru templates_api.py (înlocuirea fișierului, livrarea și retragerea), contra emulatorului Firestore.

Rulare: firebase emulators:exec --only firestore --project demo-samwera \
        ".venv/bin/python -m pytest tests/test_templates_api.py -q"
"""
import base64
import io
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from docx import Document

pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"), reason="necesită emulatorul Firestore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

import authz  # noqa: E402
import templates_api  # noqa: E402
from legal_versions import DPA_VERSION, TOS_VERSION  # noqa: E402

SRC, DST, OTHER = "SursaCabinet01", "ClientCabinet01", "AltCabinet0001"
CONSENT = {"tos": TOS_VERSION, "dpa": DPA_VERSION}


def docx(text="Societatea {{SOCIETATE_DENUMIRE}}, {{CAMP_NR}}", author="Ion Popescu") -> bytes:
    d = Document()
    d.add_paragraph(text)
    d.core_properties.author = author
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def access(days: int = 30, sub: bool = True, comp: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    return {"accessUntil": now + timedelta(days=days), "hasSubscription": sub,
            "compUntil": now + timedelta(days=days) if comp else None}


@pytest.fixture()
def env(monkeypatch):
    db = gcf.Client(project="demo-samwera")
    for coll in ("workspaces", "users", "rateLimits"):
        for d in db.collection(coll).stream():
            for sub in d.reference.collections():
                for sd in sub.stream():
                    sd.reference.delete()
            d.reference.delete()
    monkeypatch.setattr(authz, "db", lambda: db)

    def fake_authenticate():
        from flask import request
        uid = request.headers.get("X-Test-User", "")
        if not uid:
            raise authz.AuthError(401)
        return authz.Principal(uid=uid, email=f"{uid}@ex.ro", name=uid,
                               provider=request.headers.get("X-Test-Provider", "google.com"))

    monkeypatch.setattr(authz, "authenticate", fake_authenticate)
    templates_api.set_builtins({"anexa1_inregistrare_fiscala": {"placeholders": ["{{SOCIETATE_DENUMIRE}}"]},
                                "hotarare_aga": {"placeholders": []}})

    members = {"sa": {"role": "admin"}, "ana": {"role": "member"}, "vio": {"role": "viewer"}}
    db.collection("workspaces").document(SRC).set({"name": "Cabinio intern", "members": members,
                                                   "consent": CONSENT, "billing": access()})
    db.collection("workspaces").document(DST).set({"name": "Cabinet Client SRL", "members": {"cli": {"role": "admin"}},
                                                   "consent": CONSENT, "billing": access()})
    db.collection("workspaces").document(OTHER).set({"name": "Alt cabinet", "members": {"cli2": {"role": "admin"}},
                                                     "consent": CONSENT, "billing": access()})
    db.collection("users").document("sa").set({"isSuperAdmin": True})

    app = Flask(__name__)
    app.register_blueprint(templates_api.bp)
    return app.test_client(), db


def hdr(uid, wid=SRC, provider="google.com"):
    return {"X-Test-User": uid, "X-Workspace-Id": wid, "X-Test-Provider": provider}


def add_tpl(db, wid=SRC, tid="t1", data: bytes | None = None, **extra):
    d = {"name": "Act constitutiv", "description": "", "type": "docx",
         "fileBase64": base64.b64encode(data or docx()).decode(), "fileName": "act.docx",
         "placeholders": [], "outputNameTemplate": "Act.docx", "tipTemplate": "PJ", "createdAt": "x", **extra}
    db.collection("workspaces").document(wid).collection("docTemplates").document(tid).set(d)


def tpl(db, wid, tid):
    snap = db.collection("workspaces").document(wid).collection("docTemplates").document(tid).get()
    return snap.to_dict() if snap.exists else None


def audit_actions(db, wid):
    return [a.to_dict() for a in db.collection("workspaces").document(wid).collection("auditLog").stream()]


def replace(c, uid, tid="t1", data=None, base="0", wid=SRC, name="nou.docx"):
    return c.post(f"/templates/{tid}/file", headers=hdr(uid, wid),
                  data={"baseRevision": base, "template": (io.BytesIO(data or docx("{{CAMP_NOU}}")), name)},
                  content_type="multipart/form-data")


def deliver(c, uid="sa", target=DST, **body):
    body = {"sourceTemplateId": "t1", "confirmName": "Cabinet Client SRL", **body}
    return c.post(f"/admin/workspaces/{target}/templates", headers=hdr(uid), json=body)


# ── Înlocuirea fișierului ────────────────────────────────────────────────────

def test_inlocuirea_pastreaza_identitatea_si_recalculeaza_etichetele(env):
    c, db = env
    add_tpl(db, sourceKey="anexa1_inregistrare_fiscala", placeholders=["{{FALS}}"])
    r = replace(c, "ana")
    assert r.status_code == 200, r.get_json()
    t = tpl(db, SRC, "t1")
    assert t["placeholders"] == ["{{CAMP_NOU}}"] and r.get_json()["placeholders"] == ["{{CAMP_NOU}}"]
    assert t["revision"] == 1 and t["updatedBy"] == "ana" and t["fileName"] == "nou.docx"
    assert t["sourceKey"] == "anexa1_inregistrare_fiscala" and t["name"] == "Act constitutiv"
    entry = next(a for a in audit_actions(db, SRC) if a["action"] == "template.replace")
    assert entry["target"] == "t1" and "nou.docx" not in str(entry)


def test_revizie_veche_e_refuzata(env):
    c, db = env
    add_tpl(db, revision=3)
    r = replace(c, "ana", base="2")
    assert r.status_code == 409 and r.get_json() == {"error": "revision_conflict", "revision": 3}
    assert tpl(db, SRC, "t1")["revision"] == 3


def test_vizualizatorul_si_alt_cabinet_nu_pot_inlocui(env):
    c, db = env
    add_tpl(db)
    add_tpl(db, wid=OTHER, tid="t9")
    assert replace(c, "vio").status_code == 403
    assert replace(c, "ana", tid="t9").status_code == 404           # calea e mereu din cabinetul autorizat
    assert replace(c, "ana", wid=OTHER).status_code == 403
    assert tpl(db, OTHER, "t9").get("revision") is None


def test_cabinet_expirat_nu_poate_inlocui(env):
    c, db = env
    add_tpl(db)
    db.collection("workspaces").document(SRC).update({"billing": access(days=-1)})
    assert replace(c, "ana").get_json()["error"] == "subscription_required"


def test_fisier_nesigur_sau_sablon_google_docs(env):
    c, db = env
    add_tpl(db)
    db.collection("workspaces").document(SRC).collection("docTemplates").document("g1").set(
        {"name": "G", "type": "gdoc", "docId": "x"})
    assert replace(c, "ana", data=b"nu e docx").get_json()["error"] == "invalid_template"
    assert replace(c, "ana", name="act.pdf").get_json()["error"] == "invalid_template"
    assert replace(c, "ana", tid="g1").get_json()["error"] == "not_replaceable"
    assert replace(c, "ana", tid="lipsa").status_code == 404
    assert replace(c, "ana", base="x").get_json()["error"] == "invalid_revision"


# ── Crearea ──────────────────────────────────────────────────────────────────

def create(c, uid, data=None, wid=SRC, name="act.docx", **fields):
    form = {"name": "Act nou", "tipTemplate": "PJ", **fields, "template": (io.BytesIO(data or docx()), name)}
    return c.post("/templates", headers=hdr(uid, wid), data=form, content_type="multipart/form-data")


def test_crearea_calculeaza_etichetele_pe_server(env):
    c, db = env
    r = create(c, "ana", placeholders="{{FALS}}", revision="9", delivery="x")
    assert r.status_code == 201, r.get_json()
    t = tpl(db, SRC, r.get_json()["id"])
    assert set(t["placeholders"]) == {"{{CAMP_NR}}", "{{SOCIETATE_DENUMIRE}}"}
    assert t["revision"] == 0 and "delivery" not in t and t["createdBy"] == "ana" and t["createdAt"] is not None
    assert t["type"] == "docx" and t["tipTemplate"] == "PJ" and t["outputNameTemplate"] == "Act nou_completat.docx"
    assert any(a["action"] == "template.create" for a in audit_actions(db, SRC))


def test_crearea_refuza_fisierul_nesigur_si_fara_nume(env):
    c, db = env
    assert create(c, "ana", data=b"nu e docx").get_json()["error"] == "invalid_template"
    assert create(c, "ana", name="act.pdf").get_json()["error"] == "invalid_template"
    assert create(c, "ana", data=b"x" * 600_000).get_json()["error"] == "template_too_large"
    assert create(c, "ana", **{"name": "  "}).get_json()["error"] == "name_required"
    assert list(db.collection("workspaces").document(SRC).collection("docTemplates").stream()) == []


def test_vizualizatorul_nu_creeaza(env):
    c, _db = env
    assert create(c, "vio").status_code == 403


def test_duplicarea_unui_sablon_de_baza_ia_fisierul_de_pe_server(env):
    c, db = env
    original = docx("{{CAMP_NR}}")
    templates_api.set_builtins({"hotarare_aga": {
        "type": "docx", "bytes": original, "filename": "Hotărâre AGA.docx", "version": 3, "name": "Hotărâre AGA",
        "description": "d", "tipTemplate": "PJ", "outputNameTemplate": "AGA.docx",
        "placeholders": ["{{CAMP_NR}}"], "clauses": [], "repeatGroups": []}})
    r = c.post("/templates/from-builtin", headers=hdr("ana"), json={"key": "hotarare_aga"})
    assert r.status_code == 201, r.get_json()
    t = tpl(db, SRC, r.get_json()["id"])
    assert t["sourceKey"] == "hotarare_aga" and t["sourceVersion"] == 3 and t["name"] == "Hotărâre AGA"
    assert base64.b64decode(t["fileBase64"]) == original and t["placeholders"] == ["{{CAMP_NR}}"]
    assert c.post("/templates/from-builtin", headers=hdr("ana"), json={"key": "nu_exista"}).get_json()["error"] == "invalid_source_key"


# ── Livrarea ─────────────────────────────────────────────────────────────────

def test_livrarea_copiaza_curata_si_nu_suprascrie(env):
    c, db = env
    add_tpl(db, sourceVersion=4, createdBy="sa")
    r = deliver(c, sourceKey="hotarare_aga")
    assert r.status_code == 201, r.get_json()
    t = tpl(db, DST, "dlv_t1")
    assert t["delivery"]["by"] == "sa" and t["delivery"]["sourceTemplateId"] == "t1" and t["revision"] == 0
    assert t["sourceKey"] == "hotarare_aga" and "sourceVersion" not in t
    assert isinstance(t["createdAt"], datetime)                     # lista din aplicație e ordonată după el
    assert t["placeholders"] == ["{{CAMP_NR}}", "{{SOCIETATE_DENUMIRE}}"]
    assert Document(io.BytesIO(base64.b64decode(t["fileBase64"]))).core_properties.author == ""
    entry = next(a for a in audit_actions(db, DST) if a["action"] == "template.deliver")
    assert entry["meta"]["byProvider"] is True and "Act constitutiv" not in str(entry)

    assert deliver(c).get_json()["error"] == "already_delivered"
    copy = deliver(c, asNewCopy=True)
    assert copy.status_code == 201 and copy.get_json()["id"] != "dlv_t1"


def test_dry_run_nu_scrie_si_raporteaza_campurile_necerute(env):
    c, db = env
    add_tpl(db)
    r = deliver(c, dryRun=True, sourceKey="anexa1_inregistrare_fiscala")
    assert r.status_code == 200 and r.get_json()["warnings"] == {"dedicatedFormUnasked": ["{{CAMP_NR}}"]}
    assert tpl(db, DST, "dlv_t1") is None


def test_cnp_real_blocheaza_livrarea(env):
    c, db = env
    add_tpl(db, data=docx("Asociat CNP 1900101123457"))
    r = deliver(c)
    assert r.status_code == 422 and r.get_json()["blocking"] == ["personal_data"]
    assert tpl(db, DST, "dlv_t1") is None


def test_doar_super_adminul_in_sesiune_google_membru_al_sursei(env):
    c, db = env
    add_tpl(db)
    assert deliver(c, uid="ana").status_code == 403
    sa_password = c.post(f"/admin/workspaces/{DST}/templates", headers=hdr("sa", provider="password"),
                         json={"sourceTemplateId": "t1", "confirmName": "Cabinet Client SRL"})
    assert sa_password.status_code == 403
    add_tpl(db, wid=OTHER, tid="t1")
    from_foreign = c.post(f"/admin/workspaces/{DST}/templates", headers=hdr("sa", wid=OTHER),
                          json={"sourceTemplateId": "t1", "confirmName": "Cabinet Client SRL"})
    assert from_foreign.status_code == 403                          # nu e membru al cabinetului sursă


def test_tinta_trebuie_confirmata_valida_si_cu_abonament(env):
    c, db = env
    add_tpl(db)
    assert deliver(c, confirmName="Cabinet client srl").get_json()["error"] == "confirm_mismatch"
    assert deliver(c, target=SRC, confirmName="Cabinio intern").status_code == 404
    assert deliver(c, target="Inexistent0001").status_code == 404
    assert deliver(c, sourceKey="nu_exista").get_json()["error"] == "invalid_source_key"
    assert deliver(c, sourceTemplateId="lipsa").status_code == 404

    ws = db.collection("workspaces").document(DST)
    ws.update({"billing": access(sub=False)})                        # perioadă de probă
    assert deliver(c).get_json()["error"] == "target_subscription_required"
    ws.update({"billing": access(sub=False, comp=True)})             # acces gratuit acordat
    assert deliver(c, dryRun=True).status_code == 200
    ws.update({"consent": {"tos": "veche", "dpa": "veche"}})
    assert deliver(c).get_json()["error"] == "target_consent_required"
    ws.update({"consent": CONSENT, "status": "pendingDeletion"})
    assert deliver(c).status_code == 404


# ── Listare și retragere ─────────────────────────────────────────────────────

def test_listarea_nu_intoarce_fisiere_si_retragerea_atinge_doar_livrarile(env):
    c, db = env
    add_tpl(db)
    deliver(c)
    add_tpl(db, wid=DST, tid="propriu")
    listed = c.get(f"/admin/workspaces/{DST}/delivered-templates", headers=hdr("sa")).get_json()
    assert [t["id"] for t in listed] == ["dlv_t1"] and "fileBase64" not in listed[0]
    assert c.get(f"/admin/workspaces/{DST}/delivered-templates", headers=hdr("ana")).status_code == 403

    assert c.delete(f"/admin/workspaces/{DST}/templates/propriu", headers=hdr("sa")).status_code == 404
    assert tpl(db, DST, "propriu") is not None
    assert c.delete(f"/admin/workspaces/{DST}/templates/dlv_t1", headers=hdr("ana")).status_code == 403
    assert c.delete(f"/admin/workspaces/{DST}/templates/dlv_t1", headers=hdr("sa")).status_code == 200
    assert tpl(db, DST, "dlv_t1") is None
    assert any(a["action"] == "template.delivery_revoke" for a in audit_actions(db, DST))
