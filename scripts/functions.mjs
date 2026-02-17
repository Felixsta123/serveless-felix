const devConfig = {
  WEB_APP_URL: 'https://serverless-felix-dev.web.app',
  DISCORD_ADMIN_ROLE_ID: '1471881086521839656',
  SNAPSHOT_BUCKET: 'serverless-felix-dev-snapshots',
};

export const getEnvironmentValues = () => devConfig;

export const functions = {
  discordProxy: {
    trigger: 'http',
    serviceAccount: 'sa-discord-proxy',
    envFromProcess: ['DISCORD_ALLOWED_GUILD_ID'],
    secrets: {
      DISCORD_PUBLIC_KEY: 'discord_public_key',
    },
  },
  webProxy: {
    trigger: 'http',
    serviceAccount: 'sa-web-proxy',
    timeoutSeconds: 540,
    envByEnvironmentFromConfig: ['WEB_APP_URL'],
    envFromProcess: ['REQUEST_RESPONSE_TTL_SECONDS'],
  },
  oauthProxy: {
    trigger: 'http',
    serviceAccount: 'sa-oauth-proxy',
    envByEnvironmentFromConfig: ['WEB_APP_URL'],
    secrets: {
      DISCORD_CLIENT_ID: 'discord_client_id',
      DISCORD_REDIRECT_URI: 'oauth_redirect_uri',
    },
  },
  workerDraw: {
    trigger: 'topic',
    topic: 'jobs-draw',
    retry: true,
    serviceAccount: 'sa-worker-draw',
    envFromProcess: ['RATE_LIMIT_PER_MINUTE', 'CANVAS_CHUNK_SIZE'],
  },
  workerSnapshot: {
    trigger: 'topic',
    topic: 'jobs-snapshot',
    serviceAccount: 'sa-worker-snapshot',
    envByEnvironmentFromConfig: ['DISCORD_ADMIN_ROLE_ID', 'SNAPSHOT_BUCKET'],
    envFromProcess: [
      'CANVAS_CHUNK_SIZE',
      'SNAPSHOT_PIXEL_SCALE',
      'SNAPSHOT_MAX_DIM',
      'SNAPSHOT_URL_TTL_SECONDS',
      'SNAPSHOT_MAX_CHUNKS',
    ],
  },
  workerDiscord: {
    trigger: 'topic',
    topic: 'jobs-session',
    serviceAccount: 'sa-worker-session',
    envByEnvironmentFromConfig: ['DISCORD_ADMIN_ROLE_ID'],
  },
  workerDiscordCanvas: {
    trigger: 'topic',
    topic: 'jobs-canvas',
    serviceAccount: 'sa-worker-canvas',
    envByEnvironmentFromConfig: ['WEB_APP_URL', 'SNAPSHOT_BUCKET'],
    envFromProcess: ['SNAPSHOT_URL_TTL_SECONDS'],
  },
  workerDiscordFollowup: {
    trigger: 'topic',
    topic: 'jobs-discord-followup',
    serviceAccount: 'sa-worker-followup',
  },
  workerOAuth: {
    trigger: 'topic',
    topic: 'jobs-oauth',
    serviceAccount: 'sa-worker-oauth',
    envFromProcess: ['SESSION_TTL_HOURS'],
    secrets: {
      DISCORD_CLIENT_ID: 'discord_client_id',
      DISCORD_CLIENT_SECRET: 'discord_client_secret',
    },
  },
  workerWebRead: {
    trigger: 'topic',
    topic: 'jobs-web-read',
    serviceAccount: 'sa-worker-web-read',
    envFromProcess: ['CANVAS_CHUNK_SIZE', 'REQUEST_RESPONSE_TTL_SECONDS'],
  },
  workerWebActiveArea: {
    trigger: 'topic',
    topic: 'jobs-web-active-area',
    serviceAccount: 'sa-worker-web-active-area',
    envFromProcess: ['REQUEST_RESPONSE_TTL_SECONDS'],
  },
  workerWebRealtimeToken: {
    trigger: 'topic',
    topic: 'jobs-web-realtime-token',
    serviceAccount: 'sa-worker-web-realtime-token',
    envFromProcess: ['REQUEST_RESPONSE_TTL_SECONDS'],
  },
};
