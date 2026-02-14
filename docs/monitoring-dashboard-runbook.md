# Monitoring Dashboard Runbook

This project now provisions a Cloud Monitoring dashboard as code, aligned with the subject and teacher observability requirements.

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
```

The command creates or updates the dashboard based on display name.

Required IAM role for the deploying identity:
- `roles/monitoring.dashboardEditor`

## Files

- Template: `monitoring/dashboard.core.template.json`
- Rendered per env: `monitoring/dashboard.<env>.json`
- Deploy script: `scripts/deploy-monitoring.mjs`

## Next required step (still pending)

Add alert policies (not included in this runbook yet), for example:
- 5xx error spike on Cloud Run services
- Pub/Sub backlog age/depth thresholds
