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
    envByEnvironment: {
      dev: {
        WEB_APP_URL: 'https://serverless-felix-dev.web.app',
      },
      prd: {
        WEB_APP_URL: 'https://serverless-felix-prd.web.app',
      },
    },
  },
  oauthProxy: {
    trigger: 'http',
    serviceAccount: 'proxy',
    envByEnvironment: {
      dev: {
        WEB_APP_URL: 'https://serverless-felix-dev.web.app',
      },
      prd: {
        WEB_APP_URL: 'https://serverless-felix-prd.web.app',
      },
    },
    secrets: {
      DISCORD_CLIENT_ID: 'discord_client_id',
      DISCORD_REDIRECT_URI: 'oauth_redirect_uri',
    },
  },
  workerDraw: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envFromProcess: ['RATE_LIMIT_PER_MINUTE', 'CANVAS_CHUNK_SIZE'],
  },
  workerSnapshot: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envByEnvironment: {
      dev: {
        DISCORD_ADMIN_ROLE_ID: '1471881086521839656',
        SNAPSHOT_BUCKET: 'serverless-felix-dev-snapshots',
      },
      prd: {
        DISCORD_ADMIN_ROLE_ID: '1471881086521839656',
        SNAPSHOT_BUCKET: 'serverless-felix-prd-snapshots',
      },
    },
    envFromProcess: [
      'DISCORD_ADMIN_ROLE_ID',
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
    envByEnvironment: {
      dev: {
        DISCORD_ADMIN_ROLE_ID: '1471881086521839656',
        WEB_APP_URL: 'https://serverless-felix-dev.web.app',
      },
      prd: {
        DISCORD_ADMIN_ROLE_ID: '1471881086521839656',
        WEB_APP_URL: 'https://serverless-felix-prd.web.app',
      },
    },
    envFromProcess: ['DISCORD_ADMIN_ROLE_ID'],
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
