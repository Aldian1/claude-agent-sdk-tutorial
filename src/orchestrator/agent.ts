import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import type { AgentInfo, AgentStatus, SubAgentInfo } from './types.js';
import { readMemory, writeMemory } from './memory.js';
import { createOrchestratorMcpServer, type SubAgentCallbacks, type LongTermMemoryCallbacks } from './tools.js';
import { buildSystemPrompt } from './prompts.js';
import { SubAgentRunner } from './subAgent.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding } from '../utils/embeddings.js';
import { longTermMemoryDb } from '../utils/database.js';
import { createTrace, endTrace, startSpan, endSpan, withSpan, getTraceContext } from '../utils/tracing.js';

/**
 * Individual agent orchestrator that runs in continuous cycles
 */
export class AgentOrchestrator {
  public readonly id: string;
  public status: AgentStatus = 'stopped';
  public cycleCount: number = 0;
  public readonly memoryPath: string;
  public readonly instructions: string;
  public readonly researchQuery?: string;
  public readonly resultsPath?: string;
  public readonly createdAt: Date;
  public lastCycleAt?: Date;
  public sleepUntil?: Date;

  private currentQuery?: Query;
  private sleepTimeout?: NodeJS.Timeout;
  private isPaused: boolean = false;
  private pauseResolve?: (value: void) => void;
  private cycleLoopPromise?: Promise<void>;
  private shouldStop: boolean = false;
  private subAgents: Map<string, SubAgentRunner> = new Map();
  private traceId?: string;

  constructor(
    id: string,
    instructions: string,
    memoryPath: string,
    researchQuery?: string,
    resultsPath?: string
  ) {
    this.id = id;
    this.instructions = instructions;
    this.memoryPath = memoryPath;
    this.researchQuery = researchQuery;
    this.resultsPath = resultsPath;
    this.createdAt = new Date();
  }

  /**
   * Handle sleep tool callback
   */
  private handleSleep(durationSeconds: number): void {
    logger.debug(`[Agent ${this.id}] Sleep tool called with duration: ${durationSeconds}s`);
    this.sleepUntil = new Date(Date.now() + durationSeconds * 1000);
    logger.debug(`[Agent ${this.id}] Sleep scheduled until: ${this.sleepUntil.toISOString()}`);
  }

  /**
   * Spawn a sub-agent for a specific research task
   */
  private async spawnSubAgent(task: string): Promise<SubAgentInfo> {
    logger.info(`[Agent ${this.id}] Spawning sub-agent for task: ${task}`);
    
    const context = getTraceContext();
    const parentSpanId = context?.currentSpanId;
    
    // Start span for sub-agent spawn
    const spanId = await startSpan(
      `spawn_sub_agent_${task.substring(0, 50)}`,
      'sub_agent',
      {
        traceId: this.traceId,
        parentSpanId,
        input: { task },
        metadata: { agent_id: this.id },
      }
    );
    
    try {
      // Determine report path in reports/sub-agents/{orchestrator-id}/{sub-agent-id}.md
      const reportsBasePath = this.resultsPath 
        ? join(this.resultsPath, '..', 'sub-agents', this.id)
        : join(process.cwd(), 'results', 'sub-agents', this.id);
      
      // Ensure directory exists
      if (!existsSync(reportsBasePath)) {
        await mkdir(reportsBasePath, { recursive: true });
      }

      // Generate ID first so we can use it in the report path
      const subAgentId = randomUUID();
      const reportPath = join(reportsBasePath, `${subAgentId}.md`);

      const subAgent = new SubAgentRunner(
        this.id,
        task,
        reportPath,
        subAgentId
      );

      this.subAgents.set(subAgent.id, subAgent);
      logger.debug(`[Agent ${this.id}] Sub-agent created: ${subAgent.id}`);

      // Pass trace context to sub-agent
      if (this.traceId) {
        subAgent.setTraceContext(this.traceId, spanId);
      }

      // Run sub-agent asynchronously (don't await - let it run in parallel)
      subAgent.run().catch((error) => {
        logger.error(`[Agent ${this.id}] Sub-agent ${subAgent.id} error:`, error);
      });

      const info = subAgent.getInfo();
      
      // End span with sub-agent info
      await endSpan(spanId, 'completed', {
        output: {
          sub_agent_id: info.id,
          status: info.status,
          report_path: info.reportPath,
        },
      });
      
      return info;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await endSpan(spanId, 'error', {
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * List all sub-agents
   */
  private listSubAgents(): SubAgentInfo[] {
    return Array.from(this.subAgents.values()).map(agent => agent.getInfo());
  }

  /**
   * Read a sub-agent's report
   */
  private async readSubAgentReport(subAgentId: string): Promise<string> {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      throw new Error(`Sub-agent ${subAgentId} not found`);
    }

    const reportPath = subAgent.reportPath;
    if (!existsSync(reportPath)) {
      throw new Error(`Report file not found for sub-agent ${subAgentId}: ${reportPath}`);
    }

    return await readFile(reportPath, 'utf-8');
  }

  /**
   * Save a long-term memory with embedding
   */
  private async saveLongTermMemory(title: string, content: string, category: string = 'research'): Promise<string> {
    logger.info(`[Agent ${this.id}] Saving long-term memory: ${title}`);
    try {
      // Generate embedding for the content
      const embedding = await generateEmbedding(content);
      
      // Store in database
      const memory = await longTermMemoryDb.create({
        agent_id: this.id,
        title,
        content,
        category,
        embedding,
        metadata: {
          research_query: this.researchQuery,
          cycle_count: this.cycleCount,
        },
      });

      if (!memory) {
        throw new Error('Failed to create long-term memory');
      }

      logger.debug(`[Agent ${this.id}] Long-term memory saved with ID: ${memory.id}`);
      return memory.id;
    } catch (error) {
      logger.error(`[Agent ${this.id}] Error saving long-term memory:`, error);
      throw error;
    }
  }

  /**
   * Search long-term memory using RAG
   */
  private async searchLongTermMemory(query: string, limit: number = 5): Promise<Array<{ title: string; content: string; similarity: number }>> {
    logger.info(`[Agent ${this.id}] Searching long-term memory: ${query}`);
    try {
      // Generate embedding for the query
      const queryEmbedding = await generateEmbedding(query);
      
      // Search database
      const results = await longTermMemoryDb.search(queryEmbedding, {
        agentId: this.id,
        threshold: 0.7,
        limit,
      });

      logger.debug(`[Agent ${this.id}] Found ${results.length} similar memories`);
      return results.map(r => ({
        title: r.title,
        content: r.content,
        similarity: r.similarity,
      }));
    } catch (error) {
      logger.error(`[Agent ${this.id}] Error searching long-term memory:`, error);
      throw error;
    }
  }

  /**
   * Get sub-agent callbacks for MCP tools
   */
  private getSubAgentCallbacks(): SubAgentCallbacks {
    return {
      spawnSubAgent: (task: string) => this.spawnSubAgent(task),
      listSubAgents: () => this.listSubAgents(),
      readSubAgentReport: (subAgentId: string) => this.readSubAgentReport(subAgentId),
    };
  }

  /**
   * Get long-term memory callbacks for MCP tools
   */
  private getLongTermMemoryCallbacks(): LongTermMemoryCallbacks {
    return {
      saveLongTermMemory: (title: string, content: string, category?: string) => 
        this.saveLongTermMemory(title, content, category),
      searchLongTermMemory: (query: string, limit?: number) => 
        this.searchLongTermMemory(query, limit),
    };
  }

  /**
   * Run a single cycle
   */
  private async runCycle(): Promise<void> {
    if (this.shouldStop) {
      return;
    }

    this.cycleCount++;
    this.lastCycleAt = new Date();
    logger.info(`[Agent ${this.id}] Starting cycle ${this.cycleCount}`);

    // Wrap cycle in a span
    await withSpan(
      `cycle_${this.cycleCount}`,
      'cycle',
      async (cycleSpanId) => {
        logger.debug(`[Agent ${this.id}] Building system prompt...`);
        const systemPrompt = await buildSystemPrompt(this.getInfo(), this.memoryPath, this.resultsPath);
        logger.debug(`[Agent ${this.id}] System prompt length: ${systemPrompt.length} chars`);
        
        const researchContext = this.researchQuery
          ? `\n\nResearch Query: "${this.researchQuery}"\nYour goal is to act as a project manager: break down this research query into focused sub-tasks, spawn sub-agents to research each sub-task in parallel, monitor their progress, read their reports when complete, and synthesize all findings into a comprehensive final report.`
          : '';
        
        const cyclePrompt = `Cycle ${this.cycleCount}: Act as a project manager for research. Review your memory and the research query. Break down the research into focused sub-tasks, spawn sub-agents to handle each sub-task in parallel, monitor their progress, read their reports when complete, and synthesize all findings into a comprehensive final report.${researchContext}`;
        logger.debug(`[Agent ${this.id}] Cycle prompt: ${cyclePrompt}`);

        logger.debug(`[Agent ${this.id}] Creating MCP server...`);
        const mcpServer = createOrchestratorMcpServer(
          (duration) => this.handleSleep(duration),
          this.resultsPath,
          this.getSubAgentCallbacks(),
          this.getLongTermMemoryCallbacks()
        );
        logger.debug(`[Agent ${this.id}] MCP server created`);
        
        const options: Options = {
          mcpServers: {
            orchestrator: mcpServer,
          },
          systemPrompt,
          settingSources: ['project'],
          tools: { type: 'preset', preset: 'claude_code' },
          permissionMode: 'bypassPermissions',
        };

        logger.debug(`[Agent ${this.id}] Creating query with options:`, {
          hasMcpServers: !!options.mcpServers,
          hasSystemPrompt: !!options.systemPrompt,
          tools: options.tools,
          permissionMode: options.permissionMode,
        });

        // Wrap LLM query in a span
        await withSpan(
          'llm_query',
          'llm',
          async (llmSpanId) => {
            try {
              logger.debug(`[Agent ${this.id}] Calling query()...`);
              const queryStartTime = Date.now();
              this.currentQuery = query({
                prompt: cyclePrompt,
                options,
              });
              logger.debug(`[Agent ${this.id}] Query created, starting to process messages...`);

              // Set up a timeout warning
              const timeoutWarning = setTimeout(() => {
                const elapsed = Date.now() - queryStartTime;
                logger.warn(`[Agent ${this.id}] Query has been running for ${Math.round(elapsed / 1000)}s without messages...`);
              }, 30000); // Warn after 30 seconds

              let sleepRequested = false;
              let messageCount = 0;
              const toolSpans = new Map<string, string>(); // Map tool call IDs to span IDs

              // Process messages
              for await (const message of this.currentQuery) {
                clearTimeout(timeoutWarning); // Clear warning once we get messages
                messageCount++;
                logger.debug(`[Agent ${this.id}] Message #${messageCount} received:`, {
                  type: message.type,
                  subtype: 'subtype' in message ? message.subtype : undefined,
                  uuid: 'uuid' in message ? message.uuid : undefined,
                });

                if (this.shouldStop) {
                  logger.debug(`[Agent ${this.id}] Stop requested, interrupting query...`);
                  await this.currentQuery.interrupt();
                  break;
                }

                if (this.isPaused) {
                  logger.debug(`[Agent ${this.id}] Paused, interrupting query...`);
                  await this.currentQuery.interrupt();
                  // Wait for resume
                  await new Promise<void>((resolve) => {
                    this.pauseResolve = resolve;
                  });
                  // Note: Query cannot be resumed, so we'll start a new cycle
                  break;
                }

                if (message.type === 'assistant') {
                  logger.debug(`[Agent ${this.id}] Assistant message received`);
                  const content = message.message.content;
                  if (Array.isArray(content)) {
                    logger.debug(`[Agent ${this.id}] Content blocks: ${content.length}`);
                    for (const block of content) {
                      if (block.type === 'text') {
                        logger.debug(`[Agent ${this.id}] Text block length: ${block.text.length} chars`);
                      } else if (block.type === 'tool_use') {
                        // Start span for tool call
                        const toolSpanId = await startSpan(
                          `tool_${block.name}`,
                          'tool',
                          {
                            parentSpanId: llmSpanId,
                            input: block.input,
                            metadata: {
                              tool_id: block.id,
                            },
                          }
                        );
                        toolSpans.set(block.id, toolSpanId);
                        logger.debug(`[Agent ${this.id}] Tool use detected:`, {
                          name: block.name,
                          id: block.id,
                          input: JSON.stringify(block.input).substring(0, 100),
                        });
                      }
                    }
                  }
                } else if (message.type === 'stream_event') {
                  const event = message.event;
                  logger.debug(`[Agent ${this.id}] Stream event:`, {
                    eventType: event.type,
                    deltaType: 'delta' in event && event.delta ? event.delta.type : undefined,
                  });
                } else if (message.type === 'result') {
                  logger.debug(`[Agent ${this.id}] Result message received:`, {
                    subtype: message.subtype,
                    duration_ms: message.duration_ms,
                    num_turns: message.num_turns,
                    is_error: message.is_error,
                  });
                  
                  if (message.subtype === 'success') {
                    logger.info(`[Agent ${this.id}] Cycle ${this.cycleCount} completed successfully`);
                    logger.debug(`[Agent ${this.id}] Result details:`, {
                      duration_ms: message.duration_ms,
                      duration_api_ms: message.duration_api_ms,
                      num_turns: message.num_turns,
                      total_cost_usd: message.total_cost_usd,
                      usage: message.usage,
                    });
                    
                    // End LLM span with result metadata
                    await endSpan(llmSpanId, 'completed', {
                      output: {
                        duration_ms: message.duration_ms,
                        duration_api_ms: message.duration_api_ms,
                        num_turns: message.num_turns,
                        total_cost_usd: message.total_cost_usd,
                        usage: message.usage,
                      },
                      metadata: {
                        message_count: messageCount,
                      },
                    });
                    
                    // Check if sleep was requested
                    if (this.sleepUntil) {
                      sleepRequested = true;
                      logger.debug(`[Agent ${this.id}] Sleep was requested during cycle`);
                    }
                  } else {
                    logger.error(`[Agent ${this.id}] Cycle ${this.cycleCount} error:`, {
                      subtype: message.subtype,
                      errors: message.errors,
                    });
                    
                    // End LLM span with error
                    const firstError = message.errors?.[0];
                    const errorMessage = firstError 
                      ? (typeof firstError === 'string' ? firstError : String(firstError))
                      : 'Unknown error';
                    await endSpan(llmSpanId, 'error', {
                      error: errorMessage,
                      output: {
                        errors: message.errors,
                      },
                    });
                  }
                } else if (message.type === 'system') {
                  logger.debug(`[Agent ${this.id}] System message:`, {
                    subtype: message.subtype,
                    tools: 'tools' in message ? message.tools : undefined,
                    model: 'model' in message ? message.model : undefined,
                  });
                } else {
                  logger.debug(`[Agent ${this.id}] Unknown message type: ${message.type}`);
                }
              }

              clearTimeout(timeoutWarning);
              const queryDuration = Date.now() - queryStartTime;
              logger.debug(`[Agent ${this.id}] Finished processing ${messageCount} messages (took ${Math.round(queryDuration / 1000)}s)`);

              // End any remaining tool spans (in case they weren't completed)
              for (const [toolId, toolSpanId] of toolSpans.entries()) {
                await endSpan(toolSpanId, 'completed', {
                  metadata: { note: 'Tool span ended with LLM query' },
                });
              }

              // If sleep was requested, wait for it
              if (sleepRequested && this.sleepUntil) {
                const sleepDuration = this.sleepUntil.getTime() - Date.now();
                logger.debug(`[Agent ${this.id}] Sleep requested, duration: ${sleepDuration}ms`);
                if (sleepDuration > 0) {
                  this.status = 'sleeping';
                  logger.info(`[Agent ${this.id}] Sleeping for ${Math.round(sleepDuration / 1000)}s`);
                  await new Promise<void>((resolve) => {
                    this.sleepTimeout = setTimeout(() => {
                      logger.debug(`[Agent ${this.id}] Sleep timeout completed`);
                      this.sleepUntil = undefined;
                      resolve();
                    }, sleepDuration);
                  });
                }
                this.sleepUntil = undefined;
              } else {
                logger.debug(`[Agent ${this.id}] No sleep requested, continuing to next cycle`);
              }

              this.currentQuery = undefined;
              logger.debug(`[Agent ${this.id}] Cycle ${this.cycleCount} cleanup complete`);
            } catch (error) {
              logger.error(`[Agent ${this.id}] Error in cycle ${this.cycleCount}:`, error);
              if (error instanceof Error) {
                logger.debug(`[Agent ${this.id}] Error stack:`, error.stack);
              }
              this.currentQuery = undefined;
              throw error;
            }
          },
          {
            traceId: this.traceId,
            parentSpanId: cycleSpanId,
            input: {
              cycle_number: this.cycleCount,
              prompt: cyclePrompt.substring(0, 500), // Truncate for storage
            },
            metadata: {
              system_prompt_length: systemPrompt.length,
            },
          }
        );
      },
      {
        traceId: this.traceId,
        input: {
          cycle_number: this.cycleCount,
          research_query: this.researchQuery,
        },
        metadata: {
          agent_id: this.id,
        },
      }
    );
  }

  /**
   * Main cycle loop
   */
  private async cycleLoop(): Promise<void> {
    logger.debug(`[Agent ${this.id}] Cycle loop started`);
    while (!this.shouldStop) {
      logger.debug(`[Agent ${this.id}] Cycle loop iteration, shouldStop: ${this.shouldStop}, isPaused: ${this.isPaused}`);
      
      if (this.isPaused) {
        logger.debug(`[Agent ${this.id}] Paused, waiting for resume...`);
        // Wait for resume
        await new Promise<void>((resolve) => {
          this.pauseResolve = resolve;
        });
        logger.debug(`[Agent ${this.id}] Resumed, continuing loop`);
        continue;
      }

      this.status = 'running';
      logger.debug(`[Agent ${this.id}] Calling runCycle()...`);
      await this.runCycle();
      logger.debug(`[Agent ${this.id}] runCycle() completed`);

      // Small delay between cycles if not sleeping
      if (!this.sleepUntil && !this.shouldStop) {
        logger.debug(`[Agent ${this.id}] Waiting 1s before next cycle...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        logger.debug(`[Agent ${this.id}] Skipping delay (sleepUntil: ${this.sleepUntil}, shouldStop: ${this.shouldStop})`);
      }
    }

    this.status = 'stopped';
    logger.info(`[Agent ${this.id}] Cycle loop stopped`);
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    if (this.status !== 'stopped') {
      throw new Error(`Agent ${this.id} is already running`);
    }

    this.shouldStop = false;
    this.isPaused = false;
    this.status = 'running';

    // Create trace for agent run
    this.traceId = await createTrace(
      this.id,
      'agent_run',
      {
        instructions: this.instructions,
        research_query: this.researchQuery,
        memory_path: this.memoryPath,
        results_path: this.resultsPath,
      }
    );

    // Ensure memory directory exists
    const memoryDir = join(this.memoryPath, '..');
    if (!existsSync(memoryDir)) {
      await mkdir(memoryDir, { recursive: true });
    }

    // Initialize memory file if it doesn't exist
    if (!existsSync(this.memoryPath)) {
      const defaultMemory = await readMemory(
        this.memoryPath,
        this.id,
        this.instructions,
        this.createdAt
      );
      await writeMemory(this.memoryPath, defaultMemory, this.id);
    }

    // Start cycle loop
    this.cycleLoopPromise = this.cycleLoop();
    logger.info(`[Agent ${this.id}] Started`);
  }

  /**
   * Pause the orchestrator
   */
  async pause(): Promise<void> {
    if (this.status === 'stopped') {
      throw new Error(`Agent ${this.id} is not running`);
    }

    if (this.isPaused) {
      return; // Already paused
    }

    this.isPaused = true;
    this.status = 'paused';

    // Interrupt current query if running
    if (this.currentQuery) {
      await this.currentQuery.interrupt();
    }

    // Clear sleep timeout if sleeping
    if (this.sleepTimeout) {
      clearTimeout(this.sleepTimeout);
      this.sleepTimeout = undefined;
      this.sleepUntil = undefined;
    }

    logger.info(`[Agent ${this.id}] Paused`);
  }

  /**
   * Resume the orchestrator
   */
  async resume(): Promise<void> {
    if (!this.isPaused) {
      return; // Not paused
    }

    this.isPaused = false;
    this.status = 'running';

    // Resolve pause promise to continue cycle loop
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = undefined;
    }

    logger.info(`[Agent ${this.id}] Resumed`);
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      return;
    }

    this.shouldStop = true;
    this.isPaused = false;

    // Interrupt current query
    if (this.currentQuery) {
      await this.currentQuery.interrupt();
    }

    // Stop all sub-agents
    for (const subAgent of this.subAgents.values()) {
      await subAgent.stop();
    }
    this.subAgents.clear();

    // Clear sleep timeout
    if (this.sleepTimeout) {
      clearTimeout(this.sleepTimeout);
      this.sleepTimeout = undefined;
    }

    // Resolve pause promise if paused
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = undefined;
    }

    // Wait for cycle loop to finish
    if (this.cycleLoopPromise) {
      await this.cycleLoopPromise;
    }

    // End trace
    if (this.traceId) {
      await endTrace(this.traceId, 'completed');
      this.traceId = undefined;
    }

    this.status = 'stopped';
    logger.info(`[Agent ${this.id}] Stopped`);
  }

  /**
   * Get agent info
   */
  getInfo(): AgentInfo {
    return {
      id: this.id,
      status: this.status,
      cycleCount: this.cycleCount,
      memoryPath: this.memoryPath,
      instructions: this.instructions,
      researchQuery: this.researchQuery,
      resultsPath: this.resultsPath,
      createdAt: this.createdAt,
      lastCycleAt: this.lastCycleAt,
      sleepUntil: this.sleepUntil,
    };
  }
}

