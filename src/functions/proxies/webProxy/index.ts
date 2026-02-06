import { HttpFunction } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { DrawJobPayload, publishJob } from '../../shared/queue.js';

const firestore = new Firestore();
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';

type SessionData = {
  discordUserId: string;
  discordUsername: string;
  discordAvatar: string | null;
  token: string;
  state: string;
  expiresAt: Timestamp;
  status: string;
  error?: string;
};

const setCorsHeaders = (res: Parameters<HttpFunction>[1]) => {
  res.set('Access-Control-Allow-Origin', WEB_APP_URL || '*');
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

  console.log('validateSession: full token', token);

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

  // Check expiration
  if (data.expiresAt.toDate() < new Date()) {
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
      res.status(200).json({
        status: 'ready',
        token: data.token,
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

  // GET /me - Get current user info
  if (req.method === 'GET' && path === '/me') {
    const session = await validateSession(req.headers['x-session-token'] as string | undefined);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.status(200).json({
      id: session.discordUserId,
      username: session.discordUsername,
      avatar: session.discordAvatar,
    });
    return;
  }

  // GET /canvas - Get active area bounds
  if (req.method === 'GET' && path === '/canvas') {
    const activeAreaRef = firestore.doc('activeArea/current');
    const activeSnap = await activeAreaRef.get();

    if (!activeSnap.exists) {
      res.status(200).json({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
      return;
    }

    const data = activeSnap.data();
    res.status(200).json({
      minX: data?.minX ?? 0,
      minY: data?.minY ?? 0,
      maxX: data?.maxX ?? 0,
      maxY: data?.maxY ?? 0,
    });
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

  // GET /pixels?chunk=x_y - Get pixels for a chunk
  if (req.method === 'GET' && path === '/pixels') {
    const chunk = req.query.chunk as string | undefined;
    if (!chunk || !/^-?\d+_-?\d+$/.test(chunk)) {
      res.status(400).json({ error: 'Invalid chunk parameter. Format: x_y' });
      return;
    }

    const pixelsRef = firestore.collection(`chunks/${chunk}/pixels`);
    const snapshot = await pixelsRef.get();

    const pixels = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        x: data.x,
        y: data.y,
        color: data.color,
        authorId: data.authorId,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    res.status(200).json({ chunk, pixels });
    return;
  }

  // Default: 404
  res.status(404).json({ error: 'Not found' });
};
