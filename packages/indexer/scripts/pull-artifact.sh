#!/bin/bash

ENVIRONMENT="${1:-local}"
TARGET_VERSION="${2:-latest}"
CLEANUP_ARTIFACT="${3:-true}"

echo "Pulling artifact for environment: $ENVIRONMENT"
echo "Target version: $TARGET_VERSION"

# Function to fetch and prepare artifact data
fetch_and_prepare_artifact() {
    local temp_dir="temp-artifact"
    local artifact_zip="artifact.zip"
    local TAG_NAME="hyperbridge-indexer-schema"
    local artifact_url="https://github.com/polytope-labs/hyperbridge-sdk/releases/download/$TAG_NAME-$TARGET_VERSION/artifact.zip"

    if ! command -v curl >/dev/null 2>&1; then
        echo "❌ curl command not found. Please install curl to fetch artifacts."
        return 1
    fi

    if [[ -f "$artifact_zip" ]]; then
        echo "Found existing $artifact_zip, checking if it's valid..."
        if unzip -t "$artifact_zip" >/dev/null 2>&1; then
            echo "Existing $artifact_zip is valid, skipping download"
        else
            echo "Existing $artifact_zip is corrupted, downloading fresh copy"
            rm -f "$artifact_zip"
        fi
    fi

    if [[ ! -f "$artifact_zip" ]]; then
        echo "Downloading artifact from: $artifact_url"
        if ! curl -sfL "$artifact_url" -o "$artifact_zip"; then
            echo "❌ Failed to fetch artifact from $artifact_url"
            return 1
        fi
        echo "Successfully downloaded $artifact_zip"
    fi

    if [[ ! -f "$artifact_zip" ]] || [[ ! -s "$artifact_zip" ]]; then
        echo "❌ Artifact.zip is missing or empty"
        return 1
    fi

    rm -rf "$temp_dir"
    mkdir -p "$temp_dir"

    echo "Extracting artifact.zip..."
    if ! unzip -q "$artifact_zip" -d "$temp_dir"; then
        echo "❌ Failed to extract artifact.zip"
        rm -rf "$temp_dir"
        return 1
    fi

    local env_artifact_dir="$temp_dir/artifact/$ENVIRONMENT"
    if [[ ! -d "$env_artifact_dir" ]]; then
        echo "❌ Environment directory not found: $env_artifact_dir"
        if [[ -d "$temp_dir/artifact" ]]; then
            echo "Available environments:"
            ls -la "$temp_dir/artifact/" | grep "^d" | awk '{print "  - " $9}' | grep -v "^\s*-\s*\.$" | grep -v "^\s*-\s*\.\.$"
        fi
        rm -rf "$temp_dir"
        return 1
    fi

    echo "Copying $ENVIRONMENT environment files to current directory..."
    local copied_count=0

    # Enable globbing of hidden files
    shopt -s dotglob

    for file in "$env_artifact_dir"/*; do
        if [[ -f "$file" ]]; then
            local filename=$(basename "$file")
            echo "Copying: $filename"
            if cp "$file" "./$filename"; then
                ((copied_count++))
            else
                echo "❌ Failed to copy $filename"
            fi
        fi
    done

    # Disable dotglob
    shopt -u dotglob

    if [[ $copied_count -eq 0 ]]; then
        echo "No files were copied for environment: $ENVIRONMENT"
        rm -rf "$temp_dir"
        return 1
    fi

    echo "Successfully copied $copied_count files for environment: $ENVIRONMENT"

    if [[ "$CLEANUP_ARTIFACT" == "true" ]]; then
        echo "Cleaning up artifact.zip"
        rm -f "$artifact_zip"
    fi

    rm -rf "$temp_dir"
    return 0
}

if fetch_and_prepare_artifact; then
    echo "Successfully prepared artifact for environment: $ENVIRONMENT"
else
    echo "❌ Failed to prepare artifact for environment: $ENVIRONMENT"
    exit 1
fi
