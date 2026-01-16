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
- **Remote compilation:** Source code (`src/` + `tsconfig.json`) is uploaded to Google Cloud.
- **Buildpack:** Google Cloud runs `npm run gcp-build` (`tsc`) to compile TypeScript to JavaScript.
- **Entry point:** `package.json` `main` points to `index.js` (compiled output at root).
- **Ignore rules:** `.gcloudignore` allows `src` and `tsconfig.json` but ignores local `dist` and `node_modules`.
- **Scripts:** `scripts/deploy.mjs` handles the deployment logic, defaulting to `europe-west1`.
