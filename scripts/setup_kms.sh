#!/usr/bin/env bash
# Creează cheia Cloud KMS (KEK) pentru vault-ul de date sensibile și acordă accesul funcției.
# NU se rulează automat: cere un cont gcloud cu drepturi pe proiect. Rulați-l o dată per proiect (staging, apoi prod).
#
#   PROJECT_ID=samwera-eu ./scripts/setup_kms.sh
#
# Variabile opționale: LOCATION (implicit europe-west3), KEYRING, KEY, FUNCTION_SA.
set -euo pipefail

: "${PROJECT_ID:?setați PROJECT_ID}"
LOCATION="${LOCATION:-europe-west3}"     # regiune UE — datele nu trebuie să părăsească UE
KEYRING="${KEYRING:-samwera}"
KEY="${KEY:-vault-kek}"

# Funcția rulează cu un cont de serviciu DEDICAT, cu drepturi minime (nu cu contul implicit Compute, care are rol de Editor).
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-api-runtime}"
FUNCTION_SA="${FUNCTION_SA:-${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com}"

echo "Proiect: $PROJECT_ID | locație: $LOCATION | cont funcție: $FUNCTION_SA"

gcloud services enable cloudkms.googleapis.com --project "$PROJECT_ID"

gcloud kms keyrings describe "$KEYRING" --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud kms keyrings create "$KEYRING" --location "$LOCATION" --project "$PROJECT_ID"

NEXT_ROTATION="$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
gcloud kms keys describe "$KEY" --keyring "$KEYRING" --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud kms keys create "$KEY" --keyring "$KEYRING" --location "$LOCATION" --project "$PROJECT_ID" \
       --purpose encryption --rotation-period 90d --next-rotation-time "$NEXT_ROTATION"

gcloud iam service-accounts describe "$FUNCTION_SA" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$RUNTIME_SA_NAME" --display-name "Cabinio API runtime" --project "$PROJECT_ID"

# Drepturi minime la nivel de proiect: date Firestore, citirea conturilor Auth (verificarea tokenurilor revocate), jurnale.
for ROLE in roles/datastore.user roles/firebaseauth.viewer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${FUNCTION_SA}" --role "$ROLE" --condition=None >/dev/null
done

# Doar criptare/decriptare pe cheia vault-ului — funcția nu poate administra sau șterge cheia.
gcloud kms keys add-iam-policy-binding "$KEY" --keyring "$KEYRING" --location "$LOCATION" --project "$PROJECT_ID" \
  --member "serviceAccount:${FUNCTION_SA}" --role roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null

KEY_PATH="projects/${PROJECT_ID}/locations/${LOCATION}/keyRings/${KEYRING}/cryptoKeys/${KEY}"

# Expirarea automată (TTL) pentru istoricul de extrageri, jurnalul de audit și contoarele de limitare (câmpul `expireAt`).
gcloud firestore fields ttls update expireAt --collection-group=extractions --enable-ttl --project "$PROJECT_ID" || true
gcloud firestore fields ttls update expireAt --collection-group=auditLog --enable-ttl --project "$PROJECT_ID" || true
gcloud firestore fields ttls update expireAt --collection-group=rateLimits --enable-ttl --project "$PROJECT_ID" || true

echo
echo "Gata. Setați în .env.<id-proiect> (NU în firebase.json):"
echo "  VAULT_KMS_KEY=${KEY_PATH}"
echo "  RUNTIME_SERVICE_ACCOUNT=${FUNCTION_SA}"
