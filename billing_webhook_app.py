"""Aplicație Flask minimă pentru webhook-ul Stripe (funcția `billing_webhook` din main.py).

Separată de `app.py` intenționat: aplicația principală rulează cu `concurrency=1` și 4 GiB și încarcă la pornire
modelele EasyOCR și șabloanele. Stripe trimite 5–8 evenimente într-o secundă la fiecare abonare; aici pornirea
e rapidă și o instanță procesează mai multe evenimente deodată, fără să concureze cu OCR-ul.
"""
from __future__ import annotations

from flask import Flask

import authz

authz.init_admin()

import billing_api  # noqa: E402  (după init Firebase Admin)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024             # evenimentele Stripe au câțiva KB
app.register_blueprint(billing_api.webhook_bp)
