import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { resolveProjectId } from './lib/projects.mjs';
import { runCapture, runInherit } from './lib/gcloud.mjs';

const environment = 'dev';
const projectId = resolveProjectId();
const templatePath = path.resolve('monitoring', 'alert-policies.core.template.json');
const renderedPath = path.resolve('monitoring', `alert-policies.${environment}.json`);
const discordWebhookUrl = process.env.ALERT_DISCORD_WEBHOOK_URL?.trim() ?? '';
const discordChannelDisplayName = `Serverless Felix - Discord Alerts (${environment})`;

if (!fs.existsSync(templatePath)) {
  console.error(`Alert policy template not found: ${templatePath}`);
  process.exit(1);
}

const renderPolicies = () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  const rendered = template
    .replace(/{{ENV}}/g, environment)
    .replace(/{{PROJECT_ID}}/g, projectId);

  const parsed = JSON.parse(rendered);
  if (!Array.isArray(parsed.policies) || parsed.policies.length === 0) {
    throw new Error('Template must contain a non-empty policies array.');
  }

  fs.writeFileSync(renderedPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return parsed.policies;
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serverless-felix-alerts-'));

const writePolicyFile = (policy, index) => {
  const filePath = path.join(tempDir, `policy-${environment}-${index}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  return filePath;
};

const monitoringApiRequest = async (method, endpoint, accessToken, body) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        method,
        hostname: 'monitoring.googleapis.com',
        path: endpoint,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve(data ? JSON.parse(data) : {});
            return;
          }
          reject(new Error(`Monitoring API ${method} ${endpoint} failed (${status}): ${data}`));
        });
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });

const ensureDiscordNotificationChannel = async () => {
  if (!discordWebhookUrl) {
    return null;
  }

  const accessToken = runCapture(['auth', 'print-access-token']);
  const listResponse = await monitoringApiRequest(
    'GET',
    `/v3/projects/${projectId}/notificationChannels`,
    accessToken,
  );
  const channels = Array.isArray(listResponse.notificationChannels)
    ? listResponse.notificationChannels
    : [];

  const byUrl = channels.find(
    (channel) =>
      channel?.type === 'webhook_tokenauth' &&
      channel?.labels?.url === discordWebhookUrl,
  );
  if (byUrl?.name) {
    if (byUrl.enabled === false) {
      await monitoringApiRequest(
        'PATCH',
        `/v3/${byUrl.name}?updateMask=enabled`,
        accessToken,
        { enabled: true },
      );
    }
    return byUrl.name;
  }

  const byDisplayName = channels.find(
    (channel) =>
      channel?.type === 'webhook_tokenauth' &&
      channel?.displayName === discordChannelDisplayName,
  );
  if (byDisplayName?.name) {
    await monitoringApiRequest(
      'PATCH',
      `/v3/${byDisplayName.name}?updateMask=labels.url,enabled`,
      accessToken,
      {
        labels: { ...(byDisplayName.labels ?? {}), url: discordWebhookUrl },
        enabled: true,
      },
    );
    return byDisplayName.name;
  }

  const created = await monitoringApiRequest(
    'POST',
    `/v3/projects/${projectId}/notificationChannels`,
    accessToken,
    {
      type: 'webhook_tokenauth',
      displayName: discordChannelDisplayName,
      description: `Discord webhook notifications for ${projectId} alerts`,
      labels: { url: discordWebhookUrl },
      enabled: true,
      userLabels: {
        app: 'serverless-felix',
        env: environment,
        managed_by: 'codex',
      },
    },
  );

  if (!created?.name || typeof created.name !== 'string') {
    throw new Error('Failed to create Discord notification channel.');
  }
  return created.name;
};

try {
  const discordChannelName = await ensureDiscordNotificationChannel();
  if (discordChannelName) {
    console.log(`Using Discord notification channel: ${discordChannelName}`);
  } else {
    console.warn(
      'ALERT_DISCORD_WEBHOOK_URL is not set. Alert policies will be applied without notification channels.',
    );
  }

  const policies = renderPolicies();

  const existingPolicies = JSON.parse(
    runCapture([
      'monitoring',
      'policies',
      'list',
      '--project',
      projectId,
      '--format',
      'json',
    ]) || '[]',
  );

  const existingByDisplayName = new Map(
    existingPolicies
      .filter((policy) => typeof policy.displayName === 'string' && policy.displayName)
      .map((policy) => [policy.displayName, policy]),
  );

  const applied = [];

  for (const [index, policy] of policies.entries()) {
    if (!policy.displayName || typeof policy.displayName !== 'string') {
      console.error(`Policy at index ${index} is missing a valid displayName.`);
      process.exit(1);
    }

    const existing = existingByDisplayName.get(policy.displayName);
    const existingNotificationChannels = Array.isArray(existing?.notificationChannels)
      ? existing.notificationChannels.filter((channel) => typeof channel === 'string')
      : [];
    const nextNotificationChannels = discordChannelName
      ? [discordChannelName]
      : existingNotificationChannels;
    const policyWithNotifications =
      nextNotificationChannels.length > 0
        ? {
            ...policy,
            notificationChannels: nextNotificationChannels,
          }
        : policy;

    const policyFilePath = (() => {
      if (!existing) {
        return writePolicyFile(policyWithNotifications, index);
      }

      const current = JSON.parse(
        runCapture([
          'monitoring',
          'policies',
          'describe',
          existing.name,
          '--project',
          projectId,
          '--format',
          'json',
        ]),
      );

      return writePolicyFile(
        {
          ...policyWithNotifications,
          name: current.name,
          etag: current.etag,
        },
        index,
      );
    })();

    if (!existing) {
      console.log(`Creating alert policy: ${policy.displayName}`);
      runInherit([
        'monitoring',
        'policies',
        'create',
        '--project',
        projectId,
        '--policy-from-file',
        policyFilePath,
      ]);
    } else {
      console.log(`Updating alert policy: ${policy.displayName}`);
      runInherit([
        'monitoring',
        'policies',
        'update',
        existing.name,
        '--project',
        projectId,
        '--policy-from-file',
        policyFilePath,
      ]);
    }

    applied.push(policy.displayName);
  }

  console.log('Applied alert policies:');
  for (const displayName of applied) {
    console.log(`- ${displayName}`);
  }
  console.log(`Rendered policies: ${renderedPath}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
