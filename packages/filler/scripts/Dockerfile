# Ultra simple Dockerfile that just sleeps
FROM alpine:latest

# Create non-root user
RUN addgroup -g 1001 -S filler && \
    adduser -S filler -u 1001

# Set working directory
WORKDIR /app

# Create a simple mock script
RUN mkdir -p /app/config && \
    echo '#!/bin/sh' > /app/run.sh && \
    echo 'echo "🚀 Hyperbridge Filler Mock Starting"' >> /app/run.sh && \
    echo 'echo "Config file: $1"' >> /app/run.sh && \
    echo 'echo "✅ Filler ready"' >> /app/run.sh && \
    echo 'while true; do' >> /app/run.sh && \
    echo '  echo "💤 Waiting for orders..."' >> /app/run.sh && \
    echo '  sleep 10' >> /app/run.sh && \
    echo 'done' >> /app/run.sh && \
    chmod +x /app/run.sh

# Configure permissions
RUN chown -R filler:filler /app

# Switch to non-root user
USER filler

# Default command - extremely simple script that just sleeps
CMD ["/app/run.sh", "/app/config/config.toml"]
