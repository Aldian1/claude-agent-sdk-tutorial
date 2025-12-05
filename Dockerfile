# Use Node.js 20 (Debian-based for glibc support, required by onnxruntime-node)
FROM node:20-slim AS base

# Install system dependencies required by onnxruntime-node
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install build dependencies if needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev && \
    npm cache clean --force

# Build stage
FROM base AS builder
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage - use minimal runtime image
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json* ./

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy public directory for static files (frontend dashboard)
COPY --from=builder /app/public ./public

# Copy any other necessary files (e.g., supabase config if needed)
COPY supabase ./supabase

# Expose port (default 3000, can be overridden)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["npm", "start"]

