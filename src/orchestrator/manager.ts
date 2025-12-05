import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AgentOrchestrator } from './agent.js';
import { logger } from '../utils/logger.js';

/**
 * Manager for multiple agent orchestrators
 */
export class OrchestratorManager {
  private agents: Map<string, AgentOrchestrator> = new Map();
  private memoryBasePath: string;

  constructor(memoryBasePath: string = join(process.cwd(), 'memory')) {
    this.memoryBasePath = memoryBasePath;
  }

  /**
   * Spawn a new agent
   */
  async spawn(
    instructions: string,
    options?: {
      memoryTemplate?: string;
      researchQuery?: string;
      resultsPath?: string;
    }
  ): Promise<AgentOrchestrator> {
    logger.debug(`[OrchestratorManager] Spawning new agent...`);
    const id = randomUUID();
    const memoryPath = join(this.memoryBasePath, `${id}.md`);
    const resultsPath = options?.resultsPath || join(this.memoryBasePath, '..', 'results', `${id}-results.md`);
    
    logger.info(`[OrchestratorManager] Spawning agent ${id.substring(0, 8)}...`);
    logger.debug(`[OrchestratorManager] Agent ID: ${id}`);
    logger.debug(`[OrchestratorManager] Memory path: ${memoryPath}`);
    logger.debug(`[OrchestratorManager] Results path: ${resultsPath}`);
    logger.debug(`[OrchestratorManager] Instructions length: ${instructions.length} chars`);
    if (options?.researchQuery) {
      logger.debug(`[OrchestratorManager] Research query: ${options.researchQuery}`);
    }

    // Ensure memory directory exists
    if (!existsSync(this.memoryBasePath)) {
      logger.debug(`[OrchestratorManager] Creating memory directory: ${this.memoryBasePath}`);
      await mkdir(this.memoryBasePath, { recursive: true });
    }

    // Ensure results directory exists
    const resultsDir = join(resultsPath, '..');
    if (!existsSync(resultsDir)) {
      logger.debug(`[OrchestratorManager] Creating results directory: ${resultsDir}`);
      await mkdir(resultsDir, { recursive: true });
    }

    // Create initial memory file if template provided
    if (options?.memoryTemplate && !existsSync(memoryPath)) {
      logger.debug(`[OrchestratorManager] Writing memory template (${options.memoryTemplate.length} chars)`);
      await writeFile(memoryPath, options.memoryTemplate, 'utf-8');
    }

    logger.debug(`[OrchestratorManager] Creating AgentOrchestrator instance...`);
    const agent = new AgentOrchestrator(
      id,
      instructions,
      memoryPath,
      options?.researchQuery,
      resultsPath
    );
    this.agents.set(id, agent);
    logger.debug(`[OrchestratorManager] Agent added to map, total agents: ${this.agents.size}`);
    
    logger.debug(`[OrchestratorManager] Starting agent...`);
    await agent.start();
    logger.debug(`[OrchestratorManager] Agent started successfully`);

    return agent;
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): AgentOrchestrator | undefined {
    return this.agents.get(id);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentOrchestrator[] {
    return Array.from(this.agents.values());
  }

  /**
   * Remove agent
   */
  async removeAgent(id: string): Promise<boolean> {
    const agent = this.agents.get(id);
    if (!agent) {
      return false;
    }

    await agent.stop();
    this.agents.delete(id);
    return true;
  }
}

