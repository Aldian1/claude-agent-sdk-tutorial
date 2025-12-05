import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';

export type ProcessStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';

export interface ProcessInfo {
  id: string;
  status: ProcessStatus;
  prompt: string;
  createdAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  cost?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  query?: Query;
}

class ProcessManager {
  private processes: Map<string, ProcessInfo> = new Map();

  /**
   * Start a new agent process
   */
  async startProcess(
    prompt: string,
    options?: Options
  ): Promise<string> {
    const id = randomUUID();
    
    const processInfo: ProcessInfo = {
      id,
      status: 'pending',
      prompt,
      createdAt: new Date(),
    };

    this.processes.set(id, processInfo);

    // Start the query asynchronously
    this.executeQuery(id, prompt, options).catch((error) => {
      const process = this.processes.get(id);
      if (process) {
        process.status = 'error';
        process.error = error instanceof Error ? error.message : String(error);
        process.completedAt = new Date();
      }
    });

    return id;
  }

  /**
   * Execute the query and update process status
   */
  private async executeQuery(
    id: string,
    prompt: string,
    options?: Options
  ): Promise<void> {
    const process = this.processes.get(id);
    if (!process) return;

    try {
      process.status = 'running';
      
      const queryResult = query({
        prompt,
        options: {
          settingSources: ['project'],
          ...options,
        },
      });

      // Store the query object for potential cancellation
      process.query = queryResult;

      const messages: string[] = [];

      // Process streaming messages
      for await (const message of queryResult) {
        // Handle different message types
        if (message.type === 'assistant') {
          // Extract text content from assistant messages
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                messages.push(block.text);
              }
            }
          }
        } else if (message.type === 'stream_event') {
          // Handle streaming events (partial messages)
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            messages.push(event.delta.text);
          }
        } else if (message.type === 'result') {
          // Final result message
          if (message.subtype === 'success') {
            process.status = 'completed';
            process.result = messages.join('');
            process.cost = message.total_cost_usd;
            process.usage = {
              inputTokens: message.usage.input_tokens || 0,
              outputTokens: message.usage.output_tokens || 0,
            };
          } else {
            process.status = 'error';
            process.error = message.errors?.join(', ') || 'Unknown error';
          }
          process.completedAt = new Date();
          process.query = undefined; // Clear query reference
        }
      }
    } catch (error) {
      process.status = 'error';
      process.error = error instanceof Error ? error.message : String(error);
      process.completedAt = new Date();
      process.query = undefined;
    }
  }

  /**
   * Get process information by ID
   */
  getProcess(id: string): ProcessInfo | undefined {
    return this.processes.get(id);
  }

  /**
   * Cancel a running process
   */
  async cancelProcess(id: string): Promise<boolean> {
    const process = this.processes.get(id);
    if (!process || !process.query) {
      return false;
    }

    try {
      await process.query.interrupt();
      process.status = 'cancelled';
      process.completedAt = new Date();
      process.query = undefined;
      return true;
    } catch (error) {
      process.status = 'error';
      process.error = error instanceof Error ? error.message : String(error);
      process.completedAt = new Date();
      return false;
    }
  }

  /**
   * Get all processes (for debugging/admin purposes)
   */
  getAllProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * Clean up old completed processes (older than 1 hour)
   */
  cleanupOldProcesses(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, process] of this.processes.entries()) {
      if (
        (process.status === 'completed' || process.status === 'error' || process.status === 'cancelled') &&
        process.completedAt &&
        process.completedAt.getTime() < oneHourAgo
      ) {
        this.processes.delete(id);
      }
    }
  }
}

// Singleton instance
export const processManager = new ProcessManager();

// Cleanup old processes every 30 minutes
setInterval(() => {
  processManager.cleanupOldProcesses();
}, 30 * 60 * 1000);

