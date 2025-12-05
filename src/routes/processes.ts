import { Router, type Request, type Response } from 'express';
import { processManager, type ProcessInfo } from '../processManager.js';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Start a new agent process
 * POST /api/query
 * Body: { prompt: string, options?: Options }
 */
router.post('/query', async (req: Request, res: Response) => {
  try {
    const { prompt, options } = req.body as { prompt: string; options?: Options };

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Prompt is required and must be a string',
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'Configuration error',
        message: 'ANTHROPIC_API_KEY environment variable is not set',
      });
    }

    const processId = await processManager.startProcess(prompt, options);

    res.status(202).json({
      success: true,
      processId,
      message: 'Process started successfully',
      statusUrl: `/api/status/${processId}`,
    });
  } catch (error) {
    logger.error('Error starting process:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get process status
 * GET /api/status/:id
 */
router.get('/status/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const process = processManager.getProcess(id);

  if (!process) {
    return res.status(404).json({
      error: 'Not found',
      message: `Process with ID ${id} not found`,
    });
  }

  // Return process info (excluding the query object)
  const response: Omit<ProcessInfo, 'query'> = {
    id: process.id,
    status: process.status,
    prompt: process.prompt,
    createdAt: process.createdAt,
    completedAt: process.completedAt,
    result: process.result,
    error: process.error,
    cost: process.cost,
    usage: process.usage,
  };

  res.json(response);
});

/**
 * Cancel a running process
 * POST /api/status/:id/cancel
 */
router.post('/status/:id/cancel', async (req: Request, res: Response) => {
  const { id } = req.params;
  const process = processManager.getProcess(id);

  if (!process) {
    return res.status(404).json({
      error: 'Not found',
      message: `Process with ID ${id} not found`,
    });
  }

  if (process.status !== 'running' && process.status !== 'pending') {
    return res.status(400).json({
      error: 'Invalid operation',
      message: `Cannot cancel process with status: ${process.status}`,
    });
  }

  const cancelled = await processManager.cancelProcess(id);

  if (cancelled) {
    res.json({
      success: true,
      message: 'Process cancelled successfully',
    });
  } else {
    res.status(500).json({
      error: 'Failed to cancel process',
      message: 'Unable to cancel the process',
    });
  }
});

/**
 * Get all processes (for debugging/admin)
 * GET /api/processes
 */
router.get('/processes', (req: Request, res: Response) => {
  const processes = processManager.getAllProcesses().map((process) => ({
    id: process.id,
    status: process.status,
    prompt: process.prompt.substring(0, 100) + (process.prompt.length > 100 ? '...' : ''),
    createdAt: process.createdAt,
    completedAt: process.completedAt,
    cost: process.cost,
  }));

  res.json({
    processes,
    count: processes.length,
  });
});

export default router;

