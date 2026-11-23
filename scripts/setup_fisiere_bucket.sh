#!/usr/bin/env bash
# Creează bucket-ul pentru documentele clienților (fisiere.py) și acordă accesul funcției.
# NU se rulează automat: cere un cont gcloud cu drepturi pe proiect. Rulați-l o dată per proiect.
#
#   PROJECT_ID=samwera-board-eu ./scripts/setup_fisiere_bucket.sh
#
# Apoi: FISIERE_BUCKET=<numele afișat la final> în .env.<proiect> și deploy-ul funcțiilor (vezi docs/plan-documente-client.md).
# Variabile opționale: LOCATION (implicit europe-west3), BUCKET, FUNCTION_SA.
set -euo pipefail

: "${PROJECT_ID:?setați PROJECT_ID}"
LOCATION="${LOCATION:-europe-west3}"               # aceeași regiune UE ca baza de date și funcția
BUCKET="${BUCKET:-${PROJECT_ID}-fisiere}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-api-runtime}"
FUNCTION_SA="${FUNCTION_SA:-${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com}"

echo "Proiect: $PROJECT_ID | bucket: gs://$BUCKET | locație: $LOCATION | cont funcție: $FUNCTION_SA"

# Acces uniform (doar IAM, fără ACL pe obiecte) și acces public interzis definitiv. Conținutul e oricum criptat de
# aplicație cu cheia cabinetului; bucket-ul adaugă criptarea standard Google la stocare.
# Ștergerea temporară (soft delete) rămâne implicită, 7 zile: plasa de siguranță la o ștergere din greșeală,
# în limita de 30 de zile din DPA.
gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT_ID" --location "$LOCATION" \
       --default-storage-class STANDARD --uniform-bucket-level-access --public-access-prevention

# Doar contul funcției, doar pe acest bucket: citire, scriere și ștergere de obiecte (fără administrarea bucket-ului).
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --project "$PROJECT_ID" \
  --member "serviceAccount:$FUNCTION_SA" --role roles/storage.objectUser >/dev/null

echo
echo "Gata. Adăugați în .env.$PROJECT_ID:"
echo "  FISIERE_BUCKET=$BUCKET"
