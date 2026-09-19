import os

os.environ.setdefault("UPLOAD_FOLDER", "/tmp/uploads")

from firebase_functions import https_fn, params
from app import app as flask_app

_azure_docint_key = params.SecretParam("AZURE_DOCUMENT_INTELLIGENCE_KEY")

# Cont de serviciu DEDICAT pentru funcție, cu drepturi minime (Firestore, citire Auth, KMS, jurnale), în loc de
# contul implicit Compute (rol de Editor pe tot proiectul). Se setează în .env.<proiect>; dacă lipsește, se folosește
# contul implicit. Crearea lui: scripts/setup_kms.sh sau docs/vault-rollout.md, secțiunea 1.
_runtime_sa = os.getenv("RUNTIME_SERVICE_ACCOUNT") or None


@https_fn.on_request(
    region="europe-west3",
    memory=4096,
    timeout_sec=300,
    max_instances=10,
    concurrency=1,
    secrets=[_azure_docint_key],
    service_account=_runtime_sa,
)
def api(req: https_fn.Request) -> https_fn.Response:
    environ = dict(req.environ)
    path = environ.get("PATH_INFO", "/")
    if path.startswith("/api"):
        environ["PATH_INFO"] = path[4:] or "/"
    with flask_app.request_context(environ):
        return flask_app.full_dispatch_request()
