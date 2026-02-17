import { HttpFunction } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import crypto from 'node:crypto';
import {
  DrawJobPayload,
  WebActiveAreaRequestedJobPayload,
  WebCanvasRequestedJobPayload,
  WebRealtimeTokenRequestedJobPayload,
  publishJob,
} from '../../shared/queue.js';
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
} from '../../shared/validation.js';
import { runWithSpan } from '../../shared/tracing.js';
import { toPositiveInt } from '../../shared/env.js';

const firestore = new Firestore();
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';
const SESSION_COOKIE_NAME = 'session_token';
const REQUEST_RESPONSE_TTL_SECONDS = toPositiveInt(process.env.REQUEST_RESPONSE_TTL_SECONDS, 900);

const REQUEST_ID_PATTERN = /^[a-f0-9-]{36}$/i;

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

type CanvasWindowQuery = {
  offsetX: number;
  offsetY: number;
  size: number;
};

type RequestResponseStatus = 'pending' | 'ready' | 'error';

type RequestResponseRecord = {
  ownerUserId?: unknown;
  kind?: unknown;
  status?: unknown;
  payload?: unknown;
  error?: unknown;
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

const requestResponseRef = (requestId: string) =>
  firestore.doc(`requestResponses/${requestId}`);

const buildResponseExpiry = (): Timestamp =>
  Timestamp.fromDate(new Date(Date.now() + REQUEST_RESPONSE_TTL_SECONDS * 1000));

const writePendingRequestResponse = async (
  requestId: string,
  ownerUserId: string,
  kind: string,
) => {
  const now = Timestamp.now();
  await requestResponseRef(requestId).set(
    {
      ownerUserId,
      kind,
      status: 'pending',
      payload: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: buildResponseExpiry(),
    },
    { merge: true },
  );
};

const writeErrorRequestResponse = async (
  requestId: string,
  message: string,
): Promise<void> => {
  const now = Timestamp.now();
  await requestResponseRef(requestId).set(
    {
      status: 'error',
      payload: null,
      error: message,
      updatedAt: now,
      expiresAt: buildResponseExpiry(),
    },
    { merge: true },
  );
};

const parseRequestPathId = (
  path: string,
  query: Record<string, unknown>,
): string | null => {
  if (path.startsWith('/request/')) {
    const raw = decodeURIComponent(path.slice('/request/'.length));
    const trimmed = raw.trim();
    return trimmed || null;
  }

  if (path === '/request') {
    const raw = query.requestId;
    if (typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed || null;
  }

  return null;
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

      if (req.method === 'GET' && (path.startsWith('/request/') || path === '/request')) {
        const session = await validateSession(req, requestContext, path);
        if (!session) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const requestId = parseRequestPathId(path, req.query as Record<string, unknown>);
        if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
          res.status(400).json({ error: 'Invalid request id' });
          return;
        }

        try {
          const snap = await requestResponseRef(requestId).get();
          if (!snap.exists) {
            res.status(404).json({ error: 'Request not found' });
            return;
          }

          const data = (snap.data() as RequestResponseRecord | undefined) ?? {};
          const ownerUserId = typeof data.ownerUserId === 'string' ? data.ownerUserId : null;
          if (!ownerUserId || ownerUserId !== session.discordUserId) {
            logWarn('web_proxy_request_status_owner_mismatch', {
              ...requestContext,
              path,
              requestId,
              ownerUserId,
              userId: session.discordUserId,
            });
            res.status(403).json({ error: 'Forbidden' });
            return;
          }

          const status =
            data.status === 'pending' || data.status === 'ready' || data.status === 'error'
              ? (data.status as RequestResponseStatus)
              : 'pending';

          if (status === 'ready') {
            res.status(200).json({ status, payload: data.payload ?? null });
            return;
          }

          if (status === 'error') {
            res.status(200).json({
              status,
              error: typeof data.error === 'string' ? data.error : 'Request failed',
            });
            return;
          }

          res.status(200).json({ status: 'pending' });
          return;
        } catch (error) {
          logError('web_proxy_request_status_failed', error, {
            ...requestContext,
            path,
            requestId,
            userId: session.discordUserId,
          });
          res.status(500).json({ error: 'Failed to read request status' });
          return;
        }
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

        const responseRequestId = crypto.randomUUID();
        const payload: WebRealtimeTokenRequestedJobPayload = {
          kind: 'web.realtimeToken.requested',
          receivedAt: new Date().toISOString(),
          correlationId: requestContext.correlationId,
          requestId: requestContext.requestId,
          traceId: requestContext.traceId,
          userId: session.discordUserId,
          discordUsername: session.discordUsername,
          responseRequestId,
        };

        try {
          await writePendingRequestResponse(responseRequestId, session.discordUserId, payload.kind);
          await publishJob(payload, { source: 'web', kind: payload.kind });
          logInfo('web_proxy_realtime_token_enqueued', {
            ...requestContext,
            path,
            userId: session.discordUserId,
            responseRequestId,
          });
          res.status(202).json({ requestId: responseRequestId, status: 'pending' });
          return;
        } catch (error) {
          logError('web_proxy_realtime_token_enqueue_failed', error, {
            ...requestContext,
            path,
            userId: session.discordUserId,
            responseRequestId,
          });
          try {
            await writeErrorRequestResponse(responseRequestId, 'Failed to enqueue realtime token request');
          } catch {
            // keep original failure semantics
          }
          res.status(500).json({ error: 'Failed to enqueue realtime token request' });
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

      if (req.method === 'GET' && path === '/active-area') {
        const session = await validateSession(req, requestContext, path);
        if (!session) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const responseRequestId = crypto.randomUUID();
        const payload: WebActiveAreaRequestedJobPayload = {
          kind: 'web.activeArea.requested',
          receivedAt: new Date().toISOString(),
          correlationId: requestContext.correlationId,
          requestId: requestContext.requestId,
          traceId: requestContext.traceId,
          userId: session.discordUserId,
          responseRequestId,
        };

        try {
          await writePendingRequestResponse(responseRequestId, session.discordUserId, payload.kind);
          await publishJob(payload, { source: 'web', kind: payload.kind });
          logInfo('web_proxy_active_area_enqueued', {
            ...requestContext,
            path,
            userId: session.discordUserId,
            responseRequestId,
          });
          res.status(202).json({ requestId: responseRequestId, status: 'pending' });
          return;
        } catch (error) {
          logError('web_proxy_active_area_enqueue_failed', error, {
            ...requestContext,
            path,
            userId: session.discordUserId,
            responseRequestId,
          });
          try {
            await writeErrorRequestResponse(responseRequestId, 'Failed to enqueue active area request');
          } catch {
            // keep original failure semantics
          }
          res.status(500).json({ error: 'Failed to enqueue active area request' });
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

        const responseRequestId = crypto.randomUUID();
        const payload: WebCanvasRequestedJobPayload = {
          kind: 'web.canvas.requested',
          receivedAt: new Date().toISOString(),
          correlationId: requestContext.correlationId,
          requestId: requestContext.requestId,
          traceId: requestContext.traceId,
          userId: session.discordUserId,
          responseRequestId,
          offsetX: windowQuery.offsetX,
          offsetY: windowQuery.offsetY,
          size: windowQuery.size,
        };

        try {
          await writePendingRequestResponse(responseRequestId, session.discordUserId, payload.kind);
          await publishJob(payload, { source: 'web', kind: payload.kind });
          logInfo('web_proxy_canvas_enqueued', {
            ...requestContext,
            path,
            userId: session.discordUserId,
            responseRequestId,
            offsetX: windowQuery.offsetX,
            offsetY: windowQuery.offsetY,
            size: windowQuery.size,
          });
          res.status(202).json({ requestId: responseRequestId, status: 'pending' });
          return;
        } catch (error) {
          logError('web_proxy_canvas_enqueue_failed', error, {
            ...requestContext,
            path,
            userId: session.discordUserId,
            responseRequestId,
            offsetX: windowQuery.offsetX,
            offsetY: windowQuery.offsetY,
            size: windowQuery.size,
          });
          try {
            await writeErrorRequestResponse(responseRequestId, 'Failed to enqueue canvas request');
          } catch {
            // keep original failure semantics
          }
          res.status(500).json({ error: 'Failed to enqueue canvas request' });
          return;
        }
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

      logWarn('web_proxy_not_found', {
        ...requestContext,
        path,
        method: req.method,
      });
      res.status(404).json({ error: 'Not found' });
    },
  );
