import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp, FieldValue } from '@google-cloud/firestore';
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

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
const CHUNK_SIZE = Number(process.env.CANVAS_CHUNK_SIZE ?? 50);

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
    logWarn('worker_draw_missing_message_data', {
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
      logError('worker_draw_parse_failed', fallbackError, {
        eventId: event.id ?? null,
        primaryError: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
};

const toMinuteKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}`;
};

const chunkIdFor = (x: number, y: number): string => {
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  return `${chunkX}_${chunkY}`;
};

const pixelIdFor = (x: number, y: number): string => `${x}_${y}`;
const toRoundId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

export const workerDraw = async (event: CloudEvent<PubSubEnvelope>) => {
  const job = parseJob(event);
  if (!job || job.kind !== 'draw.requested') {
    return;
  }
  const context = getWorkerContext(event, job);

  const eventId =
    job.interaction?.id ?? `${job.userId}:${job.receivedAt}:${job.x}:${job.y}`;
  const now = new Date();
  const minuteKey = toMinuteKey(now);
  const chunkId = chunkIdFor(job.x, job.y);
  const pixelId = pixelIdFor(job.x, job.y);

  const idempotencyRef = firestore.doc(`idempotency/${eventId}`);
  const rateRef = firestore.doc(`rate/${job.userId}/minutes/${minuteKey}`);
  const pixelRef = firestore.doc(`chunks/${chunkId}/pixels/${pixelId}`);
  const eventRef = firestore.doc(`eventsByDay/${minuteKey.slice(0, 8)}/items/${eventId}`);

  let result: { status: 'duplicate' | 'paused' | 'rate_limited' | 'ok' };
  try {
    result = await firestore.runTransaction(async (tx) => {
      const [idempotencySnap, rateSnap, pixelSnap, sessionSnap, activeSnap] =
        await Promise.all([
          tx.get(idempotencyRef),
          tx.get(rateRef),
          tx.get(pixelRef),
          tx.get(sessionRef),
          tx.get(activeAreaRef),
        ]);

      if (idempotencySnap.exists) {
        return { status: 'duplicate' as const };
      }

      const sessionState = sessionSnap.exists
        ? (sessionSnap.data()?.state as string | undefined)
        : 'running';
      if (sessionState === 'paused') {
        return { status: 'paused' as const };
      }
      const sessionRoundId = toRoundId(sessionSnap.data()?.roundId);

      const currentCount = (rateSnap.data()?.count as number | undefined) ?? 0;
      if (currentCount >= RATE_LIMIT_PER_MINUTE) {
        return { status: 'rate_limited' as const };
      }

      const pixelData = pixelSnap.data() as
        | { color?: unknown; roundId?: unknown }
        | undefined;
      const sameRoundAsCurrent =
        !sessionRoundId || toRoundId(pixelData?.roundId) === sessionRoundId;
      const oldColor =
        sameRoundAsCurrent && typeof pixelData?.color === 'string'
          ? pixelData.color
          : undefined;
      const timestamp = Timestamp.now();

      tx.set(idempotencyRef, { createdAt: timestamp });
      tx.set(rateRef, { count: FieldValue.increment(1) }, { merge: true });
      tx.set(
        pixelRef,
        {
          x: job.x,
          y: job.y,
          color: job.color,
          updatedAt: timestamp,
          authorId: job.userId,
          ...(sessionRoundId ? { roundId: sessionRoundId } : {}),
        },
        { merge: true },
      );
      tx.set(
        eventRef,
        {
          ts: timestamp,
          source: job.source,
          userId: job.userId,
          guildId: job.interaction?.guildId ?? null,
          x: job.x,
          y: job.y,
          newColor: job.color,
          oldColor: oldColor ?? null,
          roundId: sessionRoundId,
        },
        { merge: true },
      );

      const activeData = activeSnap.data() as
        | {
            minX?: number;
            minY?: number;
            maxX?: number;
            maxY?: number;
            roundId?: unknown;
          }
        | undefined;
      const isFreshRound =
        Boolean(sessionRoundId) && toRoundId(activeData?.roundId) !== sessionRoundId;
      const next = {
        minX: isFreshRound ? job.x : (activeData?.minX ?? job.x),
        minY: isFreshRound ? job.y : (activeData?.minY ?? job.y),
        maxX: isFreshRound ? job.x : (activeData?.maxX ?? job.x),
        maxY: isFreshRound ? job.y : (activeData?.maxY ?? job.y),
      };
      tx.set(
        activeAreaRef,
        {
          minX: Math.min(next.minX, job.x),
          minY: Math.min(next.minY, job.y),
          maxX: Math.max(next.maxX, job.x),
          maxY: Math.max(next.maxY, job.y),
          updatedAt: timestamp,
          ...(sessionRoundId ? { roundId: sessionRoundId } : {}),
        },
        { merge: true },
      );

      return { status: 'ok' as const };
    });
  } catch (error) {
    logError('worker_draw_transaction_failed', error, {
      ...context,
      userId: job.userId,
      source: job.source,
      x: job.x,
      y: job.y,
    });
    return;
  }

  logInfo('worker_draw_processed', {
    ...context,
    status: result.status,
    userId: job.userId,
    source: job.source,
    x: job.x,
    y: job.y,
  });

  if (job.source !== 'discord' || !job.interaction?.applicationId || !job.interaction.token) {
    return;
  }

  const { applicationId, token } = job.interaction;
  const send = async (content: string, flags?: number) => {
    try {
      await postDiscordFollowup(applicationId, token, content, flags);
    } catch (error) {
      logError('worker_draw_followup_failed', error, {
        ...context,
        status: result.status,
        userId: job.userId,
      });
    }
  };

  switch (result.status) {
    case 'ok':
      await send(`Pixel mis à jour en (${job.x}, ${job.y}) avec ${job.color}.`);
      break;
    case 'rate_limited':
      await send(
        `Limite de débit atteinte (${RATE_LIMIT_PER_MINUTE}/min). Réessayez plus tard.`,
        64,
      );
      break;
    case 'paused':
      await send('La session est en pause.', 64);
      break;
    case 'duplicate':
      await send('Requête de dessin en doublon ignorée.', 64);
      break;
    default:
      await send('Échec du traitement de la commande de dessin.', 64);
  }
};
