import { PubSub } from '@google-cloud/pubsub';

export type DiscordJobPayload = {
  kind: 'discord.command';
  command: string;
  receivedAt: string;
  interaction: {
    id: string;
    token?: string;
    applicationId?: string;
    guildId?: string;
    channelId?: string;
    userId?: string;
  };
  data?: unknown;
};

const pubsub = new PubSub();

export const publishJob = async (
  payload: DiscordJobPayload,
  attributes: Record<string, string> = {},
  topicName = process.env.JOBS_TOPIC ?? 'jobs',
): Promise<string> => {
  const data = Buffer.from(JSON.stringify(payload));
  return pubsub.topic(topicName).publishMessage({
    data,
    attributes,
  });
};

