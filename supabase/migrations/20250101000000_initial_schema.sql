-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Processes table (for processManager)
CREATE TABLE IF NOT EXISTS processes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error', 'cancelled')),
  prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  result TEXT,
  error TEXT,
  cost DECIMAL(10, 6),
  usage_input_tokens INTEGER,
  usage_output_tokens INTEGER,
  created_by TEXT
);

-- Agents table (for orchestrator)
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'sleeping', 'stopped')),
  cycle_count INTEGER NOT NULL DEFAULT 0,
  instructions TEXT NOT NULL,
  research_query TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_cycle_at TIMESTAMPTZ,
  sleep_until TIMESTAMPTZ,
  created_by TEXT
);

-- Agent memory table (stores agent memory content)
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id)
);

-- Results table (stores research results)
CREATE TABLE IF NOT EXISTS results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  process_id UUID REFERENCES processes(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sub-agents table
CREATE TABLE IF NOT EXISTS sub_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'researching', 'completed', 'failed')),
  task TEXT NOT NULL,
  report_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_processes_status ON processes(status);
CREATE INDEX IF NOT EXISTS idx_processes_created_at ON processes(created_at);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_results_agent_id ON results(agent_id);
CREATE INDEX IF NOT EXISTS idx_results_process_id ON results(process_id);
CREATE INDEX IF NOT EXISTS idx_sub_agents_parent_id ON sub_agents(parent_id);
CREATE INDEX IF NOT EXISTS idx_sub_agents_status ON sub_agents(status);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER update_agent_memory_updated_at
  BEFORE UPDATE ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_results_updated_at
  BEFORE UPDATE ON results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Long-term memories table (for RAG/semantic search)
CREATE TABLE IF NOT EXISTS long_term_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'research',
  embedding vector(384),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_long_term_memories_embedding ON long_term_memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_long_term_memories_agent_id ON long_term_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_long_term_memories_category ON long_term_memories(category);

-- Add updated_at trigger for long_term_memories
CREATE TRIGGER update_long_term_memories_updated_at
  BEFORE UPDATE ON long_term_memories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function for semantic search of long-term memories
CREATE OR REPLACE FUNCTION match_long_term_memories(
  query_embedding vector(384),
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 5,
  filter_agent_id text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text,
  content text,
  category text,
  similarity double precision,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ltm.id,
    ltm.title,
    ltm.content,
    ltm.category,
    1 - (ltm.embedding <=> query_embedding) as similarity,
    ltm.created_at
  FROM long_term_memories ltm
  WHERE 
    ltm.embedding IS NOT NULL
    AND 1 - (ltm.embedding <=> query_embedding) > match_threshold
    AND (filter_agent_id IS NULL OR ltm.agent_id = filter_agent_id)
  ORDER BY (ltm.embedding <=> query_embedding) ASC
  LIMIT LEAST(match_count, 20);
$$;

