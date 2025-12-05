import { Router, type Request, type Response } from 'express';
import { orchestratorManager } from '../orchestrator/index.js';
import { logger } from '../utils/logger.js';
import { readMemory } from '../orchestrator/memory.js';
import { longTermMemoryDb } from '../utils/database.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const router = Router();

/**
 * Spawn a new research agent
 * POST /api/orchestrator/start
 * Body: { instructions: string, researchQuery?: string, memoryTemplate?: string, resultsPath?: string }
 */
router.post('/start', async (req: Request, res: Response) => {
  logger.debug(`[API] POST /api/orchestrator/start received`);
  try {
    const { instructions, researchQuery, memoryTemplate, resultsPath } = req.body as {
      instructions: string;
      researchQuery?: string;
      memoryTemplate?: string;
      resultsPath?: string;
    };

    logger.debug(`[API] Request body:`, {
      hasInstructions: !!instructions,
      instructionsLength: instructions?.length,
      hasResearchQuery: !!researchQuery,
      researchQueryLength: researchQuery?.length,
      hasMemoryTemplate: !!memoryTemplate,
      hasResultsPath: !!resultsPath,
    });

    if (!instructions || typeof instructions !== 'string') {
      logger.debug(`[API] Invalid request: instructions missing or not string`);
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Instructions are required and must be a string',
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn(`[API] ANTHROPIC_API_KEY not set`);
      return res.status(500).json({
        error: 'Configuration error',
        message: 'ANTHROPIC_API_KEY environment variable is not set',
      });
    }

    logger.info(`[API] Spawning new agent...`);
    logger.debug(`[API] Calling orchestratorManager.spawn()...`);
    const agent = await orchestratorManager.spawn(instructions, {
      researchQuery,
      memoryTemplate,
      resultsPath,
    });
    logger.debug(`[API] Agent spawned, returning response`);

    res.status(201).json({
      success: true,
      agent: agent.getInfo(),
      message: 'Research agent spawned successfully',
    });
  } catch (error) {
    logger.error('[API] Error spawning agent:', error);
    if (error instanceof Error) {
      logger.debug('[API] Error stack:', error.stack);
    }
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get agent status
 * GET /api/orchestrator/:id
 */
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = orchestratorManager.getAgent(id);

  if (!agent) {
    return res.status(404).json({
      error: 'Not found',
      message: `Agent with ID ${id} not found`,
    });
  }

  res.json(agent.getInfo());
});

/**
 * Pause a running agent
 * POST /api/orchestrator/:id/pause
 */
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agent = orchestratorManager.getAgent(id);

    if (!agent) {
      return res.status(404).json({
        error: 'Not found',
        message: `Agent with ID ${id} not found`,
      });
    }

    await agent.pause();

    res.json({
      success: true,
      message: 'Agent paused successfully',
      agent: agent.getInfo(),
    });
  } catch (error) {
    logger.error('Error pausing agent:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Resume a paused agent
 * POST /api/orchestrator/:id/resume
 */
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agent = orchestratorManager.getAgent(id);

    if (!agent) {
      return res.status(404).json({
        error: 'Not found',
        message: `Agent with ID ${id} not found`,
      });
    }

    await agent.resume();

    res.json({
      success: true,
      message: 'Agent resumed successfully',
      agent: agent.getInfo(),
    });
  } catch (error) {
    logger.error('Error resuming agent:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Stop and remove an agent
 * POST /api/orchestrator/:id/stop
 */
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const removed = await orchestratorManager.removeAgent(id);

    if (!removed) {
      return res.status(404).json({
        error: 'Not found',
        message: `Agent with ID ${id} not found`,
      });
    }

    res.json({
      success: true,
      message: 'Agent stopped and removed successfully',
    });
  } catch (error) {
    logger.error('Error stopping agent:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * List all active agents
 * GET /api/orchestrator
 */
router.get('/', (req: Request, res: Response) => {
  const agents = orchestratorManager.getAllAgents().map((agent) => agent.getInfo());

  res.json({
    agents,
    count: agents.length,
  });
});

/**
 * Get agent stats including memory and long-term memory
 * GET /api/orchestrator/:id/stats
 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agent = orchestratorManager.getAgent(id);

    if (!agent) {
      return res.status(404).json({
        error: 'Not found',
        message: `Agent with ID ${id} not found`,
      });
    }

    const agentInfo = agent.getInfo();
    
    // Read memory file content
    let memoryContent = '';
    let memorySize = 0;
    if (existsSync(agentInfo.memoryPath)) {
      try {
        memoryContent = await readFile(agentInfo.memoryPath, 'utf-8');
        memorySize = memoryContent.length;
      } catch (error) {
        logger.error(`Error reading memory file for agent ${id}:`, error);
      }
    }

    // Get long-term memory stats
    const longTermMemories = await longTermMemoryDb.getByAgentId(id);
    const longTermMemoryCount = longTermMemories.length;
    const longTermMemoryByCategory = longTermMemories.reduce((acc, mem) => {
      acc[mem.category] = (acc[mem.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      agent: agentInfo,
      memory: {
        size: memorySize,
        sizeFormatted: formatBytes(memorySize),
        preview: memoryContent.substring(0, 500) + (memoryContent.length > 500 ? '...' : ''),
        fullSize: memoryContent.length,
      },
      longTermMemory: {
        count: longTermMemoryCount,
        byCategory: longTermMemoryByCategory,
        recent: longTermMemories.slice(0, 10).map(mem => ({
          id: mem.id,
          title: mem.title,
          category: mem.category,
          createdAt: mem.created_at,
          contentPreview: mem.content.substring(0, 200) + (mem.content.length > 200 ? '...' : ''),
        })),
      },
    });
  } catch (error) {
    logger.error('Error fetching agent stats:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export default router;

