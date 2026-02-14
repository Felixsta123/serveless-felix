import { CloudEvent } from '@google-cloud/functions-framework';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import https from 'node:https';
import crypto from 'node:crypto';
import admin from 'firebase-admin';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import {
  getWorkerContext,
  logError,
  logInfo,
} from '../../shared/observability.js';
import { parseJob } from '../../shared/pubsubJob.js';
import { runWithSpan } from '../../shared/tracing.js';

const firestore = new Firestore();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? '';
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 24);

const adminAuth = () => {
  const app = admin.apps.length > 0 ? admin.app() : admin.initializeApp();
  return admin.auth(app);
};

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
          } catch {
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

export const workerOAuth = async (event: CloudEvent<PubSubEnvelope>) =>
  runWithSpan(
    'workerOAuth.pubsub',
    {
      'faas.trigger': 'pubsub',
      'messaging.system': 'pubsub',
      'messaging.destination': 'jobs',
      'messaging.operation': 'process',
    },
    async () => {
  const job = parseJob(
    event,
    'worker_oauth_parse_failed',
    'worker_oauth_missing_message_data',
  );
  if (!job || job.kind !== 'oauth.exchange') {
    return;
  }
  const context = getWorkerContext(event, job);

  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    logError(
      'worker_oauth_missing_credentials',
      new Error('Discord OAuth credentials are not configured'),
      {
        ...context,
      },
    );
    return;
  }

  const { code, state, redirectUri } = job;

  try {
    const tokenResponse = await exchangeCodeForToken(code, redirectUri);
    logInfo('worker_oauth_token_exchanged', {
      ...context,
      oauthState: state,
    });

    const user = await fetchDiscordUser(tokenResponse.access_token);
    logInfo('worker_oauth_user_fetched', {
      ...context,
      oauthState: state,
      userId: user.id,
    });

    const firebaseCustomToken = await adminAuth().createCustomToken(user.id, {
      discordUsername: user.global_name ?? user.username,
    });

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
      firebaseCustomToken,
      state,
      createdAt: now,
      expiresAt,
      status: 'ready',
    });

    logInfo('worker_oauth_session_ready', {
      ...context,
      oauthState: state,
      userId: user.id,
    });
  } catch (error) {
    logError('worker_oauth_exchange_failed', error, {
      ...context,
      oauthState: state,
    });

    const sessionRef = firestore.doc(`sessions/${state}`);
    try {
      await sessionRef.set({
        state,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        createdAt: Timestamp.now(),
      });
      logInfo('worker_oauth_session_error_written', {
        ...context,
        oauthState: state,
      });
    } catch (sessionWriteError) {
      logError('worker_oauth_session_error_write_failed', sessionWriteError, {
        ...context,
        oauthState: state,
      });
    }
  }
    },
  );
