# Claude Agent SDK TypeScript Project

A minimal, well-structured TypeScript project for building agents with the Claude Agent SDK.

## Prerequisites

- Node.js 18+ 
- npm or yarn

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` and add your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=your_actual_api_key_here
   PORT=3000  # Optional: default is 3000
   DEBUG=false  # Optional: set to 'true' or '1' to enable verbose debug logging
   ```
   
   Get your API key from [Anthropic Console](https://console.anthropic.com/).

## Usage

### API Server Mode (Default)

Start the API server:
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable).

**Note:** By default, the CLI output shows only important information (info, warnings, errors). To enable verbose debug logging, set `DEBUG=true` in your `.env` file or run with `DEBUG=1 npm run dev`.

### CLI Mode

Run the agent directly from the command line:
```bash
npm run dev:cli
```

### Build

Compile TypeScript to JavaScript:
```bash
npm run build
```

### Production

Run the compiled API server:
```bash
npm start
```

Or run the CLI:
```bash
npm run start:cli
```

## API Endpoints

### Health Check
```bash
GET /api/health
```

Returns server health status:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.45,
  "environment": "development",
  "apiKeyConfigured": true
}
```

### Start Agent Process
```bash
POST /api/query
Content-Type: application/json

{
  "prompt": "Your prompt here",
  "options": {
    "model": "claude-sonnet-4-5-20250929",
    "maxTurns": 10
  }
}
```

Returns:
```json
{
  "success": true,
  "processId": "uuid-here",
  "message": "Process started successfully",
  "statusUrl": "/api/status/uuid-here"
}
```

### Get Process Status
```bash
GET /api/status/:id
```

Returns:
```json
{
  "id": "uuid-here",
  "status": "running",
  "prompt": "Your prompt",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "completedAt": null,
  "result": null,
  "error": null,
  "cost": null,
  "usage": null
}
```

Status values: `pending`, `running`, `completed`, `error`, `cancelled`

### Cancel Process
```bash
POST /api/status/:id/cancel
```

### List All Processes
```bash
GET /api/processes
```

## Orchestrator API (Research Agents)

The orchestrator manages autonomous research agents that conduct web research on Magic: The Gathering topics.

### Start Research Agent
```bash
POST /api/orchestrator/start
Content-Type: application/json

{
  "instructions": "You are a research agent specializing in Magic: The Gathering news and trends.",
  "researchQuery": "What are the latest meta changes in Modern format?",
  "resultsPath": "./results/research-results.md"  // Optional
}
```

Returns:
```json
{
  "success": true,
  "agent": {
    "id": "uuid-here",
    "status": "running",
    "cycleCount": 0,
    "researchQuery": "What are the latest meta changes in Modern format?",
    "resultsPath": "./results/uuid-here-results.md",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Research agent spawned successfully"
}
```

### Get Agent Status
```bash
GET /api/orchestrator/:id
```

### Pause Agent
```bash
POST /api/orchestrator/:id/pause
```

### Resume Agent
```bash
POST /api/orchestrator/:id/resume
```

### Stop Agent
```bash
POST /api/orchestrator/:id/stop
```

### List All Agents
```bash
GET /api/orchestrator
```

### Example Usage

```bash
# Start a research agent
curl -X POST http://localhost:3000/api/orchestrator/start \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": "You are a research agent specializing in Magic: The Gathering news and trends.",
    "researchQuery": "What are the latest meta changes in Modern format?"
  }'

# Check agent status (replace AGENT_ID with the returned agent id)
curl http://localhost:3000/api/orchestrator/AGENT_ID

# List all agents
curl http://localhost:3000/api/orchestrator

# Check health
curl http://localhost:3000/api/health
```

## Research Agent Features

- **Web Research**: Agents use web search to find the latest Magic: The Gathering information
- **Persistent Memory**: Each agent maintains a memory file tracking research progress
- **Results Saving**: Agents save comprehensive findings to a results.md file when research is complete
- **Autonomous Operation**: Agents run in continuous cycles, conducting research autonomously
- **Future Sub-Agent Support**: Architecture prepared for coordinating multiple sub-agents for parallel research

## Project Structure

```
claude-sdk/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── server.ts              # API server entry point
│   ├── processManager.ts      # Process tracking and management
│   ├── orchestrator/
│   │   ├── agent.ts           # Research agent orchestrator
│   │   ├── manager.ts          # Agent manager
│   │   ├── prompts.ts          # System prompts for research agents
│   │   ├── tools.ts            # MCP tools (sleep, saveResults)
│   │   ├── memory.ts           # Memory file management
│   │   └── types.ts            # Type definitions
│   └── routes/
│       ├── orchestrator.ts     # Orchestrator API routes
│       └── ...
├── memory/                    # Agent memory files
├── results/                   # Research results files
├── package.json               # ES module config + dependencies
├── tsconfig.json              # TypeScript configuration
├── .env.example               # Environment variable template
├── .gitignore                 # Git ignore patterns
└── README.md                  # This file
```

## Best Practices Applied

- **ES Modules**: Uses `"type": "module"` for modern JavaScript compatibility
- **Environment Isolation**: Explicit `settingSources: ['project']` prevents context pollution
- **Streaming Mode**: Real-time interaction with async iteration
- **Type Safety**: TypeScript strict mode enabled
- **Security**: Environment variables for sensitive data, `.env` excluded from git

## Customization

Edit `src/index.ts` to:
- Change the agent prompt
- Add custom tools or skills
- Configure additional agent options
- Implement your specific use case

## Resources

- [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk/overview)
- [Anthropic Console](https://console.anthropic.com/)

