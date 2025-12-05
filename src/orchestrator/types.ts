/**
 * Agent status types
 */
export type AgentStatus = 'running' | 'paused' | 'sleeping' | 'stopped';

/**
 * Sub-agent status types
 */
export type SubAgentStatus = 'pending' | 'researching' | 'completed' | 'failed';

/**
 * Agent information interface
 */
export interface AgentInfo {
  id: string;
  status: AgentStatus;
  cycleCount: number;
  memoryPath: string;
  instructions: string;
  researchQuery?: string;
  resultsPath?: string;
  createdAt: Date;
  lastCycleAt?: Date;
  sleepUntil?: Date;
}

/**
 * Sub-agent information interface
 */
export interface SubAgentInfo {
  id: string;
  parentId: string;
  status: SubAgentStatus;
  task: string;
  reportPath: string;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

