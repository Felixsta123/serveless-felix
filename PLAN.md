## Serverless Plan

### 1) Product definition

Pixel canvas. Web shows live state (Firestore reads). All writes server-side (API Gateway -> queue -> worker). Discord can draw + request snapshot.

---

## 2) Hard constraints

- GCP only: API Gateway, Cloud Functions, Pub/Sub, Firestore, GCS, Secret Manager
- Firebase: Hosting + Auth
- No Cloud Run
- Web OAuth: Discord -> Firebase custom token
- Strict 20/min per user
- Append-only event log
- Snapshot uses active area

---

## 3) Minimal architecture

Clients

- Web SPA (Firebase Hosting)
- Discord bot (slash commands)

Ingress (single)

- API Gateway

Compute

- Cloud Functions (HTTP proxies)
- Cloud Functions (Pub/Sub workers)

Queue

- Pub/Sub topic: `jobs`

Storage

- Firestore: `canvas state`, `events`, `activeArea`, `rate`, `config`, `idempotency`
- GCS: `snapshots`, `event-archives`

Secrets/ops

- Secret Manager
- Logging/Monitoring

---

## 4) Components

### HTTP Cloud Functions (3)

1. `discordProxy` `/discord/interactions`
- verify signature
- enforce guildId
- publish job
- immediate ack

1. `webProxy` `/api/*`
- verify Firebase ID token
- publish job
- return 202

1. `oauthProxy` `/auth/discord/callback`
- exchange code
- fetch Discord user
- mint Firebase custom token
- redirect to SPA

### Pub/Sub (1 topic)

- `jobs` with attribute `type=draw|snapshot`

### Worker Cloud Functions (2)

1. `workerDraw` (Pub/Sub)
- idempotency
- strict 20/min
- write pixel state
- write event log
- update active area
- Discord follow-up if source=discord

1. `workerSnapshot` (Pub/Sub)
- read active area
- render image
- upload GCS
- Discord follow-up with URL

---

## 5) Firestore schema

Config

- `config/discord` `{allowedGuildId, adminRoleId}`

Canvas state (web reads)

- `chunks/{chunkId}/pixels/{pixelId}` `{x,y,color,updatedAt,authorId}`

Active area

- `activeArea/current` `{minX,minY,maxX,maxY,updatedAt}`

Event log (append-only)

- `eventsByDay/{YYYYMMDD}/items/{eventId}` `{ts,source,userId,guildId,x,y,newColor,oldColor?}`

Rate limit (strict 20/min)

- `rate/{userId}/minutes/{YYYYMMDDHHmm}` `{count}`

Idempotency

- `idempotency/{eventId}` `{createdAt}` with TTL

---

## 6) Security

Firestore rules

- Allow read: `chunks/**`, `activeArea/**` for authenticated user    
- Deny all client writes everywhere

IAM

- Proxies: publish Pub/Sub, read secrets
- Workers: subscribe Pub/Sub, RW Firestore, (snapshot worker) write GCS, read secrets

---

## 7) Execution plan

### Step 1: Infrastructure baseline

- Firestore, GCS buckets, Pub/Sub `jobs`
- Secret Manager entries
- Service accounts + least privilege
- API Gateway routes to proxies

### Step 2: Auth

- `oauthProxy` mint Firebase custom token
- SPA login flow + Firebase Auth session

### Step 3: Web live view

- SPA subscribes to Firestore `chunks/**` for viewport
- Subscribe to `activeArea/current`

### Step 4: Write pipeline

- `webProxy` -> Pub/Sub
- `workerDraw`: idempotency + rate + write pixel + event + activeArea
- SPA sees result via Firestore

### Step 5: Discord draw

- `discordProxy` signature + guild restriction
- Publish draw job with interaction metadata
- `workerDraw` sends follow-up message

### Step 6: Snapshot

- `workerSnapshot` render active area -> GCS -> Discord follow-up

### Step 7: Retention (only after features work)

- Firestore TTL on idempotency + events
- GCS lifecycle on snapshots + archives
- Optional daily archive export job

---

## 8) Retention defaults

- Idempotency TTL: 7 days
- Events TTL: 30 days (start smaller to avoid cost surprise)
- Snapshots lifecycle: delete after 90 days