#!/usr/bin/env bash
# Alerte Cloud Monitoring pentru API (vezi docs/procedura-incident.md, secțiunea 4). Se rulează în Cloud Shell:
#   bash setup_alerts.sh adresa@exemplu.ro
# Poate fi rulat din nou: alertele și canalul de e-mail existente nu se dublează.
set -euo pipefail

EMAIL="${1:?Folosire: bash setup_alerts.sh adresa@exemplu.ro}"
PROJECT=samwera-board-eu
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

CHANNEL="$(gcloud beta monitoring channels list --project "$PROJECT" \
  --filter="type=\"email\" AND labels.email_address=\"$EMAIL\"" --format='value(name)' | head -1)"
if [ -z "$CHANNEL" ]; then
  CHANNEL="$(gcloud beta monitoring channels create --project "$PROJECT" --display-name="Cabinio alerte" \
    --type=email --channel-labels=email_address="$EMAIL" --format='value(name)')"
fi

# Nume, condiția pe metricile Cloud Run, pragul pe 5 minute
create_policy() {
  local name="$1" metric_filter="$2" threshold="$3"
  if gcloud alpha monitoring policies list --project "$PROJECT" --filter="displayName=\"$name\"" --format='value(name)' | grep -q .; then
    echo "Există deja: $name"
    return
  fi
  cat > "$TMP" <<EOF
{
  "displayName": "$name",
  "combiner": "OR",
  "notificationChannels": ["$CHANNEL"],
  "conditions": [{
    "displayName": "$name",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"api\" AND metric.type=\"run.googleapis.com/request_count\" AND $metric_filter",
      "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM"}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": $threshold,
      "duration": "0s"
    }
  }]
}
EOF
  gcloud alpha monitoring policies create --project "$PROJECT" --policy-from-file="$TMP" --format='value(displayName)'
}

create_policy "API erori 5xx" 'metric.labels.response_code_class=\"5xx\"' 10
create_policy "API autentificari respinse" 'metric.labels.response_code=\"401\"' 50
create_policy "API cereri limitate" 'metric.labels.response_code=\"429\"' 50

echo "Gata. Alertele ajung la $EMAIL."
