# Serverless Felix

Canvas pixel collaboratif inspiré de r/place, avec commandes Discord et une UI web.

Fournisseur cloud : GCP uniquement.
Style d'architecture : entièrement serverless, piloté par événements, asynchrone.

## 1. Périmètre

Ce projet implémente :

- Interactions bot Discord via API Gateway
- Application web avec actions de dessin authentifiées
- Traitement asynchrone basé sur Pub/Sub
- Persistance Firestore avec contrôle de concurrence
- Génération de snapshots dans Cloud Storage
- Monitoring, alertes, logs structurés, tracing

## 2. Couverture des exigences

| Sujet / Recommandation | Implémentation |
|---|---|
| Endpoints publics via API Gateway | `/discord`, `/web/*`, `/oauth` sur API Gateway |
| Proxy puis file (async d'abord) | `discordProxy`, `webProxy`, `oauthProxy` valident/ack/enqueue uniquement |
| SRP des workers | Workers dédiés par responsabilité (`workerDraw`, `workerSnapshot`, etc.) |
| Architecture event-driven | Topics Pub/Sub + triggers Eventarc pour les workers |
| Commandes Discord | `draw`, `canvas`, `session`, `snapshot` |
| Contrôles admin de session | `start`, `pause`, `reset` avec vérification rôle admin |
| Flux snapshot | Le worker snapshot génère le PNG, upload vers bucket, retourne une URL signée à Discord |
| Stockage persistant | Firestore pour l'état canvas/session, Cloud Storage pour les snapshots |
| Rate limit par utilisateur | Compteur transactionnel Firestore (`RATE_LIMIT_PER_MINUTE`) |
| Métadonnées pixel | `authorId`, `authorUsername`, `updatedAt` stockées par pixel |
| Authentification OAuth | Discord OAuth2 + échange backend + cookie de session HttpOnly |
| Canvas web quasi temps réel | Listeners Firestore sur docs chunk, avec fallback polling |
| Sécurité | Service accounts least-privilege, secrets dans Secret Manager, pas d'invoker Cloud Run public |
| Monitoring et alertes | Dashboard Cloud Monitoring + policies (5xx, backlog, âge message, DLQ) |
| Logs et tracing | Logs JSON structurés + IDs correlation/request/trace + spans OpenTelemetry |
| Fiabilité | DLQ + tentatives de livraison + policy de retry + nettoyage TTL |

## 3. Architecture

![Schéma d'architecture](architecture.png)

## 4. Composants

### 4.1 Proxies (points d'entrée HTTP uniquement)

- `discordProxy`: vérifie la signature Discord, valide le payload de slash command, enfile un job, puis répond immédiatement.
- `webProxy`: valide le cookie de session, valide le payload de requête, enfile les jobs draw/read/token.
- `oauthProxy`: démarre la redirection OAuth et enfile le job d'échange de code après validation du callback.

### 4.2 Workers

- `workerDraw`: idempotence, vérification état session, vérification rate limit, transaction d'écriture pixel.
- `workerDiscord`: gère les actions admin de session (`start`, `pause`, `reset`).
- `workerSnapshot`: charge la zone active du canvas, génère un PNG, upload vers bucket, écrit les métadonnées du dernier snapshot.
- `workerDiscordCanvas`: renvoie le dernier snapshot vers Discord.
- `workerOAuth`: échange le code OAuth Discord, récupère l'utilisateur, crée un token custom Firebase, stocke la session.
- `workerWebRead`: résout les données de fenêtre canvas de manière asynchrone.
- `workerWebActiveArea`: résout la zone active de manière asynchrone.
- `workerWebRealtimeToken`: crée un token custom Firebase de manière asynchrone.
- `workerDiscordFollowup`: publisher générique de follow-up Discord.

### 4.3 Stockages de données

- Firestore:
  - `chunks/{chunkId}/pixels/{pixelId}`: pixels du canvas
  - `activeArea/current`: limites actuelles du canvas actif
  - `config/session`: état du round (`running` / `paused`)
  - `sessions/{state}`: sessions OAuth
  - `requestResponses/{requestId}`: enregistrements async request-response pour les lectures web
  - `idempotency/{eventId}`: protection contre les doublons
  - `rate/{userId}/minutes/{yyyyMMddHHmm}`: compteurs de draw par minute et par utilisateur
- Cloud Storage:
  - `gs://serverless-felix-dev-snapshots/snapshots/...` fichiers snapshot

## 5. Pourquoi des listeners Firestore directs pour le temps réel

Les écritures web restent appliquées via API Gateway et le pipeline backend asynchrone.

Les lectures temps réel passent en listeners Firestore directs parce que :

- latence plus faible qu'un polling API
- charge backend et coût inférieurs pour les mises à jour fréquentes
- mises à jour incrémentales natives (flux de changements de documents), pas de refetch complet de fenêtre à chaque fois
- sécurité préservée : les règles Firestore exigent des utilisateurs authentifiés et interdisent les écritures client

## 6. Modèle de sécurité

- API Gateway est le seul point d'entrée API public.
- L'invoker Cloud Run est restreint :
  - proxies invocables par le service account `api-gateway-invoker`
  - workers invocables par les service agents Eventarc/PubSub + service account dédié workers
- Un service account par groupe de fonctions, pas une identité runtime partagée.
- Secrets stockés dans Secret Manager (`discord_public_key`, `discord_client_id`, `discord_client_secret`, `oauth_redirect_uri`).
- Validation de signature des requêtes Discord dans `discordProxy`.
- Validation du cookie `state` OAuth dans `oauthProxy`.
- Cookie de session web en `HttpOnly`, `Secure`, `SameSite=None`.
- Règles Firestore client en lecture seule pour les utilisateurs authentifiés sur les docs canvas, sans permission d'écriture client.
- Liens snapshot en URL signées avec TTL (pas d'objets publics).

## 7. Observabilité et fiabilité

- Logs JSON structures avec :
  - `correlationId`
  - `requestId`
  - `traceId`
- Spans OpenTelemetry exportés vers Cloud Trace.
- Le dashboard inclut :
  - taux de requêtes / erreurs / latence Cloud Run
  - backlog Pub/Sub
  - âge du plus ancien message non-acquitté
- Alertes :
  - pic de 5xx Cloud Run
  - profondeur de backlog Pub/Sub
  - âge du plus ancien message non-acquitté Pub/Sub
  - DLQ non vide
- DLQ :
  - topic : `jobs-dlq`
  - subscriptions worker configurées avec dead-letter policy
- TTL activé sur :
  - `sessions.expiresAt`
  - `idempotency.createdAt`
  - `requestResponses.expiresAt`

## 8. Structure du dépôt

```text
src/functions/proxies/      proxies HTTP
src/functions/workers/      workers Pub/Sub
src/functions/shared/       libs partagées (queue, tracing, validation, observabilité)
gateway/                    template OpenAPI pour API Gateway
monitoring/                 templates dashboard et alert policies
scripts/                    scripts d'automatisation deploy/infra
web/                        frontend (Vite + Firebase client SDK)
runbook.md                  runbook opérationnel détaillé
```

## 9. Prérequis

- Node.js + npm
- gcloud CLI authentifié
- Firebase CLI (via `npx firebase-tools` suffit)
- Accès au projet GCP (`serverless-felix-dev`)
- Credentials application Discord

## 10. Setup et déploiement

### 10.1 Installation

```bash
npm ci
npm --prefix web ci
```

### 10.2 Bootstrap initial (nouveau projet GCP)

Définir projet et région :

```bash
export PROJECT_ID=serverless-felix-dev
export REGION=europe-west1
gcloud config set project "$PROJECT_ID"
```

Activer les APIs requises :

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

Créer Firestore et le bucket snapshot :

```bash
gcloud firestore databases create \
  --project "$PROJECT_ID" \
  --database="(default)" \
  --location="$REGION" \
  --type=firestore-native || true

gcloud storage buckets create "gs://serverless-felix-dev-snapshots" \
  --location="$REGION" \
  --uniform-bucket-level-access || true
```

Créer les secrets (valeurs à fournir depuis la config de votre app Discord) :

```bash
for SECRET in discord_public_key discord_client_id discord_client_secret oauth_redirect_uri; do
  gcloud secrets create "$SECRET" --project "$PROJECT_ID" --replication-policy=automatic || true
done
```

Ajouter les versions de secrets :

```bash
echo -n "$DISCORD_PUBLIC_KEY" | gcloud secrets versions add discord_public_key --project "$PROJECT_ID" --data-file=-
echo -n "$DISCORD_CLIENT_ID" | gcloud secrets versions add discord_client_id --project "$PROJECT_ID" --data-file=-
echo -n "$DISCORD_CLIENT_SECRET" | gcloud secrets versions add discord_client_secret --project "$PROJECT_ID" --data-file=-
```

### 10.3 Déployer le backend et la plateforme

```bash
npm run deploy:dev
npm run deploy:dev:gateway
npm run deploy:dev:reliability
npm run deploy:dev:ttl
npm run deploy:dev:monitoring
npm run deploy:dev:alerts
```

Définir le secret de redirection OAuth vers l'URL active de la gateway :

```bash
export DEV_GATEWAY_HOST=$(gcloud api-gateway gateways describe serverless-felix-dev-gateway \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(defaultHostname)')

export OAUTH_REDIRECT_URI="https://${DEV_GATEWAY_HOST}/oauth"
echo -n "$OAUTH_REDIRECT_URI" | gcloud secrets versions add oauth_redirect_uri \
  --project "$PROJECT_ID" --data-file=-

npm run deploy:dev:oauthProxy
npm run deploy:dev:workerOAuth
```

Créer une API key pour les routes protégées `/web/*` :

```bash
export GATEWAY_MANAGED_SERVICE=$(gcloud api-gateway apis describe serverless-felix-dev \
  --project "$PROJECT_ID" \
  --format='value(managedService)')

export GATEWAY_API_KEY=$(gcloud services api-keys create \
  --project "$PROJECT_ID" \
  --display-name="serverless-felix-web-dev" \
  --api-target="service=${GATEWAY_MANAGED_SERVICE}" \
  --allowed-referrers="https://serverless-felix-dev.web.app/*,http://localhost:*/*" \
  --format='value(keyString)')
```

### 10.4 Déployer le web

```bash
export VITE_API_GATEWAY_URL="https://${DEV_GATEWAY_HOST}"
export VITE_API_GATEWAY_KEY="$GATEWAY_API_KEY"

npm --prefix web run build
npx --yes firebase-tools deploy \
  --project serverless-felix-dev \
  --only firestore:rules,firestore:indexes,hosting \
  --config web/firebase.json \
  --non-interactive
```

### 10.5 Enregistrer les slash commands Discord

```bash
DISCORD_APP_ID="<app_id>" \
DISCORD_BOT_TOKEN="<bot_token>" \
DISCORD_GUILD_ID="<guild_id>" \
npm run discord:commands
```

Définir les valeurs dans le portail Discord :

- Endpoint interactions : `https://${DEV_GATEWAY_HOST}/discord`
- URI de redirection OAuth : `https://${DEV_GATEWAY_HOST}/oauth`

## 11. Configuration runtime

Variables cœur :

- `DISCORD_PUBLIC_KEY`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_ALLOWED_GUILD_ID` (optionnel)
- `ALERT_DISCORD_WEBHOOK_URL`

Réglages opérationnels :

- `RATE_LIMIT_PER_MINUTE` (défaut 20)
- `CANVAS_CHUNK_SIZE` (défaut 50)
- `SNAPSHOT_PIXEL_SCALE` (défaut 8)
- `SNAPSHOT_MAX_DIM` (défaut 2048)
- `SNAPSHOT_URL_TTL_SECONDS` (défaut 86400)
- `SNAPSHOT_MAX_CHUNKS` (défaut 400)
- `SESSION_TTL_HOURS` (défaut 24)
- `REQUEST_RESPONSE_TTL_SECONDS` (défaut 900)

Variables build web :

- `VITE_API_GATEWAY_URL`
- `VITE_API_GATEWAY_KEY`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`

## 12. Checklist de vérification

```bash
gcloud functions list --v2 --regions=europe-west1 --project=serverless-felix-dev
gcloud api-gateway gateways list --location=europe-west1 --project=serverless-felix-dev
gcloud pubsub topics list --project=serverless-felix-dev
gcloud pubsub subscriptions list --project=serverless-felix-dev
gcloud monitoring dashboards list --project=serverless-felix-dev
gcloud monitoring policies list --project=serverless-felix-dev
```

Checks fonctionnels :

1. Discord `/draw` met à jour le canvas.
2. Discord `/session pause|start|reset` fonctionne uniquement pour le rôle admin.
3. Discord `/snapshot` poste l'image/l'URL signée.
4. Le login web via Discord fonctionne.
5. Le draw web fonctionne et les métadonnées pixel sont visibles.
6. Les mises à jour temps réel se propagent entre clients.
