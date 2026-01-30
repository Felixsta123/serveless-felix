import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const loadEnv = () => {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

loadEnv();

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

const commands = [
  {
    name: 'draw',
    description: 'Draw a pixel on the canvas',
    type: 1,
    options: [
      {
        name: 'x',
        description: 'X coordinate',
        type: 4,
        required: true,
      },
      {
        name: 'y',
        description: 'Y coordinate',
        type: 4,
        required: true,
      },
      {
        name: 'color',
        description: 'Hex color (e.g. #ff00aa)',
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: 'canvas',
    description: 'Get the current canvas status',
    type: 1,
  },
  {
    name: 'session',
    description: 'Manage the drawing session (admin)',
    type: 1,
    options: [
      {
        name: 'action',
        description: 'Session action',
        type: 3,
        required: true,
        choices: [
          { name: 'start', value: 'start' },
          { name: 'pause', value: 'pause' },
          { name: 'reset', value: 'reset' },
        ],
      },
    ],
  },
  {
    name: 'snapshot',
    description: 'Create a canvas snapshot (admin)',
    type: 1,
  },
];

const requestBody = JSON.stringify(commands);

const req = https.request(
  {
    method: 'PUT',
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
