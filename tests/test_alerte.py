"""Motorul de alerte (alerte.py): calculul din datele cabinetului, setările personale și sincronizarea cu `notificari`.

Logica e pură și se testează direct; sincronizarea rulează pe un Firestore minimal în memorie (fără emulator),
suficient pentru operațiile folosite de alerte.py: get/set/update/delete, where(==, !=), stream, batch.
"""
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

import alerte

ROOT = Path(__file__).resolve().parent.parent
AZI = date(2026, 11, 13)
ACUM = datetime(2026, 11, 13, 8, 0, tzinfo=timezone.utc)
# Pragurile implicite din catalog, toate tipurile pornite (pentru funcțiile de calcul, care primesc doar pragurile).
REGULI = {cod: {"activ": True, "praguri": alerte.normalizeaza_praguri(t["fel"], t["praguri"])} for cod, t in alerte.TIPURI.items()}
MEMBRI = {"adm": {"role": "admin", "displayName": "Ana Admin"}, "m1": {"role": "member", "displayName": "Mihai"},
          "v1": {"role": "viewer"}}


def ro(d: date) -> str:
    return alerte.date_to_ro(d)


# ── Paritate cu lib/durata.ts ───────────────────────────────────────────────────

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "termene.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("caz", FIXTURE["mandate"], ids=lambda c: c["titlu"])
def test_paritate_mandat(caz):
    assert alerte.stare_mandat(caz["mandat"], alerte.ro_to_date(FIXTURE["azi"])) == caz["asteptat"]


@pytest.mark.parametrize("caz", FIXTURE["durate"], ids=lambda c: c["titlu"])
def test_paritate_durata(caz):
    azi = alerte.ro_to_date(FIXTURE["azi"])
    assert alerte.stare_durata_societate(caz["durata"], caz["dataInmatricularii"], azi) == caz["asteptat"]


def test_adauga_luni_ultima_zi_a_lunii():
    assert alerte.adauga_luni(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert alerte.adauga_luni(date(2024, 12, 15), 1) == date(2025, 1, 15)
    assert alerte.adauga_luni(date(2027, 2, 10), -3) == date(2026, 11, 10)


# ── Texte și praguri ────────────────────────────────────────────────────────────

def test_numar_zile_romana():
    assert [alerte.numar_zile(n) for n in (1, 2, 19, 20, 25, 100, 101, 120)] == [
        "o zi", "2 zile", "19 zile", "20 de zile", "25 de zile", "100 de zile", "101 zile", "120 de zile"]
    assert [alerte.cand(n) for n in (0, 1, 5)] == ["azi", "mâine", "în 5 zile"]


@pytest.mark.parametrize("zile,asteptat", [
    (100, None), (90, ("90", "info")), (31, ("90", "info")), (30, ("30", "atentie")), (8, ("30", "atentie")),
    (7, ("7", "urgent")), (1, ("7", "urgent")), (0, ("azi", "urgent")), (-1, ("expirat", "urgent")),
])
def test_evalueaza_termen_mandat(zile, asteptat):
    assert alerte.evalueaza_termen("mandat_expira", zile, [90, 30, 7]) == asteptat


def test_evalueaza_termen_sarcina_si_un_singur_prag():
    assert alerte.evalueaza_termen("sarcina_termen", 3, [3, 1, 0]) == ("3", "info")
    assert alerte.evalueaza_termen("sarcina_termen", 1, [3, 1, 0]) == ("1", "atentie")
    assert alerte.evalueaza_termen("sarcina_termen", -2, [3, 1, 0]) == ("depasit", "urgent")
    assert alerte.evalueaza_termen("ci_expira", 30, [30]) == ("30", "atentie")   # un singur prag, peste 7 zile
    assert alerte.evalueaza_termen("ci_expira", 5, [5]) == ("5", "urgent")


def test_evalueaza_vechime():
    assert alerte.evalueaza_vechime(13, [14]) is None
    assert alerte.evalueaza_vechime(14, [14]) == ("14", "atentie")
    assert alerte.evalueaza_vechime(28, [14]) == ("dublu", "urgent")
    # mai multe praguri: fiecare e o treaptă, ultimul e urgent
    assert alerte.evalueaza_vechime(6, [30, 14, 7]) is None
    assert alerte.evalueaza_vechime(7, [30, 14, 7]) == ("7", "atentie")
    assert alerte.evalueaza_vechime(20, [30, 14, 7]) == ("14", "atentie")
    assert alerte.evalueaza_vechime(30, [30, 14, 7]) == ("30", "urgent")


# ── Setările personale ──────────────────────────────────────────────────────────

def _profil(uid, prefs=None, membri=MEMBRI):
    return alerte.profil(uid, membri[uid], prefs, membri)


def test_profil_implicite_pe_rol():
    adm, m1, v1 = _profil("adm"), _profil("m1"), _profil("v1")
    pornite = lambda p: sorted(c for c, r in p.reguli.items() if r["activ"])
    assert pornite(adm) == sorted(alerte.TIPURI)                                   # adminul: tot
    assert pornite(m1) == ["acces_citire", "dosar_asignat", "dosar_blocat", "dosar_planificare",
                           "sarcina_asignata", "sarcina_termen"]
    assert pornite(v1) == ["acces_citire"]
    assert "trial_expira" not in m1.reguli and "plata_esuata" not in v1.reguli     # abonamentul: doar adminii
    assert adm.surse["dosare"] == ("toate", frozenset()) and m1.surse["sarcini"] == ("ale_mele", frozenset())


def test_profil_preferinte_salvate_normalizate():
    prefs = {"tipuri": {"ci_expira": {"activ": True, "praguri": [7, 7, 400, -1, 2.5, "30", True, 60, 1, 2, 3, 4]},
                        "acces_citire": {"activ": False}, "dosar_blocat": {"praguri": [0]}, "necunoscut": {"activ": True}},
             "surse": {"dosare": {"sursa": "responsabili", "responsabili": ["adm", 5, ""]}, "sarcini": {"sursa": "toti"}}}
    p = _profil("m1", prefs)
    assert p.reguli["ci_expira"] == {"activ": True, "praguri": [60, 7, 4, 3, 2]}   # unice, în limite, desc., cel mult 5
    assert p.reguli["acces_citire"]["activ"] is True                               # obligatoriu
    assert p.reguli["dosar_blocat"]["praguri"] == [14]                             # prag invalid → implicit
    assert "necunoscut" not in p.reguli
    assert p.surse["dosare"] == ("responsabili", frozenset({"adm"}))
    assert p.surse["sarcini"] == ("ale_mele", frozenset())                         # sursă invalidă → implicitul rolului


def test_profil_fara_colegi_ignora_de_la():
    singur = {"adm": {"role": "admin"}, "v1": {"role": "viewer"}}
    p = alerte.profil("adm", singur["adm"], {"surse": {"dosare": {"sursa": "ale_mele"}}}, singur)
    assert p.surse["dosare"] == ("toate", frozenset())


def test_accepta():
    adm, m1 = _profil("adm"), _profil("m1")
    sarcina = alerte.Alerta("sarcina_termen", "sarcina:s1", "urgent", "azi", "T", "D", "/", responsabil_uid="m1")
    a_altcuiva = alerte.Alerta("sarcina_termen", "sarcina:s2", "urgent", "azi", "T", "D", "/", responsabil_uid="adm")
    assert alerte.accepta(adm, sarcina) and alerte.accepta(m1, sarcina)
    assert alerte.accepta(adm, a_altcuiva) and not alerte.accepta(m1, a_altcuiva)   # membrul: doar ale lui
    urmarit = _profil("adm", {"surse": {"sarcini": {"sursa": "responsabili", "responsabili": ["m1"]}}})
    assert alerte.accepta(urmarit, sarcina) and not alerte.accepta(urmarit, a_altcuiva)
    oprit = _profil("adm", {"tipuri": {"sarcina_termen": {"activ": False}}})
    assert not alerte.accepta(oprit, sarcina)
    ev = alerte.Alerta("sarcina_asignata", "sarcina:s1", "info", "eveniment", "T", "D", "/", sub="m1",
                       responsabil_uid="m1", eveniment=True)
    assert alerte.accepta(m1, ev) and not alerte.accepta(adm, ev)                  # asignarea: doar celui asignat
    acces = alerte.Alerta("acces_citire", "cabinet", "urgent", "imediat", "", "", "/")
    assert all(alerte.accepta(_profil(u), acces) for u in MEMBRI)


def test_calcul_cu_profilul_unui_membru_fara_tipurile_adminului():
    # Membrul nu poate primi „perioada de probă”: calculul cu pragurile lui nu trebuie să cadă, ci doar să le sară.
    proba = {"billing": {"status": "trialing", "accessUntil": ACUM + timedelta(days=3), "trialEndsAt": ACUM + timedelta(days=3)}}
    m1 = _profil("m1")
    assert "trial_expira" not in m1.reguli
    assert alerte.alerte_cabinet(proba, ACUM, m1.reguli) == []
    assert alerte.dorite(lambda r: alerte.alerte_cabinet(proba, ACUM, r), [m1]) == {}


def test_dorite_cu_pragurile_fiecaruia():
    c = {"denumire": "Alfa SRL", "asociati": [_persoana("Pop", "Ion", "p1", ro(AZI + timedelta(days=10)))]}
    profile = [_profil("adm", {"tipuri": {"ci_expira": {"praguri": [5]}}}),     # vrea doar cu 5 zile înainte
               _profil("m1", {"tipuri": {"ci_expira": {"activ": True}}}),       # și-a pornit CI-urile (60, 30)
               _profil("v1")]
    apeluri = []

    def calcul(reguli):
        apeluri.append(1)
        return alerte.alerte_client("c1", c, AZI, reguli)
    docs = alerte.dorite(calcul, profile)
    assert sorted((d["uid"], d["prag"]) for d in docs.values()) == [("m1", "30")]
    assert len(apeluri) == 2                     # m1 și v1 au aceleași praguri: un singur calcul pentru amândoi


# ── Clienți ─────────────────────────────────────────────────────────────────────

def _persoana(nume, prenume="", pid=None, valabila="", mandat=None):
    p = {"nume": nume, "prenume": prenume, "valabila_pana_la": valabila}
    if pid:
        p["pid"] = pid
    if mandat:
        p["mandat"] = mandat
    return p


def _mandat_ani(ani, numire):
    return {"durata": {"tip": "ani", "ani": str(ani), "data": ""}, "inceput": "data", "dataNumire": numire}


def test_alerte_client_mandat_durata_ci():
    c = {"denumire": "Alfa SRL", "tipClient": "PJ",
         "administratori": [_persoana("Popescu", "Ion", "p1", ro(AZI + timedelta(days=20)), _mandat_ani(4, "10.12.2022"))],
         "asociati": [_persoana("Popescu", "Ion", "p1", ro(AZI + timedelta(days=20))),   # aceeași persoană: o singură alertă de CI
                      _persoana("Ionescu", "Maria", "p2", ro(AZI - timedelta(days=3)))],
         "durataSocietate": {"tip": "ani", "ani": "10", "data": ""}, "dataInmatricularii": "10.02.2017"}
    alerte_c = {a.cod + ":" + (a.sub or ""): a for a in alerte.alerte_client("c1", c, AZI, REGULI)}
    assert set(alerte_c) == {"mandat_expira:p1", "ci_expira:p1", "ci_expira:p2", "durata_expira:"}

    m = alerte_c["mandat_expira:p1"]
    assert (m.prag, m.severitate, m.titlu) == ("30", "atentie", "Mandat de administrator expiră în 27 de zile")
    assert m.detaliu == "Popescu Ion · Alfa SRL · 10.12.2026"
    assert m.link == "/?open=c1&sectiune=administratori&pid=p1"
    assert m.cheie == "mandat_expira:client:c1:p1:2026-12-10" and m.cheie_baza == "mandat_expira:client:c1:p1"

    assert alerte_c["ci_expira:p1"].link == "/?open=c1&sectiune=administratori&pid=p1"
    ci2 = alerte_c["ci_expira:p2"]
    assert (ci2.prag, ci2.severitate, ci2.titlu) == ("expirat", "urgent", "Act de identitate expirat de 3 zile")
    assert ci2.link == "/?open=c1&sectiune=asociati&pid=p2"

    d = alerte_c["durata_expira:"]
    assert d.prag == "90" and "termenul de consultare a asociaților (10.11.2026) a trecut" in d.detaliu
    # Nicio cheie nu conține nume, CNP sau serie
    assert all("Popescu" not in a.cheie and "Ionescu" not in a.cheie for a in alerte_c.values())


def test_durata_consultare_asociati_viitoare():
    c = {"denumire": "Gama SRL", "durataSocietate": {"tip": "data", "ani": "", "data": ro(AZI + timedelta(days=95))}}
    reguli = {**REGULI, "durata_expira": {"activ": True, "praguri": [120]}}
    [d] = alerte.alerte_client("c9", c, AZI, reguli)
    assert "consultarea asociaților până la" in d.detaliu


def test_alerte_client_mandat_fara_data_doar_dupa_infiintare():
    admin = _persoana("Pop", "Dan", "p9", mandat={"durata": {"tip": "ani", "ani": "4", "data": ""}, "inceput": "aprobare", "dataNumire": ""})
    c = {"denumire": "Beta SRL", "administratori": [admin]}
    assert [a.cod for a in alerte.alerte_client("c2", {**c, "inInfiintare": True}, AZI, REGULI)] == []
    assert [a.cod for a in alerte.alerte_client("c2", c, AZI, REGULI)] == ["mandat_fara_data"]


def test_alerte_client_pf_doar_ci_titular_si_fara_date_invalide():
    c = {"denumire": "Ion Pop PFA", "tipClient": "PF",
         "titular": _persoana("Pop", "Ion", "t1", ro(AZI + timedelta(days=10))),
         "membriIF": [_persoana("Pop", "Ana", None, "permanent")],
         "administratori": [_persoana("X", mandat=_mandat_ani(1, ro(AZI)))]}  # la PF nu se urmăresc mandate
    out = alerte.alerte_client("c3", c, AZI, REGULI)
    assert [(a.cod, a.sub) for a in out] == [("ci_expira", "t1")]
    assert out[0].link == "/?open=c3&sectiune=titular&pid=t1"


# ── Dosare și sarcini ───────────────────────────────────────────────────────────

def _dosar(**kw):
    return {"nrInregistrareDosar": "1234", "clientDenumire": "Alfa SRL", "responsabilUid": "m1", "responsabilNume": "Mihai",
            "stadiu": "in_lucru", "facturat": False, "createdAt": ACUM - timedelta(days=2), **kw}


def test_alerte_dosar_planificare_blocat():
    out = alerte.alerte_dosar("d1", _dosar(dataPlanificare=(AZI + timedelta(days=1)).isoformat(),
                                           stadiuDin=ACUM - timedelta(days=15)), AZI, REGULI)
    coduri = {a.cod: a for a in out}
    assert set(coduri) == {"dosar_planificare", "dosar_blocat"}
    assert coduri["dosar_planificare"].titlu == "Dosar planificat mâine"
    assert coduri["dosar_blocat"].titlu == "Dosar de 15 zile în stadiul „În lucru”"
    assert coduri["dosar_blocat"].detaliu == "Dosar 1234 · Alfa SRL · Responsabil: Mihai"
    assert all(a.responsabil_uid == "m1" and a.link == "/dosare?open=d1" for a in out)


def test_alerte_dosar_stadii_finale_si_arhivat():
    eliberat = _dosar(stadiu="dosar_eliberat", stadiuDin=(ACUM - timedelta(days=8)).isoformat(),
                      dataPlanificare=AZI.isoformat())
    # eliberat, dar nepredat: tot „blocat” (fără planificare, stadiul e final pentru ea)
    [blocat] = alerte.alerte_dosar("d", {**eliberat, "stadiuDin": (ACUM - timedelta(days=15)).isoformat()}, AZI, REGULI)
    assert blocat.cod == "dosar_blocat" and blocat.titlu == "Dosar de 15 zile în stadiul „Dosar eliberat”"
    assert alerte.alerte_dosar("d", eliberat, AZI, REGULI) == []          # doar 8 zile: sub pragul de 14
    predat = _dosar(stadiu="documente_predate_client", documentePredateAt=ACUM - timedelta(days=7))
    assert [a.cod for a in alerte.alerte_dosar("d", predat, AZI, REGULI)] == ["dosar_nefacturat"]
    assert alerte.alerte_dosar("d", {**predat, "facturat": True}, AZI, REGULI) == []


def test_alerte_sarcina_termen():
    s = {"titlu": "Depunere ONRC", "status": "in_lucru", "termenLimita": (AZI - timedelta(days=2)).isoformat(),
         "assigneeUid": "m1", "assigneeNume": "Mihai", "clientDenumire": "Alfa SRL"}
    [a] = alerte.alerte_sarcina("s1", s, AZI, REGULI)
    assert (a.prag, a.severitate, a.titlu) == ("depasit", "urgent", "Termen de sarcină depășit de 2 zile")
    assert a.detaliu == "„Depunere ONRC” · Alfa SRL · Mihai" and a.link == "/sarcini?open=s1"
    assert alerte.alerte_sarcina("s1", {**s, "status": "finalizat"}, AZI, REGULI) == []
    assert alerte.alerte_sarcina("s1", {**s, "termenLimita": (AZI + timedelta(days=4)).isoformat()}, AZI, REGULI) == []


def test_evenimente_asignare():
    dupa = _dosar(responsabilUid="m1")
    assert alerte.eveniment_dosar("d1", {"responsabilUid": "m1"}, dupa, "adm") is None     # neschimbat
    assert alerte.eveniment_dosar("d1", None, dupa, "m1") is None                          # s-a asignat singur
    ev = alerte.eveniment_dosar("d1", {"responsabilUid": "adm"}, dupa, "adm")
    assert ev.cheie == "dosar_asignat:dosar:d1:m1" and ev.exclusi == {"adm"}
    membri = {**MEMBRI, "adm2": {"role": "admin"}}
    docs = alerte.dorite(lambda reguli: [ev], alerte.profiluri(membri, {}))
    assert {d["uid"]: d["titlu"] for d in docs.values()} == {"m1": "Ți s-a asignat un dosar"}   # doar celui asignat

    s_ev = alerte.eveniment_sarcina("s1", {"assigneeUid": None}, {"titlu": "T", "assigneeUid": "m1", "status": "deschis"}, None)
    assert s_ev.cod == "sarcina_asignata" and s_ev.responsabil_uid == "m1"


# ── Cabinet ─────────────────────────────────────────────────────────────────────

def test_alerte_cabinet():
    proba = {"billing": {"status": "trialing", "accessUntil": ACUM + timedelta(days=3), "trialEndsAt": ACUM + timedelta(days=3)}}
    [t] = alerte.alerte_cabinet(proba, ACUM, REGULI)
    assert (t.cod, t.prag, t.titlu) == ("trial_expira", "3", "Perioada de probă se termină în 3 zile")
    restanta = {"billing": {"status": "past_due", "accessUntil": ACUM + timedelta(days=5)}}
    assert [a.cod for a in alerte.alerte_cabinet(restanta, ACUM, REGULI)] == ["plata_esuata"]
    expirat = {"billing": {"status": "expired", "accessUntil": ACUM - timedelta(days=1), "trialEndsAt": ACUM}}
    assert [a.cod for a in alerte.alerte_cabinet(expirat, ACUM, REGULI)] == ["acces_citire"]


# ── Sincronizare (pură) ─────────────────────────────────────────────────────────

def _doc(**kw):
    baza = {"uid": "m1", "cheie": "k", "cheieBaza": "k", "cod": "sarcina_termen", "sursa": "sarcina:s1",
            "severitate": "info", "prag": "3", "titlu": "T", "detaliu": "D", "link": "/", "clientId": None,
            "dosarId": None, "sarcinaId": "s1", "responsabilUid": "m1", "termen": None, "eveniment": False}
    return {**baza, **kw}


def test_plan_sincronizare():
    vechi = ACUM - timedelta(days=1)
    existente = {
        "neschimbat": {**_doc(), "vazut": True},
        "treapta": {**_doc(), "vazut": True, "amanatPana": ACUM + timedelta(days=1)},
        "depasit": {**_doc(prag="azi"), "vazut": True, "amanatPana": ACUM + timedelta(days=1)},
        "disparut": {**_doc(), "rezolvat": False},
        "redeschis": {**_doc(), "rezolvat": True, "rezolvatLa": vechi, "vazut": True},
        "eveniment": {**_doc(eveniment=True), "rezolvat": False},
        "fost_membru": {**_doc(uid="plecat")},
    }
    dorit = {"neschimbat": _doc(), "treapta": _doc(prag="1", severitate="atentie"), "depasit": _doc(prag="depasit"),
             "redeschis": _doc(), "nou": _doc()}
    creat, actualizat, sters = alerte.plan_sincronizare(dorit, existente, {"eveniment"}, {"m1", "adm"}, ACUM)
    assert set(creat) == {"nou"} and creat["nou"]["vazut"] is False and creat["nou"]["rezolvat"] is False
    assert "neschimbat" not in actualizat
    assert actualizat["treapta"] == {"prag": "1", "severitate": "atentie", "vazut": False, "actualizatLa": ACUM}
    assert actualizat["depasit"]["amanatPana"] is None and actualizat["depasit"]["vazut"] is False
    assert actualizat["disparut"]["rezolvat"] is True
    assert actualizat["redeschis"]["rezolvat"] is False and actualizat["redeschis"]["vazut"] is False
    assert "eveniment" not in actualizat
    assert sters == ["fost_membru"]


def test_eveniment_valid():
    ex = {"cod": "dosar_asignat", "cheieBaza": "dosar_asignat:dosar:d1:m1", "sursa": "dosar:d1", "creatLa": ACUM - timedelta(days=2)}
    assert alerte.eveniment_valid(ex, ACUM, {"dosar:d1": {"responsabilUid": "m1", "stadiu": "in_lucru"}}, MEMBRI)
    assert not alerte.eveniment_valid(ex, ACUM, {"dosar:d1": {"responsabilUid": "adm", "stadiu": "in_lucru"}}, MEMBRI)
    assert not alerte.eveniment_valid(ex, ACUM, {"dosar:d1": {"responsabilUid": "m1", "stadiu": "dosar_eliberat"}}, MEMBRI)
    assert not alerte.eveniment_valid({**ex, "creatLa": ACUM - timedelta(days=15)}, ACUM,
                                      {"dosar:d1": {"responsabilUid": "m1", "stadiu": "in_lucru"}}, MEMBRI)
    nou = {"cod": "membru_nou", "cheieBaza": "membru_nou:cabinet:m1", "sursa": "cabinet", "creatLa": ACUM}
    assert alerte.eveniment_valid(nou, ACUM, {}, MEMBRI) and not alerte.eveniment_valid(nou, ACUM, {}, {"adm": {}})


# ── Firestore în memorie ────────────────────────────────────────────────────────

class _Snap:
    def __init__(self, id_, data):
        self.id, self._data = id_, data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class _Doc:
    def __init__(self, store, path):
        self.store, self.path = store, path
        self.id = path.rsplit("/", 1)[-1]

    def get(self):
        return _Snap(self.id, self.store.get(self.path))

    def set(self, data):
        self.store[self.path] = dict(data)

    def update(self, data):
        self.store[self.path] = {**self.store[self.path], **data}

    def delete(self):
        self.store.pop(self.path, None)

    def collection(self, name):
        return _Coll(self.store, f"{self.path}/{name}")


class _Coll:
    def __init__(self, store, path, filtre=()):
        self.store, self.path, self.filtre = store, path, filtre

    def document(self, id_):
        return _Doc(self.store, f"{self.path}/{id_}")

    def where(self, field=None, op=None, value=None, filter=None):
        if filter is not None:
            field, op, value = filter.field_path, filter.op_string, filter.value
        return _Coll(self.store, self.path, self.filtre + ((field, op, value),))

    def stream(self):
        prefix = self.path + "/"
        for path, data in sorted(self.store.items()):
            if not path.startswith(prefix) or "/" in path[len(prefix):]:
                continue
            ok = True
            for field, op, value in self.filtre:
                v = data
                for part in field.split("."):
                    v = v.get(part) if isinstance(v, dict) else None
                ok &= (v == value) if op == "==" else (v is not None and v != value)
            if ok:
                yield _Snap(path[len(prefix):], data)


class _Batch:
    def __init__(self):
        self.ops = []

    def set(self, ref, data):
        self.ops.append(lambda: ref.set(data))

    def update(self, ref, data):
        self.ops.append(lambda: ref.update(data))

    def delete(self, ref):
        self.ops.append(ref.delete)

    def commit(self):
        for op in self.ops:
            op()


class FakeDb:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return _Coll(self.store, name)

    def batch(self):
        return _Batch()

    def notificari(self, wid="w1"):
        prefix = f"workspaces/{wid}/notificari/"
        return {p[len(prefix):]: d for p, d in self.store.items() if p.startswith(prefix)}


@pytest.fixture
def db():
    f = FakeDb()
    f.store["workspaces/w1"] = {"features": {"alerte": True}, "members": dict(MEMBRI),
                                "billing": {"status": "active", "accessUntil": ACUM + timedelta(days=30)}}
    return f


def _sarcina(**kw):
    return {"titlu": "Depunere", "status": "deschis", "termenLimita": AZI.isoformat(), "assigneeUid": "m1",
            "assigneeNume": "Mihai", **kw}


def test_trigger_entitate_creeaza_actualizeaza_rezolva_sterge(db):
    s = _sarcina()
    db.store["workspaces/w1/sarcini/s1"] = s
    alerte.la_scriere_entitate(db, "sarcina", "w1", "s1", None, s, autor="adm", acum=ACUM)
    docs = db.notificari()
    cheie = f"sarcina_termen:sarcina:s1:{AZI.isoformat()}"
    assert set(docs) == {f"adm__{cheie}", f"m1__{cheie}", "m1__sarcina_asignata:sarcina:s1:m1"}
    assert docs[f"m1__{cheie}"]["prag"] == "azi" and docs["m1__sarcina_asignata:sarcina:s1:m1"]["titlu"] == "Ți s-a asignat o sarcină"

    # utilizatorul o vede; o modificare fără schimbare de treaptă nu o face iar „nouă”
    db.store[f"workspaces/w1/notificari/m1__{cheie}"]["vazut"] = True
    s2 = {**s, "titlu": "Depunere (rev.)"}
    db.store["workspaces/w1/sarcini/s1"] = s2
    alerte.la_scriere_entitate(db, "sarcina", "w1", "s1", s, s2, acum=ACUM)
    assert db.notificari()[f"m1__{cheie}"]["vazut"] is True
    assert db.notificari()["m1__sarcina_asignata:sarcina:s1:m1"]["rezolvat"] is False   # evenimentul rămâne

    # finalizată: totul se rezolvă
    db.store["workspaces/w1/sarcini/s1"] = {**s2, "status": "finalizat"}
    alerte.la_scriere_entitate(db, "sarcina", "w1", "s1", s2, {**s2, "status": "finalizat"}, acum=ACUM)
    assert all(d["rezolvat"] for d in db.notificari().values())

    # ștearsă: alertele ei dispar
    del db.store["workspaces/w1/sarcini/s1"]
    alerte.la_scriere_entitate(db, "sarcina", "w1", "s1", s, None, acum=ACUM)
    assert db.notificari() == {}


def test_trigger_fara_flag_nu_scrie(db):
    db.store["workspaces/w1"]["features"] = {}
    assert alerte.la_scriere_entitate(db, "sarcina", "w1", "s1", None, _sarcina(), acum=ACUM) == {"sarit": True}
    assert db.notificari() == {}


def test_recalculeaza_cabinet_si_retentie(db):
    db.store["workspaces/w1/sarcini/s1"] = _sarcina()
    db.store["workspaces/w1/sarcini/s2"] = _sarcina(status="finalizat")
    db.store["workspaces/w1/clienti/c1"] = {"denumire": "Alfa SRL", "asociati": [
        _persoana("Pop", "Ion", "p1", ro(AZI + timedelta(days=10)))]}
    db.store["workspaces/w1/notificari/adm__vechi"] = {**_doc(uid="adm"), "rezolvat": True,
                                                       "rezolvatLa": ACUM - timedelta(days=31)}
    r = alerte.recalculeaza_cabinet(db, "w1", acum=ACUM)
    coduri = sorted((d["uid"], d["cod"]) for d in db.notificari().values())
    assert coduri == [("adm", "ci_expira"), ("adm", "sarcina_termen"), ("m1", "sarcina_termen")]
    assert r["retentie"] == 1


def test_trigger_cabinet_reguli_membri_si_flag(db):
    db.store["workspaces/w1/sarcini/s1"] = _sarcina()
    inainte = dict(db.store["workspaces/w1"])
    alerte.recalculeaza_cabinet(db, "w1", acum=ACUM)

    # nicio schimbare relevantă (ex. numele cabinetului): nu se recalculează
    assert alerte.la_scriere_cabinet(db, "w1", inainte, {**inainte, "name": "Nou"}) == {"sarit": True}

    # membru nou: adminii primesc „membru nou”; m1 plecat: alertele și setările lui dispar
    db.store["workspaces/w1/preferinteAlerte/m1"] = {"tipuri": {}}
    membri = {k: v for k, v in MEMBRI.items() if k != "m1"} | {"n1": {"role": "member", "displayName": "Nora"}}
    dupa = {**inainte, "members": membri}
    db.store["workspaces/w1"] = dupa
    alerte.la_scriere_cabinet(db, "w1", inainte, dupa)
    docs = db.notificari()
    assert "adm__membru_nou:cabinet:n1" in docs and docs["adm__membru_nou:cabinet:n1"]["detaliu"] == "Nora"
    assert not any(d["uid"] == "m1" for d in docs.values())
    assert "workspaces/w1/preferinteAlerte/m1" not in db.store

    # flag oprit: nu rămâne nimic
    dupa2 = {**dupa, "features": {}}
    db.store["workspaces/w1"] = dupa2
    alerte.la_scriere_cabinet(db, "w1", dupa, dupa2)
    assert db.notificari() == {}


def test_trigger_preferinte_recalculeaza_doar_utilizatorul(db):
    db.store["workspaces/w1/sarcini/s1"] = _sarcina(assigneeUid="adm")
    alerte.recalculeaza_cabinet(db, "w1", acum=ACUM)
    assert sorted(d["uid"] for d in db.notificari().values() if d["cod"] == "sarcina_termen") == ["adm"]

    # vizualizatorul își pornește termenele de sarcină de la toți: le primește, cu pragurile lui
    db.store["workspaces/w1/preferinteAlerte/v1"] = {"tipuri": {"sarcina_termen": {"activ": True}},
                                                     "surse": {"sarcini": {"sursa": "toate", "responsabili": []}}}
    db.store["workspaces/w1/notificari/adm__x"] = {**_doc(uid="adm")}            # ale altora: neatinse
    r = alerte.la_scriere_preferinte(db, "w1", "v1")
    assert sorted(d["uid"] for d in db.notificari().values() if d["cod"] == "sarcina_termen") == ["adm", "adm", "v1"]
    assert r["create"] == 1 and db.notificari()["adm__x"].get("rezolvat") is None

    # și le oprește: a lui se rezolvă
    db.store["workspaces/w1/preferinteAlerte/v1"] = {"tipuri": {"sarcina_termen": {"activ": False}}}
    alerte.la_scriere_preferinte(db, "w1", "v1")
    assert [d["rezolvat"] for d in db.notificari().values() if d["uid"] == "v1"] == [True]
    assert alerte.la_scriere_preferinte(db, "w1", "strain") == {"sarit": True}


def test_ruleaza_zilnic_sare_cabinetele_fara_flag(db):
    db.store["workspaces/w2"] = {"members": dict(MEMBRI)}
    db.store["workspaces/w2/sarcini/s1"] = _sarcina()
    db.store["workspaces/w1/sarcini/s1"] = _sarcina()
    assert alerte.ruleaza_zilnic(db, acum=ACUM) == {"cabinete": 1, "erori": 0, "neprocesate": 0}
    assert db.notificari("w2") == {} and db.notificari("w1")


def test_trigger_sare_scrierile_fara_campuri_relevante(db):
    s = _sarcina()
    db.store["workspaces/w1/sarcini/s1"] = {**s, "order": 3}
    assert alerte.la_scriere_entitate(db, "sarcina", "w1", "s1", s, {**s, "order": 3}, acum=ACUM) == {"sarit": True}
    assert db.notificari() == {}


def test_trigger_intarziat_foloseste_documentul_curent(db):
    # Sarcina a fost între timp finalizată; un eveniment mai vechi (schimbarea termenului) sosește abia acum.
    s = _sarcina()
    db.store["workspaces/w1/sarcini/s1"] = {**s, "status": "finalizat"}
    alerte.la_scriere_entitate(db, "sarcina", "w1", "s1", {**s, "assigneeUid": None}, s, autor="adm", acum=ACUM)
    assert db.notificari() == {}          # nici termen, nici „ți s-a asignat” pentru o sarcină încheiată


def test_preferinte_doar_ignorari_nu_recalculeaza(db):
    inainte = {"tipuri": {"ci_expira": {"activ": True}}, "ignorate": []}
    dupa = {**inainte, "ignorate": ["client:c1"]}
    assert alerte.la_scriere_preferinte(db, "w1", "m1", inainte, dupa) == {"sarit": True}


def test_redeschiderea_anuleaza_amanarea_veche():
    ex = {"x": {**_doc(), "rezolvat": True, "rezolvatLa": ACUM, "vazut": True, "amanatPana": ACUM + timedelta(days=20)}}
    _, actualizat, _ = alerte.plan_sincronizare({"x": _doc()}, ex, set(), {"m1"}, ACUM)
    assert actualizat["x"]["amanatPana"] is None and actualizat["x"]["rezolvat"] is False


def test_jobul_zilnic_raporteaza_eroare_daca_un_cabinet_a_cazut(monkeypatch):
    import authz
    import main
    monkeypatch.setattr(authz, "init_admin", lambda: None)
    monkeypatch.setattr(authz, "db", lambda: None)
    monkeypatch.setattr(alerte, "ruleaza_zilnic", lambda db: {"cabinete": 3, "erori": 0, "neprocesate": 0})
    main.alerte_zilnice.__wrapped__(None)                      # totul în regulă: fără excepție
    monkeypatch.setattr(alerte, "ruleaza_zilnic", lambda db: {"cabinete": 2, "erori": 1, "neprocesate": 0})
    with pytest.raises(RuntimeError, match="rulare incompletă"):
        main.alerte_zilnice.__wrapped__(None)
