# Serverless Plan (GCP)

## 1) Goal
Build a fully serverless, event-driven multiplayer pixel canvas where users draw via Discord and a web app. All public traffic goes through API Gateway -> proxy functions -> Pub/Sub -> workers.

## 2) Hard constraints (subject)
- Serverless only (Cloud Functions, Firestore, Cloud Storage, Pub/Sub, API Gateway).
- No direct public function invocations; API Gateway is the only public entrypoint.
- All workloads are asynchronous and event-driven; proxies only enqueue and immediately ack.
- Functions follow SRP (single responsibility).
- Auth required for web API (Discord OAuth2 recommended); Discord interactions signed.
- Discord interactions must be ACKed within 3 seconds (deferred response); real work happens in workers.
- No `--allow-unauthenticated` on functions; API Gateway service account is the only invoker.

## 3) Current status (implemented vs missing)
Implemented
- API Gateway OpenAPI template with `/discord`, `/web`, `/oauth` routes.
- Deploy scripts for functions and API Gateway.
- Discord proxy verifies signature and enqueues job.
- Worker that replies to a `hello` Discord command.

Missing / stubbed
- webProxy and oauthProxy logic.
- workerDraw, workerSnapshot logic.
- Firestore schema, GCS bucket usage, rate limiting, idempotency.
- Web app + OAuth flow.
- Admin/session commands and snapshots.
- Monitoring, IAM least-privilege policies, Secret Manager usage.

## 4) Architecture (target)
Entry
- API Gateway (public)

Proxies (HTTP Cloud Functions Gen2)
- `discordProxy` -> validate signature -> enqueue job
- `webProxy` -> validate auth -> enqueue job
- `oauthProxy` -> validate callback + state -> enqueue `oauth.exchange` -> immediate redirect/poll page

Event bus
- Pub/Sub topic `jobs` (initially single topic with attributes like `kind=draw|snapshot|session|discord`)

Workers (Pub/Sub Cloud Functions Gen2)
- `workerDraw` -> rate limit + idempotency -> write pixel + event log + active area
- `workerSnapshot` -> render canvas image -> upload to GCS -> notify Discord
- `workerDiscord` -> handles Discord follow-ups and admin/session commands
- `workerOAuth` -> exchange Discord code -> mint Firebase custom token -> store session token for SPA

Storage
- Firestore for canvas state, events, rate limit, idempotency, config
- Cloud Storage bucket for snapshots and static exports

Security/ops
- Secret Manager for Discord secrets, OAuth secrets
- Least-privilege service accounts
- Cloud Logging/Monitoring/Trace enabled

## 5) Data model (Firestore)
Config
- `config/discord`: `{ allowedGuildId, adminRoleId }`

Canvas state (near-real-time reads)
- `chunks/{chunkId}/pixels/{pixelId}`: `{ x, y, color, updatedAt, authorId }`

Active area
- `activeArea/current`: `{ minX, minY, maxX, maxY, updatedAt }`

Event log (append-only)
- `eventsByDay/{YYYYMMDD}/items/{eventId}`: `{ ts, source, userId, guildId, x, y, newColor, oldColor? }`

Rate limit (strict 20/min)
- `rate/{userId}/minutes/{YYYYMMDDHHmm}`: `{ count }`

Idempotency
- `idempotency/{eventId}`: `{ createdAt }` with TTL

## 6) Events / job payloads
- `draw.requested`: `{ x, y, color, userId, source, interaction? }`
- `snapshot.requested`: `{ userId, source, interaction? }`
- `session.command`: `{ action: start|pause|reset, userId, source, interaction? }`

## 7) Discord commands (minimum)
User
- `/draw x y color`
- `/canvas` (returns status or link)

Admin
- `/session start|pause|reset`
- `/snapshot`

## 8) Web app requirements
- SPA (Firebase Hosting recommended)
- Discord OAuth2 -> async token exchange via worker -> Firebase custom token session
- Real-time canvas rendering via Firestore listeners
- Pixel selection shows author + timestamp
- Writes go through API Gateway -> webProxy

## 9) Security
- API Gateway uses service account to invoke proxies.
- Proxies only publish to Pub/Sub; no direct data writes.
- Firestore rules: authenticated reads, no client writes.
- Secrets stored in Secret Manager and injected at deploy time.
- Remove or lock down any non-gateway HTTP functions (e.g. `hello`) in prod.

## 10) Observability
- Structured logs on proxies/workers.
- Metrics dashboards: errors, Pub/Sub backlog, worker latency.
- Alerts for error rate and backlog growth.

## 11) Execution plan (ordered)
1. Baseline infrastructure
   - Enable APIs, create Pub/Sub topic `jobs`, Firestore, GCS buckets, Secret Manager entries.
   - Create service accounts and IAM roles for proxies/workers.
   - Deploy API Gateway and functions.

2. Discord pipeline
   - Expand slash commands to match requirements.
   - Implement `workerDiscord` routing for follow-ups and admin commands.
   - Implement `workerDraw` to write Firestore and reply to Discord when source=discord.

3. Web pipeline
   - Implement `webProxy` auth validation and enqueue draw/snapshot requests.
   - Implement `oauthProxy` as proxy-only; enqueue `oauth.exchange`.
   - Implement `workerOAuth` to exchange Discord code and mint Firebase custom token.
   - Build SPA with authenticated reads and pixel selection.

4. Snapshot flow
   - Implement `workerSnapshot` render -> upload to GCS -> Discord follow-up.

5. Hardening
   - Add idempotency, rate limiting, DLQ, retries.
   - Finalize Firestore rules and secret handling.
   - Monitoring dashboards and alerts.

## 12) Acceptance checklist
- All public entrypoints are API Gateway routes only.
- All writes are asynchronous via Pub/Sub.
- Discord commands work (draw, snapshot, session).
- Web app supports authenticated draw + real-time view.
- Rate limiting and idempotency enforced.
- Snapshots stored in GCS and posted back to Discord.
- IAM least-privilege and Secret Manager in use.
- Logs and metrics available in Cloud Monitoring.
- No direct function invocation possible from the public internet.
