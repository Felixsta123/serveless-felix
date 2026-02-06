import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import https from 'node:https';
import crypto from 'node:crypto';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { JobPayload } from '../../shared/queue.js';

const firestore = new Firestore();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? '';
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 24);

type DiscordTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
};

type DiscordUser = {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name?: string | null;
};

const httpRequest = <T>(options: https.RequestOptions, body?: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        } else {
          reject(new Error(`HTTP ${status}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });

const exchangeCodeForToken = async (
  code: string,
  redirectUri: string,
): Promise<DiscordTokenResponse> => {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }).toString();

  return httpRequest<DiscordTokenResponse>(
    {
      method: 'POST',
      hostname: 'discord.com',
      path: '/api/v10/oauth2/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body,
  );
};

const fetchDiscordUser = async (accessToken: string): Promise<DiscordUser> => {
  return httpRequest<DiscordUser>({
    method: 'GET',
    hostname: 'discord.com',
    path: '/api/v10/users/@me',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
};

const generateSessionToken = (): string => crypto.randomBytes(32).toString('hex');

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
    console.log('workerOAuth missing message data', {
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
      console.error('workerOAuth failed to parse job payload', error, fallbackError);
      return null;
    }
  }
};

export const workerOAuth = async (event: CloudEvent<PubSubEnvelope>) => {
  const job = parseJob(event);
  if (!job || job.kind !== 'oauth.exchange') {
    return;
  }

  const { code, state, redirectUri } = job;

  try {
    // Exchange code for access token
    const tokenResponse = await exchangeCodeForToken(code, redirectUri);
    console.log('workerOAuth got token for state', state);

    // Fetch user info
    const user = await fetchDiscordUser(tokenResponse.access_token);
    console.log('workerOAuth got user', user.id, user.username);

    // Create session in Firestore
    const sessionToken = generateSessionToken();
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000),
    );

    const sessionRef = firestore.doc(`sessions/${state}`);
    await sessionRef.set({
      discordUserId: user.id,
      discordUsername: user.global_name ?? user.username,
      discordAvatar: user.avatar,
      token: sessionToken,
      state,
      createdAt: now,
      expiresAt,
      status: 'ready',
    });

    console.log('workerOAuth created session for user', user.id);
  } catch (error) {
    console.error('workerOAuth failed to exchange token', error);

    // Store error state so web app can show error
    const sessionRef = firestore.doc(`sessions/${state}`);
    await sessionRef.set({
      state,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      createdAt: Timestamp.now(),
    });
  }
};
