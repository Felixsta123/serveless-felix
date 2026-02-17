import { resolveProjectId } from './lib/projects.mjs';
import { runCapture, runInherit, runResult } from './lib/gcloud.mjs';

const region = 'europe-west1';
const projectId = resolveProjectId();
const workers = [
  'workerdraw',
  'workerdiscord',
  'workerdiscordcanvas',
  'workerdiscordfollowup',
  'workeroauth',
  'workersnapshot',
  'workerwebactivearea',
  'workerwebread',
  'workerwebrealtimetoken',
];
const workerServiceAccounts = {
  workerdraw: 'sa-worker-draw',
  workerdiscord: 'sa-worker-session',
  workerdiscordcanvas: 'sa-worker-canvas',
  workerdiscordfollowup: 'sa-worker-followup',
  workeroauth: 'sa-worker-oauth',
  workersnapshot: 'sa-worker-snapshot',
  workerwebactivearea: 'sa-worker-web-active-area',
  workerwebread: 'sa-worker-web-read',
  workerwebrealtimetoken: 'sa-worker-web-realtime-token',
};
const workerTopics = [
  'jobs-draw',
  'jobs-canvas',
  'jobs-session',
  'jobs-snapshot',
  'jobs-oauth',
  'jobs-discord-followup',
  'jobs-web-read',
  'jobs-web-active-area',
  'jobs-web-realtime-token',
];
const dlqTopic = 'jobs-dlq';
const dlqSubscription = 'jobs-dlq-sub';
const workerSelfTokenCreatorServiceAccounts = [
  'sa-worker-oauth',
  'sa-worker-web-realtime-token',
  'sa-worker-snapshot',
  'sa-worker-canvas',
];

const ensureTopic = (topicId) => {
  const describe = runResult([
    'pubsub',
    'topics',
    'describe',
    topicId,
    '--project',
    projectId,
  ]);
  if (describe.status === 0) {
    console.log(`Topic exists: ${topicId}`);
    return;
  }

  console.log(`Creating topic: ${topicId}`);
  runInherit([
    'pubsub',
    'topics',
    'create',
    topicId,
    '--project',
    projectId,
  ]);
};

const ensureSubscription = (subscriptionId, topicId) => {
  const describe = runResult([
    'pubsub',
    'subscriptions',
    'describe',
    subscriptionId,
    '--project',
    projectId,
  ]);
  if (describe.status === 0) {
    console.log(`Subscription exists: ${subscriptionId}`);
    return;
  }

  console.log(`Creating subscription: ${subscriptionId}`);
  runInherit([
    'pubsub',
    'subscriptions',
    'create',
    subscriptionId,
    '--project',
    projectId,
    '--topic',
    topicId,
    '--message-retention-duration',
    '604800s',
  ]);
};

const projectNumber = runCapture([
  'projects',
  'describe',
  projectId,
  '--format',
  'value(projectNumber)',
]);

if (!projectNumber) {
  console.error(`Unable to resolve project number for ${projectId}`);
  process.exit(1);
}

for (const topic of workerTopics) {
  ensureTopic(topic);
}
ensureTopic(dlqTopic);
ensureSubscription(dlqSubscription, dlqTopic);

const pubsubServiceAgent = `service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
const eventarcServiceAgent = `service-${projectNumber}@gcp-sa-eventarc.iam.gserviceaccount.com`;
console.log(`Granting DLQ publish permission to Pub/Sub service agent: ${pubsubServiceAgent}`);
runInherit([
  'pubsub',
  'topics',
  'add-iam-policy-binding',
  dlqTopic,
  '--project',
  projectId,
  '--member',
  `serviceAccount:${pubsubServiceAgent}`,
  '--role',
  'roles/pubsub.publisher',
]);

const ensurePubSubTokenCreatorBindings = () => {
  const serviceAccounts = new Set(Object.values(workerServiceAccounts));
  for (const serviceAccount of serviceAccounts) {
    const serviceAccountEmail = `${serviceAccount}@${projectId}.iam.gserviceaccount.com`;
    runInherit([
      'iam',
      'service-accounts',
      'add-iam-policy-binding',
      serviceAccountEmail,
      '--project',
      projectId,
      '--member',
      `serviceAccount:${pubsubServiceAgent}`,
      '--role',
      'roles/iam.serviceAccountTokenCreator',
    ]);
  }
};
ensurePubSubTokenCreatorBindings();

const ensureWorkerSelfTokenCreatorBindings = () => {
  for (const serviceAccount of workerSelfTokenCreatorServiceAccounts) {
    const serviceAccountEmail = `${serviceAccount}@${projectId}.iam.gserviceaccount.com`;
    runInherit([
      'iam',
      'service-accounts',
      'add-iam-policy-binding',
      serviceAccountEmail,
      '--project',
      projectId,
      '--member',
      `serviceAccount:${serviceAccountEmail}`,
      '--role',
      'roles/iam.serviceAccountTokenCreator',
    ]);
  }
};
ensureWorkerSelfTokenCreatorBindings();

const ensureRunInvokerBindings = (service) => {
  const describe = runResult([
    'run',
    'services',
    'describe',
    service,
    '--region',
    region,
    '--project',
    projectId,
  ]);
  if (describe.status !== 0) {
    console.warn(`Skipping run.invoker hardening; Cloud Run service not found: ${service}`);
    return;
  }

  const triggerServiceAccount = workerServiceAccounts[service];
  const members = [
    `serviceAccount:${eventarcServiceAgent}`,
    `serviceAccount:${pubsubServiceAgent}`,
    ...(triggerServiceAccount
      ? [`serviceAccount:${triggerServiceAccount}@${projectId}.iam.gserviceaccount.com`]
      : []),
  ];
  for (const member of members) {
    runInherit([
      'run',
      'services',
      'add-iam-policy-binding',
      service,
      '--region',
      region,
      '--project',
      projectId,
      '--member',
      member,
      '--role',
      'roles/run.invoker',
    ]);
  }
};

const subscriptions = JSON.parse(
  runCapture([
    'pubsub',
    'subscriptions',
    'list',
    '--project',
    projectId,
    '--format',
    'json',
  ]) || '[]',
);

const workerSubscriptionIds = subscriptions
  .map((sub) => ({
    name: typeof sub.name === 'string' ? sub.name : '',
  }))
  .filter(({ name }) => {
    const subscriptionId = name.split('/').pop() ?? '';
    return workers.some((worker) => subscriptionId.startsWith(`eventarc-${region}-${worker}-`));
  })
  .map(({ name }) => name.split('/').pop())
  .filter(Boolean);

if (workerSubscriptionIds.length === 0) {
  console.warn('No Eventarc worker subscriptions found to apply DLQ policy.');
  process.exit(0);
}

for (const subscriptionId of workerSubscriptionIds) {
  console.log(`Applying DLQ policy on subscription: ${subscriptionId}`);
  runInherit([
    'pubsub',
    'subscriptions',
    'update',
    subscriptionId,
    '--project',
    projectId,
    '--dead-letter-topic',
    dlqTopic,
    '--max-delivery-attempts',
    '10',
  ]);
}

for (const workerService of workers) {
  ensureRunInvokerBindings(workerService);
}

console.log('Reliability hardening applied.');
console.log(`- DLQ topic: ${dlqTopic}`);
console.log(`- DLQ subscription: ${dlqSubscription}`);
console.log(`- Worker subscriptions hardened: ${workerSubscriptionIds.length}`);
console.log(`- Worker run.invoker hardened: ${workers.length}`);
