import { HttpFunction } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { DrawJobPayload, publishJob } from '../../shared/queue.js';

const firestore = new Firestore();
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';
const STATE_PATTERN = /^[a-f0-9]{32}$/i;

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
): Promise<SessionData | null> => {
  if (!sessionToken) {
    console.log('validateSession: missing X-Session-Token header');
    return null;
  }
  const token = sessionToken.trim();
  if (!token) {
    console.log('validateSession: empty token');
    return null;
  }

  // Find session by token
  const sessionsRef = firestore.collection('sessions');
  const query = sessionsRef.where('token', '==', token).limit(1);
  const snapshot = await query.get();

  if (snapshot.empty) {
    console.log('validateSession: no session found for token');
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data() as SessionData;
  console.log('validateSession: found session for user', data.discordUserId);

  if (data.status !== 'ready') {
    console.log('validateSession: session is not ready');
    return null;
  }

  // Check expiration
  if (!data.expiresAt || data.expiresAt.toDate() < new Date()) {
    console.log('validateSession: session expired');
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

export const webProxy: HttpFunction = async (req, res) => {
  if (!WEB_APP_URL) {
    res.status(500).json({ error: 'WEB_APP_URL is not configured' });
    return;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
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
      res.status(400).json({ error: 'Missing state parameter' });
      return;
    }
    if (!STATE_PATTERN.test(state)) {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    const sessionRef = firestore.doc(`sessions/${state}`);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
      res.status(404).json({ status: 'pending' });
      return;
    }

    const data = sessionSnap.data() as SessionData;
    if (data.status === 'error') {
      res.status(400).json({ status: 'error', error: data.error });
      return;
    }

    if (data.status === 'ready') {
      if (!data.token || !data.firebaseCustomToken) {
        res.status(500).json({ status: 'error', error: 'Session is missing required tokens' });
        return;
      }
      res.status(200).json({
        status: 'ready',
        apiToken: data.token,
        firebaseToken: data.firebaseCustomToken,
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
    const session = await validateSession(req.headers['x-session-token'] as string | undefined);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      res.status(400).json({ error: 'Missing request body' });
      return;
    }

    const x = parseIntParam(body.x);
    const y = parseIntParam(body.y);
    const color = normalizeColor(body.color);

    if (x === null || y === null || !color) {
      res.status(400).json({ error: 'Invalid parameters. Required: x (int), y (int), color (hex)' });
      return;
    }

    const payload: DrawJobPayload = {
      kind: 'draw.requested',
      receivedAt: new Date().toISOString(),
      source: 'web',
      userId: session.discordUserId,
      x,
      y,
      color,
    };

    try {
      await publishJob(payload, { source: 'web', kind: 'draw.requested' });
    } catch (error) {
      console.error('webProxy failed to publish draw job', error);
      res.status(500).json({ error: 'Failed to enqueue draw request' });
      return;
    }

    res.status(202).json({ message: 'Draw request accepted' });
    return;
  }

  // Default: 404
  res.status(404).json({ error: 'Not found' });
};
