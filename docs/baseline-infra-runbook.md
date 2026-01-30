# Baseline Infra Runbook (Env-Agnostic)

## 0) Prereqs
- `gcloud` installed and authenticated.
- You have Owner or sufficient IAM permissions.

```bash
export ENV="dev" # or "prd"
export PROJECT_ID="serverless-felix-$ENV"
export REGION="europe-west1"

gcloud config set project "$PROJECT_ID"
```

## 1) Enable required APIs
```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  pubsub.googleapis.com \
  apigateway.googleapis.com \
  servicemanagement.googleapis.com \
  servicecontrol.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  cloudtrace.googleapis.com
```

## 2) Create Firestore database
```bash
# Skip if already created

gcloud firestore databases create \
  --database="(default)" \
  --location="$REGION" \
  --type=firestore-native
```

## 3) Create GCS buckets
```bash
export SNAPSHOT_BUCKET="serverless-felix-$ENV-snapshots"
export EXPORT_BUCKET="serverless-felix-$ENV-exports"

# Snapshots bucket

gcloud storage buckets create "gs://$SNAPSHOT_BUCKET" \
  --location="$REGION" \
  --uniform-bucket-level-access

# Optional exports bucket

gcloud storage buckets create "gs://$EXPORT_BUCKET" \
  --location="$REGION" \
  --uniform-bucket-level-access
```

Lifecycle rule:
```bash
cat > /tmp/gcs-lifecycle.json <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 90}
    }
  ]
}
JSON

gcloud storage buckets update "gs://$SNAPSHOT_BUCKET" --lifecycle-file=/tmp/gcs-lifecycle.json
```

## 4) Create Pub/Sub topic
```bash
gcloud pubsub topics create jobs
```

Optional DLQ:
```bash
# gcloud pubsub topics create jobs-dlq
# gcloud pubsub subscriptions create jobs-dlq-sub --topic=jobs-dlq
```

## 5) Create service accounts
```bash
gcloud iam service-accounts create api-gateway-invoker \
  --display-name="API Gateway Invoker"

gcloud iam service-accounts create proxy-sa \
  --display-name="Proxy Functions SA"

gcloud iam service-accounts create worker-sa \
  --display-name="Worker Functions SA"
```

## 6) IAM bindings
```bash
# Proxy SA: publish jobs + read secrets

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:proxy-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:proxy-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Worker SA: consume jobs + Firestore RW + GCS + secrets

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# GCS bucket access for snapshots

gcloud storage buckets add-iam-policy-binding "gs://$SNAPSHOT_BUCKET" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

## 7) Create secrets
```bash
for SECRET in \
  discord_public_key \
  discord_app_id \
  discord_bot_token \
  discord_client_id \
  discord_client_secret \
  oauth_redirect_uri \
  firebase_service_account
  do
    gcloud secrets create "$SECRET" --replication-policy="automatic" || true
  done
```

## 8) Deploy API Gateway + functions
```bash
npm run deploy:$ENV
npm run deploy:$ENV:gateway
```

## 9) Lock down invocation (gateway only)
After deploy, ensure only the API Gateway invoker SA can invoke proxies:
```bash
export INVOKER_SA="api-gateway-invoker@$PROJECT_ID.iam.gserviceaccount.com"

for fn in discordProxy webProxy oauthProxy; do
  gcloud functions add-invoker-policy-binding "$fn" \
    --gen2 \
    --region "$REGION" \
    --member "serviceAccount:$INVOKER_SA"
  done
```

Verify no public invoker:
```bash
gcloud functions get-iam-policy discordProxy --gen2 --region "$REGION"
```
