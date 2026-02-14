import { HttpFunction } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { DrawJobPayload, publishJob } from '../../shared/queue.js';
import {
  getHttpRequestContext,
  logError,
  logInfo,
  logWarn,
  type RequestContext,
} from '../../shared/observability.js';

const firestore = new Firestore();
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';
const STATE_PATTERN = /^[a-f0-9]{32}$/i;
const CHUNK_SIZE = Number(process.env.CANVAS_CHUNK_SIZE ?? 50);

type SessionData = {
  discordUserId: string;
  discordUsername: string;
  discordAvatar: string | null;
  token: string;
  firebaseCustomToken?: string;
  state: string;
  expiresAt: Timestamp;
  status: string;
  error?: string;
};

type PixelRecord = {
  x: number;
  y: number;
  color: string;
  authorId: string;
  updatedAt: string | null;
};

const setCorsHeaders = (res: Parameters<HttpFunction>[1]) => {
  if (WEB_APP_URL) {
    res.set('Access-Control-Allow-Origin', WEB_APP_URL);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.set('Access-Control-Allow-Credentials', 'true');
};

const validateSession = async (
  sessionToken: string | undefined,
  requestContext: RequestContext,
  path: string,
): Promise<SessionData | null> => {
  if (!sessionToken) {
    logWarn('web_proxy_session_token_missing', {
      ...requestContext,
      path,
    });
    return null;
  }
  const token = sessionToken.trim();
  if (!token) {
    logWarn('web_proxy_session_token_empty', {
      ...requestContext,
      path,
    });
    return null;
  }

  // Find session by token
  const sessionsRef = firestore.collection('sessions');
  const query = sessionsRef.where('token', '==', token).limit(1);
  const snapshot = await query.get();

  if (snapshot.empty) {
    logWarn('web_proxy_session_not_found', {
      ...requestContext,
      path,
    });
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data() as SessionData;

  if (data.status !== 'ready') {
    logWarn('web_proxy_session_not_ready', {
      ...requestContext,
      path,
      userId: data.discordUserId,
      status: data.status,
    });
    return null;
  }

  // Check expiration
  if (!data.expiresAt || data.expiresAt.toDate() < new Date()) {
    logWarn('web_proxy_session_expired', {
      ...requestContext,
      path,
      userId: data.discordUserId,
    });
    return null;
  }

  return data;
};

const parseIntParam = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizeColor = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!/^#?[0-9a-f]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = parseIntParam(value);
  if (parsed === null || parsed < 1) {
    return null;
  }
  return parsed;
};

const toTimestampIso = (value: unknown): string | null => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  return null;
};

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

export const webProxy: HttpFunction = async (req, res) => {
  const requestContext = getHttpRequestContext(req);

  if (!WEB_APP_URL) {
    logError('web_proxy_missing_web_app_url', new Error('WEB_APP_URL is not configured'), {
      ...requestContext,
      path: req.path,
      method: req.method,
    });
    res.status(500).json({ error: 'WEB_APP_URL is not configured' });
    return;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    logInfo('web_proxy_preflight', {
      ...requestContext,
      path: req.path,
    });
    res.status(204).send('');
    return;
  }

  // Normalize path - handle both /session and /web/session formats
  let path = req.path || '/';
  if (path.startsWith('/web/')) {
    path = path.slice(4); // Remove /web prefix
  }
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // GET /session?state=xxx - Poll for session status (used after OAuth callback)
  if (req.method === 'GET' && path === '/session') {
    const state = req.query.state as string | undefined;
    if (!state) {
      logWarn('web_proxy_session_missing_state', {
        ...requestContext,
        path,
      });
      res.status(400).json({ error: 'Missing state parameter' });
      return;
    }
    if (!STATE_PATTERN.test(state)) {
      logWarn('web_proxy_session_invalid_state', {
        ...requestContext,
        path,
      });
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    const sessionRef = firestore.doc(`sessions/${state}`);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
      logInfo('web_proxy_session_pending_not_found', {
        ...requestContext,
        path,
        state,
      });
      res.status(404).json({ status: 'pending' });
      return;
    }

    const data = sessionSnap.data() as SessionData;
    if (data.status === 'error') {
      logWarn('web_proxy_session_error', {
        ...requestContext,
        path,
        state,
      });
      res.status(400).json({ status: 'error', error: data.error });
      return;
    }

    if (data.status === 'ready') {
      if (!data.token) {
        logError(
          'web_proxy_session_missing_token',
          new Error('Session is missing API token'),
          {
            ...requestContext,
            path,
            state,
          },
        );
        res.status(500).json({ status: 'error', error: 'Session is missing API token' });
        return;
      }
      logInfo('web_proxy_session_ready', {
        ...requestContext,
        path,
        state,
        userId: data.discordUserId,
      });
      res.status(200).json({
        status: 'ready',
        apiToken: data.token,
        user: {
          id: data.discordUserId,
          username: data.discordUsername,
          avatar: data.discordAvatar,
        },
      });
      return;
    }

    res.status(200).json({ status: 'pending' });
    return;
  }

  // POST /draw - Draw a pixel (authenticated)
  if (req.method === 'POST' && path === '/draw') {
    const session = await validateSession(
      req.headers['x-session-token'] as string | undefined,
      requestContext,
      path,
    );
    if (!session) {
      logWarn('web_proxy_draw_unauthorized', {
        ...requestContext,
        path,
      });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      logWarn('web_proxy_draw_missing_body', {
        ...requestContext,
        path,
        userId: session.discordUserId,
      });
      res.status(400).json({ error: 'Missing request body' });
      return;
    }

    const x = parseIntParam(body.x);
    const y = parseIntParam(body.y);
    const color = normalizeColor(body.color);

    if (x === null || y === null || !color) {
      logWarn('web_proxy_draw_invalid_params', {
        ...requestContext,
        path,
        userId: session.discordUserId,
      });
      res.status(400).json({ error: 'Invalid parameters. Required: x (int), y (int), color (hex)' });
      return;
    }

    const payload: DrawJobPayload = {
      kind: 'draw.requested',
      receivedAt: new Date().toISOString(),
      correlationId: requestContext.correlationId,
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
      source: 'web',
      userId: session.discordUserId,
      x,
      y,
      color,
    };

    try {
      await publishJob(payload, { source: 'web', kind: 'draw.requested' });
      logInfo('web_proxy_draw_enqueued', {
        ...requestContext,
        path,
        userId: session.discordUserId,
        x,
        y,
      });
    } catch (error) {
      logError('web_proxy_draw_publish_failed', error, {
        ...requestContext,
        path,
        userId: session.discordUserId,
        x,
        y,
      });
      res.status(500).json({ error: 'Failed to enqueue draw request' });
      return;
    }

    res.status(202).json({ message: 'Draw request accepted' });
    return;
  }

  // GET /active-area - Active canvas bounds (authenticated)
  if (req.method === 'GET' && path === '/active-area') {
    const session = await validateSession(
      req.headers['x-session-token'] as string | undefined,
      requestContext,
      path,
    );
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const snap = await firestore.doc('activeArea/current').get();
      if (!snap.exists) {
        res.status(200).json({ minX: 0, minY: 0, maxX: 0, maxY: 0, roundId: null });
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      res.status(200).json({
        minX: parseIntParam(data.minX) ?? 0,
        minY: parseIntParam(data.minY) ?? 0,
        maxX: parseIntParam(data.maxX) ?? 0,
        maxY: parseIntParam(data.maxY) ?? 0,
        roundId: typeof data.roundId === 'string' ? data.roundId : null,
      });
      return;
    } catch (error) {
      logError('web_proxy_active_area_failed', error, {
        ...requestContext,
        path,
        userId: session.discordUserId,
      });
      res.status(500).json({ error: 'Failed to read active area' });
      return;
    }
  }

  // GET /canvas - Read visible canvas window (authenticated)
  if (req.method === 'GET' && path === '/canvas') {
    const session = await validateSession(
      req.headers['x-session-token'] as string | undefined,
      requestContext,
      path,
    );
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const offsetX = parseIntParam(req.query.offsetX);
    const offsetY = parseIntParam(req.query.offsetY);
    const size = parsePositiveInt(req.query.size);

    if (offsetX === null || offsetY === null || size === null || size > 500) {
      res.status(400).json({
        error: 'Invalid query params. Required: offsetX (int), offsetY (int), size (1-500)',
      });
      return;
    }

    const minX = offsetX;
    const minY = offsetY;
    const maxX = offsetX + size - 1;
    const maxY = offsetY + size - 1;

    try {
      const activeSnap = await firestore.doc('activeArea/current').get();
      const activeData = (activeSnap.data() as Record<string, unknown> | undefined) ?? {};
      const roundId = typeof activeData.roundId === 'string' ? activeData.roundId : null;

      const chunks = toChunkRange(minX, minY, maxX, maxY);
      const chunkSnapshots = await Promise.all(
        chunks.map(({ chunkId }) => {
          const col = firestore.collection(`chunks/${chunkId}/pixels`);
          return roundId ? col.where('roundId', '==', roundId).get() : col.get();
        }),
      );

      const dedup = new Map<string, PixelRecord>();
      for (const chunkSnap of chunkSnapshots) {
        for (const doc of chunkSnap.docs) {
          const data = doc.data() as Record<string, unknown>;
          const x = parseIntParam(data.x);
          const y = parseIntParam(data.y);
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
          dedup.set(`${x}_${y}`, {
            x,
            y,
            color,
            authorId,
            updatedAt: toTimestampIso(data.updatedAt),
          });
        }
      }

      res.status(200).json({
        roundId,
        window: { minX, minY, maxX, maxY, size },
        activeArea: {
          minX: parseIntParam(activeData.minX) ?? 0,
          minY: parseIntParam(activeData.minY) ?? 0,
          maxX: parseIntParam(activeData.maxX) ?? 0,
          maxY: parseIntParam(activeData.maxY) ?? 0,
        },
        pixels: Array.from(dedup.values()),
      });
      return;
    } catch (error) {
      logError('web_proxy_canvas_failed', error, {
        ...requestContext,
        path,
        userId: session.discordUserId,
        offsetX,
        offsetY,
        size,
      });
      res.status(500).json({ error: 'Failed to read canvas' });
      return;
    }
  }

  // Default: 404
  logWarn('web_proxy_not_found', {
    ...requestContext,
    path,
    method: req.method,
  });
  res.status(404).json({ error: 'Not found' });
};
