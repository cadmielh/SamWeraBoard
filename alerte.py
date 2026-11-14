"""Alertele din aplicație: calculul lor din datele cabinetului și sincronizarea cu `workspaces/{wid}/notificari`.

Vezi docs/plan-alerte.md („Arhitectura finală”). Pe scurt:
- catalogul tipurilor e `alerte_catalog.json` (sursă comună cu frontendul, lib/alerteCatalog.ts);
- setările sunt doar personale (`workspaces/{wid}/preferinteAlerte/{uid}`: tip pornit, praguri, „de la”), cu implicite
  pe rol în catalog; serverul le aplică și scrie câte un document per destinatar, `{uid}__{cheie}`, cu pragurile lui;
  browserul aplică doar ignorările punctuale și amânarea;
- recalcularea pornește din triggere Firestore (o entitate, un utilizator sau tot cabinetul) și din jobul zilnic.

Funcțiile de calcul sunt pure (primesc dicționare, întorc `Alerta`), ca să fie testate fără Firestore; doar
secțiunea „Firestore” de la final citește și scrie. Cheile și id-urile nu conțin date personale; textele alertelor
conțin doar numele clientului și al persoanei, vizibile oricum oricărui membru al cabinetului.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Bucharest")
CATALOG = json.loads((Path(__file__).resolve().parent / "alerte_catalog.json").read_text(encoding="utf-8"))
TIPURI: dict[str, dict] = {t["cod"]: t for t in CATALOG["tipuri"]}

FEATURE = "alerte"
COLECTIE = "notificari"
PREFERINTE = "preferinteAlerte"
ZILE_RETENTIE = 30          # alertele rezolvate se șterg după atâtea zile
ZILE_EVENIMENT = 14         # „ți s-a asignat…”, „membru nou” se rezolvă singure după atâtea zile
BUGET_ZILNIC_SEC = 1500     # jobul zilnic rulează cel mult 1800 s (main.py); restul rămâne pentru rularea următoare

# Limitele preferințelor (oglinda lib/alerteCatalog.ts); regulile Firestore verifică doar forma, aici se normalizează.
MAX_PRAGURI = 5
MAX_ZILE_PRAG = 365
MAX_RESPONSABILI = 50
SURSE = ("toate", "ale_mele", "responsabili")
CATEGORII_CU_SURSA = {c["id"]: c["sursaImplicita"] for c in CATALOG["categorii"] if c.get("sursaImplicita")}
# Asignările ajung doar la persoana asignată, indiferent de „de la”.
_PERSONALE = ("dosar_asignat", "sarcina_asignata")

STADII_FINALE = ("dosar_eliberat", "documente_predate_client")
STADIU_ETICHETA = {
    "in_lucru": "În lucru",
    "in_asteptare_client": "În așteptare client",
    "depus_in_solutionare": "Depus, în soluționare",
    "dosar_amanat": "Dosar amânat",
    "dosar_spre_eliberare": "Dosar spre eliberare",
    "dosar_eliberat": "Dosar eliberat",
    "documente_predate_client": "Documente predate client",
}

# La aceste tipuri un termen trecut se numește „expirat”, la celelalte „depășit”.
_EXPIRA = ("mandat_expira", "durata_expira", "ci_expira")


# ── Date și termene (oglinda lib/dates.ts și lib/durata.ts) ─────────────────────

_RO = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

ZILE_AVERTIZARE = 90            # lib/durata.ts ZILE_AVERTIZARE: doar pentru paritatea stării cu frontendul
LUNI_CONSULTARE_PRELUNGIRE = 3  # art. 227 alin. 2


def ro_to_date(s) -> date | None:
    m = _RO.match(str(s or "").strip())
    if not m:
        return None
    try:
        return date(int(m[3]), int(m[2]), int(m[1]))
    except ValueError:
        return None


def iso_to_date(s) -> date | None:
    m = _ISO.match(str(s or "").strip()[:10])
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None


def date_to_ro(d: date) -> str:
    return f"{d.day:02d}.{d.month:02d}.{d.year}"


def zi_locala(v) -> date | None:
    """Ziua (în România) a unui moment: Timestamp/datetime din Firestore sau text ISO; None dacă lipsește."""
    if v is None or v == "":
        return None
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return iso_to_date(v)
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(TZ).date()
    if isinstance(v, date):
        return v
    return None


def adauga_luni(start: date, luni: int) -> date:
    """Termen în luni (Cod civil, art. 2552): ziua corespunzătoare, sau ultima zi a lunii dacă ea nu există."""
    idx = start.year * 12 + start.month - 1 + luni
    an, luna = divmod(idx, 12)
    urmatoarea = date(an + (luna + 1) // 12, (luna + 1) % 12 + 1, 1)
    return date(an, luna + 1, min(start.day, (urmatoarea - timedelta(days=1)).day))


def _ani_valizi(ani) -> int | None:
    """Ca `Number(ani)` din frontend: un întreg pozitiv (și „10.0”), altfel None."""
    try:
        n = float(str(ani).strip())
    except ValueError:
        return None
    return int(n) if n.is_integer() and n > 0 else None


def _durata_aleasa(d: dict | None) -> bool:
    """Echivalentul lui `durataScurta(d) !== ''`: alegerea e completă (fără să ceară o dată validă)."""
    if not isinstance(d, dict):
        return False
    tip = d.get("tip")
    if tip == "nedeterminata":
        return True
    if tip == "data":
        return bool(str(d.get("data") or "").strip())
    if tip == "ani":
        return _ani_valizi(d.get("ani")) is not None
    return False


def data_expirare(d: dict | None, inceput) -> date | None:
    if not isinstance(d, dict):
        return None
    if d.get("tip") == "data":
        return ro_to_date(d.get("data"))
    if d.get("tip") != "ani" or _ani_valizi(d.get("ani")) is None:
        return None
    start = ro_to_date(inceput)
    return adauga_luni(start, 12 * _ani_valizi(d.get("ani"))) if start else None


def _stare_dupa_expirare(expira: date, azi: date) -> dict:
    zile = (expira - azi).days
    stare = "expirat" if zile < 0 else "curand" if zile <= ZILE_AVERTIZARE else "activ"
    return {"stare": stare, "expira": date_to_ro(expira), "zile": zile}


def stare_mandat(m: dict | None, azi: date) -> dict:
    """Oglinda `stareMandat` din lib/durata.ts (testată pe aceleași exemple: tests/fixtures/termene.json)."""
    if not isinstance(m, dict) or not _durata_aleasa(m.get("durata")):
        return {"stare": "incomplet"}
    if m["durata"].get("tip") == "nedeterminata":
        return {"stare": "nedeterminat"}
    numire = m.get("dataNumire") if ro_to_date(m.get("dataNumire")) else ""
    expira = data_expirare(m["durata"], numire)
    if expira:
        return _stare_dupa_expirare(expira, azi)
    return {"stare": "asteptare", "motiv": "aprobare" if m.get("inceput") == "aprobare" else "numire"}


def stare_durata_societate(d: dict | None, data_inmatricularii, azi: date) -> dict:
    """Oglinda `stareDurataSocietate` din lib/durata.ts."""
    if not _durata_aleasa(d):
        return {"stare": "incomplet"}
    if d.get("tip") == "nedeterminata":
        return {"stare": "nedeterminat"}
    expira = data_expirare(d, data_inmatricularii or "")
    return _stare_dupa_expirare(expira, azi) if expira else {"stare": "asteptare", "motiv": "inmatriculare"}


# ── Texte ───────────────────────────────────────────────────────────────────────

def numar_zile(n: int) -> str:
    """„o zi”, „3 zile”, „25 de zile” (cu „de” de la 20 în sus, ca în română)."""
    if n == 1:
        return "o zi"
    return f"{n} {'de ' if n % 100 == 0 or n % 100 >= 20 else ''}zile"


def cand(zile: int) -> str:
    """Pentru un termen viitor: „azi”, „mâine”, „în 3 zile”."""
    return "azi" if zile == 0 else "mâine" if zile == 1 else f"în {numar_zile(zile)}"


def _nume(p: dict) -> str:
    return " ".join(x for x in (str(p.get("nume") or "").strip(), str(p.get("prenume") or "").strip()) if x)


# ── Preferințele personale ──────────────────────────────────────────────────────

def normalizeaza_praguri(fel: str, praguri) -> list[int]:
    """Întregi unici, în limite, descrescători, cel mult MAX_PRAGURI. Fără sens la „imediat”/„eveniment”."""
    if fel not in ("termen", "vechime") or not isinstance(praguri, list):
        return []
    minim = 0 if fel == "termen" else 1
    out = sorted({int(p) for p in praguri
                  if isinstance(p, (int, float)) and not isinstance(p, bool) and float(p).is_integer()
                  and minim <= p <= MAX_ZILE_PRAG}, reverse=True)
    return out[:MAX_PRAGURI]


@dataclass
class Profil:
    """Ce primește un membru: tipurile pornite cu pragurile lui și, la dosare/sarcini, „de la cine”.
    Oglinda lib/alerteConfig.ts (preferintaEfectiva, sursaEfectiva)."""
    uid: str
    reguli: dict[str, dict]                         # cod -> {"activ", "praguri"}, doar tipurile permise rolului
    surse: dict[str, tuple[str, frozenset[str]]]    # categorie -> (sursa, responsabili)

    @property
    def semnatura(self) -> tuple:
        """Profilele cu aceleași praguri produc aceleași alerte: se calculează o singură dată."""
        return tuple((c, tuple(r["praguri"])) for c, r in sorted(self.reguli.items()))


def are_colegi(uid: str, membri: dict[str, dict]) -> bool:
    """Filtrul „de la” are sens doar dacă mai e cineva care poate fi responsabil (nu vizualizator)."""
    return any(u != uid and (m or {}).get("role") != "viewer" for u, m in membri.items())


def profil(uid: str, membru: dict, prefs: dict | None, membri: dict[str, dict]) -> Profil:
    rol = (membru or {}).get("role") or "viewer"
    prefs = prefs if isinstance(prefs, dict) else {}
    salvate = prefs.get("tipuri") if isinstance(prefs.get("tipuri"), dict) else {}
    reguli = {}
    for cod, tip in TIPURI.items():
        if rol not in tip["roluri"]:
            continue
        p = salvate.get(cod) if isinstance(salvate.get(cod), dict) else {}
        activ = p.get("activ") if isinstance(p.get("activ"), bool) else rol in tip["implicit"]
        praguri = normalizeaza_praguri(tip["fel"], p.get("praguri")) or normalizeaza_praguri(tip["fel"], tip["praguri"])
        reguli[cod] = {"activ": activ or rol in tip["obligatoriu"], "praguri": praguri}

    surse_salvate = prefs.get("surse") if isinstance(prefs.get("surse"), dict) else {}
    colegi = are_colegi(uid, membri)
    surse = {}
    for cat, implicite in CATEGORII_CU_SURSA.items():
        p = surse_salvate.get(cat) if isinstance(surse_salvate.get(cat), dict) else {}
        sursa = p.get("sursa") if p.get("sursa") in SURSE else implicite.get(rol, "ale_mele")
        resp = p.get("responsabili") if isinstance(p.get("responsabili"), list) else []
        resp = frozenset(r for r in resp[:MAX_RESPONSABILI] if isinstance(r, str) and r)
        surse[cat] = (sursa, resp) if colegi else ("toate", frozenset())
    return Profil(uid, reguli, surse)


def profiluri(membri: dict[str, dict], prefs: dict[str, dict]) -> list[Profil]:
    return [profil(uid, m, prefs.get(uid), membri) for uid, m in membri.items()]


# ── Alerta ──────────────────────────────────────────────────────────────────────

@dataclass
class Alerta:
    cod: str
    sursa: str                        # „client:<id>”, „dosar:<id>”, „sarcina:<id>”, „cabinet”
    severitate: str                   # info | atentie | urgent
    prag: str
    titlu: str
    detaliu: str
    link: str
    sub: str | None = None            # al doilea nivel al cheii (ex. pid-ul persoanei, uid-ul asignatului)
    termen: date | None = None
    client_id: str | None = None
    dosar_id: str | None = None
    sarcina_id: str | None = None
    responsabil_uid: str | None = None
    eveniment: bool = False
    # Titlul văzut de responsabil/asignat, când diferă de al celorlalți („Ți s-a asignat…” față de „Dosar asignat…”).
    titlu_responsabil: str | None = None
    exclusi: frozenset[str] = field(default_factory=frozenset)   # ex. autorul asignării

    @property
    def cheie_baza(self) -> str:
        return ":".join([self.cod, self.sursa] + ([self.sub] if self.sub else []))

    @property
    def cheie(self) -> str:
        return self.cheie_baza + (f":{self.termen.isoformat()}" if self.termen else "")


def doc_id(uid: str, cheie: str) -> str:
    return f"{uid}__{cheie}".replace("/", "_")


def _praguri(reguli: dict[str, dict], cod: str) -> list[int]:
    """Pragurile unui tip în profilul cuiva; un tip pe care rolul nu-l poate primi (ex. abonamentul, la membri) nu are
    praguri, deci nu produce alerte."""
    return (reguli.get(cod) or {}).get("praguri") or []


def evalueaza_termen(cod: str, zile: int, praguri: list[int]) -> tuple[str, str] | None:
    """Pragul atins și severitatea pentru un termen peste `zile` zile (negativ = trecut), sau None dacă e prea departe.
    O singură alertă pe termen, care urcă în severitate; `prag` se schimbă doar la trecerea într-o treaptă nouă."""
    if zile < 0:
        return ("expirat" if cod in _EXPIRA else "depasit"), "urgent"
    if not praguri or zile > praguri[0]:
        return None
    if zile == 0:
        return "azi", "urgent"
    atins = min(p for p in praguri if p >= zile)
    if atins == praguri[-1] and atins <= 7:
        sev = "urgent"
    elif len(praguri) > 1 and atins == praguri[0]:
        sev = "info"
    else:
        sev = "atentie"
    return str(atins), sev


def evalueaza_vechime(zile: int, praguri: list[int]) -> tuple[str, str] | None:
    """Pragul atins (cel mai mare depășit) și severitatea pentru o stare care durează de `zile` zile. Cu mai multe
    praguri, ultimul (cel mai mare) e urgent; cu unul singur, urgent devine de la dublul lui. Fiecare treaptă nouă
    schimbă `prag`, deci alerta reapare ca nouă."""
    atinse = [p for p in praguri if zile >= p]
    if not atinse:
        return None
    atins = max(atinse)
    if len(praguri) == 1:
        return ("dublu", "urgent") if zile >= 2 * atins else (str(atins), "atentie")
    return str(atins), "urgent" if atins == praguri[0] else "atentie"


def _text_termen(prag: str, zile: int, viitor: str, trecut: str) -> str:
    """`viitor`/`trecut` conțin „{cand}”/„{cat}”: „Mandat expiră {cand}” / „Mandat expirat de {cat}”."""
    if prag in ("expirat", "depasit"):
        return trecut.format(cat=numar_zile(-zile)) if zile < 0 else trecut.format(cat="azi")
    return viitor.format(cand=cand(zile))


# ── Clienți ─────────────────────────────────────────────────────────────────────

def _persoane_ci(c: dict) -> list[tuple[str, int, dict]]:
    """(secțiune, index, persoană) pentru toate persoanele cu act de identitate, fără dubluri (aceeași persoană
    poate fi asociat și administrator). Ordinea secțiunilor dă secțiunea în care se deschide fișa."""
    out, vazute = [], set()
    grupe = [("titular", [c.get("titular")] if isinstance(c.get("titular"), dict) else []),
             ("membriIF", c.get("membriIF") or []),
             ("administratori", c.get("administratori") or []),
             ("asociati", c.get("asociati") or [])]
    for sectiune, persoane in grupe:
        for i, p in enumerate(persoane):
            if not isinstance(p, dict):
                continue
            ident = p.get("pid") or f"{_nume(p).lower()}|{p.get('valabila_pana_la') or ''}"
            if ident in vazute:
                continue
            vazute.add(ident)
            out.append((sectiune, i, p))
    return out


def _link_client(cid: str, sectiune: str, pid: str | None = None) -> str:
    return f"/?open={cid}&sectiune={sectiune}" + (f"&pid={pid}" if pid else "")


def alerte_client(cid: str, c: dict, azi: date, reguli: dict[str, dict]) -> list[Alerta]:
    denumire = str(c.get("denumire") or "").strip() or "Client fără denumire"
    sursa = f"client:{cid}"
    out: list[Alerta] = []

    if c.get("tipClient") != "PF":
        for i, p in enumerate(c.get("administratori") or []):
            if not isinstance(p, dict) or not isinstance(p.get("mandat"), dict):
                continue
            pid = p.get("pid") or None
            sub = pid or f"administratori.{i}"
            nume = _nume(p) or "Administrator"
            link = _link_client(cid, "administratori", pid)
            st = stare_mandat(p["mandat"], azi)
            if "expira" in st:
                ev = evalueaza_termen("mandat_expira", st["zile"], _praguri(reguli, "mandat_expira"))
                if ev:
                    out.append(Alerta(
                        "mandat_expira", sursa, ev[1], ev[0],
                        _text_termen(ev[0], st["zile"], "Mandat de administrator expiră {cand}", "Mandat de administrator expirat de {cat}"),
                        f"{nume} · {denumire} · {st['expira']}", link, sub=sub, termen=ro_to_date(st["expira"]),
                        client_id=cid))
            elif st["stare"] == "asteptare" and (st["motiv"] == "numire" or not c.get("inInfiintare")):
                out.append(Alerta("mandat_fara_data", sursa, "atentie", "imediat", "Lipsește data de început a mandatului",
                                  f"{nume} · {denumire}", link, sub=sub, client_id=cid))

        st = stare_durata_societate(c.get("durataSocietate"), c.get("dataInmatricularii"), azi)
        if "expira" in st:
            ev = evalueaza_termen("durata_expira", st["zile"], _praguri(reguli, "durata_expira"))
            if ev:
                expira = ro_to_date(st["expira"])
                consultare = adauga_luni(expira, -LUNI_CONSULTARE_PRELUNGIRE)
                # Art. 227 alin. 2: asociații se consultă cu cel puțin 3 luni înainte; după acea dată, doar se semnalează.
                nota = ("" if st["zile"] < 0 else
                        f" · consultarea asociaților până la {date_to_ro(consultare)}" if consultare >= azi else
                        f" · termenul de consultare a asociaților ({date_to_ro(consultare)}) a trecut")
                detaliu = f"{denumire} · {st['expira']}{nota}"
                out.append(Alerta(
                    "durata_expira", sursa, ev[1], ev[0],
                    _text_termen(ev[0], st["zile"], "Durata societății expiră {cand}", "Durata societății a expirat de {cat}"),
                    detaliu, _link_client(cid, "durata"), termen=expira, client_id=cid))

    for sectiune, i, p in _persoane_ci(c):
        valabila = ro_to_date(p.get("valabila_pana_la"))
        if not valabila:
            continue
        zile = (valabila - azi).days
        ev = evalueaza_termen("ci_expira", zile, _praguri(reguli, "ci_expira"))
        if not ev:
            continue
        pid = p.get("pid") or None
        out.append(Alerta(
            "ci_expira", sursa, ev[1], ev[0],
            _text_termen(ev[0], zile, "Act de identitate expiră {cand}", "Act de identitate expirat de {cat}"),
            f"{_nume(p) or 'Persoană fără nume'} · {denumire} · {date_to_ro(valabila)}",
            _link_client(cid, sectiune, pid), sub=pid or f"{sectiune}.{i}", termen=valabila, client_id=cid))
    return out


# ── Dosare ──────────────────────────────────────────────────────────────────────

def _dosar_arhivat(d: dict) -> bool:
    return d.get("stadiu") == "documente_predate_client" and d.get("facturat") is True


def _eticheta_dosar(d: dict) -> str:
    nr = str(d.get("nrInregistrareDosar") or "").strip()
    client = str(d.get("clientDenumire") or d.get("clientDenumireLibera") or "").strip()
    return " · ".join(x for x in (f"Dosar {nr}" if nr else "Dosar fără număr", client) if x)


def _cu_responsabil(text: str, d: dict) -> str:
    nume = str(d.get("responsabilNume") or "").strip()
    return f"{text} · Responsabil: {nume}" if nume else text


def alerte_dosar(did: str, d: dict, azi: date, reguli: dict[str, dict]) -> list[Alerta]:
    if _dosar_arhivat(d):
        return []
    stadiu = d.get("stadiu")
    final = stadiu in STADII_FINALE
    resp = d.get("responsabilUid") or None
    baza = dict(dosar_id=did, client_id=d.get("clientId") or None, responsabil_uid=resp)
    sursa, link = f"dosar:{did}", f"/dosare?open={did}"
    detaliu = _cu_responsabil(_eticheta_dosar(d), d)
    out: list[Alerta] = []

    planificare = iso_to_date(d.get("dataPlanificare"))
    if planificare and not final:
        zile = (planificare - azi).days
        ev = evalueaza_termen("dosar_planificare", zile, _praguri(reguli, "dosar_planificare"))
        if ev:
            out.append(Alerta("dosar_planificare", sursa, ev[1], ev[0],
                              _text_termen(ev[0], zile, "Dosar planificat {cand}", "Data de planificare depășită de {cat}"),
                              detaliu, link, termen=planificare, **baza))

    # „Blocat” acoperă orice stadiu înainte de predarea documentelor, inclusiv „Dosar eliberat” (dosar nepredat încă).
    din = zi_locala(d.get("stadiuDin")) or zi_locala(d.get("createdAt"))
    if din and stadiu != "documente_predate_client":
        zile = (azi - din).days
        ev = evalueaza_vechime(zile, _praguri(reguli, "dosar_blocat"))
        if ev:
            out.append(Alerta("dosar_blocat", sursa, ev[1], ev[0],
                              f"Dosar de {numar_zile(zile)} în stadiul „{STADIU_ETICHETA.get(stadiu, stadiu or '—')}”",
                              detaliu, link, sub=str(stadiu or ""), **baza))

    predat = zi_locala(d.get("documentePredateAt")) or din
    if predat and stadiu == "documente_predate_client" and d.get("facturat") is not True:
        zile = (azi - predat).days
        ev = evalueaza_vechime(zile, _praguri(reguli, "dosar_nefacturat"))
        if ev:
            out.append(Alerta("dosar_nefacturat", sursa, ev[1], ev[0],
                              f"Dosar predat de {numar_zile(zile)}, nefacturat", detaliu, link, **baza))
    return out


def eveniment_dosar(did: str, inainte: dict | None, dupa: dict | None, autor: str | None) -> Alerta | None:
    """„Dosar asignat”, când responsabilul cu cont se schimbă (nu și când te asignezi singur)."""
    resp = (dupa or {}).get("responsabilUid") or None
    if not dupa or not resp or resp == (inainte or {}).get("responsabilUid") or resp == autor:
        return None
    if dupa.get("stadiu") in STADII_FINALE:
        return None
    eticheta = _eticheta_dosar(dupa)
    return Alerta("dosar_asignat", f"dosar:{did}", "info", "eveniment",
                  f"Dosar asignat: {str(dupa.get('responsabilNume') or '').strip() or 'responsabil nou'}",
                  eticheta, f"/dosare?open={did}", sub=resp, dosar_id=did, client_id=dupa.get("clientId") or None,
                  responsabil_uid=resp, eveniment=True, titlu_responsabil="Ți s-a asignat un dosar",
                  exclusi=frozenset({autor} if autor else ()))


# ── Sarcini ─────────────────────────────────────────────────────────────────────

def _eticheta_sarcina(s: dict) -> str:
    titlu = str(s.get("titlu") or "").strip() or "Sarcină fără titlu"
    client = str(s.get("clientDenumire") or s.get("clientDenumireLibera") or "").strip()
    return " · ".join(x for x in (f"„{titlu}”", client) if x)


def _cu_asignat(text: str, s: dict) -> str:
    nume = str(s.get("assigneeNume") or "").strip()
    return f"{text} · {nume}" if nume else text


def alerte_sarcina(sid: str, s: dict, azi: date, reguli: dict[str, dict]) -> list[Alerta]:
    if s.get("status") == "finalizat":
        return []
    termen = iso_to_date(s.get("termenLimita"))
    if not termen:
        return []
    zile = (termen - azi).days
    ev = evalueaza_termen("sarcina_termen", zile, _praguri(reguli, "sarcina_termen"))
    if not ev:
        return []
    return [Alerta("sarcina_termen", f"sarcina:{sid}", ev[1], ev[0],
                   _text_termen(ev[0], zile, "Termen de sarcină {cand}", "Termen de sarcină depășit de {cat}"),
                   _cu_asignat(_eticheta_sarcina(s), s), f"/sarcini?open={sid}", termen=termen, sarcina_id=sid,
                   client_id=s.get("clientId") or None, dosar_id=s.get("dosarId") or None,
                   responsabil_uid=s.get("assigneeUid") or None)]


def eveniment_sarcina(sid: str, inainte: dict | None, dupa: dict | None, autor: str | None) -> Alerta | None:
    asignat = (dupa or {}).get("assigneeUid") or None
    if not dupa or not asignat or asignat == (inainte or {}).get("assigneeUid") or asignat == autor:
        return None
    if dupa.get("status") == "finalizat":
        return None
    return Alerta("sarcina_asignata", f"sarcina:{sid}", "info", "eveniment",
                  f"Sarcină asignată: {str(dupa.get('assigneeNume') or '').strip() or 'persoană nouă'}",
                  _eticheta_sarcina(dupa), f"/sarcini?open={sid}", sub=asignat, sarcina_id=sid,
                  client_id=dupa.get("clientId") or None, dosar_id=dupa.get("dosarId") or None,
                  responsabil_uid=asignat, eveniment=True, titlu_responsabil="Ți s-a asignat o sarcină",
                  exclusi=frozenset({autor} if autor else ()))


# ── Cabinet (abonament, membri) ─────────────────────────────────────────────────

def alerte_cabinet(ws: dict, acum: datetime, reguli: dict[str, dict]) -> list[Alerta]:
    b = ws.get("billing") if isinstance(ws.get("billing"), dict) else {}
    azi = acum.astimezone(TZ).date()
    out: list[Alerta] = []
    acces = b.get("accessUntil")
    acces = acces if isinstance(acces, datetime) else None
    if acces is None or acces <= acum:
        out.append(Alerta("acces_citire", "cabinet", "urgent", "imediat", "Cabinetul e doar în citire",
                          "Perioada de probă sau abonamentul a expirat. Datele se pot citi și exporta.", "/abonament"))
        return out
    if b.get("status") == "past_due":
        out.append(Alerta("plata_esuata", "cabinet", "urgent", "imediat", "Plata abonamentului a eșuat",
                          "Actualizează metoda de plată ca accesul să nu se oprească.", "/abonament"))
    final_proba = zi_locala(b.get("trialEndsAt"))
    if b.get("status") == "trialing" and final_proba:
        zile = (final_proba - azi).days
        ev = evalueaza_termen("trial_expira", zile, _praguri(reguli, "trial_expira")) if zile >= 0 else None
        if ev:
            out.append(Alerta("trial_expira", "cabinet", ev[1], ev[0], f"Perioada de probă se termină {cand(zile)}",
                              f"Ultima zi: {date_to_ro(final_proba)}. Alege un abonament ca să păstrezi accesul complet.",
                              "/abonament", termen=final_proba))
    return out


def eveniment_membru_nou(uid: str, membru: dict) -> Alerta:
    nume = str(membru.get("displayName") or "").strip() or str(membru.get("email") or "").strip() or "Membru nou"
    return Alerta("membru_nou", "cabinet", "info", "eveniment", "Membru nou în cabinet", nume, "/utilizatori",
                  sub=uid, eveniment=True, exclusi=frozenset({uid}))


# ── Destinatari ─────────────────────────────────────────────────────────────────

def accepta(p: Profil, a: Alerta) -> bool:
    """Alerta ajunge la membru: tipul e pornit la el, iar la dosare/sarcini trece de „de la” (asignările doar la cel
    asignat). Pragurile s-au aplicat deja la calcul (alertele se calculează cu pragurile profilului)."""
    r = p.reguli.get(a.cod)
    if not r or not r["activ"] or p.uid in a.exclusi:
        return False
    if a.cod in _PERSONALE:
        return a.responsabil_uid == p.uid
    cat = TIPURI[a.cod]["categorie"]
    if cat in p.surse:
        sursa, resp = p.surse[cat]
        if sursa == "ale_mele":
            return a.responsabil_uid == p.uid
        if sursa == "responsabili":
            return a.responsabil_uid in resp
    return True


def document(a: Alerta, uid: str) -> dict:
    """Câmpurile calculate ale unei alerte (fără starea pusă de utilizator: vazut, amanatPana)."""
    titlu = a.titlu_responsabil if a.titlu_responsabil and uid == a.responsabil_uid else a.titlu
    return {
        "uid": uid, "cheie": a.cheie, "cheieBaza": a.cheie_baza, "cod": a.cod, "sursa": a.sursa,
        "severitate": a.severitate, "prag": a.prag, "titlu": titlu, "detaliu": a.detaliu, "link": a.link,
        "clientId": a.client_id, "dosarId": a.dosar_id, "sarcinaId": a.sarcina_id,
        "responsabilUid": a.responsabil_uid, "termen": a.termen.isoformat() if a.termen else None,
        "eveniment": a.eveniment,
    }


def dorite(calcul, profile: list[Profil]) -> dict[str, dict]:
    """{id document: câmpuri calculate} pentru toți membrii. `calcul(reguli)` întoarce alertele cu pragurile date;
    profilele cu aceleași praguri împart același calcul."""
    out: dict[str, dict] = {}
    cache: dict[tuple, list[Alerta]] = {}
    for p in profile:
        if p.semnatura not in cache:
            cache[p.semnatura] = calcul(p.reguli)
        for a in cache[p.semnatura]:
            if accepta(p, a):
                out[doc_id(p.uid, a.cheie)] = document(a, p.uid)
    return out


# ── Sincronizare (pură) ─────────────────────────────────────────────────────────

_CAMPURI = ("uid", "cheie", "cheieBaza", "cod", "sursa", "severitate", "prag", "titlu", "detaliu", "link",
            "clientId", "dosarId", "sarcinaId", "responsabilUid", "termen", "eveniment")


def plan_sincronizare(dorit: dict[str, dict], existente: dict[str, dict], pastrate: set[str], membri: set[str],
                      acum: datetime) -> tuple[dict[str, dict], dict[str, dict], list[str]]:
    """Ce trebuie scris: (de creat, de actualizat {id: modificări}, de șters).

    - nou → creat, nevăzut;
    - existent → doar câmpurile schimbate; o treaptă nouă (`prag`) îl face iar „nou”, iar la depășit/expirat anulează
      și amânarea; unul rezolvat care reapare se redeschide;
    - existent care nu mai e dorit → rezolvat (evenimentele din `pastrate` rămân cum sunt);
    - al unui fost membru → șters.
    """
    creat, actualizat, sters = {}, {}, []
    for i, doc in dorit.items():
        ex = existente.get(i)
        if ex is None:
            creat[i] = {**doc, "creatLa": acum, "actualizatLa": acum, "vazut": False, "amanatPana": None,
                        "rezolvat": False, "rezolvatLa": None}
            continue
        mod = {k: doc[k] for k in _CAMPURI if ex.get(k) != doc[k]}
        if ex.get("rezolvat"):
            mod.update(rezolvat=False, rezolvatLa=None, vazut=False, amanatPana=None, creatLa=acum)
        elif ex.get("prag") != doc["prag"]:
            mod["vazut"] = False
            if doc["prag"] in ("depasit", "expirat"):
                mod["amanatPana"] = None
        if mod:
            actualizat[i] = {**mod, "actualizatLa": acum}
    for i, ex in existente.items():
        if i in dorit:
            continue
        if ex.get("uid") not in membri:
            sters.append(i)
        elif not ex.get("rezolvat") and i not in pastrate:
            actualizat[i] = {"rezolvat": True, "rezolvatLa": acum, "actualizatLa": acum}
    return creat, actualizat, sters


def eveniment_valid(ex: dict, acum: datetime, entitati: dict[str, dict | None], membri: dict[str, dict]) -> bool:
    """Un eveniment deja trimis rămâne cât timp cauza ține (același responsabil, dosar/sarcină activă, membrul e încă
    în cabinet) și cel mult ZILE_EVENIMENT zile."""
    creat = ex.get("creatLa")
    if not isinstance(creat, datetime) or acum - creat > timedelta(days=ZILE_EVENIMENT) or ex.get("rezolvat"):
        return False
    sub = ex.get("cheieBaza", "").split(":")[-1]
    if ex.get("cod") == "membru_nou":
        return sub in membri
    ent = entitati.get(ex.get("sursa", ""))
    if not ent:
        return False
    if ex.get("cod") == "dosar_asignat":
        return ent.get("responsabilUid") == sub and ent.get("stadiu") not in STADII_FINALE
    if ex.get("cod") == "sarcina_asignata":
        return ent.get("assigneeUid") == sub and ent.get("status") != "finalizat"
    return False


# ── Firestore ───────────────────────────────────────────────────────────────────

def activ_pentru(ws: dict | None) -> bool:
    """Cabinetul primește alerte: flag-ul de lansare e pornit și nu e programat pentru ștergere."""
    return bool(ws) and (ws.get("features") or {}).get(FEATURE) is True and ws.get("status") != "pendingDeletion"


def _acum() -> datetime:
    return datetime.now(timezone.utc)


def _scrie(db, coll, creat: dict, actualizat: dict, sters: list) -> dict:
    batch, n = db.batch(), 0

    def flush():
        nonlocal batch, n
        if n:
            batch.commit()
        batch, n = db.batch(), 0

    for i, doc in creat.items():
        batch.set(coll.document(i), doc)
        n += 1
        if n >= 400:
            flush()
    for i, mod in actualizat.items():
        batch.update(coll.document(i), mod)
        n += 1
        if n >= 400:
            flush()
    for i in sters:
        batch.delete(coll.document(i))
        n += 1
        if n >= 400:
            flush()
    flush()
    return {"create": len(creat), "actualizate": len(actualizat), "sterse": len(sters)}


def _existente(query) -> dict[str, dict]:
    return {s.id: (s.to_dict() or {}) for s in query.stream()}


def _evenimente_pastrate(existente: dict[str, dict], acum: datetime, entitati: dict, membri: dict,
                         profile: list[Profil]) -> set[str]:
    """Evenimentele deja trimise care rămân: tipul e încă pornit la destinatar și cauza ține (vezi eveniment_valid)."""
    dupa_uid = {p.uid: p for p in profile}
    return {i for i, ex in existente.items()
            if ex.get("eveniment") and ex.get("uid") in dupa_uid
            and dupa_uid[ex["uid"]].reguli.get(ex.get("cod"), {}).get("activ")
            and eveniment_valid(ex, acum, entitati, membri)}


def _preferinte(ws_ref, uid: str | None = None) -> dict[str, dict]:
    coll = ws_ref.collection(PREFERINTE)
    if uid:
        snap = coll.document(uid).get()
        return {uid: snap.to_dict() or {}} if snap.exists else {}
    return {s.id: (s.to_dict() or {}) for s in coll.stream()}


_ENTITATI = {"client": "clienti", "dosar": "dosare", "sarcina": "sarcini"}


def _alerte_entitate(tip: str, eid: str, data: dict, azi: date, reguli: dict) -> list[Alerta]:
    if tip == "client":
        return alerte_client(eid, data, azi, reguli)
    if tip == "dosar":
        return alerte_dosar(eid, data, azi, reguli)
    return alerte_sarcina(eid, data, azi, reguli)


# Câmpurile din care se calculează alertele fiecărei entități; o scriere care nu atinge niciunul (ex. ordinea cardurilor
# pe board, notițele clientului) nu declanșează recalcularea.
CAMPURI_ENTITATE = {
    "client": ("tipClient", "denumire", "inInfiintare", "administratori", "asociati", "titular", "membriIF",
               "durataSocietate", "dataInmatricularii"),
    "dosar": ("stadiu", "stadiuDin", "createdAt", "dataPlanificare", "responsabilUid", "responsabilNume", "facturat",
              "documentePredateAt", "nrInregistrareDosar", "clientId", "clientDenumire", "clientDenumireLibera"),
    "sarcina": ("status", "termenLimita", "assigneeUid", "assigneeNume", "titlu", "clientId", "clientDenumire",
                "clientDenumireLibera", "dosarId"),
}


def schimbare_relevanta(tip: str, inainte: dict | None, dupa: dict | None) -> bool:
    if inainte is None or dupa is None:
        return True
    return any(inainte.get(k) != dupa.get(k) for k in CAMPURI_ENTITATE[tip])


def la_scriere_entitate(db, tip: str, wid: str, eid: str, inainte: dict | None, dupa: dict | None,
                        autor: str | None = None, acum: datetime | None = None) -> dict:
    """Trigger pe clienti/dosare/sarcini: recalculează alertele entității. La ștergere, alertele ei se șterg.

    Triggerele pot sosi în altă ordine decât scrierile, deci alertele se calculează din documentul citit acum, nu din
    `dupa`; evenimentul (asignarea) se deduce din `inainte`/`dupa` și se păstrează doar dacă documentul curent îl
    confirmă (vezi eveniment_valid)."""
    if not schimbare_relevanta(tip, inainte, dupa):
        return {"sarit": True}
    ws_ref = db.collection("workspaces").document(wid)
    snap = ws_ref.get()
    ws = snap.to_dict() if snap.exists else None
    if not activ_pentru(ws):
        return {"sarit": True}
    acum = acum or _acum()
    coll = ws_ref.collection(COLECTIE)
    sursa = f"{tip}:{eid}"
    existente = _existente(coll.where("sursa", "==", sursa))
    snap_ent = ws_ref.collection(_ENTITATI[tip]).document(eid).get()
    curent = (snap_ent.to_dict() or {}) if snap_ent.exists else None
    if curent is None:
        return _scrie(db, coll, {}, {}, list(existente))

    membri = ws.get("members") or {}
    profile = profiluri(membri, _preferinte(ws_ref))
    azi = acum.astimezone(TZ).date()
    ev = eveniment_dosar(eid, inainte, dupa, autor) if tip == "dosar" else \
        eveniment_sarcina(eid, inainte, dupa, autor) if tip == "sarcina" else None
    if ev and not eveniment_valid({"cod": ev.cod, "cheieBaza": ev.cheie_baza, "sursa": sursa, "creatLa": acum},
                                  acum, {sursa: curent}, membri):
        ev = None       # între timp asignarea s-a schimbat sau dosarul/sarcina s-a încheiat
    dorit = dorite(lambda reguli: _alerte_entitate(tip, eid, curent, azi, reguli) + ([ev] if ev else []), profile)
    pastrate = _evenimente_pastrate(existente, acum, {sursa: curent}, membri, profile)
    return _scrie(db, coll, *plan_sincronizare(dorit, existente, pastrate, set(membri), acum))


def recalculeaza_cabinet(db, wid: str, ws: dict | None = None, membri_noi: list[str] | None = None,
                         acum: datetime | None = None, doar_uid: str | None = None) -> dict:
    """Recalculează alertele cabinetului (jobul zilnic, schimbarea membrilor sau a abonamentului); cu `doar_uid`, doar
    ale acelui membru (și-a schimbat setările). Fără flag-ul `alerte` (sau la oprirea lui), alertele existente se șterg."""
    ws_ref = db.collection("workspaces").document(wid)
    if ws is None:
        snap = ws_ref.get()
        ws = snap.to_dict() if snap.exists else None
    coll = ws_ref.collection(COLECTIE)
    existente = _existente(coll.where("uid", "==", doar_uid) if doar_uid else coll)
    if not activ_pentru(ws):
        # Flag oprit: nu rămân alerte vechi. Un cabinet în ștergere se șterge oricum în întregime.
        if existente and ws and ws.get("status") != "pendingDeletion":
            return _scrie(db, coll, {}, {}, list(existente))
        return {"sarit": True}

    acum = acum or _acum()
    azi = acum.astimezone(TZ).date()
    membri = ws.get("members") or {}
    profile = [p for p in profiluri(membri, _preferinte(ws_ref, doar_uid)) if not doar_uid or p.uid == doar_uid]
    entitati: dict[str, dict] = {}
    for tip, colectie in _ENTITATI.items():
        q = ws_ref.collection(colectie)
        if tip == "sarcina":
            q = q.where("status", "!=", "finalizat")
        for s in q.stream():
            entitati[f"{tip}:{s.id}"] = s.to_dict() or {}
    evenimente = [eveniment_membru_nou(uid, membri[uid]) for uid in membri_noi or [] if uid in membri]

    def calcul(reguli: dict[str, dict]) -> list[Alerta]:
        out = alerte_cabinet(ws, acum, reguli) + evenimente
        for cheie, data in entitati.items():
            tip, eid = cheie.split(":", 1)
            out.extend(_alerte_entitate(tip, eid, data, azi, reguli))
        return out

    dorit = dorite(calcul, profile)
    pastrate = _evenimente_pastrate(existente, acum, entitati, membri, profile)
    rezultat = _scrie(db, coll, *plan_sincronizare(dorit, existente, pastrate, set(membri), acum))

    # Retenție: alertele rezolvate de mult nu mai au ce căuta (și conțin nume).
    limita = acum - timedelta(days=ZILE_RETENTIE)
    vechi = [i for i, ex in existente.items()
             if ex.get("rezolvat") and isinstance(ex.get("rezolvatLa"), datetime) and ex["rezolvatLa"] < limita
             and i not in dorit]
    if vechi:
        _scrie(db, coll, {}, {}, vechi)
    rezultat["retentie"] = len(vechi)
    return rezultat


# Câmpurile documentului de cabinet care schimbă alertele; restul (șabloane, nume, facturare) nu declanșează nimic.
CAMPURI_CABINET = ("members", "billing", "status", "features")


def la_scriere_cabinet(db, wid: str, inainte: dict | None, dupa: dict | None) -> dict:
    """Trigger pe workspaces/{wid}: la schimbarea membrilor (și a rolurilor), a abonamentului sau a flag-ului."""
    if not dupa:
        return {"sarit": True}
    inainte = inainte or {}
    if all(inainte.get(k) == dupa.get(k) for k in CAMPURI_CABINET):
        return {"sarit": True}
    vechi, noi = set(inainte.get("members") or {}), set(dupa.get("members") or {})
    for uid in vechi - noi:     # preferințele unui fost membru nu mai folosesc nimănui
        db.collection("workspaces").document(wid).collection(PREFERINTE).document(uid).delete()
    return recalculeaza_cabinet(db, wid, ws=dupa, membri_noi=sorted(noi - vechi) if inainte else [])


def la_scriere_preferinte(db, wid: str, uid: str, inainte: dict | None = None, dupa: dict | None = None) -> dict:
    """Trigger pe preferinteAlerte/{uid}: membrul și-a schimbat setările; doar alertele lui se recalculează. Ignorările
    (`ignorate`) le aplică browserul, deci o scriere care schimbă doar ele nu costă o recalculare. Preferințele se
    recitesc la rulare (nu din eveniment), ca o rulare întârziată să nu aplice o stare mai veche."""
    if inainte is not None and dupa is not None and all(
            (inainte or {}).get(k) == (dupa or {}).get(k) for k in ("tipuri", "surse")):
        return {"sarit": True}
    snap = db.collection("workspaces").document(wid).get()
    ws = snap.to_dict() if snap.exists else None
    if not activ_pentru(ws) or uid not in (ws.get("members") or {}):
        return {"sarit": True}
    return recalculeaza_cabinet(db, wid, ws=ws, doar_uid=uid)


def ruleaza_zilnic(db, acum: datetime | None = None) -> dict:
    """Jobul zilnic: toate cabinetele cu flag-ul `alerte` (termenele avansează odată cu zilele)."""
    import random
    import time
    from google.cloud.firestore_v1.base_query import FieldFilter
    rezultat = {"cabinete": 0, "erori": 0, "neprocesate": 0}
    cabinete = list(db.collection("workspaces").where(filter=FieldFilter(f"features.{FEATURE}", "==", True)).stream())
    # Ordine aleatoare: dacă rularea se apropie de limita de timp, nu rămân mereu aceleași cabinete pe dinafară.
    random.shuffle(cabinete)
    start = time.monotonic()
    for i, snap in enumerate(cabinete):
        if time.monotonic() - start > BUGET_ZILNIC_SEC:
            rezultat["neprocesate"] = len(cabinete) - i
            print(f"[alerte] buget de timp depășit: {rezultat['neprocesate']} cabinete rămase pentru mâine")
            break
        ws = snap.to_dict() or {}
        if ws.get("status") == "pendingDeletion":
            continue
        try:
            recalculeaza_cabinet(db, snap.id, ws=ws, acum=acum)
            rezultat["cabinete"] += 1
        except Exception as e:      # un cabinet cu date ciudate nu oprește restul
            rezultat["erori"] += 1
            print(f"[alerte] {snap.id}: {type(e).__name__}")
    return rezultat
