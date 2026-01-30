import { HttpFunction } from '@google-cloud/functions-framework';
import {
  InteractionResponseType,
  InteractionType,
  getInteractionUserId,
  parseDiscordInteraction,
  verifyDiscordRequest,
} from '../../shared/discord.js';
import { resolveDiscordCommand } from '../../shared/discordCommands.js';
import { JobPayload, publishJob } from '../../shared/queue.js';

type DiscordOption = {
  name?: string;
  value?: unknown;
  options?: DiscordOption[];
};

const respondEphemeral = (res: Parameters<HttpFunction>[1], content: string) => {
  res.status(200).json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      flags: 64,
    },
  });
};

const getOptionValue = (options: unknown[] | undefined, name: string): unknown => {
  if (!options) {
    return undefined;
  }
  for (const option of options) {
    if (!option || typeof option !== 'object') {
      continue;
    }
    const typed = option as DiscordOption;
    if (typed.name === name) {
      return typed.value;
    }
  }
  return undefined;
};

const parseIntOption = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizeColor = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!/^#?[0-9a-f]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

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

  const allowedGuildId = process.env.DISCORD_ALLOWED_GUILD_ID;
  if (allowedGuildId && interaction.guild_id && interaction.guild_id !== allowedGuildId) {
    respondEphemeral(res, 'This command is not allowed in this server.');
    return;
  }

  const userId = getInteractionUserId(interaction);
  if (!userId) {
    respondEphemeral(res, 'Unable to identify the user for this command.');
    return;
  }

  const interactionMeta = {
    id: interaction.id,
    token: interaction.token,
    applicationId: interaction.application_id,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    userId,
    roles: interaction.member?.roles ?? [],
  };

  const receivedAt = new Date().toISOString();
  const options = interaction.data?.options as unknown[] | undefined;
  let payload: JobPayload | null = null;

  switch (command.jobType) {
    case 'draw.requested': {
      const xValue = parseIntOption(getOptionValue(options, 'x'));
      const yValue = parseIntOption(getOptionValue(options, 'y'));
      const colorValue = normalizeColor(getOptionValue(options, 'color'));
      if (xValue === null || yValue === null || !colorValue) {
        respondEphemeral(res, 'Invalid draw parameters. Use: /draw x y color');
        return;
      }
      payload = {
        kind: 'draw.requested',
        receivedAt,
        source: 'discord',
        userId,
        x: xValue,
        y: yValue,
        color: colorValue,
        interaction: interactionMeta,
      };
      break;
    }
    case 'canvas.requested': {
      payload = {
        kind: 'canvas.requested',
        receivedAt,
        source: 'discord',
        userId,
        interaction: interactionMeta,
      };
      break;
    }
    case 'session.command': {
      const actionValue = getOptionValue(options, 'action');
      if (actionValue !== 'start' && actionValue !== 'pause' && actionValue !== 'reset') {
        respondEphemeral(res, 'Invalid session action. Use: start, pause, reset');
        return;
      }
      payload = {
        kind: 'session.command',
        receivedAt,
        source: 'discord',
        userId,
        action: actionValue,
        interaction: interactionMeta,
      };
      break;
    }
    case 'snapshot.requested': {
      payload = {
        kind: 'snapshot.requested',
        receivedAt,
        source: 'discord',
        userId,
        interaction: interactionMeta,
      };
      break;
    }
    default:
      respondEphemeral(res, 'Unknown command.');
      return;
  }

  try {
    await publishJob(payload, {
      source: 'discord',
      kind: payload.kind,
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
