"""Aplicație Flask minimă pentru documentele clienților (funcția `documente` din main.py).

Separată de `app.py` intenționat, ca webhook-ul Stripe: aplicația principală rulează cu `concurrency=1` și 4 GiB și
încarcă la pornire modelele EasyOCR. O încărcare sau descărcare de 15 MB pe o conexiune lentă ar ține ocupată o
instanță întreagă, iar câteva cozi de fișiere deodată ar bloca OCR-ul și restul aplicației. Aici pornirea e rapidă și
o instanță servește mai multe transferuri simultan. Aceleași rute rămân și în `app.py` (dezvoltare locală, operațiile
mici trimise prin Hosting); browserul trimite aici doar încărcările și descărcările (`VITE_FILES_BASE`).
"""
from __future__ import annotations

import os

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

import authz

authz.init_admin()

import fisiere  # noqa: E402  (după init Firebase Admin)
import cereri_api  # noqa: E402
import fisiere_api  # noqa: E402

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = fisiere.MAX_BYTES + 256 * 1024
# Aceeași politică CORS ca app.py: fără FRONTEND_ORIGIN, nicio origine cross-site nu e acceptată.
_cors_origins = [o.strip() for o in os.getenv("FRONTEND_ORIGIN", "").split(",") if o.strip()]
CORS(app, origins=_cors_origins,
     allow_headers=["Content-Type", "X-Firebase-Token", "X-Workspace-Id"],
     expose_headers=["Content-Disposition", "Retry-After"])

# Plasă de siguranță pe IP; limitele reale sunt per cont și per cabinet (ratelimit.py: fisiere_scriere / fisiere_citire).
limiter = Limiter(get_remote_address, app=app, default_limits=["1000 per hour"])


@limiter.request_filter
def _skip_preflight() -> bool:
    return request.method == "OPTIONS"


app.register_blueprint(fisiere_api.bp)
app.register_blueprint(cereri_api.bp)


@app.get("/health")
def health():
    return jsonify({"ok": True})
