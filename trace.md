# Project Trace

## Setup Phase
- [x] Initialized `package.json` with dependencies.
- [x] Created `tsconfig.json` for TypeScript support.
- [x] Installed dependencies.
- [x] Implemented Hello World function (in `index.ts` -> `src/index.ts`).
- [x] Configured deployment scripts (switched from `serverless.yml` to `gcloud` CLI via `deploy.mjs`).
- [x] Setup GitHub Actions for CI/CD.
- [x] Configured Google Cloud Service Account & Permissions.
- [x] Successfully deployed Gen 2 Function to dev environment (`europe-west1`).
- [x] Verified deployment with `curl`.

## Deployment Strategy
- **Local compilation:** TypeScript is compiled locally using `npm run build` (`tsc`).
- **Artifact creation:** `npm run predeploy` creates a `dist` folder with compiled JS + `package.json` + `package-lock.json`.
- **Environment config:** `deploy:dev` command sets `GOOGLE_NODE_RUN_SCRIPTS=` to prevent Cloud Build from trying to re-build (which fails without `tsconfig.json`).
- **Remote compilation:** Source code (`src/` + `tsconfig.json`) is uploaded to Google Cloud.
- **Buildpack:** Google Cloud runs `npm run gcp-build` (`tsc`) to compile TypeScript to JavaScript.
- **Entry point:** `package.json` `main` points to `index.js` (compiled output at root).
- **Ignore rules:** `.gcloudignore` allows `src` and `tsconfig.json` but ignores local `dist` and `node_modules`.
- **Scripts:** `scripts/deploy.mjs` handles the deployment logic, defaulting to `europe-west1`.

## To activate jobs (already done in dev, todo in prod)
gcloud services enable pubsub.googleapis.com
gcloud pubsub topics create jobs --project=serverless-felix-dev

## Also need to enable these APIs
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable eventarc.googleapis.com
