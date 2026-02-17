import { spawn } from 'node:child_process';
import { functions, getEnvironmentValues } from './functions.mjs';
import { resolveProjectId } from './lib/projects.mjs';

const [, , functionName] = process.argv;
const region = 'europe-west1';
const MAX_DEPLOY_ATTEMPTS = Number(process.env.DEPLOY_MAX_ATTEMPTS ?? 5);
const BASE_RETRY_DELAY_MS = Number(process.env.DEPLOY_RETRY_DELAY_MS ?? 15000);
const RETRIABLE_DEPLOY_ERROR = /unable to queue the operation|status=\[409\]/i;

const projectId = resolveProjectId();
const environmentValues = getEnvironmentValues();

const names = functionName ? [functionName] : Object.keys(functions);

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
  const fromEnvironmentConfig = {};
  for (const key of config.envByEnvironmentFromConfig ?? []) {
    const value = environmentValues[key];
    if (value !== undefined && value !== '') {
      fromEnvironmentConfig[key] = value;
    }
  }

  const fromProcess = {};
  for (const key of config.envFromProcess ?? []) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      fromProcess[key] = value;
    }
  }

  return {
    ...fromEnvironmentConfig,
    ...fromProcess,
  };
};

const encodeKvList = (entries) => entries.map(([key, value]) => `${key}=${value}`).join(',');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runGcloud = (args) =>
  new Promise((resolve) => {
    const child = spawn('gcloud', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('error', (error) => {
      output += `\n${error instanceof Error ? error.message : String(error)}\n`;
      resolve({ code: 1, output });
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });

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
    if (config.retry) {
      args.push('--retry');
    }
  }

  const serviceAccount = resolveServiceAccount(config.serviceAccount);
  if (serviceAccount) {
    args.push('--service-account', serviceAccount);
  }

  if (
    typeof config.timeoutSeconds === 'number' &&
    Number.isInteger(config.timeoutSeconds) &&
    config.timeoutSeconds > 0
  ) {
    args.push('--timeout', `${config.timeoutSeconds}s`);
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

  let deployed = false;
  for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
    const { code, output } = await runGcloud(args);
    if (code === 0) {
      deployed = true;
      break;
    }

    if (attempt < MAX_DEPLOY_ATTEMPTS && RETRIABLE_DEPLOY_ERROR.test(output)) {
      const delayMs = BASE_RETRY_DELAY_MS * attempt;
      console.warn(
        `Deploy of ${name} hit transient queue contention (attempt ${attempt}/${MAX_DEPLOY_ATTEMPTS}). Retrying in ${Math.round(delayMs / 1000)}s...`,
      );
      await sleep(delayMs);
      continue;
    }

    process.exit(code ?? 1);
  }

  if (!deployed) {
    process.exit(1);
  }
}
