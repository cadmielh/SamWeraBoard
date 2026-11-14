#!/usr/bin/env bash
# Rulează toate testele care au nevoie de emulatoare: backend (pytest), reguli Firestore, E2E cu Auth reală.
# Necesită Java (emulatorul Firestore) și dependențele din .venv + tests/rules/node_modules.
set -euo pipefail
cd "$(dirname "$0")/.."
# firebase.test.json: alte porturi (8180/9199) decât emulatorul de dezvoltare, ca să poată rula în paralel cu el.
firebase emulators:exec --config firebase.test.json --only auth,firestore --project demo-samwera \
  ".venv/bin/python -m pytest tests -q -W ignore && node --test tests/rules/firestore.rules.test.js"
(cd frontend && npm test --silent)
