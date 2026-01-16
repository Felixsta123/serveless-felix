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
    projects[environment],
  ];

  if (config.trigger === 'http') {
    args.push('--trigger-http');
    if (config.allowUnauthenticated) {
      args.push('--allow-unauthenticated');
    }
  }

  if (config.trigger === 'topic' && config.topic) {
    args.push('--trigger-topic', config.topic);
  }

  const child = spawn('gcloud', args, { stdio: 'inherit' });
  const code = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  if (code !== 0) {
    process.exit(code ?? 1);
  }
}
