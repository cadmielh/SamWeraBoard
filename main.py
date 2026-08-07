import os

os.environ.setdefault("UPLOAD_FOLDER", "/tmp/uploads")

from firebase_functions import https_fn, params
from app import app as flask_app

_azure_docint_key = params.SecretParam("AZURE_DOCUMENT_INTELLIGENCE_KEY")
_demoanaf_key     = params.SecretParam("DEMOANAF_API_KEY")


@https_fn.on_request(
    region="us-central1",
    memory=4096,
    timeout_sec=300,
    max_instances=10,
    concurrency=1,
    secrets=[_azure_docint_key, _demoanaf_key],
)
def api(req: https_fn.Request) -> https_fn.Response:
    environ = dict(req.environ)
    path = environ.get("PATH_INFO", "/")
    if path.startswith("/api"):
        environ["PATH_INFO"] = path[4:] or "/"
    with flask_app.request_context(environ):
        return flask_app.full_dispatch_request()
