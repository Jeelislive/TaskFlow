# Multi-stage Docker build for production-ready TaskFlow API
FROM node:18-alpine as base

# Install bun
RUN npm install -g bun

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Production stage
FROM node:18-alpine as production

# Install bun in production stage
RUN npm install -g bun

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

WORKDIR /app

# Copy built application with proper ownership
COPY --from=base --chown=nestjs:nodejs /app/dist ./dist
COPY --from=base --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=base --chown=nestjs:nodejs /app/package.json ./

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["bun", "run", "start:prod"]