import { Router, type Request, type Response } from 'express';
import { traceDb, spanDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Get all traces
 * GET /api/traces
 * Query params: ?agentId=xxx (optional filter by agent)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.query;

    let traces;
    if (agentId && typeof agentId === 'string') {
      traces = await traceDb.getByAgentId(agentId);
    } else {
      traces = await traceDb.getAll();
    }

    res.json({
      success: true,
      traces: traces || [],
      count: traces?.length || 0,
    });
  } catch (error) {
    logger.error('Error fetching traces:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get a specific trace with all its spans
 * GET /api/traces/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trace = await traceDb.getById(id);
    if (!trace) {
      return res.status(404).json({
        error: 'Not found',
        message: `Trace with id ${id} not found`,
      });
    }

    const spans = await spanDb.getByTraceId(id);

    res.json({
      success: true,
      trace,
      spans,
      spanCount: spans.length,
    });
  } catch (error) {
    logger.error('Error fetching trace:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get spans for a trace
 * GET /api/traces/:id/spans
 */
router.get('/:id/spans', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const spans = await spanDb.getByTraceId(id);

    res.json({
      success: true,
      spans,
      count: spans.length,
    });
  } catch (error) {
    logger.error('Error fetching spans:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

