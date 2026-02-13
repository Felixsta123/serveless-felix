# Project Agent Guide (serverless-felix)

## Scope
Build a fully serverless, event-driven pixel canvas (r/place style) with Discord + Web entrypoints on GCP.

## Non-negotiable requirements (from subject)
- Serverless only: no VMs, no Kubernetes, no self-managed servers.
- All public traffic must go through API Gateway -> proxy functions.
- All workloads are asynchronous and event-driven (Pub/Sub). Proxies only enqueue.
- Functions follow Single Responsibility Principle.
- Persistent data in Firestore and Cloud Storage.
- Discord interactions use slash commands with API Gateway URL.
- Web app supports near-real-time canvas and authenticated users (Discord OAuth2).

## Cloud provider decisions
- GCP only: Cloud Functions Gen2, API Gateway, Pub/Sub, Firestore, Cloud Storage.
- Secret Manager for secrets; Cloud Logging/Monitoring/Trace for observability.
- Firebase Hosting/Auth is allowed for the SPA if needed.

## Current implementation status (keep updated when you change it)
- Implemented: API Gateway template, deployment scripts, `discordProxy`, `webProxy`, `oauthProxy`, `workerDraw`, `workerDiscord`, `workerOAuth`, `workerSnapshot`, `hello`.
- Implemented: Web SPA (Vite + TypeScript + Firebase) with Discord OAuth2, real-time Firestore canvas, and authenticated pixel drawing.
- Implemented: Snapshot pipeline in `workerSnapshot` (render canvas PNG from Firestore chunks -> upload to GCS snapshots bucket -> Discord follow-up with embedded image; no long URL in message text).
- Hardened: deploy scripts enforce `--no-allow-unauthenticated`, dedicated `proxy-sa`/`worker-sa`, Secret Manager bindings for OAuth/Discord secrets, and gateway invoker lockdown.
- Deployed (dev): Firebase Hosting at https://serverless-felix-dev.web.app
- Deployed (dev): `DISCORD_ADMIN_ROLE_ID=1471881086521839656` on both `workerDiscord` and `workerSnapshot`.
- Firestore schema implemented and used: `chunks/pixels`, `sessions`, `activeArea`, `rate`, `idempotency`, `eventsByDay`, `config/session`.
- Remaining infra/docs gaps: monitoring dashboards/alerts, TTL cleanup, DLQ/retry hardening, README + architecture diagram, prd project bootstrap.

## Ground rules for changes
- Do not add direct HTTP calls to workers.
- Proxies must only validate and enqueue events.
- Keep all public endpoints behind API Gateway.
- Use least-privilege IAM for each function.
- Keep secrets out of code; use Secret Manager or env vars in deployment.

## Useful repo paths
- Functions: `src/functions/*`
- API Gateway template: `gateway/openapi.template.yaml`
- Deploy scripts: `scripts/deploy.mjs`, `scripts/deploy-gateway.mjs`
- Plan: `PLAN.md`

## Local dev
- Run a function locally: `npm run dev:<functionName>`
- Build: `npm run build`

## When in doubt
- Re-read `subjects/SERVERLESS - Subject.md` and align with constraints.
- Keep architecture documentation in sync with code and deployments.
