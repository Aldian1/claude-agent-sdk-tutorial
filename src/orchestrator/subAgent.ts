import { query, type Options, type Query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { SubAgentInfo, SubAgentStatus } from './types.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { startSpan, endSpan, withSpan, setTraceContext, getTraceContext } from '../utils/tracing.js';

/**
 * Lightweight sub-agent that runs a single research task and writes findings to a report file
 */
export class SubAgentRunner {
  public readonly id: string;
  public readonly parentId: string;
  public readonly task: string;
  public readonly reportPath: string;
  public readonly createdAt: Date;
  public status: SubAgentStatus = 'pending';
  public completedAt?: Date;
  public error?: string;

  private currentQuery?: Query;
  private traceId?: string;
  private parentSpanId?: string;

  constructor(
    parentId: string,
    task: string,
    reportPath: string,
    id?: string
  ) {
    this.id = id || randomUUID();
    this.parentId = parentId;
    this.task = task;
    this.reportPath = reportPath;
    this.createdAt = new Date();
  }

  /**
   * Set trace context for this sub-agent
   */
  setTraceContext(traceId: string, parentSpanId: string): void {
    this.traceId = traceId;
    this.parentSpanId = parentSpanId;
  }

  /**
   * Create MCP server with saveReport tool for sub-agent
   */
  private createSubAgentMcpServer() {
    const saveReportTool = tool(
      'saveReport',
      'Save your research findings to the report file. Keep it concise - quick summary, key points, and sources. This is your final output.',
      {
        content: z.string().describe('Brief markdown content with summary, key points (3-5 bullets), and 2-3 source URLs. Keep it under 300 words.'),
      },
      async ({ content }) => {
        logger.info(`[SubAgent ${this.id}] Saving report to: ${this.reportPath}`);
        try {
          // Ensure directory exists
          const dir = dirname(this.reportPath);
          if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
          }

          // Add header with metadata
          const timestamp = new Date().toISOString();
          const reportContent = `# Sub-Agent Research Report
Sub-Agent ID: ${this.id}
Parent Orchestrator: ${this.parentId}
Task: ${this.task}
Generated: ${timestamp}

${content}
`;

          await writeFile(this.reportPath, reportContent, 'utf-8');
          logger.debug(`[SubAgent ${this.id}] Report saved successfully`);
          return {
            content: [
              {
                type: 'text',
                text: `Research report has been saved to ${this.reportPath}. Your task is complete.`,
              },
            ],
          };
        } catch (error) {
          logger.error(`[SubAgent ${this.id}] Error saving report:`, error);
          return {
            content: [
              {
                type: 'text',
                text: `Error saving report: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    return createSdkMcpServer({
      name: 'sub-agent-tools',
      tools: [saveReportTool],
    });
  }

  /**
   * Run the sub-agent research task
   */
  async run(): Promise<void> {
    if (this.status !== 'pending') {
      throw new Error(`SubAgent ${this.id} is not in pending status`);
    }

    this.status = 'researching';
    logger.info(`[SubAgent ${this.id}] Starting research task: ${this.task}`);

    // Wrap sub-agent run in a span
    await withSpan(
      `sub_agent_${this.task.substring(0, 50)}`,
      'sub_agent',
      async (subAgentSpanId) => {
        // Set trace context for this sub-agent
        if (this.traceId) {
          setTraceContext({
            traceId: this.traceId,
            currentSpanId: subAgentSpanId,
          });
        }

        // Ensure report directory exists
        const reportDir = dirname(this.reportPath);
        if (!existsSync(reportDir)) {
          await mkdir(reportDir, { recursive: true });
        }

        const systemPrompt = `You are a fast research sub-agent. Your job is to quickly find and summarize information.

## Your Task
${this.task}

## Instructions
1. Use web search to quickly find relevant information (1-2 searches max)
2. Summarize key points concisely
3. Include 2-3 sources
4. Save your findings using 'saveReport' tool

## Report Format
Keep it brief:
- Quick summary (2-3 sentences)
- Key points (bullet list, 3-5 items)
- Sources (2-3 URLs)

Be fast and focused. Don't over-research.`;

        const taskPrompt = `Task: ${this.task}

Quickly research this topic using web search. Find the key information, summarize it briefly, and save your report. Keep it concise - aim for 200-300 words total.`;

        const mcpServer = this.createSubAgentMcpServer();

        const options: Options = {
          mcpServers: {
            'sub-agent': mcpServer,
          },
          systemPrompt,
          settingSources: ['project'],
          tools: { type: 'preset', preset: 'claude_code' },
          permissionMode: 'bypassPermissions',
        };

        // Wrap LLM query in a span
        await withSpan(
          'sub_agent_llm_query',
          'llm',
          async (llmSpanId) => {
            try {
              logger.debug(`[SubAgent ${this.id}] Creating query...`);
              this.currentQuery = query({
                prompt: taskPrompt,
                options,
              });

              let reportSaved = false;
              let messageCount = 0;
              const MAX_MESSAGES = 20; // Limit to prevent excessive research
              const toolSpans = new Map<string, string>(); // Map tool call IDs to span IDs

              // Process messages
              for await (const message of this.currentQuery) {
                messageCount++;
                logger.debug(`[SubAgent ${this.id}] Message #${messageCount} received:`, {
                  type: message.type,
                });

                // Stop if too many messages (taking too long)
                if (messageCount > MAX_MESSAGES) {
                  logger.warn(`[SubAgent ${this.id}] Stopping after ${MAX_MESSAGES} messages - taking too long`);
                  if (this.currentQuery) {
                    await this.currentQuery.interrupt();
                  }
                  this.status = 'failed';
                  this.error = `Stopped after ${MAX_MESSAGES} messages - research taking too long`;
                  break;
                }

                if (message.type === 'assistant') {
                  const content = message.message.content;
                  if (Array.isArray(content)) {
                    for (const block of content) {
                      if (block.type === 'tool_use') {
                        // Start span for tool call
                        const toolSpanId = await startSpan(
                          `tool_${block.name}`,
                          'tool',
                          {
                            traceId: this.traceId,
                            parentSpanId: llmSpanId,
                            input: block.input,
                            metadata: {
                              tool_id: block.id,
                            },
                          }
                        );
                        toolSpans.set(block.id, toolSpanId);
                        
                        if (block.name === 'saveReport') {
                          reportSaved = true;
                          logger.debug(`[SubAgent ${this.id}] Report save tool called`);
                          // End tool span immediately since saveReport completes synchronously
                          await endSpan(toolSpanId, 'completed', {
                            output: { report_path: this.reportPath },
                          });
                          toolSpans.delete(block.id);
                        }
                      }
                    }
                  }
                } else if (message.type === 'result') {
                  // End any remaining tool spans
                  for (const [toolId, toolSpanId] of toolSpans.entries()) {
                    await endSpan(toolSpanId, 'completed', {
                      metadata: { note: 'Tool span ended with LLM query' },
                    });
                  }
                  
                  if (message.subtype === 'success') {
                    logger.info(`[SubAgent ${this.id}] Research completed successfully`);
                    
                    // End LLM span
                    await endSpan(llmSpanId, 'completed', {
                      output: {
                        duration_ms: message.duration_ms,
                        duration_api_ms: message.duration_api_ms,
                        num_turns: message.num_turns,
                        total_cost_usd: message.total_cost_usd,
                        usage: message.usage,
                        report_saved: reportSaved,
                      },
                      metadata: {
                        message_count: messageCount,
                      },
                    });
                    
                    if (reportSaved) {
                      this.status = 'completed';
                      this.completedAt = new Date();
                      logger.info(`[SubAgent ${this.id}] Report saved, task complete`);
                    } else {
                      logger.warn(`[SubAgent ${this.id}] Query completed but report not saved`);
                      this.status = 'failed';
                      this.error = 'Report not saved';
                    }
                  } else {
                    logger.error(`[SubAgent ${this.id}] Research failed:`, {
                      subtype: message.subtype,
                      errors: message.errors,
                    });
                    
                    // End LLM span with error
                    const errorMessage = Array.isArray(message.errors) && message.errors.length > 0
                      ? message.errors[0]
                      : 'Unknown error';
                    await endSpan(llmSpanId, 'error', {
                      error: errorMessage,
                      output: {
                        errors: message.errors,
                      },
                    });
                    
                    this.status = 'failed';
                    this.error = errorMessage;
                  }
                }
              }

              this.currentQuery = undefined;
            } catch (error) {
              logger.error(`[SubAgent ${this.id}] Error during research:`, error);
              this.status = 'failed';
              this.error = error instanceof Error ? error.message : String(error);
              this.currentQuery = undefined;
              throw error;
            }
          },
          {
            traceId: this.traceId,
            parentSpanId: subAgentSpanId,
            input: {
              task: this.task,
              prompt: taskPrompt.substring(0, 500), // Truncate for storage
            },
            metadata: {
              system_prompt_length: systemPrompt.length,
            },
          }
        );

        // End sub-agent span
        await endSpan(subAgentSpanId, this.status === 'completed' ? 'completed' : 'error', {
          output: {
            status: this.status,
            completed_at: this.completedAt?.toISOString(),
            error: this.error,
            report_path: this.reportPath,
          },
        });
      },
      {
        traceId: this.traceId,
        parentSpanId: this.parentSpanId,
        input: {
          task: this.task,
          sub_agent_id: this.id,
          parent_id: this.parentId,
        },
        metadata: {
          report_path: this.reportPath,
        },
      }
    );
  }

  /**
   * Get sub-agent info
   */
  getInfo(): SubAgentInfo {
    return {
      id: this.id,
      parentId: this.parentId,
      status: this.status,
      task: this.task,
      reportPath: this.reportPath,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      error: this.error,
    };
  }

  /**
   * Stop the sub-agent (interrupt if running)
   */
  async stop(): Promise<void> {
    if (this.currentQuery) {
      await this.currentQuery.interrupt();
      this.currentQuery = undefined;
    }
    if (this.status === 'researching') {
      this.status = 'failed';
      this.error = 'Interrupted';
    }
  }
}

