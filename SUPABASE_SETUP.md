# Supabase Local Database Setup Guide

This guide will help you set up and use Supabase locally for this project.

## Prerequisites

- Docker Desktop installed and running (required for local Supabase)
- Node.js 18+ installed

## Initial Setup

1. **Start Supabase locally:**
   ```bash
   npm run supabase:start
   ```

   This will:
   - Start all Supabase services (PostgreSQL, API, Auth, Storage, etc.)
   - Create the database schema from migrations
   - Display connection details

2. **Check Supabase status:**
   ```bash
   npm run supabase:status
   ```

   This will show you:
   - API URL (default: http://127.0.0.1:54321)
   - Anon Key (for client-side access)
   - Service Role Key (for server-side access)
   - Database URL (for direct PostgreSQL access)

3. **Configure environment variables:**
   
   Create a `.env` file in the project root (copy from `.env.example` if it exists):
   ```bash
   # Anthropic API Configuration
   ANTHROPIC_API_KEY=your_actual_api_key_here

   # Server Configuration
   PORT=3000
   DEBUG=false

   # Supabase Configuration (Local Development)
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
   ```

   **Note:** The keys above are the default local development keys. When you run `supabase start`, it will display the actual keys for your instance.

## Database Schema

The database includes the following tables:

- **processes**: Stores agent process information (status, prompts, results, costs)
- **agents**: Stores orchestrator agent information (status, cycle count, instructions)
- **agent_memory**: Stores agent memory content (linked to agents)
- **results**: Stores research results (linked to agents or processes)
- **sub_agents**: Stores sub-agent information (linked to parent agents)

## Available Scripts

- `npm run supabase:start` - Start Supabase services
- `npm run supabase:stop` - Stop Supabase services
- `npm run supabase:status` - Check status and get connection details
- `npm run supabase:reset` - Reset database (applies all migrations from scratch)
- `npm run supabase:migrate` - Create a new migration file
- `npm run supabase:studio` - Open Supabase Studio (web UI for database management)

## Using Supabase Studio

Supabase Studio provides a web interface to:
- View and edit database tables
- Run SQL queries
- Manage data
- View API documentation

To open Studio:
```bash
npm run supabase:studio
```

Studio will open at http://127.0.0.1:54323

## Using the Database in Code

The database service is available at `src/utils/database.ts`. Example usage:

```typescript
import { processDb, agentDb, agentMemoryDb } from './utils/database.js';

// Create a process
const process = await processDb.create({
  status: 'pending',
  prompt: 'Your prompt here',
});

// Create an agent
const agent = await agentDb.create({
  status: 'running',
  cycle_count: 0,
  instructions: 'Your instructions',
  research_query: 'Research query',
});

// Update agent memory
await agentMemoryDb.createOrUpdate(agent.id, 'Memory content here');

// Get agent memory
const memory = await agentMemoryDb.getByAgentId(agent.id);
```

## Migrations

Migrations are stored in `supabase/migrations/`. The initial schema migration is:
- `20250101000000_initial_schema.sql`

To create a new migration:
```bash
npm run supabase:migrate
```

This will create a new migration file with a timestamp.

## Troubleshooting

### Docker not running
If you see errors about Docker, make sure Docker Desktop is running.

### Port conflicts
If ports 54321-54329 are already in use, you can:
1. Stop the conflicting service
2. Or modify `supabase/config.toml` to use different ports

### Reset everything
If you need to start fresh:
```bash
npm run supabase:stop
npm run supabase:reset
```

### View logs
```bash
npx supabase logs
```

## Next Steps

1. Start Supabase: `npm run supabase:start`
2. Copy the connection details from the output
3. Update your `.env` file with the keys
4. Start using the database service in your code!

## Production Deployment

When deploying to production:
1. Create a Supabase project at https://supabase.com
2. Get your production URL and keys
3. Update your `.env` with production values
4. Push migrations: `npx supabase db push`

