import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
  ThreadChannel
} from 'discord.js';
import { execSync, exec } from 'node:child_process';
import * as dataStore from '../services/dataStore.js';
import * as configStore from '../services/configStore.js';
import type { Command } from './index.js';
import { sanitizeAgent } from '../utils/stringUtils.js';

let cachedAgents: string[] = [];
let cacheTimestamp = 0;
let refreshInFlight = false;
const CACHE_TTL_MS = 30_000;

const BUILT_IN_AGENTS = ['build', 'plan', 'explore', 'general', 'summary', 'title', 'compaction'];

function refreshCacheAsync(): void {
  if (refreshInFlight) return;
  refreshInFlight = true;
  exec('opencode agent list', { encoding: 'utf-8', timeout: 5000 }, (error, stdout) => {
    refreshInFlight = false;
    if (!error && stdout) {
      cachedAgents = parseAgentList(stdout);
      cacheTimestamp = Date.now();
    }
  });
}

function parseAgentList(output: string): string[] {
  const agents: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('[') && !trimmed.startsWith('{') && !trimmed.startsWith('opencode')) {
      const name = trimmed.split(' ')[0].toLowerCase();
      if (name) agents.push(name);
    }
  }
  return agents.length > 0 ? agents : BUILT_IN_AGENTS;
}

function getCachedAgents(): string[] {
  const now = Date.now();
  if (now - cacheTimestamp > CACHE_TTL_MS || cachedAgents.length === 0) {
    if (cachedAgents.length === 0) {
      try {
        const output = execSync('opencode agent list', { encoding: 'utf-8', timeout: 5000 });
        cachedAgents = parseAgentList(output);
        cacheTimestamp = now;
      } catch {
        cachedAgents = BUILT_IN_AGENTS;
        cacheTimestamp = now;
      }
    } else {
      refreshCacheAsync();
    }
  }
  return cachedAgents;
}

function getEffectiveChannelId(interaction: ChatInputCommandInteraction): string {
  const channel = interaction.channel;
  if (channel?.isThread()) {
    return (channel as ThreadChannel).parentId ?? interaction.channelId;
  }
  return interaction.channelId;
}

function resolveAgentHierarchy(channelId: string): { channel: string | undefined; project: string | undefined; global: string | undefined } {
  const channelAgent = dataStore.getChannelAgent(channelId);
  const globalAgent = configStore.getDefaultAgent();
  const projectAlias = dataStore.getChannelBinding(channelId);
  let projectAgent: string | undefined;
  if (projectAlias) {
    projectAgent = dataStore.getProjectDefaultAgent(projectAlias);
  }
  return { channel: channelAgent || undefined, project: projectAgent, global: globalAgent };
}

export const agent: Command = {
  data: new SlashCommandBuilder()
    .setName('agent')
    .setDescription('Manage the agent used for OpenCode sessions')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all available agents'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set the agent to use in this channel')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Agent name (e.g., build, plan, explore)')
            .setRequired(true)
            .setAutocomplete(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('default')
        .setDescription('Set the global default agent')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Agent name (e.g., build, plan, explore)')
            .setRequired(true)
            .setAutocomplete(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear the channel-level agent setting'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('show')
        .setDescription('Show current agent configuration')) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const agents = getCachedAgents();
        if (agents.length === 0) {
          await interaction.editReply('No agents found.');
          return;
        }

        let response = '### Available Agents\n\n';
        let isFirstMessage = true;

        for (const agent of agents) {
          const agentLine = `• \`${agent}\`\n`;
          if (response.length + agentLine.length > 1800 && response.length > 0) {
            if (isFirstMessage) {
              await interaction.editReply(response);
              isFirstMessage = false;
            } else {
              await interaction.followUp({ content: response, flags: MessageFlags.Ephemeral });
            }
            response = '';
          }
          response += agentLine;
        }

        if (response) {
          if (isFirstMessage) {
            await interaction.editReply(response);
          } else {
            await interaction.followUp({ content: response, flags: MessageFlags.Ephemeral });
          }
        }
      } catch (error) {
        console.error('Failed to list agents:', error);
        await interaction.editReply('Failed to retrieve agents from OpenCode CLI.');
      }
    } else if (subcommand === 'set') {
      const agentName = sanitizeAgent(interaction.options.getString('name', true));
      const channelId = getEffectiveChannelId(interaction);

      const projectAlias = dataStore.getChannelBinding(channelId);
      if (!projectAlias) {
        await interaction.reply({
          content: 'No project bound to this channel. Use `/use <alias>` first.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const availableAgents = getCachedAgents();
      if (availableAgents.length > 0 && !availableAgents.includes(agentName)) {
        await interaction.editReply(
          `Agent \`${agentName}\` not found.\nUse \`/agent list\` to see available agents.`
        );
        return;
      }

      dataStore.setChannelAgent(channelId, agentName);

      await interaction.editReply(
        `Agent for this channel set to \`${agentName}\`.\nSubsequent sessions will use this agent.`
      );
    } else if (subcommand === 'default') {
      const agentName = sanitizeAgent(interaction.options.getString('name', true));

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const availableAgents = getCachedAgents();
      if (availableAgents.length > 0 && !availableAgents.includes(agentName)) {
        await interaction.editReply(
          `Agent \`${agentName}\` not found.\nUse \`/agent list\` to see available agents.`
        );
        return;
      }

      configStore.setDefaultAgent(agentName);

      await interaction.editReply(
        `Global default agent set to \`${agentName}\`.\nThis will be used when no channel or project-level agent is configured.`
      );
    } else if (subcommand === 'clear') {
      const channelId = getEffectiveChannelId(interaction);

      const binding = dataStore.getChannelBinding(channelId);
      if (!binding) {
        await interaction.reply({
          content: 'No project bound to this channel.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      dataStore.setChannelAgent(channelId, '');
      await interaction.reply({
        content: 'Channel-level agent cleared. The project or global default will be used.',
        flags: MessageFlags.Ephemeral
      });
    } else if (subcommand === 'show') {
      const channelId = getEffectiveChannelId(interaction);
      const hierarchy = resolveAgentHierarchy(channelId);
      const effective = hierarchy.channel || hierarchy.project || hierarchy.global;

      let response = '### Agent Configuration\n\n';
      response += `**Channel**: ${hierarchy.channel ? `\`${hierarchy.channel}\`` : '*not set*'}\n`;
      response += `**Project**: ${hierarchy.project ? `\`${hierarchy.project}\`` : '*not set*'}\n`;
      response += `**Global**: ${hierarchy.global ? `\`${hierarchy.global}\`` : '*not set*'}\n`;
      response += `\n**Effective agent**: ${effective ? `\`${effective}\`` : '*default*'}`;

      await interaction.reply({
        content: response,
        flags: MessageFlags.Ephemeral
      });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const agents = getCachedAgents();

    const filtered = agents
      .filter(a => a.toLowerCase().includes(focused))
      .slice(0, 25);

    try {
      await interaction.respond(
        filtered.map(a => ({ name: a, value: a }))
      );
    } catch { }
  }
};
