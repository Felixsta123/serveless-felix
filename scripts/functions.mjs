export const functions = {
  hello: {
    trigger: 'http',
    allowUnauthenticated: true,
  },
  discordProxy: {
    trigger: 'http',
    allowUnauthenticated: true,
  },
  webProxy: {
    trigger: 'http',
    allowUnauthenticated: true,
  },
  oauthProxy: {
    trigger: 'http',
    allowUnauthenticated: true,
  },
  workerDraw: {
    trigger: 'topic',
    topic: 'jobs',
  },
  workerSnapshot: {
    trigger: 'topic',
    topic: 'jobs',
  },
  workerDiscord: {
    trigger: 'topic',
    topic: 'jobs',
  },
};
