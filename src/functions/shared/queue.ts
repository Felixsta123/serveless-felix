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

export const publishJob = async (
  payload: JobPayload,
  attributes: Record<string, string> = {},
  topicName = process.env.JOBS_TOPIC ?? 'jobs',
): Promise<string> => {
  const data = Buffer.from(JSON.stringify(payload));
  return pubsub.topic(topicName).publishMessage({
    data,
    attributes,
  });
};
