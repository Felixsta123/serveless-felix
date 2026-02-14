import { spawnSync } from 'node:child_process';

const [, , environment] = process.argv;

const projects = {
  dev: 'serverless-felix-dev',
  prd: 'serverless-felix-prd',
};

if (!environment || !(environment in projects)) {
  console.error('Usage: node scripts/deploy-ttl.mjs <dev|prd>');
  process.exit(1);
}

const projectId = projects[environment];
const database = '(default)';

const ttlTargets = [
  { collectionGroup: 'sessions', field: 'expiresAt' },
  { collectionGroup: 'idempotency', field: 'createdAt' },
];

const runCapture = (args) => {
  const result = spawnSync('gcloud', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? '').trim();
};

const runInherit = (args) => {
  const result = spawnSync('gcloud', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

for (const target of ttlTargets) {
  console.log(
    `Enabling TTL for ${target.collectionGroup}.${target.field} on project ${projectId}`,
  );
  runInherit([
    'firestore',
    'fields',
    'ttls',
    'update',
    target.field,
    '--project',
    projectId,
    '--database',
    database,
    '--collection-group',
    target.collectionGroup,
    '--enable-ttl',
    '--async',
  ]);
}

const wanted = new Map(ttlTargets.map((t) => [`${t.collectionGroup}.${t.field}`, 'UNKNOWN']));

for (const target of ttlTargets) {
  const key = `${target.collectionGroup}.${target.field}`;
  const field = JSON.parse(
    runCapture([
      'firestore',
      'indexes',
      'fields',
      'describe',
      target.field,
      '--project',
      projectId,
      '--database',
      database,
      '--collection-group',
      target.collectionGroup,
      '--format',
      'json',
    ]),
  );

  const ttlState = field?.ttlConfig?.state ?? 'MISSING';
  wanted.set(key, ttlState);
  console.log(`${key}: ttlState=${ttlState}`);
}

const failed = Array.from(wanted.entries())
  .filter(([, ttlState]) => ttlState !== 'ACTIVE' && ttlState !== 'CREATING')
  .map(([key, ttlState]) => `${key}(${ttlState})`);

if (failed.length > 0) {
  console.error(
    `TTL configuration missing/invalid for: ${failed.join(', ')}`,
  );
  process.exit(2);
}

const pending = Array.from(wanted.entries())
  .filter(([, ttlState]) => ttlState === 'CREATING')
  .map(([key]) => key);

if (pending.length > 0) {
  console.log(`TTL enablement is propagating for: ${pending.join(', ')}`);
} else {
  console.log('TTL configuration is enabled for all required fields.');
}
