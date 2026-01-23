import { HttpFunction } from '@google-cloud/functions-framework';
import {
  InteractionResponseType,
  InteractionType,
  getInteractionUserId,
  parseDiscordInteraction,
  verifyDiscordRequest,
} from '../../shared/discord.js';
import { resolveDiscordCommand } from '../../shared/discordCommands.js';
import { DiscordJobPayload, publishJob } from '../../shared/queue.js';

export const discordProxy: HttpFunction = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).set('Allow', 'POST').send({ message: 'Method Not Allowed' });
    return;
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    res.status(500).send({ message: 'DISCORD_PUBLIC_KEY is not set' });
    return;
  }

  if (!verifyDiscordRequest(req, publicKey)) {
    res.status(401).send({ message: 'Invalid request signature' });
    return;
  }

  const interaction = parseDiscordInteraction(req);
  if (!interaction) {
    res.status(400).send({ message: 'Invalid JSON body' });
    return;
  }

  if (interaction.type === InteractionType.Ping) {
    res.status(200).json({ type: InteractionResponseType.Pong });
    return;
  }

  if (interaction.type !== InteractionType.ApplicationCommand) {
    res.status(400).send({ message: 'Unsupported interaction type' });
    return;
  }

  const command = resolveDiscordCommand(interaction);
  if (!command) {
    res.status(200).json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: 'Unknown command.',
        flags: 64,
      },
    });
    return;
  }

  const payload: DiscordJobPayload = {
    kind: 'discord.command',
    command: command.jobType,
    receivedAt: new Date().toISOString(),
    interaction: {
      id: interaction.id,
      token: interaction.token,
      applicationId: interaction.application_id,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      userId: getInteractionUserId(interaction),
    },
    data: interaction.data,
  };

  try {
    await publishJob(payload, {
      source: 'discord',
      command: command.jobType,
    });
  } catch (error) {
    console.error('Failed to publish discord job', error);
    res.status(500).json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: 'Failed to enqueue command. Try again later.',
        flags: 64,
      },
    });
    return;
  }

  res.status(200).json({
    type: InteractionResponseType.DeferredChannelMessageWithSource,
  });
};
