import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
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
const storage = new Storage();
const sessionRef = firestore.doc('config/session');
const activeAreaRef = firestore.doc('activeArea/current');
const latestSnapshotRef = firestore.doc('snapshots/latest');
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';
const SNAPSHOT_BUCKET = process.env.SNAPSHOT_BUCKET ?? '';
const SNAPSHOT_URL_TTL_SECONDS = Number(process.env.SNAPSHOT_URL_TTL_SECONDS ?? 86400);
const makeRoundId = (): string => `round-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

type LatestSnapshotDoc = {
  objectPath?: unknown;
};

const clampSnapshotTtlSeconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 86400;
  }
  return Math.min(7 * 24 * 60 * 60, Math.max(300, Math.floor(value)));
};

const findLatestSnapshotObjectPath = async (): Promise<string | null> => {
  if (!SNAPSHOT_BUCKET) {
    return null;
  }

  const [files] = await storage.bucket(SNAPSHOT_BUCKET).getFiles({ prefix: 'snapshots/' });
  if (files.length === 0) {
    return null;
  }

  let latestName: string | null = null;
  let latestTimestamp = 0;

  for (const file of files) {
    const name = typeof file.name === 'string' ? file.name : '';
    if (!name || name.endsWith('/')) {
      continue;
    }
    const updatedAt = file.metadata?.updated;
    const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    const candidateTs = Number.isFinite(updatedMs) ? updatedMs : 0;
    if (candidateTs >= latestTimestamp) {
      latestTimestamp = candidateTs;
      latestName = name;
    }
  }

  return latestName;
};

const getLatestSnapshotUrl = async (): Promise<string | null> => {
  if (!SNAPSHOT_BUCKET) {
    return null;
  }

  const latestSnap = await latestSnapshotRef.get();
  if (!latestSnap.exists) {
    return null;
  }

  const data = latestSnap.data() as LatestSnapshotDoc;
  const objectPath =
    typeof data.objectPath === 'string' && data.objectPath.trim()
      ? data.objectPath
      : null;
  let resolvedObjectPath = objectPath;
  if (!resolvedObjectPath) {
    resolvedObjectPath = await findLatestSnapshotObjectPath();
    if (!resolvedObjectPath) {
      return null;
    }
    await latestSnapshotRef.set(
      {
        objectPath: resolvedObjectPath,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  }

  const expiresMs = Date.now() + clampSnapshotTtlSeconds(SNAPSHOT_URL_TTL_SECONDS) * 1000;
  const [url] = await storage.bucket(SNAPSHOT_BUCKET).file(resolvedObjectPath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresMs,
  });
  return url;
};

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
      const latestSnapshotUrl = await getLatestSnapshotUrl();
      if (latestSnapshotUrl) {
        await postDiscordFollowup(interaction.applicationId, interaction.token, {
          content: WEB_APP_URL
            ? `🖼️ **Dernier snapshot du canvas**\n\n🔗 Canvas live: ${WEB_APP_URL}`
            : '🖼️ **Dernier snapshot du canvas**',
          embeds: [
            {
              image: {
                url: latestSnapshotUrl,
              },
            },
          ],
        });
      } else {
        const content = WEB_APP_URL
          ? `🖼️ Aucun snapshot disponible pour le moment.\n\n🔗 Canvas live: ${WEB_APP_URL}`
          : '🖼️ Aucun snapshot disponible pour le moment.';
        await postDiscordFollowup(
          interaction.applicationId,
          interaction.token,
          content,
        );
      }
      logInfo('worker_discord_canvas_followup_sent', {
        ...context,
        userId: job.userId ?? null,
        hasSnapshot: Boolean(latestSnapshotUrl),
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
