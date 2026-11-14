import os

os.environ.setdefault("UPLOAD_FOLDER", "/tmp/uploads")

from firebase_functions import firestore_fn, https_fn, params, scheduler_fn

_azure_docint_key = params.SecretParam("AZURE_DOCUMENT_INTELLIGENCE_KEY")
_stripe_secret_key = params.SecretParam("STRIPE_SECRET_KEY")
_stripe_webhook_secret = params.SecretParam("STRIPE_WEBHOOK_SECRET")

# Cont de serviciu DEDICAT pentru funcție, cu drepturi minime (Firestore, citire Auth, KMS, jurnale), în loc de
# contul implicit Compute (rol de Editor pe tot proiectul). Se setează în .env.<proiect>; dacă lipsește, se folosește
# contul implicit. Crearea lui: scripts/setup_kms.sh sau docs/vault-rollout.md, secțiunea 1.
_runtime_sa = os.getenv("RUNTIME_SERVICE_ACCOUNT") or None

# Aplicația principală (OCR, șabloane) se încarcă doar în instanțele funcției `api`: instanțele `billing_webhook`
# importă și ele acest modul, dar nu au nevoie de EasyOCR. `FUNCTION_TARGET` e setat de runtime la numele
# funcției; dacă lipsește (ex. la deploy, când CLI-ul doar citește definițiile), încărcarea se face la prima cerere.
_flask_app = None


def _main_app():
    global _flask_app
    if _flask_app is None:
        from app import app as loaded
        _flask_app = loaded
    return _flask_app


if os.getenv("FUNCTION_TARGET") == "api":
    _main_app()                     # la pornirea instanței: preîncărcarea EasyOCR începe imediat


def _dispatch(flask_app, environ: dict) -> https_fn.Response:
    with flask_app.request_context(environ):
        return flask_app.full_dispatch_request()


@https_fn.on_request(
    region="europe-west3",
    memory=4096,
    timeout_sec=300,
    max_instances=10,
    concurrency=1,
    secrets=[_azure_docint_key, _stripe_secret_key],
    service_account=_runtime_sa,
)
def api(req: https_fn.Request) -> https_fn.Response:
    environ = dict(req.environ)
    path = environ.get("PATH_INFO", "/")
    if path.startswith("/api"):
        environ["PATH_INFO"] = path[4:] or "/"
    return _dispatch(_main_app(), environ)


@https_fn.on_request(
    region="europe-west3",
    memory=512,
    cpu=1,
    timeout_sec=60,
    max_instances=3,
    concurrency=40,
    secrets=[_stripe_secret_key, _stripe_webhook_secret],
    service_account=_runtime_sa,
)
def billing_webhook(req: https_fn.Request) -> https_fn.Response:
    """Endpoint-ul de webhook din Stripe Dashboard: URL-ul direct al funcției (nu prin Hosting)."""
    import billing_webhook_app
    environ = dict(req.environ)
    environ["PATH_INFO"] = "/billing/webhook"       # o singură rută; URL-ul funcției ajunge cu „/”
    return _dispatch(billing_webhook_app.app, environ)


@scheduler_fn.on_schedule(
    schedule="every day 03:30",
    timezone=scheduler_fn.Timezone("Europe/Bucharest"),
    region="europe-west3",
    memory=512,
    timeout_sec=540,
    secrets=[_stripe_secret_key],
    service_account=_runtime_sa,
)
def purge_deletions(event: scheduler_fn.ScheduledEvent) -> None:
    """Ștergerea definitivă a cabinetelor și conturilor ieșite din perioada de grație (workspace_deletion.GRACE_DAYS)."""
    import authz
    import workspace_deletion
    authz.init_admin()          # instanța funcției nu încarcă app.py, unde se face inițializarea pentru `api`
    print(f"[purge] {workspace_deletion.purge_due(authz.db(), authz.delete_user)}")


# ── Alerte (alerte.py, docs/plan-alerte.md) ─────────────────────────────────────
# Triggerele Firestore trebuie să ruleze în regiunea bazei de date; se poate schimba din .env.<proiect>.
_alerte_region = os.getenv("ALERTE_TRIGGER_REGION", "europe-west3")
_ALERTE_TRIGGER = dict(region=_alerte_region, memory=512, timeout_sec=120, max_instances=10, service_account=_runtime_sa)


def _date_document(snap) -> dict | None:
    return (snap.to_dict() or {}) if snap is not None and snap.exists else None


def _autor(event) -> str | None:
    """uid-ul utilizatorului care a scris, ca să nu-i trimitem „ți s-a asignat” când se asignează singur. Valorile
    `auth_type` diferă între documentații și versiuni ale SDK-ului; conturile de serviciu au însă ca id o adresă de
    e-mail, iar uid-urile Firebase Auth nu conțin „@”."""
    autor = getattr(event, "auth_id", None)
    return autor if autor and "@" not in autor else None


def _alerte_entitate(tip: str, cheie: str, event) -> None:
    import alerte
    import authz
    authz.init_admin()          # instanța funcției nu încarcă app.py
    alerte.la_scriere_entitate(authz.db(), tip, event.params["wid"], event.params[cheie],
                               _date_document(event.data.before), _date_document(event.data.after), autor=_autor(event))


@firestore_fn.on_document_written_with_auth_context(document="workspaces/{wid}/clienti/{cid}", **_ALERTE_TRIGGER)
def alerte_client(event) -> None:
    _alerte_entitate("client", "cid", event)


@firestore_fn.on_document_written_with_auth_context(document="workspaces/{wid}/dosare/{did}", **_ALERTE_TRIGGER)
def alerte_dosar(event) -> None:
    _alerte_entitate("dosar", "did", event)


@firestore_fn.on_document_written_with_auth_context(document="workspaces/{wid}/sarcini/{sid}", **_ALERTE_TRIGGER)
def alerte_sarcina(event) -> None:
    _alerte_entitate("sarcina", "sid", event)


@firestore_fn.on_document_written(document="workspaces/{wid}/preferinteAlerte/{uid}", **_ALERTE_TRIGGER)
def alerte_preferinte(event) -> None:
    """Un membru și-a schimbat setările de notificări: doar alertele lui se recalculează."""
    import alerte
    import authz
    authz.init_admin()
    alerte.la_scriere_preferinte(authz.db(), event.params["wid"], event.params["uid"],
                                 _date_document(event.data.before), _date_document(event.data.after))


@firestore_fn.on_document_updated(document="workspaces/{wid}", **_ALERTE_TRIGGER)
def alerte_cabinet(event) -> None:
    """Membri (și roluri), abonament sau flag-ul s-au schimbat: tot cabinetul se recalculează."""
    import alerte
    import authz
    authz.init_admin()
    alerte.la_scriere_cabinet(authz.db(), event.params["wid"], _date_document(event.data.before),
                              _date_document(event.data.after))


@scheduler_fn.on_schedule(
    schedule="every day 06:00",
    timezone=scheduler_fn.Timezone("Europe/Bucharest"),
    region="europe-west3",
    memory=512,
    timeout_sec=1800,           # alerte.BUGET_ZILNIC_SEC lasă marjă până la limită
    service_account=_runtime_sa,
)
def alerte_zilnice(event: scheduler_fn.ScheduledEvent) -> None:
    """Termenele avansează odată cu zilele: recalculează alertele tuturor cabinetelor cu flag-ul `alerte`."""
    import alerte
    import authz
    authz.init_admin()
    rezultat = alerte.ruleaza_zilnic(authz.db())
    print(f"[alerte] {rezultat}")
    # Un cabinet căzut sau rămas neprocesat nu oprește restul, dar rularea se încheie cu eroare: răspunsul 5xx declanșează
    # alerta din Cloud Monitoring (scripts/setup_alerts.sh, „Alerte: erori”). Rularea e idempotentă.
    if rezultat["erori"] or rezultat["neprocesate"]:
        raise RuntimeError(f"[alerte] rulare incompletă: {rezultat}")
