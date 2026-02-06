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
- Implemented: API Gateway template, deployment scripts, discordProxy, workerDiscord, workerDraw, hello function.
- Implemented (Step 3 - Web Pipeline): oauthProxy, workerOAuth, webProxy with session/auth/draw/pixels endpoints.
- Implemented: Web SPA (Vite + TypeScript + Firebase) with Discord OAuth2, real-time Firestore canvas, pixel drawing.
- Deployed: Firebase Hosting at https://serverless-felix-dev.web.app
- Stubs: workerSnapshot.
- Firestore schema implemented: chunks/pixels, sessions, activeArea, rate, idempotency, eventsByDay.
- No GCS bucket usage yet (for snapshots).

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
