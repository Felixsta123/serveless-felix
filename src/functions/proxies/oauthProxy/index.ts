import { HttpFunction } from '@google-cloud/functions-framework';
import crypto from 'node:crypto';
import { OAuthExchangeJobPayload, publishJob } from '../../shared/queue.js';
import {
  getHttpRequestContext,
  logError,
  logInfo,
  logWarn,
} from '../../shared/observability.js';
import { isHexState } from '../../shared/validation.js';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI ?? '';
const WEB_APP_URL = process.env.WEB_APP_URL ?? '';

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
  const requestContext = getHttpRequestContext(req);

  if (!WEB_APP_URL) {
    logError(
      'oauth_proxy_missing_web_app_url',
      new Error('Web application URL is not configured'),
      {
        ...requestContext,
        path: req.path,
      },
    );
    res.status(500).json({ error: 'Web application URL is not configured' });
    return;
  }

  res.set('Access-Control-Allow-Origin', WEB_APP_URL);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    logInfo('oauth_proxy_preflight', {
      ...requestContext,
      path: req.path,
    });
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    logWarn('oauth_proxy_method_not_allowed', {
      ...requestContext,
      method: req.method,
    });
    res.status(405).set('Allow', 'GET').json({ error: 'Method Not Allowed' });
    return;
  }

  const { code, state, action } = req.query as Record<string, string | undefined>;

  if (action === 'login') {
    if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
      logError('oauth_proxy_missing_oauth_config', new Error('OAuth is not configured'), {
        ...requestContext,
      });
      res.status(500).json({ error: 'OAuth is not configured' });
      return;
    }
    const newState = generateState();
    const authUrl = buildDiscordAuthUrl(newState);
    res.set(
      'Set-Cookie',
      `oauth_state=${newState}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    );
    logInfo('oauth_proxy_login_redirect', {
      ...requestContext,
      oauthState: newState,
    });
    res.redirect(302, authUrl);
    return;
  }

  if (code && state) {
    if (!isHexState(state)) {
      logWarn('oauth_proxy_invalid_state_format', {
        ...requestContext,
      });
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    const cookies = req.headers.cookie ?? '';
    const stateCookie = cookies
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('oauth_state='));
    const savedState = stateCookie?.split('=')[1];

    if (!savedState || savedState !== state) {
      logWarn('oauth_proxy_state_mismatch', {
        ...requestContext,
        oauthState: state,
      });
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    res.set('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');

    const payload: OAuthExchangeJobPayload = {
      kind: 'oauth.exchange',
      receivedAt: new Date().toISOString(),
      correlationId: requestContext.correlationId,
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
      code,
      state,
      redirectUri: DISCORD_REDIRECT_URI,
    };

    try {
      await publishJob(payload, { kind: 'oauth.exchange' });
      logInfo('oauth_proxy_exchange_enqueued', {
        ...requestContext,
        oauthState: state,
      });
    } catch (error) {
      logError('oauth_proxy_publish_failed', error, {
        ...requestContext,
        oauthState: state,
      });
      res.status(500).json({ error: 'Failed to process authentication' });
      return;
    }

    const redirectUrl = `${WEB_APP_URL}?oauth_state=${encodeURIComponent(state)}`;
    res.redirect(302, redirectUrl);
    return;
  }

  logWarn('oauth_proxy_invalid_request', {
    ...requestContext,
    action: action ?? null,
    hasCode: Boolean(code),
    hasState: Boolean(state),
  });
  res.status(400).json({
    error: 'Invalid request. Use ?action=login to start OAuth flow.',
  });
};
