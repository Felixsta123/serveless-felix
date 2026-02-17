import { HttpFunction } from '@google-cloud/functions-framework';
import {
  InteractionResponseType,
  InteractionType,
  getInteractionUserId,
  parseDiscordInteraction,
  verifyDiscordRequest,
} from '../../shared/discord.js';
import { postDiscordFollowup } from '../../shared/discordApi.js';
import { resolveDiscordCommand } from '../../shared/discordCommands.js';
import { JobPayload, publishJob } from '../../shared/queue.js';
import {
  getHttpRequestContext,
  logError,
  logWarn,
} from '../../shared/observability.js';
import { normalizeHexColor, parseIntStrict } from '../../shared/validation.js';
import { runWithSpan } from '../../shared/tracing.js';

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

export const discordProxy: HttpFunction = async (req, res) =>
  runWithSpan(
    'discordProxy.http',
    {
      'faas.trigger': 'http',
      'http.method': req.method,
      'http.route': req.path ?? '/discord',
    },
    async () => {
  const requestContext = getHttpRequestContext(req);

  if (req.method !== 'POST') {
    logWarn('discord_proxy_method_not_allowed', {
      ...requestContext,
      method: req.method,
    });
    res.status(405).set('Allow', 'POST').send({ message: 'Method Not Allowed' });
    return;
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    logError('discord_proxy_missing_public_key', new Error('DISCORD_PUBLIC_KEY is not set'), {
      ...requestContext,
    });
    res.status(500).send({ message: 'DISCORD_PUBLIC_KEY is not set' });
    return;
  }

  if (!verifyDiscordRequest(req, publicKey)) {
    logWarn('discord_proxy_invalid_signature', {
      ...requestContext,
    });
    res.status(401).send({ message: 'Invalid request signature' });
    return;
  }

  const interaction = parseDiscordInteraction(req);
  if (!interaction) {
    logWarn('discord_proxy_invalid_body', {
      ...requestContext,
    });
    res.status(400).send({ message: 'Invalid JSON body' });
    return;
  }

  if (interaction.type === InteractionType.Ping) {
    res.status(200).json({ type: InteractionResponseType.Pong });
    return;
  }

  if (interaction.type !== InteractionType.ApplicationCommand) {
    logWarn('discord_proxy_unsupported_interaction_type', {
      ...requestContext,
      interactionType: interaction.type,
    });
    res.status(400).send({ message: 'Unsupported interaction type' });
    return;
  }

  const command = resolveDiscordCommand(interaction);
  if (!command) {
    logWarn('discord_proxy_unknown_command', {
      ...requestContext,
      commandName: interaction.data?.name,
      interactionId: interaction.id,
    });
    res.status(200).json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: 'Commande inconnue.',
        flags: 64,
      },
    });
    return;
  }

  const allowedGuildId = process.env.DISCORD_ALLOWED_GUILD_ID;
  if (allowedGuildId && interaction.guild_id && interaction.guild_id !== allowedGuildId) {
    logWarn('discord_proxy_guild_not_allowed', {
      ...requestContext,
      interactionId: interaction.id,
      guildId: interaction.guild_id,
      allowedGuildId,
    });
    respondEphemeral(res, "Cette commande n'est pas autorisée sur ce serveur.");
    return;
  }

  const userId = getInteractionUserId(interaction);
  if (!userId) {
    logWarn('discord_proxy_missing_user_id', {
      ...requestContext,
      interactionId: interaction.id,
    });
    respondEphemeral(res, "Impossible d'identifier l'utilisateur pour cette commande.");
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
      const xValue = parseIntStrict(getOptionValue(options, 'x'));
      const yValue = parseIntStrict(getOptionValue(options, 'y'));
      const colorValue = normalizeHexColor(getOptionValue(options, 'color'));
      if (xValue === null || yValue === null || !colorValue) {
        respondEphemeral(res, 'Paramètres de dessin invalides. Utilisez : /draw x y color');
        return;
      }
      payload = {
        kind: 'draw.requested',
        receivedAt,
        correlationId: requestContext.correlationId,
        requestId: requestContext.requestId,
        traceId: requestContext.traceId,
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
        correlationId: requestContext.correlationId,
        requestId: requestContext.requestId,
        traceId: requestContext.traceId,
        source: 'discord',
        userId,
        interaction: interactionMeta,
      };
      break;
    }
    case 'session.command': {
      const actionValue = getOptionValue(options, 'action');
      if (actionValue !== 'start' && actionValue !== 'pause' && actionValue !== 'reset') {
        respondEphemeral(res, 'Action de session invalide. Utilisez : start, pause, reset');
        return;
      }
      payload = {
        kind: 'session.command',
        receivedAt,
        correlationId: requestContext.correlationId,
        requestId: requestContext.requestId,
        traceId: requestContext.traceId,
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
        correlationId: requestContext.correlationId,
        requestId: requestContext.requestId,
        traceId: requestContext.traceId,
        source: 'discord',
        userId,
        interaction: interactionMeta,
      };
      break;
    }
    default:
      respondEphemeral(res, 'Commande non prise en charge.');
      return;
  }

  res.status(200).json({
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: {
      flags: 64,
    },
  });

  try {
    await publishJob(payload, { source: 'discord', kind: payload.kind });
  } catch (error) {
    logError('discord_proxy_publish_failed', error, {
      ...requestContext,
      commandName: command.name,
      jobKind: payload.kind,
      interactionId: interaction.id,
      userId,
    });

    const applicationId = interaction.application_id;
    const interactionToken = interaction.token;
    if (!applicationId || !interactionToken) {
      logWarn('discord_proxy_publish_error_followup_missing_interaction_meta', {
        ...requestContext,
        commandName: command.name,
        interactionId: interaction.id,
        userId,
      });
      return;
    }

    try {
      await postDiscordFollowup(
        applicationId,
        interactionToken,
        'Impossible de prendre en compte la commande pour le moment. Réessayez plus tard.',
        64,
      );
    } catch (followupError) {
      logError('discord_proxy_publish_error_followup_failed', followupError, {
        ...requestContext,
        commandName: command.name,
        interactionId: interaction.id,
        userId,
      });
    }
  }
    },
  );
