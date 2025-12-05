import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { processesRouter, orchestratorRouter, healthRouter, tracesRouter } from './routes/index.js';
import { errorHandler } from './middleware/index.js';
import { logger } from './utils/logger.js';

// Load environment variables from .env file
config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes (before static files to avoid conflicts)
app.use('/api', processesRouter);
app.use('/api/orchestrator', orchestratorRouter);
app.use('/api/traces', tracesRouter);
app.use('/api', healthRouter);

// Serve static files from public directory
app.use(express.static(join(process.cwd(), 'public')));

// Serve index.html for root path
app.get('/', (_req, res) => {
  res.sendFile(join(process.cwd(), 'public', 'index.html'));
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Claude Agent SDK API server running on port ${PORT}`);
  logger.info(`🌐 Frontend Dashboard: http://localhost:${PORT}/`);
  logger.info(`📡 Health check: http://localhost:${PORT}/api/health`);
  logger.info(`📚 API docs: http://localhost:${PORT}/api`);
  
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn('⚠️  Warning: ANTHROPIC_API_KEY environment variable is not set');
  }
});
