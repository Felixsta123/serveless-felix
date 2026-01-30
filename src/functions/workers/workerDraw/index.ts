import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp, FieldValue } from '@google-cloud/firestore';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { JobPayload } from '../../shared/queue.js';
import { postDiscordFollowup } from '../../shared/discordApi.js';

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
    console.log('workerDraw missing message data', {
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
      console.error('workerDraw failed to parse job payload', error, fallbackError);
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

export const workerDraw = async (event: CloudEvent<PubSubEnvelope>) => {
  const job = parseJob(event);
  if (!job || job.kind !== 'draw.requested') {
    return;
  }

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

  const result = await firestore.runTransaction(async (tx) => {
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

    const currentCount = (rateSnap.data()?.count as number | undefined) ?? 0;
    if (currentCount >= RATE_LIMIT_PER_MINUTE) {
      return { status: 'rate_limited' as const };
    }

    const oldColor = pixelSnap.data()?.color as string | undefined;
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
      },
      { merge: true },
    );

    const activeData = activeSnap.data() as
      | { minX?: number; minY?: number; maxX?: number; maxY?: number }
      | undefined;
    const next = {
      minX: activeData?.minX ?? job.x,
      minY: activeData?.minY ?? job.y,
      maxX: activeData?.maxX ?? job.x,
      maxY: activeData?.maxY ?? job.y,
    };
    tx.set(
      activeAreaRef,
      {
        minX: Math.min(next.minX, job.x),
        minY: Math.min(next.minY, job.y),
        maxX: Math.max(next.maxX, job.x),
        maxY: Math.max(next.maxY, job.y),
        updatedAt: timestamp,
      },
      { merge: true },
    );

    return { status: 'ok' as const };
  });

  if (job.source !== 'discord' || !job.interaction?.applicationId || !job.interaction.token) {
    return;
  }

  const { applicationId, token } = job.interaction;
  const send = async (content: string, flags?: number) => {
    try {
      await postDiscordFollowup(applicationId, token, content, flags);
    } catch (error) {
      console.error('workerDraw failed to send followup', error);
    }
  };

  switch (result.status) {
    case 'ok':
      await send(`Pixel updated at (${job.x}, ${job.y}) to ${job.color}.`);
      break;
    case 'rate_limited':
      await send('Rate limit reached (20/min). Try again later.', 64);
      break;
    case 'paused':
      await send('The session is paused.', 64);
      break;
    case 'duplicate':
      await send('Duplicate draw request ignored.', 64);
      break;
    default:
      await send('Failed to process draw command.', 64);
  }
};
