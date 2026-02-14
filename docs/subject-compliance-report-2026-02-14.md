# Serverless Subject Compliance Report

Date: 2026-02-14

## Scope & Method
- Sources reviewed: all files in `subjects/`.
- Code reviewed: backend (`src/`), web app (`web/`), deploy/ops scripts (`scripts/`, `gateway/`, `monitoring/`, `.github/workflows/deploy.yml`), runbooks (`docs/`).
- Cloud reviewed via `gcloud`: **serverless-felix-dev** project resources.
- Limitation: `serverless-felix-prd` is not accessible with current account (`mathonvictor1@gmail.com`), so prod status is **unknown**.

## What You Have Today

### Architecture & Services (implemented)
- API Gateway in front of public API routes (`/discord`, `/web/*`, `/oauth`).
- Gen2 Cloud Functions split by responsibility:
  - Proxies: `discordProxy`, `webProxy`, `oauthProxy`
  - Workers: `workerDraw`, `workerDiscord`, `workerSnapshot`, `workerOAuth`
- Event-driven backbone with Pub/Sub topic `jobs` and Eventarc triggers for workers.
- Firestore as main state store (chunks, sessions, active area, idempotency, rate limits).
- Cloud Storage snapshot bucket (`serverless-felix-dev-snapshots`) with lifecycle rule.
- Web frontend deployed serverlessly (Firebase Hosting).

### Security & Ops (implemented)
- Dedicated service accounts (`proxy-sa`, `worker-sa`, `api-gateway-invoker`).
- Proxy invokers restricted to API Gateway SA (no `allUsers` on Function/Run invoker policies).
- Secret Manager integration for runtime secrets used by deployed functions.
- Monitoring dashboard + alert policies provisioned as code.
- DLQ configured (`jobs-dlq`) and attached to worker subscriptions.
- Firestore TTL enabled and active for:
  - `sessions.expiresAt`
  - `idempotency.createdAt`

## Subject Requirements Audit (C3)

| Requirement | Status | Evidence | Gap / Risk |
|---|---|---|---|
| 100% serverless (no VM/K8s) | OK | Cloud Functions Gen2, API Gateway, Pub/Sub/Eventarc, Firestore, Storage, Firebase Hosting | None seen |
| Public API endpoints through API Gateway | OK | Gateway routes in `gateway/openapi.template.yaml`; proxy invoker IAM locked to gateway SA | None seen |
| No direct public invocation of functions | OK | Function + Run invoker IAM only for `api-gateway-invoker@...` | Ingress is `ALLOW_ALL` (acceptable with IAM, but keep strict IAM) |
| Event-driven async workloads via broker | PARTIAL | Discord/web draw flows enqueue Pub/Sub jobs; workers consume events | `webProxy` serves `/canvas` and `/active-area` by direct Firestore reads (sync path) |
| SRP per function | OK | Distinct proxy and worker functions by concern | None significant |
| Discord: draw/canvas/session/snapshot commands | PARTIAL | Commands exist in `scripts/register-commands.mjs`; jobs handled in workers | `/canvas` Discord response currently returns web URL, not explicit canvas state payload |
| Discord interactions async ACK first | OK | `discordProxy` returns deferred response then workers follow up | None seen |
| Pixel data includes author + timestamp | OK | `workerDraw` writes `authorId`, `updatedAt` | None seen |
| Configurable/infinite-like canvas model | OK | Chunked coordinate model (`chunks/{chunkId}/pixels/{x_y}`) supports unbounded coords | None seen |
| Concurrent consistency | OK | Firestore transaction in `workerDraw` | None seen |
| Rate limit per user (20/min) | OK | Transactional counter in `rate/{user}/minutes/{key}` with default 20/min | Runtime env not set in deploy output; default is used |
| Web app: draw + near real-time view + auth | OK | Draw endpoint + polling every 1s + Discord OAuth flow/session cookie | Polling is near-real-time but not event-push |
| Web: select pixel and show author/timestamp | OK | UI shows selected pixel metadata from API window | None seen |
| Monitoring/logging/security expectations | PARTIAL | Structured logs, dashboard, alerts, IAM, secrets, DLQ | Trace instrumentation/configuration not implemented |
| Deliverables: README/setup, architecture diagrams | MISSING | No README/diagram assets found in repo | High defense risk |

## Teacher Docs Recommendations Audit (C2/C4/C5/C6/C7/C8)

| Recommendation Area | Status | Notes |
|---|---|---|
| IAM least privilege | PARTIAL | Good SA split (proxy/worker/gateway), but not per-function SA; `proxy-sa` and `worker-sa` are shared broad scopes |
| API Gateway as mandatory entry | OK | Enforced for proxies |
| Event messaging + DLQ + retention | OK | `jobs` topic + worker Eventarc subs with DLQ and max delivery attempts |
| Topic design (split by domain event) | PARTIAL | Single `jobs` topic with `kind` field works; docs recommend split topics (`pixel.*`, `snapshot.*`, etc.) |
| Logging with correlation IDs | OK | `observability.ts` generates/propagates `correlationId`, `requestId`, `traceId` |
| Tracing (Cloud Trace/OpenTelemetry) | MISSING | No OpenTelemetry or explicit trace spans export in code |
| Alerts + dashboard | PARTIAL | Policies exist, but no notification channels configured |
| Secret manager usage | PARTIAL | Runtime secrets are in Secret Manager; some planned secrets absent (`discord_app_id`, `discord_bot_token`, `firebase_service_account`) |
| Frontend scaling recommendations | PARTIAL | Chunked reads implemented; updates are polling, not event-driven push |
| Architecture docs/diagram maintenance | MISSING | No architecture diagram artifact in repo |

## GCP State Snapshot (dev)
- Project: `serverless-felix-dev` (ACTIVE)
- Functions: all 7 active in `europe-west1`
- API Gateway: `serverless-felix-dev-gateway` active
- Pub/Sub: `jobs`, `jobs-dlq`; DLQ attached to all worker subscriptions
- Firestore: native mode in `europe-west1`; TTL fields active
- Bucket: `serverless-felix-dev-snapshots` exists, uniform bucket-level access enabled, lifecycle delete after 90 days
- Monitoring: dashboard `Serverless Felix - Core Ops (dev)` + 3 alert policies enabled

## What Is Left To Complete (Priority)

### P0 (must do for subject/defense readiness)
1. Add **deliverables documentation**:
   - Root `README.md` with setup/deploy/run/test commands
   - Architecture diagram(s) showing request flow, event flow, IAM boundaries, and data stores
2. Implement/justify **tracing**:
   - Add Cloud Trace/OpenTelemetry instrumentation (or provide explicit defense rationale if not implemented)
3. Tighten requirement interpretation around “event-driven everywhere”:
   - Either move read model to an event-fed projection/cache path, or document and justify why synchronous read endpoints are necessary for web UX.

### P1 (strongly recommended)
1. Improve Discord `/canvas` behavior to return actual canvas snapshot/state summary, not only web link.
2. Add notification channels to alert policies (email/Slack/etc.) and document escalation path.
3. Consider finer-grained IAM (per-function SA) to better match teacher least-privilege recommendation.

### P2 (quality/scalability improvements)
1. Consider split Pub/Sub topics by domain event type for cleaner ops and ACL boundaries.
2. Consider push-based frontend updates (SSE/WebSocket bridge) instead of polling for fresher near-real-time behavior.

## Blockers / Unknowns
- `serverless-felix-prd` cannot be audited with current account permissions; prod compliance remains unknown.
- Discord Developer Portal endpoint and command wiring were not directly verifiable from GCP/repo alone.

