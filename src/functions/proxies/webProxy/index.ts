import { HttpFunction } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import admin from 'firebase-admin';
import { DrawJobPayload, publishJob } from '../../shared/queue.js';
import {
  getHttpRequestContext,
  logError,
  logInfo,
  logWarn,
  type RequestContext,
} from '../../shared/observability.js';
import {
  isHexState,
  normalizeHexColor,
  parseIntStrict,
  parsePositiveInt,
  toRoundId,
} from '../../shared/validation.js';
import { toChunkRange } from '../../shared/canvasMath.js';
import { runWithSpan } from '../../shared/tracing.js';

const firestore = new Firestore();
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';
const CHUNK_SIZE = Number(process.env.CANVAS_CHUNK_SIZE ?? 50);
const SESSION_COOKIE_NAME = 'session_token';
const adminAuth = () => {
  const app = admin.apps.length > 0 ? admin.app() : admin.initializeApp();
  return admin.auth(app);
};

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

type ActiveAreaRecord = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  roundId: string | null;
};

type CanvasWindowQuery = {
  offsetX: number;
  offsetY: number;
  size: number;
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

const setCorsHeaders = (res: Parameters<HttpFunction>[1]) => {
  res.set('Access-Control-Allow-Origin', WEB_APP_URL);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Credentials', 'true');
};

const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) {
      continue;
    }
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
};

const sessionCookie = (token: string, maxAgeSeconds: number): string =>
  `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAgeSeconds}`;

const clearSessionCookie = (): string =>
  `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;

const validateSession = async (
  req: Parameters<HttpFunction>[0],
  requestContext: RequestContext,
  path: string,
): Promise<SessionData | null> => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE_NAME];
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

const parseCanvasWindowQuery = (
  query: Record<string, unknown>,
): CanvasWindowQuery | null => {
  const offsetX = parseIntStrict(query.offsetX);
  const offsetY = parseIntStrict(query.offsetY);
  const size = parsePositiveInt(query.size);
  if (offsetX === null || offsetY === null || size === null || size > 500) {
    return null;
  }
  return { offsetX, offsetY, size };
};

const loadCanvasWindow = async (
  windowQuery: CanvasWindowQuery,
): Promise<CanvasWindowPayload> => {
  const minX = windowQuery.offsetX;
  const minY = windowQuery.offsetY;
  const maxX = windowQuery.offsetX + windowQuery.size - 1;
  const maxY = windowQuery.offsetY + windowQuery.size - 1;

  const activeSnap = await firestore.doc('activeArea/current').get();
  const activeData = (activeSnap.data() as Record<string, unknown> | undefined) ?? {};
  const activeArea = readActiveArea(activeData);

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
      dedup.set(`${x}_${y}`, {
        x,
        y,
        color,
        authorId,
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

export const webProxy: HttpFunction = async (req, res) =>
  runWithSpan(
    'webProxy.http',
    {
      'faas.trigger': 'http',
      'http.method': req.method,
      'http.route': req.path ?? '/web',
    },
    async () => {
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

  let path = req.path || '/';
  if (path.startsWith('/web/')) {
    path = path.slice(4);
  }
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  if (req.method === 'POST' && path === '/logout') {
    res.set('Set-Cookie', clearSessionCookie());
    res.status(204).send('');
    return;
  }

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
    if (!isHexState(state)) {
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

      const maxAgeSeconds = Math.max(
        0,
        Math.floor((data.expiresAt.toDate().getTime() - Date.now()) / 1000),
      );
      if (maxAgeSeconds <= 0) {
        logWarn('web_proxy_session_expired', {
          ...requestContext,
          path,
          state,
          userId: data.discordUserId,
        });
        res.set('Set-Cookie', clearSessionCookie());
        res.status(401).json({ status: 'error', error: 'Session expired' });
        return;
      }
      res.set('Set-Cookie', sessionCookie(data.token, maxAgeSeconds));

      logInfo('web_proxy_session_ready', {
        ...requestContext,
        path,
        state,
        userId: data.discordUserId,
      });
      res.status(200).json({
        status: 'ready',
        user: {
          id: data.discordUserId,
          username: data.discordUsername,
          avatar: data.discordAvatar,
        },
        firebaseCustomToken: data.firebaseCustomToken ?? null,
      });
      return;
    }

    res.status(200).json({ status: 'pending' });
    return;
  }

  if (req.method === 'GET' && path === '/realtime-token') {
    const session = await validateSession(req, requestContext, path);
    if (!session) {
      logWarn('web_proxy_realtime_token_unauthorized', {
        ...requestContext,
        path,
      });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const token = await adminAuth().createCustomToken(session.discordUserId, {
        discordUsername: session.discordUsername,
      });

      logInfo('web_proxy_realtime_token_created', {
        ...requestContext,
        path,
        userId: session.discordUserId,
      });
      res.status(200).json({ token });
      return;
    } catch (error) {
      logError('web_proxy_realtime_token_failed', error, {
        ...requestContext,
        path,
        userId: session.discordUserId,
      });
      res.status(500).json({ error: 'Failed to create realtime token' });
      return;
    }
  }

  if (req.method === 'POST' && path === '/draw') {
    const session = await validateSession(req, requestContext, path);
    if (!session) {
      logWarn('web_proxy_draw_unauthorized', {
        ...requestContext,
        path,
      });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      logWarn('web_proxy_draw_missing_body', {
        ...requestContext,
        path,
        userId: session.discordUserId,
      });
      res.status(400).json({ error: 'Missing request body' });
      return;
    }

    const typedBody = body as Record<string, unknown>;
    const x = parseIntStrict(typedBody.x);
    const y = parseIntStrict(typedBody.y);
    const color = normalizeHexColor(typedBody.color);

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

  if (req.method === 'GET' && path === '/stream') {
    logWarn('web_proxy_stream_deprecated', {
      ...requestContext,
      path,
      method: req.method,
    });
    res.status(410).json({
      error: 'Deprecated endpoint. Use Firestore realtime listeners from the web client.',
    });
    return;
  }

  if (req.method === 'GET' && path === '/active-area') {
    const session = await validateSession(req, requestContext, path);
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
      res.status(200).json(
        readActiveArea((snap.data() as Record<string, unknown> | undefined) ?? {}),
      );
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

  if (req.method === 'GET' && path === '/canvas') {
    const session = await validateSession(req, requestContext, path);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const windowQuery = parseCanvasWindowQuery(req.query as Record<string, unknown>);
    if (!windowQuery) {
      res.status(400).json({
        error: 'Invalid query params. Required: offsetX (int), offsetY (int), size (1-500)',
      });
      return;
    }

    try {
      res.status(200).json(await loadCanvasWindow(windowQuery));
      return;
    } catch (error) {
      logError('web_proxy_canvas_failed', error, {
        ...requestContext,
        path,
        userId: session.discordUserId,
        offsetX: windowQuery.offsetX,
        offsetY: windowQuery.offsetY,
        size: windowQuery.size,
      });
      res.status(500).json({ error: 'Failed to read canvas' });
      return;
    }
  }

  logWarn('web_proxy_not_found', {
    ...requestContext,
    path,
    method: req.method,
  });
  res.status(404).json({ error: 'Not found' });
    },
  );
