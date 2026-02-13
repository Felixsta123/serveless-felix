import { HttpFunction } from '@google-cloud/functions-framework';
import crypto from 'node:crypto';
import { OAuthExchangeJobPayload, publishJob } from '../../shared/queue.js';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI ?? '';
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';
const STATE_PATTERN = /^[a-f0-9]{32}$/i;

const generateState = (): string => crypto.randomBytes(16).toString('hex');

const buildDiscordAuthUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
};

export const oauthProxy: HttpFunction = async (req, res) => {
  // CORS headers for web app
  res.set('Access-Control-Allow-Origin', WEB_APP_URL || '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).set('Allow', 'GET').json({ error: 'Method Not Allowed' });
    return;
  }

  const { code, state, action } = req.query as Record<string, string | undefined>;

  // Step 1: Initiate OAuth flow - redirect user to Discord
  if (action === 'login') {
    if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
      res.status(500).json({ error: 'OAuth is not configured' });
      return;
    }
    const newState = generateState();
    const authUrl = buildDiscordAuthUrl(newState);
    // Set state in cookie for validation on callback
    res.set('Set-Cookie', `oauth_state=${newState}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`);
    res.redirect(302, authUrl);
    return;
  }

  // Step 2: Handle OAuth callback from Discord
  if (code && state) {
    if (!STATE_PATTERN.test(state)) {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    // Validate state from cookie
    const cookies = req.headers.cookie ?? '';
    const stateCookie = cookies
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('oauth_state='));
    const savedState = stateCookie?.split('=')[1];

    if (!savedState || savedState !== state) {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    // Clear the state cookie
    res.set('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');

    // Enqueue the token exchange job
    const payload: OAuthExchangeJobPayload = {
      kind: 'oauth.exchange',
      receivedAt: new Date().toISOString(),
      code,
      state,
      redirectUri: DISCORD_REDIRECT_URI,
    };

    try {
      await publishJob(payload, { kind: 'oauth.exchange' });
    } catch (error) {
      console.error('oauthProxy failed to publish job', error);
      res.status(500).json({ error: 'Failed to process authentication' });
      return;
    }

    // Redirect to web app with state for session polling
    // Use query param on main page since we're using static hosting (no SPA router)
    if (!WEB_APP_URL) {
      res.status(500).json({ error: 'Web application URL is not configured' });
      return;
    }

    const redirectUrl = `${WEB_APP_URL}?oauth_state=${encodeURIComponent(state)}`;
    res.redirect(302, redirectUrl);
    return;
  }

  // Invalid request
  res.status(400).json({
    error: 'Invalid request. Use ?action=login to start OAuth flow.',
  });
};
