import { CloudEvent } from '@google-cloud/functions-framework';
import https from 'node:https';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { DiscordJobPayload } from '../../shared/queue.js';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

const extractMessageData = (event: CloudEvent<PubSubEnvelope>): string | null => {
  const data = event.data;
  if (!data) {
    return null;
  }
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  const messageData = data.message?.data;
  if (typeof messageData === 'string') {
    return messageData;
  }
  if (Buffer.isBuffer(messageData)) {
    return messageData.toString('utf8');
  }
  const legacyData = (data as { data?: unknown }).data;
  if (typeof legacyData === 'string') {
    return legacyData;
  }
  if (Buffer.isBuffer(legacyData)) {
    return legacyData.toString('utf8');
  }
  return null;
};

const parseJob = (event: CloudEvent<PubSubEnvelope>): DiscordJobPayload | null => {
  const raw = extractMessageData(event);
  if (!raw) {
    console.log('workerDiscord missing message data', {
      dataType: typeof event.data,
      hasMessage: Boolean(event.data?.message),
    });
    return null;
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded) as DiscordJobPayload;
  } catch (error) {
    try {
      return JSON.parse(raw) as DiscordJobPayload;
    } catch (fallbackError) {
      console.error('workerDiscord failed to parse job payload', error, fallbackError);
      return null;
    }
  }
};

const postJson = async (url: string, body: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const target = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          reject(new Error(`Discord API error ${status}: ${responseBody}`));
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

const sendFollowup = async (
  applicationId: string,
  token: string,
  content: string,
): Promise<void> => {
  const url = `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${token}`;
  await postJson(url, { content });
};

export const workerDiscord = async (event: CloudEvent<PubSubEnvelope>) => {
  const job = parseJob(event);
  if (!job || job.kind !== 'discord.command') {
    console.log('workerDiscord ignored message', event.id ?? 'unknown');
    return;
  }

  const applicationId = job.interaction.applicationId;
  const token = job.interaction.token;
  if (!applicationId || !token) {
    console.error('workerDiscord missing applicationId or token', job.interaction);
    return;
  }

  switch (job.command) {
    case 'discord.hello':
      try {
        await sendFollowup(applicationId, token, 'Hello World from Serverless!');
      } catch (error) {
        console.error('workerDiscord failed to send followup', error);
      }
      return;
    default:
      console.log('workerDiscord no handler for command', job.command);
  }
};
