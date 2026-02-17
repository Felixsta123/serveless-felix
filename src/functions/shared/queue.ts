import { PubSub } from '@google-cloud/pubsub';

type JobMeta = {
  correlationId?: string;
  requestId?: string;
  traceId?: string;
};

export type InteractionMeta = {
  id: string;
  token?: string;
  applicationId?: string;
  guildId?: string;
  channelId?: string;
  userId?: string;
  roles?: string[];
};

export type DrawJobPayload = JobMeta & {
  kind: 'draw.requested';
  receivedAt: string;
  source: 'discord' | 'web';
  userId: string;
  authorUsername?: string;
  x: number;
  y: number;
  color: string;
  interaction?: InteractionMeta;
};

export type CanvasJobPayload = JobMeta & {
  kind: 'canvas.requested';
  receivedAt: string;
  source: 'discord' | 'web';
  userId?: string;
  interaction?: InteractionMeta;
};

export type SessionJobPayload = JobMeta & {
  kind: 'session.command';
  receivedAt: string;
  source: 'discord' | 'web';
  userId: string;
  action: 'start' | 'pause' | 'reset';
  interaction?: InteractionMeta;
};

export type SnapshotJobPayload = JobMeta & {
  kind: 'snapshot.requested';
  receivedAt: string;
  source: 'discord' | 'web';
  userId: string;
  interaction?: InteractionMeta;
};

export type DiscordFollowupJobPayload = JobMeta & {
  kind: 'discord.followup';
  receivedAt: string;
  applicationId: string;
  token: string;
  content: string;
};

export type OAuthExchangeJobPayload = JobMeta & {
  kind: 'oauth.exchange';
  receivedAt: string;
  code: string;
  state: string;
  redirectUri: string;
};

export type WebActiveAreaRequestedJobPayload = JobMeta & {
  kind: 'web.activeArea.requested';
  receivedAt: string;
  userId: string;
  responseRequestId: string;
};

export type WebCanvasRequestedJobPayload = JobMeta & {
  kind: 'web.canvas.requested';
  receivedAt: string;
  userId: string;
  responseRequestId: string;
  offsetX: number;
  offsetY: number;
  size: number;
};

export type WebRealtimeTokenRequestedJobPayload = JobMeta & {
  kind: 'web.realtimeToken.requested';
  receivedAt: string;
  userId: string;
  discordUsername: string;
  responseRequestId: string;
};

export type JobPayload =
  | DrawJobPayload
  | CanvasJobPayload
  | SessionJobPayload
  | SnapshotJobPayload
  | DiscordFollowupJobPayload
  | OAuthExchangeJobPayload
  | WebActiveAreaRequestedJobPayload
  | WebCanvasRequestedJobPayload
  | WebRealtimeTokenRequestedJobPayload;

const pubsub = new PubSub();
const JOB_TOPIC_BY_KIND: Record<JobPayload['kind'], string> = {
  'draw.requested': 'jobs-draw',
  'canvas.requested': 'jobs-canvas',
  'session.command': 'jobs-session',
  'snapshot.requested': 'jobs-snapshot',
  'discord.followup': 'jobs-discord-followup',
  'oauth.exchange': 'jobs-oauth',
  'web.activeArea.requested': 'jobs-web-active-area',
  'web.canvas.requested': 'jobs-web-read',
  'web.realtimeToken.requested': 'jobs-web-realtime-token',
};

const resolveTopicName = (payload: JobPayload, topicName?: string): string => {
  if (typeof topicName === 'string' && topicName.trim()) {
    return topicName.trim();
  }

  const resolved = JOB_TOPIC_BY_KIND[payload.kind];
  if (!resolved) {
    throw new Error(`No topic routing defined for job kind: ${payload.kind}`);
  }

  return resolved;
};

export const publishJob = async (
  payload: JobPayload,
  attributes: Record<string, string> = {},
  topicName?: string,
): Promise<string> => {
  const resolvedTopicName = resolveTopicName(payload, topicName);
  const data = Buffer.from(JSON.stringify(payload));
  return pubsub.topic(resolvedTopicName).publishMessage({
    data,
    attributes,
  });
};
