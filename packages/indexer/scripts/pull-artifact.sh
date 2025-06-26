#!/bin/bash

# Script to pull artifact from github release
# Usage: ENV=local ./pull-artifact.sh v0 true

set -e

# Read ENVIRONMENT from ENV environment variable
if [[ -z "$ENV" ]]; then
    echo "❌ ERROR: ENV environment variable is not set"
    echo "Please set ENV to specify the environment (e.g., export ENV=local)"
    exit 1
fi

ENVIRONMENT="$ENV"
TARGET_VERSION="${1:-v0}"
CLEANUP_ARTIFACT="${2:-true}"

echo "Pulling artifact for environment: $ENVIRONMENT"
echo "Target version: $TARGET_VERSION"

# Function to get latest hyperbridge-indexer-schema release
get_latest_schema_version() {
    echo "Checking for latest hyperbridge-indexer-schema release..."

    # Try to get the latest release with hyperbridge-indexer-schema prefix
    local latest_release
    latest_release=$(curl -s "https://api.github.com/repos/polytope-labs/hyperbridge-sdk/releases" | \
        jq -r '.[] | select(.tag_name | startswith("hyperbridge-indexer-schema-")) | .tag_name' | \
        head -n 1 2>/dev/null || echo "")

    if [[ -n "$latest_release" ]]; then
        # Extract version from tag (remove hyperbridge-indexer-schema- prefix)
        local version="${latest_release#hyperbridge-indexer-schema-}"
        echo "Found latest schema release: $latest_release (version: $version)"
        echo "$version"
    else
        echo "No hyperbridge-indexer-schema releases found, using v0"
        echo "v0"
    fi
}

# Function to fetch and prepare artifact data
fetch_and_prepare_artifact() {
    local temp_dir="temp-artifact"
    local artifact_zip="artifact.zip"
    local TAG_NAME="hyperbridge-indexer-schema"

    # If TARGET_VERSION is "latest", get the actual latest version
    if [[ "$TARGET_VERSION" == "latest" ]]; then
        TARGET_VERSION=$(get_latest_schema_version)
        echo "Resolved latest version to: $TARGET_VERSION"
    fi

    local artifact_url="https://github.com/polytope-labs/hyperbridge-sdk/releases/download/$TAG_NAME-$TARGET_VERSION/artifact.zip"

    # Check if curl is available
    if ! command -v curl >/dev/null 2>&1; then
        echo "❌ curl command not found. Please install curl to fetch artifacts."
        return 1
    fi

    # Check if artifact.zip already exists and is valid
    if [[ -f "$artifact_zip" ]]; then
        echo "Found existing artifact.zip, checking if it's valid..."
        if unzip -t "$artifact_zip" >/dev/null 2>&1; then
            echo "Existing artifact.zip is valid, skipping download"
        else
            echo "WARNING: Existing artifact.zip is corrupted, downloading fresh copy"
            rm -f "$artifact_zip"
        fi
    fi

    # Download artifact if not present or invalid
    if [[ ! -f "$artifact_zip" ]]; then
        echo "Downloading artifact from: $artifact_url"
        if ! curl -sfL "$artifact_url" -o "$artifact_zip"; then
            echo "ERROR: Failed to fetch artifact from $artifact_url"
            return 1
        fi
        echo "Successfully downloaded artifact.zip"
    fi

    # Verify the zip file
    if [[ ! -f "$artifact_zip" ]] || [[ ! -s "$artifact_zip" ]]; then
        echo "ERROR: Artifact.zip is missing or empty"
        return 1
    fi

    # Create temporary directory for extraction
    rm -rf "$temp_dir"
    mkdir -p "$temp_dir"

    # Extract the artifact
    echo "Extracting artifact.zip..."
    if ! unzip -q "$artifact_zip" -d "$temp_dir"; then
        echo "ERROR: Failed to extract artifact.zip"
        rm -rf "$temp_dir"
        return 1
    fi

    # Check if the environment-specific directory exists
    local env_artifact_dir="$temp_dir/artifact/$ENVIRONMENT"
    if [[ ! -d "$env_artifact_dir" ]]; then
        echo "ERROR: Environment directory not found: $env_artifact_dir"
        if [[ -d "$temp_dir/artifact" ]]; then
            echo "Available environments:"
            ls -la "$temp_dir/artifact/" | grep "^d" | awk '{print "  - " $9}' | grep -v "^\s*-\s*\.$" | grep -v "^\s*-\s*\.\.$"
        fi
        rm -rf "$temp_dir"
        return 1
    fi

    # Copy environment-specific files to current directory (including hidden files)
    echo "Copying $ENVIRONMENT environment files to current directory..."
    local copied_count=0

    # Enable globbing of hidden files
    shopt -s dotglob

    for file in "$env_artifact_dir"/*; do
        if [[ -f "$file" ]]; then
            local filename=$(basename "$file")
            echo "  Copying: $filename"
            if cp "$file" "./$filename"; then
                ((copied_count++))
            else
                echo "ERROR: Failed to copy $filename"
            fi
        fi
    done

    # Disable dotglob to restore default behavior
    shopt -u dotglob

    if [[ $copied_count -eq 0 ]]; then
        echo "WARNING: No files were copied for environment: $ENVIRONMENT"
        rm -rf "$temp_dir"
        return 1
    fi

    echo "Successfully copied $copied_count files for environment: $ENVIRONMENT"

    # Cleanup based on parameter
    if [[ "$CLEANUP_ARTIFACT" == "true" ]]; then
        echo "Cleaning up artifact.zip"
        rm -f "$artifact_zip"
    fi

    # Always cleanup temporary directory
    rm -rf "$temp_dir"
    return 0
}

# Change to the indexer package directory if needed
if [[ ! -f "package.json" && -d "packages/indexer" ]]; then
    cd packages/indexer
fi

# Execute the main function
if fetch_and_prepare_artifact; then
    echo "Successfully prepared artifact for environment: $ENVIRONMENT"
    echo ""
else
    echo "❌ Failed to prepare artifact for environment: $ENVIRONMENT"
    exit 1
fi
