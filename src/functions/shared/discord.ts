import { createPublicKey, verify } from 'node:crypto';
import type { HttpFunction } from '@google-cloud/functions-framework';

export type DiscordInteraction = {
  id: string;
  application_id?: string;
  type?: number;
  token?: string;
  data?: {
    name?: string;
    options?: unknown[];
  };
  guild_id?: string;
  channel_id?: string;
  member?: {
    user?: {
      id?: string;
      username?: string;
    };
  };
  user?: {
    id?: string;
    username?: string;
  };
};

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
} as const;

type HttpRequest = Parameters<HttpFunction>[0];

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const getHeader = (req: HttpRequest, name: string): string | undefined => {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const getRawBody = (req: HttpRequest): Buffer => {
  const rawBody = (req as { rawBody?: Buffer | string }).rawBody;
  if (rawBody) {
    return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body);
  }
  return Buffer.from(JSON.stringify(req.body ?? {}));
};

export const verifyDiscordRequest = (req: HttpRequest, publicKeyHex: string): boolean => {
  const signature = getHeader(req, 'x-signature-ed25519');
  const timestamp = getHeader(req, 'x-signature-timestamp');
  if (!signature || !timestamp) {
    return false;
  }
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    const message = Buffer.concat([Buffer.from(timestamp), getRawBody(req)]);
    return verify(null, message, publicKey, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
};

export const parseDiscordInteraction = (req: HttpRequest): DiscordInteraction | null => {
  try {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body) as DiscordInteraction;
    }
    return (req.body ?? {}) as DiscordInteraction;
  } catch {
    return null;
  }
};

export const getInteractionUserId = (interaction: DiscordInteraction): string | undefined =>
  interaction.member?.user?.id ?? interaction.user?.id;

