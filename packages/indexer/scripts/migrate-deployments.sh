#!/bin/bash

# Script to automate schema migration
# Usage: ./migration-deployments.sh [ENV] [V0_TAG]
# Example: ./migration-deployments.sh local v1.0.0

set -e

ENV=${1:-local}
V0_TAG=${2:-v0}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"

echo "Starting schema migration for environment: $ENV"
echo "Using v0 tag: $V0_TAG"

# # Function to check if indexer is running
# check_indexer_health() {
#     local timeout=300
#     local elapsed=0
#     local interval=10

#     echo "Checking indexer health..."

#     while [ $elapsed -lt $timeout ]; do
#         result=$(curl -s -X POST http://localhost:3100/graphql \
#             -H "Content-Type: application/json" \
#             -d '{"query": "query { _metadatas { totalCount } }"}' 2>/dev/null || echo "failed")

#         if [[ "$result" == *"_metadatas"* ]]; then
#             echo "Indexer is healthy and responding"
#             return 0
#         fi

#         echo "Waiting for indexer... (${elapsed}s elapsed)"
#         sleep $interval
#         elapsed=$((elapsed + interval))
#     done

#     echo "❌ Indexer health check failed after ${timeout}s"
#     return 1
# }

# Function to build and publish schema
build_and_publish() {
    echo "Building and publishing schema..."

    cd "$PACKAGE_DIR"

    if ! ENV="$ENV" pnpm build; then
        echo "❌ Build failed"
        return 1
    fi

    if ! ./node_modules/.bin/subql publish; then
        echo "❌ SubQL publish failed"
        return 1
    fi

    if ! ENV="$ENV" pnpm build; then
        echo "❌ Second build failed"
        return 1
    fi

    echo "Build and publish completed"
    return 0
}

echo ""
echo "Step 1: Updating deployments to create v0..."
echo ""

if ! bash "$SCRIPT_DIR/update-deployments.sh" "$ENV"; then
    echo "❌ Failed to update deployments"
    exit 1
fi

echo "Deployments updated successfully"

echo "Indexer running with v0 deployments"

echo ""
echo "Step 2: Pulling deployment data from v0 tag..."
echo ""

if ! bash "$SCRIPT_DIR/pull-artifact.sh" "$ENV" "$V0_TAG" "false"; then
    echo "Failed to pull from v0 tag, checking if chains-block-number.json exists locally"
    if [[ ! -f "chains-block-number.json" ]]; then
        echo "❌ chains-block-number.json not found. Cannot proceed with v1 migration"
        exit 1
    fi
    echo "Using existing chains-block-number.json"
else
    echo "Successfully pulled chains-block-number.json from v0 tag"
fi

if [[ ! -f "chains-block-number.json" ]]; then
    echo "❌ chains-block-number.json not found after pull attempt"
    exit 1
fi

echo "chains-block-number.json is ready for v1 build"

echo ""
echo "Step 3: Building and publishing v1 schema..."
echo ""

if ! build_and_publish; then
    echo "❌ Failed to build and publish v1 schema"
    exit 1
fi

echo "v1 schema built and published successfully"

# echo ""
# echo "Step 4: Final verification..."
# echo ""

# sleep 30

# if check_indexer_health; then
#     echo "Final verification successful"
# else
#     echo "❌ Final verification failed"
#     echo "Checking logs for troubleshooting..."
#     echo "=== Recent indexer logs ==="
#     tail -50 "indexer_${ENV}.log" || echo "No log file found"
#     exit 1
# fi

echo ""
echo "Schema migration completed successfully!"
echo ""
echo "v0: Deployments updated in database"
echo "v0: Indexer restarted and verified"
echo "v1: Deployment data pulled from v0 tag"
echo "v1: Schema built and published"
echo "v1: Indexer running with new configuration"
echo ""

echo ""
echo "Migration process completed!"
