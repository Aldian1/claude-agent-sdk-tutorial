import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Read memory from file
 */
export async function readMemory(memoryPath: string, agentId: string, instructions: string, createdAt: Date): Promise<string> {
  try {
    if (existsSync(memoryPath)) {
      return await readFile(memoryPath, 'utf-8');
    }
    // Return default memory template
    return `# Research Agent Memory - ${agentId}
Created: ${createdAt.toISOString()}
Instructions: ${instructions}

## Research Query
(Research query will be specified when agent is created)

## Cycle History
- [${createdAt.toISOString()}] Cycle 0: Initial creation

## Research Progress
### Topics Explored
(Research topics will be tracked here)

### Sources Found
(Sources and URLs will be tracked here)

### Key Findings
(Key findings and insights will be tracked here)

## Current State
Awaiting first research cycle

## Notes
(Agent's persistent notes and research observations will appear here)
`;
  } catch (error) {
    console.error(`[Agent ${agentId}] Error reading memory:`, error);
    return '';
  }
}

/**
 * Write memory to file
 */
export async function writeMemory(memoryPath: string, content: string, agentId: string): Promise<void> {
  try {
    await writeFile(memoryPath, content, 'utf-8');
  } catch (error) {
    console.error(`[Agent ${agentId}] Error writing memory:`, error);
  }
}

