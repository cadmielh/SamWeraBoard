#!/usr/bin/env bash
# Migrarea datelor din proiectul vechi în cel nou, pentru Cloud Shell (unde ai acces la ambele proiecte).
# Se rulează din folderul în care ai dezarhivat migrare.zip, pe rând:
#   bash scripts/cloudshell_migrate.sh setup     # dependențe + drept temporar de criptare pentru contul tău
#   bash scripts/cloudshell_migrate.sh dry       # doar numără, nu scrie nimic
#   bash scripts/cloudshell_migrate.sh pilot     # migrează workspace-ul mic de test (validează cheia KMS reală)
#   bash scripts/cloudshell_migrate.sh all       # migrează totul (idempotent; poate fi rulat de mai multe ori)
#   bash scripts/cloudshell_migrate.sh verify    # compară sursa cu ținta
#   bash scripts/cloudshell_migrate.sh cleanup   # retrage dreptul temporar de criptare (OBLIGATORIU la final)
# Proiectul vechi este doar CITIT: nu se modifică nimic acolo.
set -euo pipefail

SOURCE="samwera-board"
TARGET="samwera-board-eu"
PILOT="5p6z6gX7aAAY0E4sxFAE"   # workspace-ul tău (admin): 5 clienți, 12 persoane cu CNP
KEY_ARGS=(--keyring samwera --location europe-west3 --project "$TARGET")
export VAULT_KMS_KEY="projects/$TARGET/locations/europe-west3/keyRings/samwera/cryptoKeys/vault-kek"
ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
run() { python3 scripts/migrate_project.py --source "$SOURCE" --target "$TARGET" "$@"; }

case "${1:-}" in
  setup)
    gcloud config set project "$TARGET" >/dev/null
    pip install --user -q flask firebase-admin google-cloud-firestore google-cloud-kms cryptography
    # Drept TEMPORAR: contul tău criptează cu cheia vault-ului cât durează migrarea; se retrage cu `cleanup`.
    gcloud kms keys add-iam-policy-binding vault-kek "${KEY_ARGS[@]}" \
      --member "user:$ACCOUNT" --role roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null
    echo "Gata: dependențe instalate, drept temporar acordat lui $ACCOUNT. Urmează: dry"
    ;;
  dry)     run --dry-run ;;
  pilot)   run --workspace "$PILOT" ;;
  all)     run ;;
  verify)  run --verify-only ;;
  cleanup)
    gcloud kms keys remove-iam-policy-binding vault-kek "${KEY_ARGS[@]}" \
      --member "user:$ACCOUNT" --role roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null
    echo "Dreptul temporar a fost retras. Pe cheie a rămas doar contul funcției (api-runtime)."
    gcloud kms keys get-iam-policy vault-kek "${KEY_ARGS[@]}"
    ;;
  *) sed -n 2,12p "$0"; exit 1 ;;
esac
