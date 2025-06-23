#!/bin/bash

TARGET_VERSION="${1:-latest}"
REBUILD="${2:-rebuild}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to pull artifacts for a specific environment
pull_artifacts() {
    local env="$1"
    local version="${2:-latest}"

    echo "Pulling artifacts for environment: $env"
    local pull_script="$SCRIPT_DIR/pull-artifact.sh"
    if [[ ! -f "$pull_script" ]]; then
        echo "❌ pull-artifact.sh not found at: $pull_script"
        return 1
    fi

    # Pull artifacts for the specific environment
    if bash "$pull_script" "$env" "$version" "false" 2>/dev/null; then
        echo "Successfully pulled artifacts for environment: $env"
        return 0
    else
        echo "No artifacts found for environment: $env"
        return 1
    fi
}

# Function to build artifacts
build_artifacts() {
    echo "Building artifacts..."

    CONFIG_FILES=$(find ./src/configs -maxdepth 1 -name "config-*.json" -type f 2>/dev/null)
    if [[ -z "$CONFIG_FILES" ]]; then
        echo "❌ No configuration files found matching pattern config-*.json in ./src/configs"
        return 1
    fi

    echo "Found configuration files:"
    echo "$CONFIG_FILES"

    local environments=()
    for config_file in $CONFIG_FILES; do
        filename=$(basename "$config_file")
        if [[ "$filename" =~ ^config-(.+)\.json$ ]]; then
            local env="${BASH_REMATCH[1]}"
            environments+=("$env")
            echo "Process environment: $env"
        fi
    done

    if [[ ${#environments[@]} -eq 0 ]]; then
        echo "❌ No valid environments extracted from config files"
        return 1
    fi

    local artifact_dir="artifact"
    mkdir -p "$artifact_dir"

    for env in "${environments[@]}"; do
        echo ""
        echo "Building for environment: $env"

        echo "Pulling deployment data for environment: $env"
        if pull_artifacts "$env" "$TARGET_VERSION"; then
            echo "Deployment data available for build"
        else
            echo "No deployment data found, proceeding with build anyway"
        fi

        if [[ -f "chains-block-number.json" ]]; then
            echo "Found chains-block-number.json for build"
        else
            echo "chains-block-number.json not found, build may fail"
        fi

        if ! ENV="$env" pnpm build; then
            echo "❌ Build failed for environment: $env"
            return 1
        fi

        if ! ./node_modules/.bin/subql publish; then
            echo "❌ Subql Publish failed for environment: $env"
            exit 1
        fi

        if [[ "$REBUILD" == "rebuild" ]]; then
            if ! ENV="$env" pnpm build; then
                echo "❌ Rebuild failed for environment: $env"
                exit 1
            fi
        fi

        local env_artifact_dir="$artifact_dir/$env"
        mkdir -p "$env_artifact_dir"
        echo "Created artifact directory: $env_artifact_dir"

        local cid_files=$(find . -maxdepth 1 -name ".*-cid" -type f)
        local yaml_files=$(find . -maxdepth 1 -name "*.yaml" -type f)
        local json_files=$(find . -maxdepth 1 -name "chains-block-number.json" -type f)

        for file in $cid_files; do
            [[ -f "$file" ]] && mv "$file" "$env_artifact_dir/" && echo "Moved CID file: $(basename "$file")"
        done

        for file in $yaml_files; do
            if [[ "$file" == *"-lock"* ]]; then
                echo "Skipping lock file: $file"
                continue
            fi
            [[ -f "$file" ]] && mv "$file" "$env_artifact_dir/" && echo "Moved YAML file: $(basename "$file")"
        done

        for file in $json_files; do
            [[ -f "$file" ]] && mv "$file" "$env_artifact_dir/" && echo "Moved JSON file: $(basename "$file")"
        done

        echo "Completed processing for environment: $env"
    done

    echo ""
    echo "All environments processed successfully!"
    echo "Creating final artifact zip..."

    if zip -r "$artifact_dir.zip" "$artifact_dir/"; then
        echo ""
        echo "Created artifact.zip with the following contents:"
        unzip -l "$artifact_dir.zip"
        return 0
    else
        echo "❌ Failed to create artifact.zip"
        return 1
    fi
}

echo "Starting artifact preparation..."
if build_artifacts; then
    echo "Build phase completed"
else
    echo "❌ Build phase failed"
    exit 1
fi

echo ""
echo "Artifact preparation completed successfully!"
