import https from 'node:https';

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !BOT_TOKEN) {
  console.error('Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN');
  process.exit(1);
}

const basePath = GUILD_ID
  ? `/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `/applications/${APP_ID}/commands`;

const command = {
  name: 'hello',
  description: 'Test the API Gateway',
  type: 1,
};

const requestBody = JSON.stringify(command);

const req = https.request(
  {
    method: 'POST',
    hostname: 'discord.com',
    path: `/api/v10${basePath}`,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
    },
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      if (body) {
        console.log(body);
      }
    });
  },
);

req.on('error', (err) => {
  console.error('Request failed', err);
  process.exit(1);
});

req.write(requestBody);
req.end();
