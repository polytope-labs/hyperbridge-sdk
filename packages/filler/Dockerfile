# Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./
COPY tsconfig.json ./
COPY tsup.config.ts ./

# Install pnpm
RUN npm install -g pnpm

# Copy source code
COPY src ./src

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the application
RUN pnpm build

# Runtime stage
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -g 1001 -S filler && \
    adduser -S filler -u 1001

# Set working directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder --chown=filler:filler /app/dist ./dist
COPY --from=builder --chown=filler:filler /app/node_modules ./node_modules
COPY --from=builder --chown=filler:filler /app/package.json ./package.json

# Create config directory
RUN mkdir -p /app/config && chown -R filler:filler /app/config

# Switch to non-root user
USER filler

# Use tini to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["node", "dist/bin/filler-cli.js", "run", "-c", "/app/config/filler-config.toml"]
