"""Notificările „de aplicație” pentru super admini: bani, cabinete noi și ștergeri, conversie, facturare.

Spre deosebire de alerte.py (per cabinet, per membru), acestea țin de toată aplicația și ajung la toți super adminii:
`superAdminNotificari/{cheie}`, scrise doar de server, citite doar de super admini (regulile Firestore). Fiecare
eveniment are o cheie stabilă (ex. id-ul evenimentului Stripe, sau cabinet + zi), deci reluarea unui webhook sau
a jobului zilnic nu dublează notificarea. Ce a citit fiecare super admin se ține în `users/{uid}.superAdminCititeLa`.

Emiterea nu blochează niciodată operația care o declanșează (o plată, crearea unui cabinet): eșecul doar se loghează.
Textele conțin numele cabinetului, e-mailul administratorului și sume — date pe care super adminul le vede oricum.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import authz
import billing

COLECTIE = "superAdminNotificari"
RETENTIE = timedelta(days=90)
TZ = ZoneInfo("Europe/Bucharest")
ZILE_FACTURARE = 5          # o încasare fără factură emisă după atâtea zile apare în notificări
ZILE_INACTIV_PLATITOR = 14
ZILE_PROBA_SE_INCHEIE = 3
_SISTEM = {"stripe", "system", ""}


def _cheie(*parti: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", "__".join(p for p in parti if p))[:200]


def emite(cheie: str, categorie: str, titlu: str, text: str = "", *, severitate: str = "info",
          link: str = "/super-admin", wid: str | None = None) -> bool:
    """Creează notificarea dacă nu există deja (aceeași cheie = același eveniment). Nu aruncă niciodată."""
    acum = datetime.now(timezone.utc)
    try:
        authz.db().collection(COLECTIE).document(_cheie(cheie)).create({
            "categorie": categorie, "severitate": severitate, "titlu": titlu[:200], "text": text[:500],
            "link": link, "workspaceId": wid, "creatLa": acum, "expireAt": acum + RETENTIE,
        })
        return True
    except Exception as e:  # AlreadyExists = deja emisă; orice altceva doar se loghează
        if type(e).__name__ not in ("AlreadyExists", "Conflict"):
            print(f"[superadmin-alerte] emitere eșuată {categorie} ({type(e).__name__})")
        return False


def _cabinet(wid: str | None) -> tuple[str, str]:
    """(numele cabinetului, e-mailul administratorului) pentru texte; goale dacă nu se pot citi."""
    if not wid:
        return "cabinet necunoscut", ""
    try:
        ws = authz.load_workspace(wid) or {}
    except Exception:
        return wid, ""
    membri = ws.get("members") or {}
    admin = (membri.get(ws.get("ownerId")) or next((m for m in membri.values() if m.get("role") == "admin"), {})) or {}
    return ws.get("name") or wid, admin.get("email") or ""


def _link_cabinet(wid: str | None) -> str:
    return f"/super-admin?cabinet={wid}" if wid else "/super-admin"


def ron(bani) -> str:
    """Suma din subdiviziuni (bani) în format românesc: 1.250 RON, 12,50 RON."""
    try:
        v = int(bani or 0) / 100
    except (TypeError, ValueError):
        return "—"
    s = f"{v:,.2f}".replace(",", " ").replace(".", ",").replace(" ", ".")
    return (s[:-3] if s.endswith(",00") else s) + " RON"


# ── Evenimente (apelate din fluxurile existente) ──────────────────────────────

def cabinet_nou(wid: str, nume: str, email: str, proba: bool) -> None:
    emite(_cheie("cabinet_nou", wid), "cabinete", f"Cabinet nou: {nume}",
          f"{email} · {'perioadă de probă de 14 zile' if proba else 'fără probă (a mai avut una): trebuie să plătească'}",
          link=_link_cabinet(wid), wid=wid)


def cui_refolosit(wid: str, alt_wid: str) -> None:
    nume, email = _cabinet(wid)
    alt, _ = _cabinet(alt_wid)
    emite(_cheie("cui_refolosit", wid, alt_wid), "cabinete", f"CUI refolosit: {nume}",
          f"Același CUI a mai avut o probă în „{alt}”{f' · {email}' if email else ''}", severitate="atentie",
          link=_link_cabinet(wid), wid=wid)


def cont_programat_stergere(email: str, cabinete: int, sterge_la: datetime) -> None:
    emite(_cheie("cont_sters", email, sterge_la.strftime("%Y%m%d")), "cabinete", f"Cerere de ștergere a contului: {email}",
          f"Se șterge pe {sterge_la.astimezone(TZ):%d.%m.%Y}" + (f", cu {cabinete} {'cabinet' if cabinete == 1 else 'cabinete'} în care era singurul membru" if cabinete else ""),
          severitate="atentie", link="/super-admin?fila=conturi")


def din_stripe(event: dict, wid: str | None) -> None:
    """Notificarea pentru un eveniment Stripe deja procesat de webhook (vezi billing_api.process_event)."""
    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    prev = (event.get("data") or {}).get("previous_attributes") or {}
    cheie = _cheie("stripe", str(event.get("id", "")))
    nume, email = _cabinet(wid)
    cine = f"{nume}{f' · {email}' if email else ''}"
    link = _link_cabinet(wid)

    if etype == "checkout.session.completed":
        if obj.get("mode") == "payment":
            pack = (obj.get("metadata") or {}).get("pack")
            emite(cheie, "bani", f"Pachet de credite cumpărat: {ron(obj.get('amount_total'))}",
                  f"{cine} · {pack or '?'} credite", link=link, wid=wid)
        elif obj.get("mode") == "subscription":
            emite(cheie, "bani", f"Abonament nou: {nume}",
                  f"{email + ' · ' if email else ''}prima plată {'acum' if obj.get('amount_total') else 'la sfârșitul probei'}", link=link, wid=wid)
    elif etype == "customer.subscription.updated" and "cancel_at_period_end" in prev:
        if obj.get("cancel_at_period_end"):
            sfarsit = billing.to_utc(obj.get("cancel_at") or obj.get("current_period_end"))
            emite(cheie, "bani", f"Abonament anulat: {nume}",
                  f"{email + ' · ' if email else ''}se încheie {f'pe {sfarsit.astimezone(TZ):%d.%m.%Y}' if sfarsit else 'la sfârșitul perioadei'}",
                  severitate="atentie", link=link, wid=wid)
        else:
            emite(cheie, "bani", f"Abonament reactivat: {nume}", email, link=link, wid=wid)
    elif etype == "customer.subscription.deleted":
        emite(cheie, "bani", f"Abonament încheiat: {nume}", email, severitate="atentie", link=link, wid=wid)
    elif etype == "invoice.paid" and obj.get("billing_reason") == "subscription_cycle" and obj.get("amount_paid"):
        emite(cheie, "bani", f"Abonament reînnoit: {ron(obj.get('amount_paid'))}", cine, link=link, wid=wid)
    elif etype == "invoice.paid" and obj.get("billing_reason") == "subscription_create" and obj.get("amount_paid"):
        emite(cheie, "bani", f"Prima plată de abonament: {ron(obj.get('amount_paid'))}", cine, link=link, wid=wid)
    elif etype == "invoice.payment_failed":
        emite(cheie, "bani", f"Plată eșuată: {nume}", f"{ron(obj.get('amount_due'))}{f' · {email}' if email else ''} · Stripe reîncearcă automat",
              severitate="urgent", link=link, wid=wid)
    elif etype == "charge.refunded":
        emite(cheie, "bani", f"Rambursare: {ron(obj.get('amount_refunded'))}", f"{cine} · stornează factura dacă a fost emisă",
              severitate="urgent", link="/super-admin?fila=incasari", wid=wid)
    elif etype == "charge.dispute.created":
        emite(cheie, "bani", f"Dispută (chargeback): {ron(obj.get('amount'))}",
              f"{cine} · motiv: {obj.get('reason') or 'nespecificat'} · răspunde din Stripe până la termen",
              severitate="urgent", link="/super-admin?fila=incasari", wid=wid)


# ── Jobul zilnic: conversie și facturare ──────────────────────────────────────

def _ultima_actiune(db, wid: str) -> datetime | None:
    q = (db.collection("workspaces").document(wid).collection("auditLog")
         .order_by("ts", direction="DESCENDING").select(["ts", "actorUid"]).limit(20))
    for e in q.stream():
        x = e.to_dict() or {}
        if x.get("ts") and (x.get("actorUid") or "") not in _SISTEM:
            return billing.to_utc(x["ts"])
    return None


def zilnic(db, acum: datetime | None = None) -> dict:
    """Notificările care depind de trecerea timpului. Idempotent: cheile conțin ziua sau termenul."""
    acum = acum or datetime.now(timezone.utc)
    zi = acum.astimezone(TZ).strftime("%Y-%m-%d")
    rezultat = {"proba": 0, "expirate": 0, "inactivi": 0, "nefacturate": 0}

    for snap in db.collection("workspaces").limit(2000).stream():
        ws = snap.to_dict() or {}
        if ws.get("status") == "pendingDeletion":
            continue
        b = ws.get("billing") or {}
        wid = snap.id
        nume, email = ws.get("name") or wid, ""
        membri = ws.get("members") or {}
        email = (membri.get(ws.get("ownerId")) or {}).get("email") or ""
        cine = f"{nume}{f' · {email}' if email else ''}"
        trial_end = billing.to_utc(b.get("trialEndsAt"))
        access = billing.to_utc(b.get("accessUntil"))
        are_sub = bool(b.get("hasSubscription"))
        credite = billing.credit_balance(b, acum)

        # Proba se încheie în cel mult 3 zile, fără abonament și fără credite: o singură dată per sfârșit de probă.
        if (trial_end and not are_sub and credite == 0 and access and access <= trial_end + timedelta(minutes=1)
                and acum < trial_end <= acum + timedelta(days=ZILE_PROBA_SE_INCHEIE)):
            zile = max(1, -(-(trial_end - acum) // timedelta(days=1)))
            if emite(_cheie("proba_se_incheie", wid, trial_end.strftime("%Y%m%d")), "conversie",
                     f"Proba se încheie în {zile} {'zi' if zile == 1 else 'zile'}: {nume}",
                     f"{email + ' · ' if email else ''}fără abonament sau credite încă", severitate="atentie",
                     link=_link_cabinet(wid), wid=wid):
                rezultat["proba"] += 1

        # Accesul s-a încheiat în ultimele 24 de ore (probă sau plată), fără reînnoire: cabinetul e acum în citire.
        if access and acum - timedelta(days=1) <= access < acum and not are_sub:
            if emite(_cheie("acces_expirat", wid, access.strftime("%Y%m%d")), "conversie",
                     f"A trecut în modul citire: {nume}",
                     f"{email + ' · ' if email else ''}{'proba s-a încheiat fără plată' if trial_end and abs((access - trial_end).total_seconds()) < 120 else 'accesul plătit s-a încheiat'}",
                     severitate="atentie", link=_link_cabinet(wid), wid=wid):
                rezultat["expirate"] += 1

        # Cabinet plătitor care nu mai lucrează: semnal de pierdere, cel mult o dată pe săptămână.
        if billing.has_full_access(ws, acum) and (are_sub or credite > 0):
            ultima = _ultima_actiune(db, wid)
            if ultima and acum - ultima >= timedelta(days=ZILE_INACTIV_PLATITOR):
                sapt = acum.astimezone(TZ).strftime("%G-W%V")
                if emite(_cheie("platitor_inactiv", wid, sapt), "conversie", f"Client plătitor inactiv: {nume}",
                         f"{cine} · nicio acțiune de {(acum - ultima).days} zile", link=_link_cabinet(wid), wid=wid):
                    rezultat["inactivi"] += 1

    # Încasări fără factură emisă după ZILE_FACTURARE zile: un singur rezumat pe zi.
    prag = acum - timedelta(days=ZILE_FACTURARE)
    total, suma = 0, 0
    for doc in db.collection_group("invoices").stream():
        d = doc.to_dict() or {}
        platita = billing.to_utc(d.get("paidAt"))
        if (d.get("amount") or 0) > 0 and (d.get("smartbill") or {}).get("status") in (None, "pending", "failed") and platita and platita < prag:
            total, suma = total + 1, suma + (d.get("amount") or 0)
    for doc in db.collection_group("creditLots").stream():
        d = doc.to_dict() or {}
        creat = billing.to_utc(d.get("createdAt"))
        if (d.get("source") == "purchase" and (d.get("amountPaid") or 0) > 0
                and (d.get("invoice") or {}).get("status") in (None, "pending") and creat and creat < prag):
            total, suma = total + 1, suma + (d.get("amountPaid") or 0)
    if total and emite(_cheie("nefacturate", zi), "facturare",
                       f"{total} {'încasare nefacturată' if total == 1 else 'încasări nefacturate'} de peste {ZILE_FACTURARE} zile",
                       f"Total {ron(suma)} · marchează factura emisă din Încasări", severitate="urgent",
                       link="/super-admin?fila=incasari"):
        rezultat["nefacturate"] = total
    return rezultat
