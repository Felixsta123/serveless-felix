import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import admin from 'firebase-admin';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import {
  JobPayload,
  WebActiveAreaRequestedJobPayload,
  WebCanvasRequestedJobPayload,
  WebRealtimeTokenRequestedJobPayload,
} from '../../shared/queue.js';
import {
  getWorkerContext,
  logError,
  logInfo,
} from '../../shared/observability.js';
import { parseJob } from '../../shared/pubsubJob.js';
import { runWithSpan } from '../../shared/tracing.js';
import { parseIntStrict, toRoundId } from '../../shared/validation.js';
import { toChunkRange } from '../../shared/canvasMath.js';
import { toPositiveInt } from '../../shared/env.js';

const firestore = new Firestore();
const CHUNK_SIZE = toPositiveInt(process.env.CANVAS_CHUNK_SIZE, 50);
const REQUEST_RESPONSE_TTL_SECONDS = toPositiveInt(process.env.REQUEST_RESPONSE_TTL_SECONDS, 900);

const adminAuth = () => {
  const app = admin.apps.length > 0 ? admin.app() : admin.initializeApp();
  return admin.auth(app);
};

type ActiveAreaRecord = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  roundId: string | null;
};

type PixelRecord = {
  x: number;
  y: number;
  color: string;
  authorId: string;
  authorUsername: string | null;
  updatedAt: string | null;
};

type CanvasWindowPayload = {
  roundId: string | null;
  window: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    size: number;
  };
  activeArea: ActiveAreaRecord;
  pixels: PixelRecord[];
};

const isWebReadJob = (
  job: JobPayload,
): job is
  | WebActiveAreaRequestedJobPayload
  | WebCanvasRequestedJobPayload
  | WebRealtimeTokenRequestedJobPayload =>
  job.kind === 'web.activeArea.requested' ||
  job.kind === 'web.canvas.requested' ||
  job.kind === 'web.realtimeToken.requested';

const requestResponseRef = (requestId: string) =>
  firestore.doc(`requestResponses/${requestId}`);

const buildResponseExpiry = (): Timestamp =>
  Timestamp.fromDate(new Date(Date.now() + REQUEST_RESPONSE_TTL_SECONDS * 1000));

const writeReady = async (
  requestId: string,
  ownerUserId: string,
  kind: string,
  payload: unknown,
): Promise<void> => {
  const now = Timestamp.now();
  await requestResponseRef(requestId).set(
    {
      ownerUserId,
      kind,
      status: 'ready',
      payload,
      error: null,
      updatedAt: now,
      expiresAt: buildResponseExpiry(),
    },
    { merge: true },
  );
};

const writeError = async (
  requestId: string,
  ownerUserId: string,
  kind: string,
  message: string,
): Promise<void> => {
  const now = Timestamp.now();
  await requestResponseRef(requestId).set(
    {
      ownerUserId,
      kind,
      status: 'error',
      payload: null,
      error: message,
      updatedAt: now,
      expiresAt: buildResponseExpiry(),
    },
    { merge: true },
  );
};

const toTimestampIso = (value: unknown): string | null => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  return null;
};

const readActiveArea = (data: Record<string, unknown>): ActiveAreaRecord => ({
  minX: parseIntStrict(data.minX) ?? 0,
  minY: parseIntStrict(data.minY) ?? 0,
  maxX: parseIntStrict(data.maxX) ?? 0,
  maxY: parseIntStrict(data.maxY) ?? 0,
  roundId: toRoundId(data.roundId),
});

const loadActiveArea = async (): Promise<ActiveAreaRecord> => {
  const snap = await firestore.doc('activeArea/current').get();
  if (!snap.exists) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, roundId: null };
  }
  return readActiveArea((snap.data() as Record<string, unknown> | undefined) ?? {});
};

const loadCanvasWindow = async (
  windowQuery: WebCanvasRequestedJobPayload,
): Promise<CanvasWindowPayload> => {
  const minX = windowQuery.offsetX;
  const minY = windowQuery.offsetY;
  const maxX = windowQuery.offsetX + windowQuery.size - 1;
  const maxY = windowQuery.offsetY + windowQuery.size - 1;

  const activeArea = await loadActiveArea();

  const chunks = toChunkRange(minX, minY, maxX, maxY, CHUNK_SIZE);
  const chunkSnapshots = await Promise.all(
    chunks.map(({ chunkId }) => {
      const col = firestore.collection(`chunks/${chunkId}/pixels`);
      return activeArea.roundId ? col.where('roundId', '==', activeArea.roundId).get() : col.get();
    }),
  );

  const dedup = new Map<string, PixelRecord>();
  for (const chunkSnap of chunkSnapshots) {
    for (const doc of chunkSnap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const x = parseIntStrict(data.x);
      const y = parseIntStrict(data.y);
      if (x === null || y === null) {
        continue;
      }
      if (x < minX || x > maxX || y < minY || y > maxY) {
        continue;
      }
      const color = typeof data.color === 'string' ? data.color : null;
      const authorId = typeof data.authorId === 'string' ? data.authorId : null;
      if (!color || !authorId) {
        continue;
      }
      const authorUsername =
        typeof data.authorUsername === 'string' && data.authorUsername.trim() !== ''
          ? data.authorUsername
          : null;
      dedup.set(`${x}_${y}`, {
        x,
        y,
        color,
        authorId,
        authorUsername,
        updatedAt: toTimestampIso(data.updatedAt),
      });
    }
  }

  return {
    roundId: activeArea.roundId,
    window: { minX, minY, maxX, maxY, size: windowQuery.size },
    activeArea,
    pixels: Array.from(dedup.values()),
  };
};

const processJob = async (
  job:
    | WebActiveAreaRequestedJobPayload
    | WebCanvasRequestedJobPayload
    | WebRealtimeTokenRequestedJobPayload,
): Promise<void> => {
  if (job.kind === 'web.activeArea.requested') {
    const payload = await loadActiveArea();
    await writeReady(job.responseRequestId, job.userId, job.kind, payload);
    return;
  }

  if (job.kind === 'web.canvas.requested') {
    const payload = await loadCanvasWindow(job);
    await writeReady(job.responseRequestId, job.userId, job.kind, payload);
    return;
  }

  const token = await adminAuth().createCustomToken(job.userId, {
    discordUsername: job.discordUsername,
  });
  await writeReady(job.responseRequestId, job.userId, job.kind, { token });
};

export const workerWebRead = async (event: CloudEvent<PubSubEnvelope>) =>
  runWithSpan(
    'workerWebRead.pubsub',
    {
      'faas.trigger': 'pubsub',
      'messaging.system': 'pubsub',
      'messaging.destination': 'jobs',
      'messaging.operation': 'process',
    },
    async () => {
      const job = parseJob(
        event,
        'worker_webread_parse_failed',
        'worker_webread_missing_message_data',
      );
      if (!job || !isWebReadJob(job)) {
        return;
      }

      const context = getWorkerContext(event, job);

      try {
        await processJob(job);
        logInfo('worker_webread_processed', {
          ...context,
          userId: job.userId,
          kind: job.kind,
          responseRequestId: job.responseRequestId,
        });
      } catch (error) {
        logError('worker_webread_failed', error, {
          ...context,
          userId: job.userId,
          kind: job.kind,
          responseRequestId: job.responseRequestId,
        });

        const message = error instanceof Error ? error.message : 'Request processing failed';
        try {
          await writeError(job.responseRequestId, job.userId, job.kind, message);
        } catch (writeErrorFailure) {
          logError('worker_webread_write_error_failed', writeErrorFailure, {
            ...context,
            userId: job.userId,
            kind: job.kind,
            responseRequestId: job.responseRequestId,
          });
        }
      }
    },
  );
