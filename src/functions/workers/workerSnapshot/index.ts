import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { PNG } from 'pngjs';
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
const storage = new Storage();
const activeAreaRef = firestore.doc('activeArea/current');

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
};

const CHUNK_SIZE = toPositiveInt(process.env.CANVAS_CHUNK_SIZE, 50);
const SNAPSHOT_BUCKET = process.env.SNAPSHOT_BUCKET ?? '';
const DISCORD_ADMIN_ROLE_ID = process.env.DISCORD_ADMIN_ROLE_ID ?? '';
const SNAPSHOT_PIXEL_SCALE = toPositiveInt(process.env.SNAPSHOT_PIXEL_SCALE, 8);
const SNAPSHOT_MAX_DIM = toPositiveInt(process.env.SNAPSHOT_MAX_DIM, 2048);
const SNAPSHOT_URL_TTL_SECONDS = toPositiveInt(
  process.env.SNAPSHOT_URL_TTL_SECONDS,
  86400,
);
const SNAPSHOT_MAX_CHUNKS = toPositiveInt(process.env.SNAPSHOT_MAX_CHUNKS, 400);

type ActiveArea = {
  minX?: number;
  minY?: number;
  maxX?: number;
  maxY?: number;
};

type PixelRecord = {
  x: number;
  y: number;
  color: string;
};

type LoadedSnapshot = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: PixelRecord[];
};

const parseHexColor = (
  color: unknown,
): { r: number; g: number; b: number } | null => {
  if (typeof color !== 'string') {
    return null;
  }
  const normalized = color.trim().toLowerCase();
  if (!/^#?[0-9a-f]{6}$/.test(normalized)) {
    return null;
  }
  const value = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
};

const toInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return null;
};

const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.floor(value)));

const toChunkRange = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Array<{ chunkX: number; chunkY: number; chunkId: string }> => {
  const startChunkX = Math.floor(minX / CHUNK_SIZE);
  const startChunkY = Math.floor(minY / CHUNK_SIZE);
  const endChunkX = Math.floor(maxX / CHUNK_SIZE);
  const endChunkY = Math.floor(maxY / CHUNK_SIZE);

  const chunks: Array<{ chunkX: number; chunkY: number; chunkId: string }> = [];
  for (let chunkX = startChunkX; chunkX <= endChunkX; chunkX++) {
    for (let chunkY = startChunkY; chunkY <= endChunkY; chunkY++) {
      chunks.push({ chunkX, chunkY, chunkId: `${chunkX}_${chunkY}` });
    }
  }
  return chunks;
};

const loadSnapshotPixels = async (): Promise<LoadedSnapshot | null> => {
  const activeAreaSnap = await activeAreaRef.get();
  if (!activeAreaSnap.exists) {
    return null;
  }

  const activeData = activeAreaSnap.data() as ActiveArea;
  const minX = toInt(activeData.minX);
  const minY = toInt(activeData.minY);
  const maxX = toInt(activeData.maxX);
  const maxY = toInt(activeData.maxY);
  if (
    minX === null ||
    minY === null ||
    maxX === null ||
    maxY === null ||
    minX > maxX ||
    minY > maxY
  ) {
    return null;
  }

  const chunks = toChunkRange(minX, minY, maxX, maxY);
  if (chunks.length > SNAPSHOT_MAX_CHUNKS) {
    throw new Error(
      `Snapshot area is too large (${chunks.length} chunks > ${SNAPSHOT_MAX_CHUNKS}).`,
    );
  }

  const chunkSnapshots = await Promise.all(
    chunks.map(({ chunkId }) => firestore.collection(`chunks/${chunkId}/pixels`).get()),
  );

  const dedup = new Map<string, PixelRecord>();
  for (const chunkSnap of chunkSnapshots) {
    for (const doc of chunkSnap.docs) {
      const data = doc.data() as { x?: unknown; y?: unknown; color?: unknown };
      const x = toInt(data.x);
      const y = toInt(data.y);
      if (x === null || y === null) {
        continue;
      }
      if (x < minX || x > maxX || y < minY || y > maxY) {
        continue;
      }
      const parsed = parseHexColor(data.color);
      if (!parsed) {
        continue;
      }
      dedup.set(`${x}_${y}`, {
        x,
        y,
        color: `#${parsed.r.toString(16).padStart(2, '0')}${parsed.g
          .toString(16)
          .padStart(2, '0')}${parsed.b.toString(16).padStart(2, '0')}`,
      });
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    pixels: Array.from(dedup.values()),
  };
};

const paintRect = (
  png: PNG,
  x: number,
  y: number,
  size: number,
  r: number,
  g: number,
  b: number,
) => {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = x + dx;
      const py = y + dy;
      const offset = (py * png.width + px) * 4;
      png.data[offset] = r;
      png.data[offset + 1] = g;
      png.data[offset + 2] = b;
      png.data[offset + 3] = 255;
    }
  }
};

const renderSnapshotPng = (
  loaded: LoadedSnapshot,
): { buffer: Buffer; width: number; height: number; scale: number } => {
  const gridWidth = loaded.maxX - loaded.minX + 1;
  const gridHeight = loaded.maxY - loaded.minY + 1;
  const maxScaleByBounds = Math.max(
    1,
    Math.floor(Math.min(SNAPSHOT_MAX_DIM / gridWidth, SNAPSHOT_MAX_DIM / gridHeight)),
  );
  const scale = clampInt(SNAPSHOT_PIXEL_SCALE, 1, maxScaleByBounds);
  const width = gridWidth * scale;
  const height = gridHeight * scale;

  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 15;
    png.data[i + 1] = 18;
    png.data[i + 2] = 24;
    png.data[i + 3] = 255;
  }

  for (const pixel of loaded.pixels) {
    const rgb = parseHexColor(pixel.color);
    if (!rgb) {
      continue;
    }
    const screenX = (pixel.x - loaded.minX) * scale;
    const screenY = (pixel.y - loaded.minY) * scale;
    paintRect(png, screenX, screenY, scale, rgb.r, rgb.g, rgb.b);
  }

  return {
    buffer: PNG.sync.write(png),
    width,
    height,
    scale,
  };
};

const uploadSnapshot = async (
  pngBuffer: Buffer,
  userId: string,
): Promise<{ url: string }> => {
  if (!SNAPSHOT_BUCKET) {
    throw new Error('SNAPSHOT_BUCKET is not configured.');
  }
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timestamp = now.toISOString().replace(/[.:]/g, '-');
  const objectPath = `snapshots/${day}/snapshot-${userId}-${timestamp}.png`;

  const file = storage.bucket(SNAPSHOT_BUCKET).file(objectPath);
  await file.save(pngBuffer, {
    resumable: false,
    contentType: 'image/png',
    metadata: {
      cacheControl: 'private, max-age=0, no-transform',
    },
  });

  const expiresMs =
    Date.now() + clampInt(SNAPSHOT_URL_TTL_SECONDS, 300, 7 * 24 * 60 * 60) * 1000;
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresMs,
  });

  return { url };
};

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
    logWarn('worker_snapshot_missing_message_data', {
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
      logError('worker_snapshot_parse_failed', fallbackError, {
        eventId: event.id ?? null,
        primaryError: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
};

export const workerSnapshot = async (event: CloudEvent<PubSubEnvelope>) => {
  const job = parseJob(event);
  if (!job || job.kind !== 'snapshot.requested') {
    return;
  }
  const context = getWorkerContext(event, job);

  if (!job.interaction?.applicationId || !job.interaction.token) {
    logWarn('worker_snapshot_missing_interaction_metadata', {
      ...context,
      userId: job.userId,
    });
    return;
  }

  if (
    DISCORD_ADMIN_ROLE_ID &&
    !job.interaction.roles?.includes(DISCORD_ADMIN_ROLE_ID)
  ) {
    logWarn('worker_snapshot_admin_role_rejected', {
      ...context,
      userId: job.userId,
    });
    try {
      await postDiscordFollowup(
        job.interaction.applicationId,
        job.interaction.token,
        'You are not allowed to create snapshots.',
        64,
      );
    } catch (error) {
      logError('worker_snapshot_admin_rejection_followup_failed', error, {
        ...context,
        userId: job.userId,
      });
    }
    return;
  }

  try {
    const loaded = await loadSnapshotPixels();
    if (!loaded || loaded.pixels.length === 0) {
      logInfo('worker_snapshot_no_pixels', {
        ...context,
        userId: job.userId,
      });
      await postDiscordFollowup(
        job.interaction.applicationId,
        job.interaction.token,
        'No pixels found to snapshot yet.',
        64,
      );
      return;
    }

    const rendered = renderSnapshotPng(loaded);
    const uploaded = await uploadSnapshot(rendered.buffer, job.userId);

    await postDiscordFollowup(
      job.interaction.applicationId,
      job.interaction.token,
      {
        content: [
          `${rendered.width}x${rendered.height}px (x${rendered.scale})`,
          `Pixels: ${loaded.pixels.length}`,
        ].join('\n'),
        embeds: [
          {
            image: {
              url: uploaded.url,
            },
          },
        ],
      },
    );
    logInfo('worker_snapshot_completed', {
      ...context,
      userId: job.userId,
      width: rendered.width,
      height: rendered.height,
      scale: rendered.scale,
      pixels: loaded.pixels.length,
    });
  } catch (error) {
    logError('worker_snapshot_failed', error, {
      ...context,
      userId: job.userId,
    });
    try {
      await postDiscordFollowup(
        job.interaction.applicationId,
        job.interaction.token,
        `Snapshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        64,
      );
    } catch (followupError) {
      logError('worker_snapshot_error_followup_failed', followupError, {
        ...context,
        userId: job.userId,
      });
    }
  }
};
