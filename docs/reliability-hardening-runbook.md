# Reliability Hardening Runbook

This runbook applies step-1 reliability hardening for the event-driven worker pipeline.

## Scope

- Enable safe retries for idempotent worker(s)
- Add Pub/Sub dead-letter queue (DLQ)
- Attach dead-letter policy to Eventarc worker subscriptions

## Current implementation

Retry policy:
- `workerDraw` is deployed with retry enabled (`--retry`) because draw writes are idempotent (idempotency key in Firestore).

DLQ:
- Topic: `jobs-dlq`
- Subscription: `jobs-dlq-sub`
- Dead-letter policy is applied to Eventarc worker subscriptions for:
  - `workerdraw`
  - `workerdiscord`
  - `workeroauth`
  - `workersnapshot`

## Deploy

```bash
npm run deploy:dev:workerDraw
npm run deploy:dev:reliability

npm run deploy:prd:workerDraw
npm run deploy:prd:reliability
```

## Files

- Script: `scripts/deploy-reliability.mjs`
- Function retry config: `scripts/functions.mjs`
- Deploy arg wiring: `scripts/deploy.mjs`

## Verification

1. Check worker retry policy:

```bash
gcloud functions describe workerDraw --v2 --region=europe-west1 --project=<project> --format='value(eventTrigger.retryPolicy)'
```

Expected:

`RETRY_POLICY_RETRY`

2. Check DLQ config on worker subscriptions:

```bash
gcloud pubsub subscriptions list --project=<project> --format='table(name,deadLetterPolicy.deadLetterTopic,deadLetterPolicy.maxDeliveryAttempts)'
```

Expected:
- Worker subscriptions include dead-letter topic `projects/<project>/topics/jobs-dlq`
- `maxDeliveryAttempts=10`
