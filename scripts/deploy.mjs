import { spawn } from 'node:child_process';
import { functions } from './functions.mjs';

const [, , environment, functionName] = process.argv;
const region = 'europe-west1';

const projects = {
  dev: 'serverless-felix-dev',
  prd: 'serverless-felix-prd',
};

if (!environment || !(environment in projects)) {
  console.error('Usage: node scripts/deploy.mjs <dev|prd> [functionName]');
  process.exit(1);
}

const names = functionName ? [functionName] : Object.keys(functions);
const projectId = projects[environment];

const serviceAccounts = {
  proxy: `proxy-sa@${projectId}.iam.gserviceaccount.com`,
  worker: `worker-sa@${projectId}.iam.gserviceaccount.com`,
};

const resolveServiceAccount = (value) => {
  if (!value) {
    return null;
  }
  if (value.includes('@')) {
    return value;
  }
  return serviceAccounts[value] ?? null;
};

const resolveEnvVars = (config) => {
  const scoped = config.envByEnvironment?.[environment] ?? {};
  const fromProcess = {};

  for (const key of config.envFromProcess ?? []) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      fromProcess[key] = value;
    }
  }

  return {
    ...scoped,
    ...fromProcess,
  };
};

const encodeKvList = (entries) => entries.map(([key, value]) => `${key}=${value}`).join(',');

for (const name of names) {
  if (!(name in functions)) {
    console.error(`Unknown function: ${name}`);
    process.exit(1);
  }

  const config = functions[name];
  const args = [
    'functions',
    'deploy',
    name,
    '--gen2',
    '--runtime',
    'nodejs24',
    '--region',
    region,
    '--source',
    '.',
    '--entry-point',
    name,
    '--project',
    projectId,
  ];

  if (config.trigger === 'http') {
    args.push('--trigger-http');
    if (config.allowUnauthenticated) {
      args.push('--allow-unauthenticated');
    } else {
      args.push('--no-allow-unauthenticated');
    }
  }

  if (config.trigger === 'topic' && config.topic) {
    args.push('--trigger-topic', config.topic);
  }

  const serviceAccount = resolveServiceAccount(config.serviceAccount);
  if (serviceAccount) {
    args.push('--service-account', serviceAccount);
  }

  const envVars = resolveEnvVars(config);
  const envEntries = Object.entries(envVars);
  if (envEntries.length > 0) {
    args.push('--set-env-vars', encodeKvList(envEntries));
  }

  const secretEntries = Object.entries(config.secrets ?? {}).map(([envName, secretName]) => [
    envName,
    `${secretName}:latest`,
  ]);
  if (secretEntries.length > 0) {
    if (envEntries.length === 0) {
      args.push(
        '--remove-env-vars',
        secretEntries.map(([envName]) => envName).join(','),
      );
    }
    args.push('--set-secrets', encodeKvList(secretEntries));
  }

  const child = spawn('gcloud', args, { stdio: 'inherit' });
  const code = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  if (code !== 0) {
    process.exit(code ?? 1);
  }
}
