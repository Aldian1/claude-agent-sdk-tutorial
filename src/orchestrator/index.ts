export { AgentOrchestrator } from './agent.js';
export { OrchestratorManager } from './manager.js';
export { SubAgentRunner } from './subAgent.js';
export type { AgentStatus, AgentInfo, SubAgentStatus, SubAgentInfo } from './types.js';

// Singleton instance
import { OrchestratorManager } from './manager.js';
export const orchestratorManager = new OrchestratorManager();

