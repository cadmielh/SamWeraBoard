#!/usr/bin/env bash
# Rulează toate testele care au nevoie de emulatoare: backend (pytest), reguli Firestore, E2E cu Auth reală.
# Necesită Java (emulatorul Firestore) și dependențele din .venv + tests/rules/node_modules.
set -euo pipefail
cd "$(dirname "$0")/.."
firebase emulators:exec --only auth,firestore --project demo-samwera \
  ".venv/bin/python -m pytest tests -q -W ignore && node --test tests/rules/firestore.rules.test.js"
(cd frontend && npm test --silent)
