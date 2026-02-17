import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import crypto from 'node:crypto';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { postDiscordFollowup } from '../../shared/discordApi.js';
import {
  getWorkerContext,
  logError,
  logInfo,
  logWarn,
} from '../../shared/observability.js';
import { parseJob } from '../../shared/pubsubJob.js';
import { runWithSpan } from '../../shared/tracing.js';

const firestore = new Firestore();
const sessionRef = firestore.doc('config/session');
const activeAreaRef = firestore.doc('activeArea/current');
const makeRoundId = (): string => `round-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

export const workerDiscord = async (event: CloudEvent<PubSubEnvelope>) =>
  runWithSpan(
    'workerDiscord.pubsub',
    {
      'faas.trigger': 'pubsub',
      'messaging.system': 'pubsub',
      'messaging.destination': 'jobs',
      'messaging.operation': 'process',
    },
    async () => {
  const job = parseJob(
    event,
    'worker_discord_parse_failed',
    'worker_discord_missing_message_data',
  );
  if (!job) {
    logWarn('worker_discord_ignored_invalid_payload', {
      eventId: event.id ?? null,
    });
    return;
  }
  const context = getWorkerContext(event, job);
  if (job.kind !== 'session.command') {
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
    },
  );
