# Serverless - Dev Runbook

This runbook is the single setup/deploy reference for the `serverless-felix-dev` environment.

## 1. Prerequisites

- `gcloud` installed and authenticated
- `node` + `npm` installed
- Access to project: `serverless-felix-dev`
- Discord app credentials available:
  - public key
  - client id
  - client secret
- Firebase CLI is not required globally (we use `npx firebase-tools`)

## 2. Set Environment Variables

```bash
export ENV=dev
export PROJECT_ID=serverless-felix-dev
export REGION=europe-west1

export DISCORD_PUBLIC_KEY="<your_discord_public_key>"
export DISCORD_CLIENT_ID="<your_discord_client_id>"
export DISCORD_CLIENT_SECRET="<your_discord_client_secret>"
export DISCORD_ALLOWED_GUILD_ID="<optional_guild_id>"
export ALERT_DISCORD_WEBHOOK_URL="<discord_webhook_url>"

# Optional tuning
export RATE_LIMIT_PER_MINUTE=20
export CANVAS_CHUNK_SIZE=50
export SNAPSHOT_PIXEL_SCALE=8
export SNAPSHOT_MAX_DIM=2048
export SNAPSHOT_URL_TTL_SECONDS=86400
export SNAPSHOT_MAX_CHUNKS=400
export SESSION_TTL_HOURS=24
```

```bash
gcloud config set project "$PROJECT_ID"
```

## 3. Enable Required GCP APIs

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
  cloudtrace.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com
```

## 4. Create Core Infra

### Firestore

```bash
gcloud firestore databases create \
  --project "$PROJECT_ID" \
  --database="(default)" \
  --location="$REGION" \
  --type=firestore-native || true
```

### Buckets

```bash
export SNAPSHOT_BUCKET="serverless-felix-dev-snapshots"

gcloud storage buckets create "gs://$SNAPSHOT_BUCKET" \
  --location="$REGION" \
  --uniform-bucket-level-access || true
```

### Pub/Sub

```bash
gcloud pubsub topics create jobs --project "$PROJECT_ID" || true
gcloud pubsub topics create jobs-dlq --project "$PROJECT_ID" || true
gcloud pubsub subscriptions create jobs-dlq-sub \
  --project "$PROJECT_ID" \
  --topic jobs-dlq \
  --message-retention-duration=604800s || true
```

### Service Accounts

```bash
gcloud iam service-accounts create api-gateway-invoker \
  --project "$PROJECT_ID" \
  --display-name="API Gateway Invoker" || true

gcloud iam service-accounts create proxy-sa \
  --project "$PROJECT_ID" \
  --display-name="Proxy Functions SA" || true

gcloud iam service-accounts create worker-sa \
  --project "$PROJECT_ID" \
  --display-name="Worker Functions SA" || true
```

## 5. IAM

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:proxy-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:proxy-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:proxy-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud storage buckets add-iam-policy-binding "gs://$SNAPSHOT_BUCKET" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

Needed for Firebase custom token signing in `workerOAuth`:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --member="serviceAccount:worker-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

## 6. Secrets

Create secrets:

```bash
for SECRET in \
  discord_public_key \
  discord_client_id \
  discord_client_secret \
  oauth_redirect_uri
do
  gcloud secrets create "$SECRET" \
    --project "$PROJECT_ID" \
    --replication-policy=automatic || true
done
```

Add versions:

```bash
echo -n "$DISCORD_PUBLIC_KEY" | gcloud secrets versions add discord_public_key --project "$PROJECT_ID" --data-file=-
echo -n "$DISCORD_CLIENT_ID" | gcloud secrets versions add discord_client_id --project "$PROJECT_ID" --data-file=-
echo -n "$DISCORD_CLIENT_SECRET" | gcloud secrets versions add discord_client_secret --project "$PROJECT_ID" --data-file=-
```

`oauth_redirect_uri` must match the active dev gateway URL `/oauth`.
Set it after gateway creation in step 8.

## 7. Install Dependencies

```bash
npm ci
npm --prefix web ci
```

## 8. Deploy Backend + Gateway + Reliability + Monitoring

```bash
npm run deploy:dev
npm run deploy:dev:gateway
```

Get gateway hostname and set OAuth redirect secret:

```bash
export DEV_GATEWAY_HOST=$(gcloud api-gateway gateways describe serverless-felix-dev-gateway \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(defaultHostname)')

export OAUTH_REDIRECT_URI="https://${DEV_GATEWAY_HOST}/oauth"
echo -n "$OAUTH_REDIRECT_URI" | gcloud secrets versions add oauth_redirect_uri --project "$PROJECT_ID" --data-file=-
```

Redeploy OAuth components so they read latest secret value:

```bash
npm run deploy:dev:oauthProxy
npm run deploy:dev:workerOAuth
```

Apply reliability + TTL + monitoring:

```bash
npm run deploy:dev:reliability
npm run deploy:dev:ttl
npm run deploy:dev:monitoring
ALERT_DISCORD_WEBHOOK_URL="$ALERT_DISCORD_WEBHOOK_URL" npm run deploy:dev:alerts
```

## 9. Deploy Web

The web app defaults to dev values if `VITE_*` is not set.

```bash
export VITE_API_GATEWAY_URL="https://${DEV_GATEWAY_HOST}"
export VITE_FIREBASE_PROJECT_ID="serverless-felix-dev"
export VITE_FIREBASE_AUTH_DOMAIN="serverless-felix-dev.firebaseapp.com"
export VITE_FIREBASE_STORAGE_BUCKET="serverless-felix-dev.firebasestorage.app"
export VITE_FIREBASE_MESSAGING_SENDER_ID="<dev_sender_id>"
export VITE_FIREBASE_APP_ID="<dev_app_id>"
export VITE_FIREBASE_API_KEY="<dev_web_api_key>"

npm --prefix web run build
npx --yes firebase-tools deploy \
  --project serverless-felix-dev \
  --only firestore:rules,firestore:indexes,hosting \
  --config web/firebase.json \
  --non-interactive
```

## 10. Discord Finalization

- In Discord Developer Portal:
  - Interactions endpoint = `https://${DEV_GATEWAY_HOST}/discord`
  - OAuth redirect URI includes `https://${DEV_GATEWAY_HOST}/oauth`

- Register slash commands:

```bash
DISCORD_APP_ID="<app_id>" DISCORD_BOT_TOKEN="<bot_token>" DISCORD_GUILD_ID="<guild_id>" npm run discord:commands
```

## 11. Verification Checklist

```bash
gcloud functions list --v2 --regions="$REGION" --project="$PROJECT_ID"
gcloud api-gateway gateways list --location="$REGION" --project="$PROJECT_ID"
gcloud pubsub subscriptions list --project="$PROJECT_ID"
gcloud monitoring dashboards list --project "$PROJECT_ID"
gcloud monitoring policies list --project "$PROJECT_ID"
```
