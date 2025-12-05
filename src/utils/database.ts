import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

/**
 * Database client singleton
 */
let supabaseClient: SupabaseClient | null = null;

/**
 * Initialize and return Supabase client
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseKey) {
    logger.warn('Supabase key not found. Using default local development key.');
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0', {
    auth: {
      persistSession: false,
    },
  });

  return supabaseClient;
}

/**
 * Database types matching our schema
 */
export interface ProcessRow {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  prompt: string;
  created_at: string;
  completed_at?: string | null;
  result?: string | null;
  error?: string | null;
  cost?: number | null;
  usage_input_tokens?: number | null;
  usage_output_tokens?: number | null;
  created_by?: string | null;
}

export interface AgentRow {
  id: string;
  status: 'running' | 'paused' | 'sleeping' | 'stopped';
  cycle_count: number;
  instructions: string;
  research_query?: string | null;
  created_at: string;
  last_cycle_at?: string | null;
  sleep_until?: string | null;
  created_by?: string | null;
}

export interface AgentMemoryRow {
  id: string;
  agent_id: string;
  content: string;
  updated_at: string;
  created_at: string;
}

export interface ResultRow {
  id: string;
  agent_id?: string | null;
  process_id?: string | null;
  content: string;
  file_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubAgentRow {
  id: string;
  parent_id: string;
  status: 'pending' | 'researching' | 'completed' | 'failed';
  task: string;
  report_path?: string | null;
  created_at: string;
  completed_at?: string | null;
  error?: string | null;
}

export interface LongTermMemoryRow {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  category: string;
  embedding?: number[] | null;
  metadata?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface LongTermMemorySearchResult {
  id: string;
  title: string;
  content: string;
  category: string;
  similarity: number;
  created_at: string;
}

export interface TraceRow {
  id: string;
  agent_id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  start_time: string;
  end_time?: string | null;
  metadata?: Record<string, any> | null;
  error?: string | null;
}

export interface SpanRow {
  id: string;
  trace_id: string;
  parent_span_id?: string | null;
  name: string;
  span_type: string;
  status: 'running' | 'completed' | 'error';
  start_time: string;
  end_time?: string | null;
  duration_ms?: number | null;
  input?: Record<string, any> | null;
  output?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  error?: string | null;
}

/**
 * Database service for processes
 */
export const processDb = {
  async create(process: Omit<ProcessRow, 'id' | 'created_at'>): Promise<ProcessRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('processes')
      .insert(process)
      .select()
      .single();

    if (error) {
      logger.error('Error creating process:', error);
      return null;
    }

    return data;
  },

  async getById(id: string): Promise<ProcessRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('processes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Error fetching process:', error);
      return null;
    }

    return data;
  },

  async update(id: string, updates: Partial<ProcessRow>): Promise<ProcessRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('processes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating process:', error);
      return null;
    }

    return data;
  },

  async getAll(): Promise<ProcessRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('processes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching processes:', error);
      return [];
    }

    return data || [];
  },

  async delete(id: string): Promise<boolean> {
    const { error } = await getSupabaseClient()
      .from('processes')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Error deleting process:', error);
      return false;
    }

    return true;
  },
};

/**
 * Database service for agents
 */
export const agentDb = {
  async create(agent: Omit<AgentRow, 'id' | 'created_at'>): Promise<AgentRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('agents')
      .insert(agent)
      .select()
      .single();

    if (error) {
      logger.error('Error creating agent:', error);
      return null;
    }

    return data;
  },

  async getById(id: string): Promise<AgentRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Error fetching agent:', error);
      return null;
    }

    return data;
  },

  async update(id: string, updates: Partial<AgentRow>): Promise<AgentRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('agents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating agent:', error);
      return null;
    }

    return data;
  },

  async getAll(): Promise<AgentRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching agents:', error);
      return [];
    }

    return data || [];
  },

  async delete(id: string): Promise<boolean> {
    const { error } = await getSupabaseClient()
      .from('agents')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Error deleting agent:', error);
      return false;
    }

    return true;
  },
};

/**
 * Database service for agent memory
 */
export const agentMemoryDb = {
  async createOrUpdate(agentId: string, content: string): Promise<AgentMemoryRow | null> {
    // Try to update first
    const { data: existing } = await getSupabaseClient()
      .from('agent_memory')
      .select('id')
      .eq('agent_id', agentId)
      .single();

    if (existing) {
      const { data, error } = await getSupabaseClient()
        .from('agent_memory')
        .update({ content })
        .eq('agent_id', agentId)
        .select()
        .single();

      if (error) {
        logger.error('Error updating agent memory:', error);
        return null;
      }

      return data;
    } else {
      // Create new
      const { data, error } = await getSupabaseClient()
        .from('agent_memory')
        .insert({ agent_id: agentId, content })
        .select()
        .single();

      if (error) {
        logger.error('Error creating agent memory:', error);
        return null;
      }

      return data;
    }
  },

  async getByAgentId(agentId: string): Promise<AgentMemoryRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('agent_memory')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (error) {
      logger.error('Error fetching agent memory:', error);
      return null;
    }

    return data;
  },
};

/**
 * Database service for results
 */
export const resultDb = {
  async create(result: Omit<ResultRow, 'id' | 'created_at' | 'updated_at'>): Promise<ResultRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('results')
      .insert(result)
      .select()
      .single();

    if (error) {
      logger.error('Error creating result:', error);
      return null;
    }

    return data;
  },

  async getByAgentId(agentId: string): Promise<ResultRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('results')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching results:', error);
      return [];
    }

    return data || [];
  },

  async getByProcessId(processId: string): Promise<ResultRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('results')
      .select('*')
      .eq('process_id', processId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching results:', error);
      return [];
    }

    return data || [];
  },

  async update(id: string, updates: Partial<ResultRow>): Promise<ResultRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('results')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating result:', error);
      return null;
    }

    return data;
  },
};

/**
 * Database service for sub-agents
 */
export const subAgentDb = {
  async create(subAgent: Omit<SubAgentRow, 'id' | 'created_at'>): Promise<SubAgentRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('sub_agents')
      .insert(subAgent)
      .select()
      .single();

    if (error) {
      logger.error('Error creating sub-agent:', error);
      return null;
    }

    return data;
  },

  async getByParentId(parentId: string): Promise<SubAgentRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('sub_agents')
      .select('*')
      .eq('parent_id', parentId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching sub-agents:', error);
      return [];
    }

    return data || [];
  },

  async update(id: string, updates: Partial<SubAgentRow>): Promise<SubAgentRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('sub_agents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating sub-agent:', error);
      return null;
    }

    return data;
  },
};

/**
 * Database service for long-term memories with embeddings
 */
export const longTermMemoryDb = {
  /**
   * Create a new long-term memory with embedding
   */
  async create(
    memory: Omit<LongTermMemoryRow, 'id' | 'created_at' | 'updated_at'> & {
      embedding: number[];
    }
  ): Promise<LongTermMemoryRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('long_term_memories')
      .insert({
        agent_id: memory.agent_id,
        title: memory.title,
        content: memory.content,
        category: memory.category,
        embedding: memory.embedding, // Supabase JS client handles array to vector conversion
        metadata: memory.metadata || {},
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating long-term memory:', error);
      return null;
    }

    return data;
  },

  /**
   * Search for similar memories using RAG
   */
  async search(
    queryEmbedding: number[],
    options?: {
      agentId?: string;
      threshold?: number;
      limit?: number;
    }
  ): Promise<LongTermMemorySearchResult[]> {
    const { agentId, threshold = 0.7, limit = 5 } = options || {};

    const { data, error } = await getSupabaseClient().rpc('match_long_term_memories', {
      query_embedding: queryEmbedding, // Supabase JS client handles array to vector conversion
      match_threshold: threshold,
      match_count: limit,
      filter_agent_id: agentId || null,
    });

    if (error) {
      logger.error('Error searching long-term memories:', error);
      return [];
    }

    return (data || []) as LongTermMemorySearchResult[];
  },

  /**
   * Get all memories for a specific agent
   */
  async getByAgentId(agentId: string): Promise<LongTermMemoryRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('long_term_memories')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching long-term memories:', error);
      return [];
    }

    return (data || []) as LongTermMemoryRow[];
  },

  /**
   * Get a specific memory by ID
   */
  async getById(id: string): Promise<LongTermMemoryRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('long_term_memories')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Error fetching long-term memory:', error);
      return null;
    }

    return data as LongTermMemoryRow;
  },

  /**
   * Delete a memory by ID
   */
  async delete(id: string): Promise<boolean> {
    const { error } = await getSupabaseClient()
      .from('long_term_memories')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Error deleting long-term memory:', error);
      return false;
    }

    return true;
  },
};

/**
 * Database service for traces
 */
export const traceDb = {
  async create(trace: Omit<TraceRow, 'id'>): Promise<TraceRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('traces')
      .insert(trace)
      .select()
      .single();

    if (error) {
      logger.error('Error creating trace:', error);
      return null;
    }

    return data;
  },

  async getById(id: string): Promise<TraceRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('traces')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Error fetching trace:', error);
      return null;
    }

    return data;
  },

  async update(id: string, updates: Partial<TraceRow>): Promise<TraceRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('traces')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating trace:', error);
      return null;
    }

    return data;
  },

  async getByAgentId(agentId: string): Promise<TraceRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('traces')
      .select('*')
      .eq('agent_id', agentId)
      .order('start_time', { ascending: false });

    if (error) {
      logger.error('Error fetching traces:', error);
      return [];
    }

    return data || [];
  },

  async getAll(): Promise<TraceRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('traces')
      .select('*')
      .order('start_time', { ascending: false });

    if (error) {
      logger.error('Error fetching all traces:', error);
      return [];
    }

    return data || [];
  },
};

/**
 * Database service for spans
 */
export const spanDb = {
  async create(span: Omit<SpanRow, 'id'>): Promise<SpanRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('spans')
      .insert(span)
      .select()
      .single();

    if (error) {
      logger.error('Error creating span:', error);
      return null;
    }

    return data;
  },

  async getById(id: string): Promise<SpanRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('spans')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Error fetching span:', error);
      return null;
    }

    return data;
  },

  async update(id: string, updates: Partial<SpanRow>): Promise<SpanRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('spans')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Error updating span:', error);
      return null;
    }

    return data;
  },

  async getByTraceId(traceId: string): Promise<SpanRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('spans')
      .select('*')
      .eq('trace_id', traceId)
      .order('start_time', { ascending: true });

    if (error) {
      logger.error('Error fetching spans:', error);
      return [];
    }

    return data || [];
  },

  async getByParentSpanId(parentSpanId: string): Promise<SpanRow[]> {
    const { data, error } = await getSupabaseClient()
      .from('spans')
      .select('*')
      .eq('parent_span_id', parentSpanId)
      .order('start_time', { ascending: true });

    if (error) {
      logger.error('Error fetching child spans:', error);
      return [];
    }

    return data || [];
  },
};

