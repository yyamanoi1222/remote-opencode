import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js';
import * as dataStore from '../services/dataStore.js';
import type { Command } from './index.js';

export const default_agent: Command = {
  data: new SlashCommandBuilder()
    .setName('default_agent')
    .setDescription('Set the default agent for a project')
    .addStringOption(option =>
      option.setName('agent')
        .setDescription('The agent name (e.g., general-purpose)')
        .setRequired(true)) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const agent = interaction.options.getString('agent', true);
    const channelId = interaction.channelId;
    
    const projectAlias = dataStore.getChannelBinding(channelId);
    if (!projectAlias) {
      await interaction.reply({
        content: '❌ No project bound to this channel. Use `/use <alias>` first.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const project = dataStore.getProject(projectAlias);
    if (!project) {
      await interaction.reply({
        content: `❌ Project \`${projectAlias}\` not found.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    dataStore.setProjectDefaultAgent(projectAlias, agent);
    
    await interaction.reply({
      content: `✅ Default agent for project \`${projectAlias}\` set to \`${agent}\`.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
