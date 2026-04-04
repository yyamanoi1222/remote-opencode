import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction,
  MessageFlags,
  ThreadChannel
} from 'discord.js';
import * as dataStore from '../services/dataStore.js';
import type { Command } from './index.js';

export const agent: Command = {
  data: new SlashCommandBuilder()
    .setName('agent')
    .setDescription('Set the agent for this session (thread)')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The agent name (e.g., general-purpose)')
        .setRequired(true)) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const channel = interaction.channel;
    if (!channel?.isThread()) {
      await interaction.reply({
        content: '❌ This command must be used in a thread.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const threadId = channel.id;
    const agent = interaction.options.getString('name', true);
    
    const session = dataStore.getThreadSession(threadId);
    if (!session) {
      await interaction.reply({
        content: '❌ No active session in this thread. Send a prompt first.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    dataStore.setThreadSessionAgent(threadId, agent);
    
    await interaction.reply({
      content: `✅ Agent for this session set to \`${agent}\`.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
