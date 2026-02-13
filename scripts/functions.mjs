export const functions = {
  hello: {
    trigger: 'http',
    serviceAccount: 'proxy',
  },
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
  },
  workerDiscord: {
    trigger: 'topic',
    topic: 'jobs',
    serviceAccount: 'worker',
    envByEnvironment: {
      dev: {
        WEB_APP_URL: 'https://serverless-felix-dev.web.app',
      },
      prd: {
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
