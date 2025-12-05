import { randomUUID } from 'crypto';
import { traceDb, spanDb, type TraceRow, type SpanRow } from './database.js';
import { logger } from './logger.js';

/**
 * Current trace and span context
 */
export interface TraceContext {
  traceId: string;
  currentSpanId?: string;
}

/**
 * Active trace context (thread-local via AsyncLocalStorage would be ideal, but for simplicity we'll use a context object)
 */
let currentContext: TraceContext | null = null;

/**
 * Set the current trace context
 */
export function setTraceContext(context: TraceContext | null): void {
  currentContext = context;
}

/**
 * Get the current trace context
 */
export function getTraceContext(): TraceContext | null {
  return currentContext;
}

/**
 * Create a new trace
 */
export async function createTrace(
  agentId: string,
  name: string,
  metadata?: Record<string, any>
): Promise<string> {
  const traceId = randomUUID();
  
  const trace = await traceDb.create({
    agent_id: agentId,
    name,
    status: 'running',
    metadata: metadata || {},
  });

  if (!trace) {
    logger.error('Failed to create trace');
    throw new Error('Failed to create trace');
  }

  // Set as current context
  setTraceContext({
    traceId: trace.id,
  });

  logger.debug(`[Tracing] Created trace ${trace.id} for agent ${agentId}: ${name}`);
  return trace.id;
}

/**
 * End a trace
 */
export async function endTrace(
  traceId: string,
  status: 'completed' | 'error' = 'completed',
  error?: string
): Promise<void> {
  const endTime = new Date().toISOString();
  
  await traceDb.update(traceId, {
    status,
    end_time: endTime,
    error: error || null,
  });

  logger.debug(`[Tracing] Ended trace ${traceId} with status ${status}`);
  
  // Clear context if this was the current trace
  if (currentContext?.traceId === traceId) {
    setTraceContext(null);
  }
}

/**
 * Start a new span
 */
export async function startSpan(
  name: string,
  spanType: 'cycle' | 'llm' | 'tool' | 'sub_agent' | 'custom',
  options?: {
    traceId?: string;
    parentSpanId?: string;
    input?: Record<string, any>;
    metadata?: Record<string, any>;
  }
): Promise<string> {
  const context = getTraceContext();
  const traceId = options?.traceId || context?.traceId;
  
  if (!traceId) {
    logger.warn('[Tracing] No trace context available, skipping span creation');
    return '';
  }

  const parentSpanId = options?.parentSpanId || context?.currentSpanId;
  const spanId = randomUUID();

  const span = await spanDb.create({
    trace_id: traceId,
    parent_span_id: parentSpanId || null,
    name,
    span_type: spanType,
    status: 'running',
    input: options?.input || null,
    metadata: options?.metadata || {},
  });

  if (!span) {
    logger.error('Failed to create span');
    return '';
  }

  // Update context with new current span
  if (context && context.traceId === traceId) {
    setTraceContext({
      traceId: context.traceId,
      currentSpanId: span.id,
    });
  }

  logger.debug(`[Tracing] Started span ${span.id}: ${name} (type: ${spanType})`);
  return span.id;
}

/**
 * End a span
 */
export async function endSpan(
  spanId: string,
  status: 'completed' | 'error' = 'completed',
  options?: {
    output?: Record<string, any>;
    error?: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  if (!spanId) {
    return;
  }

  const span = await spanDb.getById(spanId);
  if (!span) {
    logger.warn(`[Tracing] Span ${spanId} not found`);
    return;
  }

  const endTime = new Date().toISOString();
  const startTime = new Date(span.start_time);
  const durationMs = Math.round((new Date(endTime).getTime() - startTime.getTime()));

  const updates: Partial<SpanRow> = {
    status,
    end_time: endTime,
    duration_ms: durationMs,
    output: options?.output || null,
    error: options?.error || null,
  };

  // Merge metadata if provided
  if (options?.metadata) {
    updates.metadata = {
      ...(span.metadata || {}),
      ...options.metadata,
    };
  }

  await spanDb.update(spanId, updates);

  logger.debug(`[Tracing] Ended span ${spanId} with status ${status} (duration: ${durationMs}ms)`);

  // Update context - if this was the current span, move back to parent
  const context = getTraceContext();
  if (context?.currentSpanId === spanId) {
    // Find parent span to restore context
    if (span.parent_span_id) {
      setTraceContext({
        traceId: context.traceId,
        currentSpanId: span.parent_span_id,
      });
    } else {
      setTraceContext({
        traceId: context.traceId,
      });
    }
  }
}

/**
 * Helper to run a function within a span
 */
export async function withSpan<T>(
  name: string,
  spanType: 'cycle' | 'llm' | 'tool' | 'sub_agent' | 'custom',
  fn: (spanId: string) => Promise<T>,
  options?: {
    traceId?: string;
    parentSpanId?: string;
    input?: Record<string, any>;
    metadata?: Record<string, any>;
  }
): Promise<T> {
  const spanId = await startSpan(name, spanType, options);
  
  try {
    const result = await fn(spanId);
    
    // Try to extract output from result if it's an object
    const output = typeof result === 'object' && result !== null
      ? { result }
      : { value: result };
    
    await endSpan(spanId, 'completed', { output });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await endSpan(spanId, 'error', {
      error: errorMessage,
      output: error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) },
    });
    throw error;
  }
}

/**
 * Helper to run a function within a trace
 */
export async function withTrace<T>(
  agentId: string,
  traceName: string,
  fn: (traceId: string) => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const traceId = await createTrace(agentId, traceName, metadata);
  
  try {
    const result = await fn(traceId);
    await endTrace(traceId, 'completed');
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await endTrace(traceId, 'error', errorMessage);
    throw error;
  }
}

