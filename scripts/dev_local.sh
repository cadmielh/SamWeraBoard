#!/usr/bin/env bash
# Dezvoltare locală cu emulatoare Firebase (Auth + Firestore). Trei terminale, din rădăcina repo-ului:
#   1)  ./scripts/dev_local.sh emulators     # Auth + Firestore emulate; interfață la http://127.0.0.1:4000
#   2)  ./scripts/dev_local.sh api           # API-ul Flask pe :5001 (pe macOS, :5000 e ocupat de AirPlay) (vault cu cheia locală din .env.local)
#   3)  cd frontend && npm run dev:emu       # aplicația pe http://localhost:5173
#
# Varianta cu login Google REAL (proiectul samwera-board-eu) și Firestore emulat local:
#   1)  ./scripts/dev_local.sh emulators-google
#   2)  ./scripts/dev_local.sh api-google
#   3)  cd frontend && npm run dev:google
# Nicio cerere nu ajunge în cloud (cu excepția OCR-ului Azure, dacă scanezi un buletin, cu cheia din .env.local).
set -euo pipefail
cd "$(dirname "$0")/.."

ensure_java() {
  # Emulatorul Firestore cere Java. Pe macOS `java` poate exista ca stub fără JRE: îl testăm real.
  if ! java -version >/dev/null 2>&1; then
    JRE_DIR="$HOME/.local/jre"
    if [ ! -x "$JRE_DIR/bin/java" ]; then
      echo "Java lipsește. Descarc un JRE portabil (Temurin 21) în $JRE_DIR (fără drepturi de administrator)..."
      A=$([ "$(uname -m)" = arm64 ] && echo aarch64 || echo x64)
      TMP="$(mktemp -d)"
      curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/mac/$A/jre/hotspot/normal/eclipse" | tar xz -C "$TMP" \
        && mkdir -p "$(dirname "$JRE_DIR")" && mv "$TMP"/jdk-*/Contents/Home "$JRE_DIR" \
        || { rm -rf "$TMP" "$JRE_DIR"; echo "Descărcarea a eșuat; instalați Java 21 (adoptium.net) și reîncercați."; exit 1; }
      rm -rf "$TMP"
    fi
    export JAVA_HOME="$JRE_DIR"; export PATH="$JAVA_HOME/bin:$PATH"
  fi
}

case "${1:-}" in
  emulators-google)
    ensure_java
    mkdir -p .emulator-data-google
    exec firebase emulators:start --only firestore --project samwera-board-eu \
      --import .emulator-data-google --export-on-exit .emulator-data-google
    ;;
  api-google)
    # Auth REAL: token-urile Firebase se verifică local doar cu certificatele publice Google
    # (vezi authz._dev_verify_only); Firestore = emulatorul. Nu se folosește nicio cheie de cloud.
    export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
    export GCLOUD_PROJECT=samwera-board-eu
    export AUTH_DEV_VERIFY_ONLY=1
    export GOOGLE_APPLICATION_CREDENTIALS=/nonexistent/none.json
    exec .venv/bin/python app.py
    ;;
  emulators)
    ensure_java
    mkdir -p .emulator-data
    exec firebase emulators:start --only auth,firestore --project demo-samwera \
      --import .emulator-data --export-on-exit .emulator-data
    ;;
  api)
    # Emulatoare, nu cloud; nu încărcăm cheia reală de service account din repo.
    export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
    export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
    export GCLOUD_PROJECT=demo-samwera
    export GOOGLE_APPLICATION_CREDENTIALS=/nonexistent/none.json
    exec .venv/bin/python app.py
    ;;
  *)
    sed -n 2,8p "$0"; exit 1 ;;
esac
