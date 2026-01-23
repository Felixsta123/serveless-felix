import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , environment] = process.argv;
const region = 'europe-west1';

const projects = {
  dev: 'serverless-felix-dev',
  prd: 'serverless-felix-prd',
};

if (!environment || !(environment in projects)) {
  console.error('Usage: node scripts/deploy-gateway.mjs <dev|prd>');
  process.exit(1);
}

const projectId = projects[environment];
const apiId = `serverless-felix-${environment}`;
const gatewayId = `serverless-felix-${environment}-gateway`;
const configId = `config-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const serviceAccount = `api-gateway-invoker@${projectId}.iam.gserviceaccount.com`;

const templatePath = path.resolve('gateway', 'openapi.template.yaml');
const outputPath = path.resolve('gateway', `openapi.${environment}.yaml`);

const template = fs.readFileSync(templatePath, 'utf8');
const rendered = template
  .replace(/{{PROJECT_ID}}/g, projectId)
  .replace(/{{REGION}}/g, region);

fs.writeFileSync(outputPath, rendered, 'utf8');

const run = (args, options = {}) => {
  const result = spawnSync('gcloud', args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const exists = (args) => spawnSync('gcloud', args, { stdio: 'ignore' }).status === 0;

if (
  !exists(['iam', 'service-accounts', 'describe', serviceAccount, '--project', projectId])
) {
  run([
    'iam',
    'service-accounts',
    'create',
    'api-gateway-invoker',
    '--project',
    projectId,
    '--display-name',
    'API Gateway Invoker',
  ]);
}

for (const fn of ['discordProxy', 'webProxy', 'oauthProxy']) {
  run([
    'functions',
    'add-invoker-policy-binding',
    fn,
    '--gen2',
    '--region',
    region,
    '--project',
    projectId,
    '--member',
    `serviceAccount:${serviceAccount}`,
  ]);
}

if (!exists(['api-gateway', 'apis', 'describe', apiId, '--project', projectId])) {
  run(['api-gateway', 'apis', 'create', apiId, '--project', projectId]);
}

run([
  'api-gateway',
  'api-configs',
  'create',
  configId,
  '--api',
  apiId,
  '--openapi-spec',
  outputPath,
  '--project',
  projectId,
  '--backend-auth-service-account',
  serviceAccount,
]);

if (
  !exists([
    'api-gateway',
    'gateways',
    'describe',
    gatewayId,
    '--location',
    region,
    '--project',
    projectId,
  ])
) {
  run([
    'api-gateway',
    'gateways',
    'create',
    gatewayId,
    '--api',
    apiId,
    '--api-config',
    configId,
    '--location',
    region,
    '--project',
    projectId,
  ]);
} else {
  run([
    'api-gateway',
    'gateways',
    'update',
    gatewayId,
    '--api',
    apiId,
    '--api-config',
    configId,
    '--location',
    region,
    '--project',
    projectId,
  ]);
}

run([
  'api-gateway',
  'gateways',
  'describe',
  gatewayId,
  '--location',
  region,
  '--project',
  projectId,
  '--format',
  'value(defaultHostname)',
]);
