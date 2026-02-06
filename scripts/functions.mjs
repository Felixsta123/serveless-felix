export const functions = {
  hello: {
    trigger: 'http',
  },
  discordProxy: {
    trigger: 'http',
  },
  webProxy: {
    trigger: 'http',
  },
  oauthProxy: {
    trigger: 'http',
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
  workerOAuth: {
    trigger: 'topic',
    topic: 'jobs',
  },
};
