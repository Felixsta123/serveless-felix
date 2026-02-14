import { resolveProjectId } from './lib/projects.mjs';
import { runCapture, runInherit } from './lib/gcloud.mjs';

const [, , environment] = process.argv;

const projectId = resolveProjectId(
  environment,
  'Usage: node scripts/deploy-ttl.mjs <dev|prd>',
);
const database = '(default)';

const ttlTargets = [
  { collectionGroup: 'sessions', field: 'expiresAt' },
  { collectionGroup: 'idempotency', field: 'createdAt' },
];

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
