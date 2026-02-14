# Firestore TTL Runbook

This runbook applies Firestore TTL cleanup required by the subject.

## TTL targets

- `sessions.expiresAt`
- `idempotency.createdAt`

## Deploy

```bash
npm run deploy:dev:ttl
npm run deploy:prd:ttl
```

The deploy script enables TTL asynchronously and prints current `ttlConfig.state` for each field.

Expected states:
- `CREATING` right after first apply
- then `ACTIVE` after propagation

## Files

- Script: `scripts/deploy-ttl.mjs`
- CI trigger: `.github/workflows/deploy.yml` (`ttl` filter)

## Required IAM for deploy identity

- `roles/datastore.owner` (includes field-level metadata updates used by TTL operations)
