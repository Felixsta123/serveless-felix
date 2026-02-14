# Monitoring Runbook

This project now provisions Cloud Monitoring dashboard + alert policies as code, aligned with the subject and teacher observability requirements.

## What is deployed

Dashboard display name:
- `Serverless Felix - Core Ops (dev)`
- `Serverless Felix - Core Ops (prd)`

Provisioned widgets:
- Cloud Run request rate by service (all proxies/workers)
- Cloud Run 5xx error rate by service
- Cloud Run p95 request latency by service
- Pub/Sub undelivered messages for worker subscriptions
- Pub/Sub oldest unacked message age for worker subscriptions

These cover the mandatory observability axis requested in the subject:
- traffic/load
- errors
- latency
- queue backlog depth/age

## Deploy / update

From repository root:

```bash
npm run deploy:dev:monitoring
npm run deploy:prd:monitoring
npm run deploy:dev:alerts
npm run deploy:prd:alerts
```

These commands create or update monitoring resources based on display names.

Required IAM role for the deploying identity:
- `roles/monitoring.dashboardEditor`
- `roles/monitoring.alertPolicyEditor`

## Files

- Template: `monitoring/dashboard.core.template.json`
- Rendered per env: `monitoring/dashboard.<env>.json`
- Deploy script: `scripts/deploy-monitoring.mjs`
- Template: `monitoring/alert-policies.core.template.json`
- Rendered per env: `monitoring/alert-policies.<env>.json`
- Deploy script: `scripts/deploy-alerts.mjs`

## Alert policies deployed

- Cloud Run 5xx spike (rate-based)
- Pub/Sub backlog depth (undelivered messages)
- Pub/Sub oldest unacked message age
