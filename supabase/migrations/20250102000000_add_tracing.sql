-- Traces: Top-level trace records for agent execution
CREATE TABLE IF NOT EXISTS traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,                    -- e.g., "agent_run", "cycle"
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  error TEXT
);

-- Spans: Individual units of work within traces
CREATE TABLE IF NOT EXISTS spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  parent_span_id UUID REFERENCES spans(id),
  name TEXT NOT NULL,                    -- e.g., "llm_query", "tool_call", "sub_agent"
  span_type TEXT NOT NULL,               -- cycle, llm, tool, sub_agent, custom
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  duration_ms INTEGER,
  input JSONB,
  output JSONB,
  metadata JSONB DEFAULT '{}',
  error TEXT
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_traces_agent_id ON traces(agent_id);
CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
CREATE INDEX IF NOT EXISTS idx_traces_start_time ON traces(start_time);
CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id ON spans(parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_span_type ON spans(span_type);
CREATE INDEX IF NOT EXISTS idx_spans_status ON spans(status);
CREATE INDEX IF NOT EXISTS idx_spans_start_time ON spans(start_time);

