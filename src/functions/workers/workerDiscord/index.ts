import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import crypto from 'node:crypto';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { JobPayload } from '../../shared/queue.js';
import { postDiscordFollowup } from '../../shared/discordApi.js';
import {
  getWorkerContext,
  logError,
  logInfo,
  logWarn,
} from '../../shared/observability.js';

const firestore = new Firestore();
const sessionRef = firestore.doc('config/session');
const activeAreaRef = firestore.doc('activeArea/current');
const WEB_APP_URL = process.env.WEB_APP_URL ?? 'https://your-app.web.app';
const makeRoundId = (): string => `round-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

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
    logWarn('worker_discord_missing_message_data', {
      eventId: event.id ?? null,
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
      logError('worker_discord_parse_failed', fallbackError, {
        eventId: event.id ?? null,
        primaryError: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
};

export const workerDiscord = async (event: CloudEvent<PubSubEnvelope>) => {
  const job = parseJob(event);
  if (!job) {
    logWarn('worker_discord_ignored_invalid_payload', {
      eventId: event.id ?? null,
    });
    return;
  }
  const context = getWorkerContext(event, job);

  if (job.kind === 'discord.followup') {
    try {
      await postDiscordFollowup(job.applicationId, job.token, job.content);
      logInfo('worker_discord_followup_sent', {
        ...context,
      });
    } catch (error) {
      logError('worker_discord_followup_failed', error, {
        ...context,
      });
    }
    return;
  }

  if (job.kind !== 'canvas.requested' && job.kind !== 'session.command') {
    return;
  }

  const interaction = job.interaction;
  if (!interaction?.applicationId || !interaction?.token) {
    logWarn('worker_discord_missing_interaction_metadata', {
      ...context,
      kind: job.kind,
    });
    return;
  }

  if (job.kind === 'canvas.requested') {
    try {
      await postDiscordFollowup(
        interaction.applicationId,
        interaction.token,
        `🎨 **Pixel Canvas est en ligne !**\n\n🔗 ${WEB_APP_URL}\n\nConnectez-vous avec Discord pour dessiner des pixels !`,
      );
      logInfo('worker_discord_canvas_followup_sent', {
        ...context,
        userId: job.userId ?? null,
      });
    } catch (error) {
      logError('worker_discord_canvas_followup_failed', error, {
        ...context,
        userId: job.userId ?? null,
      });
    }
    return;
  }

  const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
  if (!adminRoleId) {
    logError(
      'worker_discord_missing_admin_role_config',
      new Error('DISCORD_ADMIN_ROLE_ID is not configured'),
      {
        ...context,
        action: job.action,
        userId: job.userId,
      },
    );
    try {
      await postDiscordFollowup(
        interaction.applicationId,
        interaction.token,
        "Les commandes de session sont indisponibles : le rôle admin n'est pas configuré.",
        64,
      );
    } catch (error) {
      logError('worker_discord_admin_config_followup_failed', error, {
        ...context,
        action: job.action,
        userId: job.userId,
      });
    }
    return;
  }

  if (!interaction.roles?.includes(adminRoleId)) {
    logWarn('worker_discord_admin_role_rejected', {
      ...context,
      action: job.action,
      userId: job.userId,
    });
    try {
      await postDiscordFollowup(
        interaction.applicationId,
        interaction.token,
        "Vous n'êtes pas autorisé à gérer la session.",
        64,
      );
    } catch (error) {
      logError('worker_discord_admin_rejection_followup_failed', error, {
        ...context,
        action: job.action,
        userId: job.userId,
      });
    }
    return;
  }

  const now = Timestamp.now();
  const nextState = job.action === 'pause' ? 'paused' : 'running';
  let newRoundId: string | null = null;

  try {
    if (job.action === 'reset') {
      newRoundId = makeRoundId();
      await firestore.runTransaction(async (tx) => {
        tx.set(
          sessionRef,
          {
            state: nextState,
            roundId: newRoundId,
            updatedAt: now,
            updatedBy: job.userId,
            source: job.source,
            resetAt: now,
          },
          { merge: true },
        );
        // Overwrite current active bounds so the next draw starts a fresh round area.
        tx.set(activeAreaRef, {
          roundId: newRoundId,
          updatedAt: now,
          updatedBy: job.userId,
          source: job.source,
        });
      });
    } else {
      await sessionRef.set(
        {
          state: nextState,
          updatedAt: now,
          updatedBy: job.userId,
          source: job.source,
        },
        { merge: true },
      );
    }

    await postDiscordFollowup(
      interaction.applicationId,
      interaction.token,
      job.action === 'reset'
        ? 'Session réinitialisée : un nouveau round de canvas a démarré.'
        : `Session mise à jour : ${nextState === 'paused' ? 'en pause' : 'en cours'}.`,
    );
    logInfo('worker_discord_session_updated', {
      ...context,
      action: job.action,
      nextState,
      roundId: newRoundId,
      userId: job.userId,
    });
  } catch (error) {
    logError('worker_discord_session_update_failed', error, {
      ...context,
      action: job.action,
      nextState,
      roundId: newRoundId,
      userId: job.userId,
    });
    try {
      await postDiscordFollowup(
        interaction.applicationId,
        interaction.token,
        'Échec de la mise à jour de la session. Réessayez plus tard.',
        64,
      );
    } catch (followupError) {
      logError('worker_discord_session_error_followup_failed', followupError, {
        ...context,
        action: job.action,
        nextState,
        userId: job.userId,
      });
    }
  }
};
