import { config } from 'dotenv';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './utils/logger.js';

// Load environment variables from .env file
config();

/**
 * Main entry point for the Claude Agent SDK application.
 * 
 * This sets up a streaming agent with explicit configuration
 * to ensure environment isolation and predictable behavior.
 */
async function main() {
  // Validate required environment variables
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
      'Please create a .env file with your API key.'
    );
  }

  // Configure agent options with explicit setting sources
  // This prevents loading settings from other projects and ensures isolation
  const options: Options = {
    settingSources: ['project'], // Load settings only from project directory
  };

  // Example prompt - replace with your actual use case
  const prompt = 'Hello! Can you help me get started with the Claude Agent SDK?';

  try {
    logger.info('Starting Claude Agent...\n');
    
    // Use streaming mode for real-time interaction
    const queryResult = query({
      prompt,
      options,
    });
    
    // Process streaming messages
    for await (const message of queryResult) {
      // Handle different message types
      if (message.type === 'assistant') {
        // Extract text content from assistant messages
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              process.stdout.write(block.text);
            }
          }
        }
      } else if (message.type === 'stream_event') {
        // Handle streaming events (partial messages)
        const event = message.event;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          process.stdout.write(event.delta.text);
        }
      } else if (message.type === 'result') {
        // Final result message
        if (message.subtype === 'success') {
          logger.info('\n\nAgent interaction complete.');
          logger.info(`Total cost: $${message.total_cost_usd.toFixed(6)}`);
        } else {
          logger.error('\n\nError:', message.errors?.join(', '));
        }
      }
    }
  } catch (error) {
    logger.error('Error during agent execution:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});

