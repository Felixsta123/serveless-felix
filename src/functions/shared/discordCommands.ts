import type { DiscordInteraction } from './discord.js';

export type DiscordCommandRoute = {
  name: string;
  jobType: string;
};

const COMMAND_ROUTES = new Map<string, DiscordCommandRoute>([
  ['hello', { name: 'hello', jobType: 'discord.hello' }],
]);

export const resolveDiscordCommand = (
  interaction: DiscordInteraction,
): DiscordCommandRoute | null => {
  const name = interaction.data?.name;
  if (!name) {
    return null;
  }
  return COMMAND_ROUTES.get(name) ?? null;
};

export const listDiscordCommands = (): string[] => Array.from(COMMAND_ROUTES.keys());

