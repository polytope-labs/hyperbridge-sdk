#!/bin/bash

# Migration script for upgrading indexer deployments
# Usage: ./migrate-deployment.sh [ENV] [TARGET_VERSION]
# Example: ./migrate-deployment.sh local v0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"

ENV=${1:-local}
TARGET_VERSION=${2:-v0}
MIGRATION_BUFFER_BLOCKS=1000  # Buffer blocks for migration safety
GITHUB_REPO="polytope-labs/hyperbridge-sdk"

ENV_FILE="$ROOT_DIR/.env.$ENV"
CHAINS_DATA_FILE="$PACKAGE_DIR/chains-block-number.json"

echo "Starting Hyperbridge Indexer Migration"
echo "Environment: $ENV"
echo "Target Version: $TARGET_VERSION"
echo "Migration Buffer: $MIGRATION_BUFFER_BLOCKS blocks"
echo ""

# Function to check if indexer is running
check_indexer_status() {
    echo "Checking indexer status..."

    if [ -z "$DB_PASS" ] || [ -z "$DB_DATABASE" ] || [ -z "$DB_PORT" ] || [ -z "$DB_USER" ]; then
        echo "❌ Missing database environment variables"
        return 1
    fi

    # Try to connect to database
    local result
    result=$(PGPASSWORD="$DB_PASS" psql -d "$DB_DATABASE" -h "localhost" -p "$DB_PORT" -U "$DB_USER" -t -A -c "SELECT 1" 2>&1)
    if [ $? -eq 0 ]; then
        echo "Database connection successful"

        # Check if there are any metadata tables (indicates indexer has been running)
        local tables_count
        tables_count=$(PGPASSWORD="$DB_PASS" psql -d "$DB_DATABASE" -h "localhost" -p "$DB_PORT" -U "$DB_USER" -t -A -c "SELECT COUNT(*) FROM pg_tables WHERE tablename LIKE '_metadata_%' AND schemaname = 'app'" 2>/dev/null || echo "0")

        if [ "$tables_count" -gt 0 ]; then
            echo "Found $tables_count metadata table(s) - indexer appears to be initialized"
            return 0
        else
            echo "X No metadata tables found - indexer may not be fully initialized"
            return 1
        fi
    else
        echo "❌ Database connection failed: $result"
        return 1
    fi
}

# Function to fetch artifact.zip for the latest tag of hyperbridge-indexer-schema
fetch_artifact_data() {
    echo "Fetching chains deployment data..."

    local temp_dir="$TARGET_VERSION-artifact"
    local artifact_zip="$temp_dir/artifact.zip"
    local TAG_NAME="hyperbridge-indexer-schema"
    local artifact_url="https://github.com/polytope-labs/hyperbridge-sdk/releases/download/$TAG_NAME-$TARGET_VERSION/artifact.zip"

    # Cleanup function
    cleanup_temp() {
        if [[ -d "$temp_dir" ]]; then
            echo "Cleaning up temporary directory: $temp_dir"
            rm -rf "$temp_dir"
        fi
    }

    if ! command -v curl >/dev/null 2>&1; then
        echo "❌ curl command not found. Please install curl to fetch artifacts."
        return 1
    fi

    if [[ -d "$temp_dir" ]]; then
        echo "Temporary directory $temp_dir already exists, removing it..."
        rm -rf "$temp_dir"
    fi

    mkdir -p "$temp_dir"
    echo "Created temporary directory: $temp_dir"

    echo "Attempting to fetch version $TARGET_VERSION artifact from: $artifact_url"
    if ! curl -sfL "$artifact_url" -o "$artifact_zip"; then
        echo "❌ Failed to fetch artifact from $artifact_url"
        cleanup_temp
        return 1
    fi

    echo "Successfully downloaded artifact.zip"

    if [[ ! -f "$artifact_zip" ]] || [[ ! -s "$artifact_zip" ]]; then
        echo "❌ Downloaded artifact.zip is missing or empty"
        cleanup_temp
        return 1
    fi

    echo "Extracting artifact.zip..."
    if ! unzip -q "$artifact_zip" -d "$temp_dir"; then
        echo "❌ Failed to extract artifact.zip"
        cleanup_temp
        return 1
    fi

    rm -f "$artifact_zip"

    local artifact_subdir="$temp_dir/cid-artifacts"
    if [[ ! -d "$artifact_subdir" ]]; then
        echo "❌ Expected artifact subdirectory not found: $artifact_subdir"
        cleanup_temp
        return 1
    fi

    echo "Copying artifact files to root directory..."
    local copied_count=0
    while IFS= read -r -d '' file; do
        local filename=$(basename "$file")
        echo "Copying: $filename"
        if cp "$file" "./$filename"; then
            ((copied_count++))
        else
            echo "❌ Failed to copy $filename"
        fi
    done < <(find "$artifact_subdir" -type f -print0)

    if [[ $copied_count -eq 0 ]]; then
        echo "No files were copied from the artifact"
        cleanup_temp
        return 1
    fi

    echo "Successfully copied $copied_count files to root directory"

    cleanup_temp
    return 0
}


# # Function to get current block numbers for migration buffer
# get_current_blocks() {
#     local chain_name="$1"
#     local endpoint="$2"

#     echo "Getting current block for $chain_name..."

#     # This would need to be implemented based on your chain RPC methods
#     # For now, we'll use a placeholder that adds buffer to existing block numbers
#     local current_block=$(echo "$CHAINS_DATA" | jq -r ".\"$chain_name\".blockNumber // 0")
#     local until_block=$((current_block + MIGRATION_BUFFER_BLOCKS))

#     echo "Current: $current_block, UntilBlock: $until_block"
#     echo "$until_block"
# }

# # Function to generate migration release data
# generate_migration_release() {
#     echo "Generating migration release data..."

#     local migration_file="$PACKAGE_DIR/chains-migration-$TARGET_VERSION.json"
#     local chains_with_migration="{}"

#     # Read current chains data
#     CHAINS_DATA=$(cat "$CHAINS_DATA_FILE")

#     # Process each chain to add migration buffer
#     for chain_name in $(echo "$CHAINS_DATA" | jq -r 'keys[]'); do
#         echo "Processing $chain_name..."

#         # Get original data
#         local original_block=$(echo "$CHAINS_DATA" | jq -r ".\"$chain_name\".blockNumber")
#         local original_cid=$(echo "$CHAINS_DATA" | jq -r ".\"$chain_name\".cid")

#         # Calculate until block for migration
#         local until_block=$((original_block + MIGRATION_BUFFER_BLOCKS))

#         # Add to migration data
#         chains_with_migration=$(echo "$chains_with_migration" | jq \
#             --arg chain "$chain_name" \
#             --arg block "$original_block" \
#             --arg until "$until_block" \
#             --arg cid "$original_cid" \
#             '.[$chain] = {
#                 "blockNumber": ($block | tonumber),
#                 "untilBlock": ($until | tonumber),
#                 "cid": $cid,
#                 "version": "v0",
#                 "parentCid": null
#             }')

#         echo "$chain_name: block $original_block -> until $until_block"
#     done

#     # Save migration file
#     echo "$chains_with_migration" | jq '.' > "$migration_file"
#     echo "Migration data saved to: $migration_file"

#     # Update the main chains file for the deployment script
#     echo "$chains_with_migration" | jq 'to_entries | map({key: .key, value: {blockNumber: .value.blockNumber, cid: .value.cid}}) | from_entries' > "$CHAINS_DATA_FILE"
#     echo "Updated chains data file for deployment"
# }

# Function to run deployment update
run_deployment_update() {
    echo "Running deployment update..."

    local update_script="$SCRIPT_DIR/update-deployments.sh"
    if [ ! -f "$update_script" ]; then
        echo "   ❌ Deployment update script not found: $update_script"
        return 1
    fi

    echo "Executing: $update_script $ENV"
    chmod +x "$update_script"
    "$update_script" "$ENV"

    if [ $? -eq 0 ]; then
        echo "Deployment update completed successfully"
        return 0
    else
        echo "X Deployment update failed"
        return 1
    fi
}

# Main migration process
main() {
    if [ ! -f "$ENV_FILE" ]; then
        echo "❌ Environment file not found: $ENV_FILE"
        exit 1
    fi

    set -a
    source "$ENV_FILE"
    set +a

    echo "Environment loaded: $ENV_FILE"
    echo ""

    # # Step 1: Check indexer status
    # if ! check_indexer_status; then
    #     echo "⚠️  Indexer may not be running properly, but continuing with migration..."
    # fi
    # echo ""

    # Step 2: Fetch artifact data
    if ! fetch_artifact_data; then
        echo "❌ Failed to fetch chains data"
        exit 1
    fi
    echo ""

    # # Step 3: Generate migration release
    # generate_migration_release
    # echo ""

    # # Step 4: Run deployment update
    # if ! run_deployment_update; then
    #     echo "❌ Migration failed during deployment update"
    #     exit 1
    # fi
    # echo ""

    # echo "Migration to $TARGET_VERSION completed successfully!"
    # echo ""
    # echo "Next steps:"
    # echo "1. Monitor indexer logs to ensure smooth operation"
    # echo "2. Verify database has been updated with new deployment data"
    # echo "3. Prepare for future v1 migration using current v0 as parent CID"
    # echo ""
    # echo "Migration artifacts:"
    # echo " - Migration data: $PACKAGE_DIR/chains-migration-$TARGET_VERSION.json"
    # echo " - Backup chains data: $CHAINS_DATA_FILE.backup"
}

# Execute main function
main "$@"
