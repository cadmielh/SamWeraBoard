#!/usr/bin/env bash
# Dă `roles/run.invoker` contului de runtime pe toate serviciile `alerte-*` (triggerele Firestore din main.py).
# Firebase CLI nu-l dă singur unui cont de serviciu personalizat, iar fără el Eventarc primește 403 la livrare
# (15 nov 2026 la primul deploy, 26 nov 2026 la `alerte-cerere`). Rulează automat după deploy-ul funcțiilor
# (postdeploy în firebase.json); se poate rula și manual:
#   bash scripts/acorda_invoker_alerte.sh [proiect]
# Poate fi rulat din nou: serviciile care au deja rolul sunt sărite.
set -euo pipefail

PROJECT="${1:-${GCLOUD_PROJECT:-samwera-board-eu}}"
REGION="${ALERTE_TRIGGER_REGION:-europe-west3}"
MEMBER="serviceAccount:${RUNTIME_SERVICE_ACCOUNT:-api-runtime@${PROJECT}.iam.gserviceaccount.com}"
GCLOUD="$(command -v gcloud || echo "$HOME/google-cloud-sdk/bin/gcloud")"

for svc in $("$GCLOUD" run services list --project "$PROJECT" --region "$REGION" --format='value(metadata.name)' | grep '^alerte-' || true); do
  if "$GCLOUD" run services get-iam-policy "$svc" --project "$PROJECT" --region "$REGION" \
      --flatten='bindings[].members' --filter="bindings.role=roles/run.invoker AND bindings.members=$MEMBER" \
      --format='value(bindings.members)' | grep -q .; then
    echo "OK: $svc"
  else
    "$GCLOUD" run services add-iam-policy-binding "$svc" --project "$PROJECT" --region "$REGION" \
      --member="$MEMBER" --role=roles/run.invoker --format='none'
    echo "Acordat run.invoker: $svc"
  fi
done
