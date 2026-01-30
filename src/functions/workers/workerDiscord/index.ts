import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { JobPayload } from '../../shared/queue.js';
import { postDiscordFollowup } from '../../shared/discordApi.js';

const firestore = new Firestore();
const sessionRef = firestore.doc('config/session');

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
  const messageData = (data as { message?: { data?: unknown } }).message?.data;
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

const parseJob = (event: CloudEvent<PubSubEnvelope>): JobPayload | null => {
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
    return JSON.parse(decoded) as JobPayload;
  } catch (error) {
    try {
      return JSON.parse(raw) as JobPayload;
    } catch (fallbackError) {
      console.error('workerDiscord failed to parse job payload', error, fallbackError);
      return null;
    }
  }
};

export const workerDiscord = async (event: CloudEvent<PubSubEnvelope>) => {
  const job = parseJob(event);
  if (!job) {
    console.log('workerDiscord ignored message', event.id ?? 'unknown');
    return;
  }

  if (job.kind === 'discord.followup') {
    try {
      await postDiscordFollowup(job.applicationId, job.token, job.content);
    } catch (error) {
      console.error('workerDiscord failed to send followup', error);
    }
    return;
  }

  if (job.kind !== 'canvas.requested' && job.kind !== 'session.command') {
    return;
  }

  const interaction = job.interaction;
  if (!interaction?.applicationId || !interaction?.token) {
    console.error('workerDiscord missing applicationId or token', interaction);
    return;
  }

  if (job.kind === 'canvas.requested') {
    try {
      await postDiscordFollowup(
        interaction.applicationId,
        interaction.token,
        'Canvas is live. Web link coming soon.',
      );
    } catch (error) {
      console.error('workerDiscord failed to send canvas followup', error);
    }
    return;
  }

  const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
  if (adminRoleId && !interaction.roles?.includes(adminRoleId)) {
    try {
      await postDiscordFollowup(
        interaction.applicationId,
        interaction.token,
        'You are not allowed to manage the session.',
        64,
      );
    } catch (error) {
      console.error('workerDiscord failed to send admin rejection', error);
    }
    return;
  }

  const now = Timestamp.now();
  const nextState =
    job.action === 'start' ? 'running' : job.action === 'pause' ? 'paused' : 'reset';

  try {
    await sessionRef.set(
      {
        state: nextState,
        updatedAt: now,
        updatedBy: job.userId,
        source: job.source,
        ...(job.action === 'reset' ? { resetAt: now } : null),
      },
      { merge: true },
    );
    await postDiscordFollowup(
      interaction.applicationId,
      interaction.token,
      `Session updated: ${nextState}.`,
    );
  } catch (error) {
    console.error('workerDiscord failed to update session', error);
    try {
      await postDiscordFollowup(
        interaction.applicationId,
        interaction.token,
        'Failed to update session. Try again later.',
        64,
      );
    } catch (followupError) {
      console.error('workerDiscord failed to send error followup', followupError);
    }
  }
};
