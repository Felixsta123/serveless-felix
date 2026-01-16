# Project Trace

## Setup Phase
- [x] Initialized `package.json` with dependencies.
- [x] Created `tsconfig.json` for TypeScript support.
- [x] Installed dependencies.
- [x] Implemented Hello World function (in `index.ts`).
- [x] Configured deployment scripts (switched from `serverless.yml` to `gcloud` CLI).
- [x] Setup GitHub Actions for CI/CD.
- [x] Configured Google Cloud Service Account & Permissions.
- [x] Successfully deployed Gen 2 Function to dev environment.
- [x] Verified deployment with `curl`.

## Deployment Strategy
- **Local compilation:** TypeScript is compiled locally using `npm run build` (`tsc`).
- **Artifact creation:** `npm run predeploy` creates a `dist` folder with compiled JS + `package.json` + `package-lock.json`.
- **Environment config:** `deploy:dev` command sets `GOOGLE_NODE_RUN_SCRIPTS=` to prevent Cloud Build from trying to re-build (which fails without `tsconfig.json`).
