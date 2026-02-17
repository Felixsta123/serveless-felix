const configByEnvironment = {
  dev: {
    WEB_APP_URL: 'https://serverless-felix-dev.web.app',
    DISCORD_ADMIN_ROLE_ID: '1471881086521839656',
    SNAPSHOT_BUCKET: 'serverless-felix-dev-snapshots',
  },
  prd: {
    WEB_APP_URL: 'https://serverless-felix-prd.web.app',
    DISCORD_ADMIN_ROLE_ID: '1471881086521839656',
    SNAPSHOT_BUCKET: 'serverless-felix-prd-snapshots',
  },
};

const readEnvironmentValues = (environment) => {
  const values = configByEnvironment[environment];
  if (!values) {
    throw new Error(`Unknown environment: ${environment}`);
  }
  return values;
};

export const getEnvironmentValues = (environment) => readEnvironmentValues(environment);

export const functions = {
  discordProxy: {
    trigger: 'http',
    serviceAccount: 'proxy',
    envFromProcess: ['DISCORD_ALLOWED_GUILD_ID'],
    secrets: {
      DISCORD_PUBLIC_KEY: 'discord_public_key',
    },
  },
  webProxy: {
    trigger: 'http',
    serviceAccount: 'proxy',
    timeoutSeconds: 540,
    envByEnvironmentFromConfig: ['WEB_APP_URL'],
    envFromProcess: ['REQUEST_RESPONSE_TTL_SECONDS'],
  },
  oauthProxy: {
    trigger: 'http',
    serviceAccount: 'proxy',
    envByEnvironmentFromConfig: ['WEB_APP_URL'],
    secrets: {
      DISCORD_CLIENT_ID: 'discord_client_id',
      DISCORD_REDIRECT_URI: 'oauth_redirect_uri',
    },
  },
  workerDraw: {
    trigger: 'topic',
    topic: 'jobs',
    retry: true,
    serviceAccount: 'worker',
    envFromProcess: ['RATE_LIMIT_PER_MINUTE', 'CANVAS_CHUNK_SIZE'],
  },
  workerSnapshot: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
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
    topic: 'jobs',
    serviceAccount: 'worker',
    envByEnvironmentFromConfig: ['DISCORD_ADMIN_ROLE_ID'],
  },
  workerDiscordCanvas: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envByEnvironmentFromConfig: ['WEB_APP_URL', 'SNAPSHOT_BUCKET'],
    envFromProcess: ['SNAPSHOT_URL_TTL_SECONDS'],
  },
  workerDiscordFollowup: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
  },
  workerOAuth: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envFromProcess: ['SESSION_TTL_HOURS'],
    secrets: {
      DISCORD_CLIENT_ID: 'discord_client_id',
      DISCORD_CLIENT_SECRET: 'discord_client_secret',
    },
  },
  workerWebRead: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envFromProcess: ['CANVAS_CHUNK_SIZE', 'REQUEST_RESPONSE_TTL_SECONDS'],
  },
  workerWebActiveArea: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envFromProcess: ['REQUEST_RESPONSE_TTL_SECONDS'],
  },
  workerWebRealtimeToken: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envFromProcess: ['REQUEST_RESPONSE_TTL_SECONDS'],
  },
};
