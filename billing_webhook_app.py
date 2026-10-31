"""Aplicație Flask minimă pentru webhook-ul Stripe (funcția `billing_webhook` din main.py).

Separată de `app.py` intenționat: aplicația principală rulează cu `concurrency=1` și 4 GiB și încarcă la pornire
modelele EasyOCR și șabloanele. Stripe trimite 5–8 evenimente într-o secundă la fiecare abonare; aici pornirea
e rapidă și o instanță procesează mai multe evenimente deodată, fără să concureze cu OCR-ul.
"""
from __future__ import annotations

import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials as fb_creds
from flask import Flask

if not firebase_admin._apps:
    _sa_file = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "firebase-service-account.json")
    if Path(_sa_file).exists():
        firebase_admin.initialize_app(fb_creds.Certificate(_sa_file))
    else:
        firebase_admin.initialize_app()                    # Cloud Run: Application Default Credentials

import billing_api  # noqa: E402  (după init Firebase Admin)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024             # evenimentele Stripe au câțiva KB
app.register_blueprint(billing_api.webhook_bp)
