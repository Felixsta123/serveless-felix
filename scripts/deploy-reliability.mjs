import { resolveProjectId } from './lib/projects.mjs';
import { runCapture, runInherit, runResult } from './lib/gcloud.mjs';

const [, , environment] = process.argv;
const region = 'europe-west1';

const projectId = resolveProjectId(
  environment,
  'Usage: node scripts/deploy-reliability.mjs <dev|prd>',
);
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
const dlqTopic = 'jobs-dlq';
const dlqSubscription = 'jobs-dlq-sub';

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

  const members = [
    `serviceAccount:${eventarcServiceAgent}`,
    `serviceAccount:${pubsubServiceAgent}`,
    `serviceAccount:worker-sa@${projectId}.iam.gserviceaccount.com`,
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
    topic: typeof sub.topic === 'string' ? sub.topic : '',
  }))
  .filter(({ name, topic }) => {
    const subscriptionId = name.split('/').pop() ?? '';
    const isWorkerSub = workers.some((worker) =>
      subscriptionId.startsWith(`eventarc-${region}-${worker}-`),
    );
    return topic.endsWith('/topics/jobs') && isWorkerSub;
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
