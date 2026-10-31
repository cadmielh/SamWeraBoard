import os

os.environ.setdefault("UPLOAD_FOLDER", "/tmp/uploads")

from firebase_functions import https_fn, params

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
