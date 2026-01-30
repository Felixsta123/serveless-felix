import https from 'node:https';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

const postJson = async (url: string, body: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const target = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          reject(new Error(`Discord API error ${status}: ${responseBody}`));
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

export const postDiscordFollowup = async (
  applicationId: string,
  token: string,
  content: string,
  flags?: number,
): Promise<void> => {
  const url = `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${token}`;
  await postJson(url, flags ? { content, flags } : { content });
};
