import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
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
const latestSnapshotRef = firestore.doc('snapshots/latest');
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';
const SNAPSHOT_BUCKET = process.env.SNAPSHOT_BUCKET ?? '';
const SNAPSHOT_URL_TTL_SECONDS = Number(process.env.SNAPSHOT_URL_TTL_SECONDS ?? 86400);

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
    typeof data.objectPath === 'string' && data.objectPath.trim() ? data.objectPath : null;

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

export const workerDiscordCanvas = async (event: CloudEvent<PubSubEnvelope>) =>
  runWithSpan(
    'workerDiscordCanvas.pubsub',
    {
      'faas.trigger': 'pubsub',
      'messaging.system': 'pubsub',
      'messaging.destination': 'jobs',
      'messaging.operation': 'process',
    },
    async () => {
      const job = parseJob(
        event,
        'worker_discord_canvas_parse_failed',
        'worker_discord_canvas_missing_message_data',
      );
      if (!job || job.kind !== 'canvas.requested') {
        return;
      }

      const context = getWorkerContext(event, job);
      const interaction = job.interaction;
      if (!interaction?.applicationId || !interaction?.token) {
        logWarn('worker_discord_canvas_missing_interaction_metadata', {
          ...context,
          userId: job.userId ?? null,
        });
        return;
      }

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
          await postDiscordFollowup(interaction.applicationId, interaction.token, content);
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
    },
  );
