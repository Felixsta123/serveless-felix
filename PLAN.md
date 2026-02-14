# Serverless Plan (GCP)

Last status sync: 2026-02-14 (dev environment `serverless-felix-dev`)

## 1) Goal
Build a fully serverless, event-driven multiplayer pixel canvas where users draw via Discord and a web app.
All public traffic goes through API Gateway -> proxy functions -> Pub/Sub -> workers.

## 2) Hard constraints (subject)
- Serverless only (Cloud Functions Gen2, API Gateway, Pub/Sub, Firestore, Cloud Storage, Firebase Hosting/Auth).
- No direct public function invocation; API Gateway is the only public backend entrypoint.
- Proxies validate/auth + enqueue only; workers perform business logic asynchronously.
- Functions follow SRP.
- Web API calls are authenticated.
- Discord interactions are signed and acknowledged quickly, then processed asynchronously.
- Least-privilege IAM and Secret Manager are used.

## 3) Current status (dev, deployed)
### 3.1 Implemented and working
- API Gateway routes active for `/discord`, `/web/{path}`, `/oauth`.
- Proxies:
  - `discordProxy`: signature verification + command parsing + job enqueue + deferred ACK.
  - `webProxy`: session validation for draw + draw enqueue + session polling endpoint.
  - `oauthProxy`: OAuth start/callback state validation + enqueue `oauth.exchange` + redirect to SPA.
- Workers:
  - `workerDraw`: idempotency + per-user rate limit + Firestore transactional writes (`chunks`, `eventsByDay`, `activeArea`, `rate`, `idempotency`).
  - `workerDiscord`: `/canvas` follow-up and admin `/session` commands.
  - `workerOAuth`: Discord token exchange + Firebase custom token mint + session creation.
  - `workerSnapshot`: reads canvas from Firestore chunks, renders PNG, uploads to GCS snapshots bucket, posts Discord message with embedded image (no long URL in message text).
- Web SPA deployed: `https://serverless-felix-dev.web.app`
  - Discord OAuth2 login flow.
  - Firebase custom-token auth.
  - Near-real-time chunk subscriptions.
  - Pixel selection with author and timestamp.
  - Authenticated draw requests via API Gateway.
- Security baseline:
  - Dedicated SAs: `proxy-sa`, `worker-sa`, `api-gateway-invoker`.
  - Secrets in Secret Manager for Discord/OAuth credentials.
  - Public direct function invocation blocked (403 unauthenticated checks).
- Admin role configured and deployed:
  - `DISCORD_ADMIN_ROLE_ID=1471881086521839656` on `workerDiscord` and `workerSnapshot`.

### 3.2 Implemented but still risky/incomplete
- Event triggers are currently `RETRY_POLICY_DO_NOT_RETRY`.
- No Pub/Sub DLQ configured.
- Firestore TTL policies are not configured (idempotency/session cleanup).
- Legacy Firestore collections remain from previous schema (`canvas`, `ratelimit`).

### 3.3 Missing deliverables against subject/defense
- Monitoring deliverables:
  - Cloud Monitoring dashboard + alert policies as code implemented (`monitoring/dashboard.core.template.json`, `monitoring/alert-policies.core.template.json`) with deploy scripts (`scripts/deploy-monitoring.mjs`, `scripts/deploy-alerts.mjs`).
  - Deployed in dev; prd deployment still pending.
  - Notification channels/escalation routing not configured yet.
  - Correlation-ID/tracing pattern not standardized across all functions.
- Documentation deliverables:
  - Missing project README/setup guide.
  - Missing architecture diagram synced with current implementation.
- Production readiness:
  - `serverless-felix-prd` project still not provisioned.

## 4) Target architecture (current + hardening)
Entry
- API Gateway (public)

Proxies (HTTP Cloud Functions Gen2)
- `discordProxy` -> verify signature + validate command -> enqueue job
- `webProxy` -> validate session/auth -> enqueue draw job
- `oauthProxy` -> OAuth start/callback validation -> enqueue `oauth.exchange`

Event bus
- Pub/Sub topic `jobs` (current)
- Next hardening: DLQ + retry policy tuning

Workers (Pub/Sub Cloud Functions Gen2)
- `workerDraw` -> rate limit + idempotency + transactional Firestore writes
- `workerDiscord` -> Discord follow-ups + admin session commands
- `workerOAuth` -> Discord OAuth exchange + Firebase custom token + session creation
- `workerSnapshot` -> render snapshot -> upload to GCS -> Discord embedded image response

Storage
- Firestore for state/events/session/rate/idempotency
- Cloud Storage snapshots bucket (`serverless-felix-dev-snapshots`)

## 5) Firestore model (active)
Primary
- `chunks/{chunkId}/pixels/{pixelId}`: `{ x, y, color, updatedAt, authorId }`
- `activeArea/current`: `{ minX, minY, maxX, maxY, updatedAt }`
- `eventsByDay/{YYYYMMDD}/items/{eventId}`: `{ ts, source, userId, guildId, x, y, newColor, oldColor }`
- `rate/{userId}/minutes/{YYYYMMDDHHmm}`: `{ count }`
- `idempotency/{eventId}`: `{ createdAt }`
- `sessions/{state}`: OAuth/web session state
- `config/session`: session state (`running|paused|reset`)

Legacy (cleanup planned)
- `canvas/...`
- `ratelimit/...`

## 6) Gap-to-subject summary
- Serverless-only: OK.
- API Gateway-only public backend: OK in dev.
- Async event-driven architecture: OK.
- Discord commands:
  - `/draw`: OK.
  - `/canvas`: OK.
  - `/session start|pause|reset`: OK with configured admin role.
  - `/snapshot`: OK (snapshot image generated, stored, returned in Discord embed).
- Storage/rate-limit/concurrency: Mostly OK (transaction + rate + idempotency), cleanup lifecycle still missing.
- Web auth + near-real-time + draw + author/timestamp: OK.
- Security:
  - Dedicated SAs + secrets: OK in dev.
  - Least-privilege: mostly OK, re-review after final hardening.
- Monitoring/logging/tracing defense readiness: not complete.
- Documentation/diagram deliverables: not complete.

## 7) Execution plan (remaining work, ordered)
1. Reliability hardening
   - Add Pub/Sub DLQ strategy.
   - Switch from no-retry to safe retry policies where appropriate.
   - Configure Firestore TTL (idempotency and stale sessions; optional rate cleanup).

2. Observability and defense evidence
   - Standardize structured logs with correlation IDs across proxy -> worker flow.
   - Configure notification channels and tune alert thresholds for errors/backlog/age.
   - Deploy monitoring dashboard + alerts to prd and capture evidence/screenshots for defense.

3. Documentation deliverables
   - Add `README.md` with setup/deploy/run/verify flow.
   - Add architecture diagram reflecting current deployed topology.
   - Add monitoring section/screenshots for defense.

4. Environment completion
   - Provision `serverless-felix-prd`.
   - Replicate secured deployment + gateway + secrets + rules + monitoring in prd.

## 8) Acceptance checklist (final)
- All subject-mandated Discord commands work end-to-end, including snapshot image posting.
- All writes are asynchronous via Pub/Sub workers.
- No direct public backend function invocation (gateway-only public backend path).
- Web app supports OAuth login, near-real-time canvas, authenticated draw, author/timestamp display.
- Rate limiting + idempotency enforced and lifecycle-managed (TTL).
- Monitoring deliverables present: logs, dashboards, alerts.
- Documentation deliverables present: README/setup + architecture diagram.
- Defense-ready evidence exists for concurrency, security, observability, and persistence choices.
