import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';
import type { SubAgentInfo } from './types.js';

/**
 * Sub-agent management callbacks
 */
export interface SubAgentCallbacks {
  spawnSubAgent: (task: string) => Promise<SubAgentInfo>;
  listSubAgents: () => SubAgentInfo[];
  readSubAgentReport: (subAgentId: string) => Promise<string>;
}

/**
 * Long-term memory management callbacks
 */
export interface LongTermMemoryCallbacks {
  saveLongTermMemory: (title: string, content: string, category?: string) => Promise<string>;
  searchLongTermMemory: (query: string, limit?: number) => Promise<Array<{ title: string; content: string; similarity: number }>>;
}

/**
 * Create MCP server with sleep, saveResults, and sub-agent management tools
 * @param onSleep Callback when sleep tool is called
 * @param resultsPath Path to the results.md file
 * @param subAgentCallbacks Callbacks for sub-agent management
 * @param longTermMemoryCallbacks Callbacks for long-term memory management
 */
export function createOrchestratorMcpServer(
  onSleep: (durationSeconds: number) => void,
  resultsPath?: string,
  subAgentCallbacks?: SubAgentCallbacks,
  longTermMemoryCallbacks?: LongTermMemoryCallbacks
) {
  const sleepTool = tool(
    'sleep',
    'Take a break and pause execution. Call this when you have completed your current tasks or want to pause. The orchestrator will automatically resume after the specified duration.',
    {
      duration_seconds: z.number().min(1).max(3600).describe('How long to sleep in seconds (1-3600)'),
    },
    async ({ duration_seconds }) => {
      logger.debug(`[Sleep Tool] Called with duration: ${duration_seconds}s`);
      // Signal to orchestrator to sleep
      onSleep(duration_seconds);
      logger.debug(`[Sleep Tool] Callback executed`);
      return {
        content: [
          {
            type: 'text',
            text: `Sleeping for ${duration_seconds} seconds. The orchestrator will automatically resume after this duration.`,
          },
        ],
      };
    }
  );

  const saveResultsTool = resultsPath
    ? tool(
        'saveResults',
        'Save your comprehensive research findings to the results file. Use this when you have gathered enough information to provide a complete answer to the research query. The results should be well-structured markdown with sections for summary, key findings, sources, analysis, and conclusion.',
        {
          content: z.string().describe('The markdown content to save to the results file. Should include executive summary, key findings, sources, analysis, and conclusion.'),
        },
        async ({ content }) => {
          logger.info(`[SaveResults Tool] Saving results to: ${resultsPath}`);
          logger.debug(`[SaveResults Tool] Saving results to: ${resultsPath}`);
          try {
            // Ensure directory exists
            const dir = dirname(resultsPath);
            if (!existsSync(dir)) {
              await mkdir(dir, { recursive: true });
            }

            // Add header with timestamp
            const timestamp = new Date().toISOString();
            const resultsContent = `# Research Results
Generated: ${timestamp}

${content}
`;

            await writeFile(resultsPath, resultsContent, 'utf-8');
            logger.debug(`[SaveResults Tool] Results saved successfully`);
            return {
              content: [
                {
                  type: 'text',
                  text: `Research results have been saved to ${resultsPath}. The file contains your comprehensive findings and analysis.`,
                },
              ],
            };
          } catch (error) {
            logger.error(`[SaveResults Tool] Error saving results:`, error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error saving results: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      )
    : null;

  // Sub-agent management tools
  const spawnSubAgentTool = subAgentCallbacks
    ? tool(
        'spawnSubAgent',
        'Spawn a new sub-agent to research a specific task. The sub-agent will conduct focused research and write findings to a report file that you can read later. Use this to delegate research tasks to parallel workers.',
        {
          task: z.string().describe('The specific research task for the sub-agent. Should be focused and clearly defined.'),
        },
        async ({ task }) => {
          logger.info(`[SpawnSubAgent Tool] Spawning sub-agent for task: ${task}`);
          try {
            const subAgentInfo = await subAgentCallbacks.spawnSubAgent(task);
            logger.debug(`[SpawnSubAgent Tool] Sub-agent spawned: ${subAgentInfo.id}`);
            return {
              content: [
                {
                  type: 'text',
                  text: `Sub-agent spawned successfully.
ID: ${subAgentInfo.id}
Task: ${subAgentInfo.task}
Report Path: ${subAgentInfo.reportPath}
Status: ${subAgentInfo.status}

The sub-agent is now conducting research. Use 'listSubAgents' to check status and 'readSubAgentReport' to read the report when complete.`,
                },
              ],
            };
          } catch (error) {
            logger.error(`[SpawnSubAgent Tool] Error spawning sub-agent:`, error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error spawning sub-agent: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      )
    : null;

  const listSubAgentsTool = subAgentCallbacks
    ? tool(
        'listSubAgents',
        'List all spawned sub-agents and their current status. Use this to monitor the progress of your research delegation.',
        {},
        async () => {
          logger.debug(`[ListSubAgents Tool] Listing sub-agents`);
          try {
            const subAgents = subAgentCallbacks.listSubAgents();
            const statusSummary = subAgents.reduce((acc, agent) => {
              acc[agent.status] = (acc[agent.status] || 0) + 1;
              return acc;
            }, {} as Record<string, number>);

            const agentList = subAgents.map(agent => 
              `- ${agent.id.substring(0, 8)}... | ${agent.status} | Task: ${agent.task.substring(0, 50)}${agent.task.length > 50 ? '...' : ''}`
            ).join('\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `Sub-Agents Status:
Total: ${subAgents.length}
Status Summary: ${JSON.stringify(statusSummary, null, 2)}

Sub-Agents:
${agentList || 'No sub-agents spawned yet'}

Use 'readSubAgentReport' with a sub-agent ID to read completed reports.`,
                },
              ],
            };
          } catch (error) {
            logger.error(`[ListSubAgents Tool] Error listing sub-agents:`, error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error listing sub-agents: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      )
    : null;

  const readSubAgentReportTool = subAgentCallbacks
    ? tool(
        'readSubAgentReport',
        'Read the research report from a completed sub-agent. Use this to gather findings from your sub-agents and synthesize them into your final results.',
        {
          sub_agent_id: z.string().describe('The ID of the sub-agent whose report you want to read. Use listSubAgents to see available sub-agents.'),
        },
        async ({ sub_agent_id }) => {
          logger.info(`[ReadSubAgentReport Tool] Reading report for sub-agent: ${sub_agent_id}`);
          try {
            const report = await subAgentCallbacks.readSubAgentReport(sub_agent_id);
            logger.debug(`[ReadSubAgentReport Tool] Report read successfully (${report.length} chars)`);
            return {
              content: [
                {
                  type: 'text',
                  text: `Report from sub-agent ${sub_agent_id}:\n\n${report}`,
                },
              ],
            };
          } catch (error) {
            logger.error(`[ReadSubAgentReport Tool] Error reading report:`, error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error reading sub-agent report: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      )
    : null;

  // Long-term memory tools
  const saveLongTermMemoryTool = longTermMemoryCallbacks
    ? tool(
        'saveLongTermMemory',
        'Save completed research findings to long-term memory storage. Use this AFTER completing substantial research (like synthesizing sub-agent reports) to store knowledge for future reference. This creates an embedding and stores it in the database for semantic search. Do NOT use this for day-to-day memory - that is handled by the local .md file.',
        {
          title: z.string().describe('A descriptive title for this memory (e.g., "Research on Modern Meta Decks")'),
          content: z.string().describe('The complete research findings/content to store. Should be comprehensive and well-structured.'),
          category: z.string().optional().describe('Optional category for the memory (defaults to "research")'),
        },
        async ({ title, content, category }) => {
          logger.info(`[SaveLongTermMemory Tool] Saving memory: ${title}`);
          try {
            const memoryId = await longTermMemoryCallbacks.saveLongTermMemory(title, content, category);
            logger.debug(`[SaveLongTermMemory Tool] Memory saved with ID: ${memoryId}`);
            return {
              content: [
                {
                  type: 'text',
                  text: `Long-term memory saved successfully!
ID: ${memoryId}
Title: ${title}
Category: ${category || 'research'}

This memory has been stored with an embedding and can be retrieved using semantic search in the future.`,
                },
              ],
            };
          } catch (error) {
            logger.error(`[SaveLongTermMemory Tool] Error saving memory:`, error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error saving long-term memory: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      )
    : null;

  const searchLongTermMemoryTool = longTermMemoryCallbacks
    ? tool(
        'searchLongTermMemory',
        'Search long-term memory using semantic search (RAG) to check if similar research has been conducted before. Use this BEFORE starting new research to avoid duplicating work. Returns memories ranked by similarity to your query.',
        {
          query: z.string().describe('The search query describing what you want to find in long-term memory (e.g., "research on Modern format meta decks")'),
          limit: z.number().optional().describe('Maximum number of results to return (default: 5)'),
        },
        async ({ query, limit }) => {
          logger.info(`[SearchLongTermMemory Tool] Searching for: ${query}`);
          try {
            const results = await longTermMemoryCallbacks.searchLongTermMemory(query, limit);
            logger.debug(`[SearchLongTermMemory Tool] Found ${results.length} results`);
            
            if (results.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `No similar memories found for query: "${query}"

You can proceed with new research. Use 'saveLongTermMemory' after completing your research to store it for future reference.`,
                  },
                ],
              };
            }

            const resultsText = results
              .map((r, i) => {
                return `## Result ${i + 1} (Similarity: ${(r.similarity * 100).toFixed(1)}%)
**Title:** ${r.title}
**Content:**
${r.content.substring(0, 500)}${r.content.length > 500 ? '...' : ''}`;
              })
              .join('\n\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `Found ${results.length} similar memory(ies) for query: "${query}"

${resultsText}

These memories may contain relevant information from previous research. Review them before starting new research to avoid duplication.`,
                },
              ],
            };
          } catch (error) {
            logger.error(`[SearchLongTermMemory Tool] Error searching memory:`, error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Error searching long-term memory: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
      )
    : null;

  // Build tools array
  const tools: any[] = [sleepTool];
  if (saveResultsTool) tools.push(saveResultsTool);
  if (spawnSubAgentTool) tools.push(spawnSubAgentTool);
  if (listSubAgentsTool) tools.push(listSubAgentsTool);
  if (readSubAgentReportTool) tools.push(readSubAgentReportTool);
  if (saveLongTermMemoryTool) tools.push(saveLongTermMemoryTool);
  if (searchLongTermMemoryTool) tools.push(searchLongTermMemoryTool);

  return createSdkMcpServer({
    name: 'orchestrator-tools',
    tools,
  });
}

