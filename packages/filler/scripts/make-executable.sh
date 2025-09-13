#!/bin/bash

# Make all scripts in the scripts directory executable

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Making scripts executable..."

chmod +x "$SCRIPT_DIR/docker-build.sh"
chmod +x "$SCRIPT_DIR/docker-run.sh"
chmod +x "$SCRIPT_DIR/make-executable.sh"

echo "✓ All scripts are now executable"
