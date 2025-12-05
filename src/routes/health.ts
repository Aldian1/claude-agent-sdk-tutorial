import { Router, type Request, type Response } from 'express';

const router = Router();

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/health', (_req: Request, res: Response) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
  };

  res.json(health);
});

/**
 * API info endpoint
 * GET /api
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Claude Agent SDK API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      startQuery: 'POST /api/query',
      getStatus: 'GET /api/status/:id',
      cancelProcess: 'POST /api/status/:id/cancel',
      listProcesses: 'GET /api/processes',
      spawnAgent: 'POST /api/orchestrator/start',
      getAgent: 'GET /api/orchestrator/:id',
      getAgentStats: 'GET /api/orchestrator/:id/stats',
      pauseAgent: 'POST /api/orchestrator/:id/pause',
      resumeAgent: 'POST /api/orchestrator/:id/resume',
      stopAgent: 'POST /api/orchestrator/:id/stop',
      listAgents: 'GET /api/orchestrator',
    },
  });
});

export default router;

