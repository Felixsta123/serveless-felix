const requiredByEnvironment = {
  dev: [
    'DEV_WEB_APP_URL',
    'DEV_DISCORD_ADMIN_ROLE_ID',
    'DEV_SNAPSHOT_BUCKET',
  ],
  prd: [
    'PRD_WEB_APP_URL',
    'PRD_DISCORD_ADMIN_ROLE_ID',
    'PRD_SNAPSHOT_BUCKET',
  ],
};

const readEnvironmentValues = (environment) => {
  const required = requiredByEnvironment[environment] ?? [];
  const missing = required.filter((key) => {
    const value = process.env[key];
    return value === undefined || value === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required env for ${environment}: ${missing.join(', ')}`,
    );
  }

  const prefix = environment.toUpperCase();
  return {
    WEB_APP_URL: process.env[`${prefix}_WEB_APP_URL`],
    DISCORD_ADMIN_ROLE_ID: process.env[`${prefix}_DISCORD_ADMIN_ROLE_ID`],
    SNAPSHOT_BUCKET: process.env[`${prefix}_SNAPSHOT_BUCKET`],
  };
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
    envByEnvironmentFromConfig: ['WEB_APP_URL'],
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
    envByEnvironmentFromConfig: ['DISCORD_ADMIN_ROLE_ID', 'WEB_APP_URL'],
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
};
