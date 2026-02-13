# Baseline Infrastructure Plan (Step 1)

Goal: Prepare all GCP serverless infrastructure required by the subject before feature work.

## Ordered Steps
1. Enable required GCP APIs: `cloudfunctions`, `pubsub`, `apigateway`, `servicemanagement`, `servicecontrol`, `firestore`, `storage`, `secretmanager`, `artifactregistry`, `cloudbuild`, `run`, `eventarc`, `logging`, `monitoring`, `cloudtrace`.
2. Create Firestore database (Native mode) in `europe-west1` for each environment/project.
3. Create GCS buckets:
   - `serverless-felix-<env>-snapshots` (required)
   - `serverless-felix-<env>-exports` (optional)
   - Enable uniform bucket-level access; add lifecycle placeholder rules.
4. Create Pub/Sub topic `jobs` (optional: add DLQ topic/subscription now).
5. Create service accounts:
   - `api-gateway-invoker` (API Gateway backend auth)
   - `proxy-sa` (discord/web/oauth proxies)
   - `worker-sa` (draw/snapshot/discord/oauth workers)
6. Grant least-privilege IAM:
   - `api-gateway-invoker` -> Cloud Functions Invoker on proxy functions only.
   - `proxy-sa` -> Pub/Sub Publisher on `jobs`, Secret Manager Accessor.
   - `worker-sa` -> Pub/Sub Subscriber, Firestore RW, GCS Object Admin (snapshots), Secret Manager Accessor.
7. Create Secret Manager secrets (placeholders):
   - `discord_public_key`, `discord_app_id`, `discord_bot_token`
   - `discord_client_id`, `discord_client_secret`, `oauth_redirect_uri`
   - `firebase_service_account`
   - Add at least one secret version before deploying functions.
8. Update deploy configuration to use service accounts + secrets (function env + IAM).
9. Deploy API Gateway config + gateway (dev/prd).
10. Deploy functions (dev/prd) and verify proxy invocation through API Gateway only.

## Compliance Notes
- No function should be public; only API Gateway may invoke proxies.
- Proxies must only enqueue jobs and ACK immediately.
- Remove `allUsers` from both Cloud Functions and underlying Cloud Run services for Gen2 functions.
- Logging/Monitoring/Trace should be enabled from day one.

## Open Questions
- Do we want a single `scripts/bootstrap.mjs` or a manual runbook?
We want a manual Markdown runbook for clarity and simplicity.
- Confirm bucket names and region per environment.
We will use `serverless-felix-<env>-snapshots` in `europe-west1`.
- Add DLQ now or later?
Add DLQ now to avoid missing it later.
