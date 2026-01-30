import { PubSub } from '@google-cloud/pubsub';

export type InteractionMeta = {
  id: string;
  token?: string;
  applicationId?: string;
  guildId?: string;
  channelId?: string;
  userId?: string;
  roles?: string[];
};

export type DrawJobPayload = {
  kind: 'draw.requested';
  receivedAt: string;
  source: 'discord' | 'web';
  userId: string;
  x: number;
  y: number;
  color: string;
  interaction?: InteractionMeta;
};

export type CanvasJobPayload = {
  kind: 'canvas.requested';
  receivedAt: string;
  source: 'discord' | 'web';
  userId?: string;
  interaction?: InteractionMeta;
};

export type SessionJobPayload = {
  kind: 'session.command';
  receivedAt: string;
  source: 'discord' | 'web';
  userId: string;
  action: 'start' | 'pause' | 'reset';
  interaction?: InteractionMeta;
};

export type SnapshotJobPayload = {
  kind: 'snapshot.requested';
  receivedAt: string;
  source: 'discord' | 'web';
  userId: string;
  interaction?: InteractionMeta;
};

export type DiscordFollowupJobPayload = {
  kind: 'discord.followup';
  receivedAt: string;
  applicationId: string;
  token: string;
  content: string;
};

export type JobPayload =
  | DrawJobPayload
  | CanvasJobPayload
  | SessionJobPayload
  | SnapshotJobPayload
  | DiscordFollowupJobPayload;

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
