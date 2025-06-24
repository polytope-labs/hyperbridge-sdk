#!/bin/bash

# Script to automate seamless schema migration
# Usage: ./migrate-deployments.sh [ENV] [TAG]
# Example: ./migrate-deployments.sh local latest

set -e

ENV=${1:-local}
TAG=${2:-v0}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"

echo "Starting seamless schema migration for environment: $ENV"
echo "Using parent tag: $TAG"
echo ""

# Function to check if indexer is currently running
check_existing_indexer() {
    echo "Checking if indexer is currently running..."

    # Check if GraphQL endpoint is responding
    if curl -s -X POST http://localhost:3100/graphql \
        -H "Content-Type: application/json" \
        -d '{"query": "query { _metadatas { totalCount } }"}' >/dev/null 2>&1; then
        echo "Detected running indexer on localhost:3100"
        return 0
    else
        echo "No running indexer detected (this is fine for fresh setup)"
        return 1
    fi
}

# Function to check database connectivity and current state
check_database_state() {
    echo "Checking database state..."

    if ! command -v psql >/dev/null 2>&1; then
        echo "psql not found, skipping database state check"
        return 0
    fi

    ENV_FILE="$ROOT_DIR/.env.$ENV"
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source "$ENV_FILE"
        set +a
        echo "Loaded environment variables from $ENV_FILE"
    else
        echo "Environment file not found: $ENV_FILE"
        echo "Database state check will be skipped"
        return 0
    fi

    if [[ -n "$DB_PASS" && -n "$DB_DATABASE" && -n "$DB_PORT" && -n "$DB_USER" ]]; then
        local tables
        tables=$(PGPASSWORD="$DB_PASS" psql -d "$DB_DATABASE" -h "localhost" -p "$DB_PORT" -U "$DB_USER" -t -A -c \
            "SELECT tablename::text FROM pg_tables WHERE tablename LIKE '_metadata_%' AND schemaname = 'app'" 2>/dev/null || echo "0")

        if [[ "${#tables[@]}" -eq 0 ]]; then
            echo "No metadata table found - fresh database setup"
            return 0 # Fresh setup
        fi

        echo "$tables" | while read -r table; do
            echo "Found $table metadata table in database"

            local deployment_count
            deployment_count=$(PGPASSWORD="$DB_PASS" psql -d "$DB_DATABASE" -h "localhost" -p "$DB_PORT" -U "$DB_USER" -t -A -c \
                "SELECT COUNT(*) FROM app.$table WHERE key = 'deployments' AND value::text LIKE '%ipfs://%'" 2>/dev/null || echo "0")

            if [[ "$deployment_count" -gt 0 ]]; then
                echo "Deployments already configured in database"
                echo "This appears to be a subsequent migration"
            else
                echo "No IPFS deployments found - this will be the initial v0 migration"
            fi

            return 0
        done
    else
        echo "Database connection variables not set, skipping state check"
        return 0
    fi
}

# Function to pull parent artifact data
pull_parent_data() {
    echo "Step 1: Pulling parent artifact data..."
    echo ""

    cd "$PACKAGE_DIR"

    echo "Attempting to pull chains-block-number.json from tag: $TAG"

    if bash "$SCRIPT_DIR/pull-artifact.sh" "$ENV" "$TAG" "false"; then
        echo "Successfully pulled parent artifact data"

        if [[ -f "chains-block-number.json" ]]; then
            echo "chains-block-number.json is ready"
            echo "Preview of chains data:"
            cat chains-block-number.json | jq 'keys[]' 2>/dev/null || echo "File exists but couldn't parse JSON"
        else
            echo "chains-block-number.json not found after pull"
        fi
    else
        echo "Failed to pull from tag $TAG"

        if [[ -f "chains-block-number.json" ]]; then
            echo "Using existing local chains-block-number.json"
        else
            echo "❌ No chains-block-number.json available"
            echo "Either provide a local file or ensure the parent tag exists"
            return 1
        fi
    fi

    return 0
}

# Function to update database deployments
update_database_deployments() {
    echo ""
    echo "Step 2: Updating database deployments (creating v0 state)..."
    echo ""

    cd "$PACKAGE_DIR"

    if bash "$SCRIPT_DIR/update-deployments.sh" "$ENV"; then
        echo "Database deployments updated successfully"
        echo "The database now has v0 deployment state"
    else
        echo "❌ Failed to update database deployments"
        return 1
    fi

    return 0
}

# Function to build and publish with parent references
build_with_parent_references() {
    echo ""
    echo "Step 3: Building new schema with parent references..."
    echo ""

    cd "$PACKAGE_DIR"

    echo "Building project for environment: $ENV"
    if ! ENV="$ENV" pnpm build; then
        echo "❌ Build failed"
        return 1
    fi

    echo "Publishing to SubQL (this creates the new schema version)..."
    if ! ./node_modules/.bin/subql publish; then
        echo "❌ SubQL publish failed"
        return 1
    fi

    echo "Final build to generate updated manifest files..."
    if ! ENV="$ENV" pnpm build; then
        echo "❌ Second build failed"
        return 1
    fi

    echo "New schema built and published with parent references"

    # Show what was generated
    echo ""
    echo "Generated files:"
    ls -la .*-cid 2>/dev/null || echo "No CID files found"
    ls -la *.yaml 2>/dev/null || echo "No YAML files found"
    ls -la chains-block-number.json 2>/dev/null || echo "No chains-block-number.json files found"

    return 0
}

if [[ "$ENV" == "local" ]]; then
    echo "Pre-migration checks..."
    echo ""

    INDEXER_RUNNING=false
    if check_existing_indexer; then
        INDEXER_RUNNING=true
    fi

    check_database_state
fi


echo ""
echo "Starting migration process..."
echo ""

# Step 1: Pull parent data (always needed for parent references)
if ! pull_parent_data; then
    echo "❌ Failed to pull parent data"
    exit 1
fi

# Step 2: Update database deployments (skip if already done)
if [[ $DB_STATE -ne 2 ]]; then
    if ! update_database_deployments; then
        echo "❌ Failed to update database deployments"
        exit 1
    fi
else
    echo ""
    echo "Step 2: Skipping database update (already migrated)"
    echo ""
fi

# Step 3: Build with parent references
if ! build_with_parent_references; then
    echo "❌ Failed to build with parent references"
    exit 1
fi

echo ""
echo "Migration completed successfully!"
echo ""
echo ""
echo "Migration Summary:"
echo "  Environment: $ENV"
echo "  Parent Tag: $TAG"
echo "  Database State: $([[ "$DB_STATE" -eq 2 ]] && echo 'Previously migrated' || echo 'Newly migrated')"
echo "  Indexer Status: $([[ "$INDEXER_RUNNING" == true ]] && echo 'Was running' || echo 'Not running')"
echo ""
