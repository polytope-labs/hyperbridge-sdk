#!/bin/bash

# Script to update database schema app._metadata_*.deployments
# Usage: ENV=local ./update-deployments.sh

set -e

# Read ENVIRONMENT from ENV environment variable
if [[ -z "$ENV" ]]; then
    echo "❌ ERROR: ENV environment variable is not set"
    echo "Please set ENV to specify the environment (e.g., export ENV=local)"
    exit 1
fi

ENVIRONMENT="$ENV"

# Function to get the chain name from chain ID/identifier
get_chain_name() {
    local chain_value="$1"
    case "$chain_value" in
        # Local
        "CereTestnet") echo "cere-local" ;;

        # Mainnet
        "Hyperbridge(Nexus)") echo "hyperbridge-nexus" ;;
        "BifrostPolkadot") echo "bifrost-mainnet" ;;
        "CereMainnetBeta") echo "cere-mainnet" ;;
        "Argon") echo "argon-mainnet" ;;
        "1") echo "ethereum-mainnet" ;;
        "42161") echo "arbitrum-mainnet" ;;
        "10") echo "optimism-mainnet" ;;
        "8453") echo "base-mainnet" ;;
        "56") echo "bsc-mainnet" ;;
        "100") echo "gnosis-mainnet" ;;
        "1868") echo "soneium-mainnet" ;;


        # Testnet
        "Hyperbridge(Gargantua)") echo "hyperbridge-gargantua" ;;
        "BifrostPaseo") echo "bifrost-paseo" ;;
        "11155111") echo "sepolia" ;;
        "421614") echo "arbitrum-sepolia" ;;
        "11155420") echo "optimism-sepolia" ;;
        "84532") echo "base-sepolia" ;;
        "97") echo "bsc-chapel" ;;
        "10200") echo "gnosis-chiado" ;;

        *) echo "" ;;
    esac
}

# Function to get the environment name of a chain
get_env_chain_name() {
    local chain_name="$1"
    local env_var_name

    # Convert chain name to environment variable format
    # e.g., hyperbridge-gargantua -> HYPERBRIDGE_GARGANTUA
    env_var_name=$(echo "$chain_name" | tr '[:lower:]' '[:upper:]' | tr '-' '_')

    echo "$env_var_name"
}

# Function to get chain endpoint from environment
get_chain_endpoint() {
    local env_var_name
    local endpoint

    env_var_name=$(get_env_chain_name "$chain_name")
    endpoint=$(printenv "$env_var_name" || echo "")

    echo "$endpoint"
}

run_query() {
    local query="$1"

    for var in DB_PASS DB_DATABASE DB_HOST DB_PORT DB_USER; do
        if [ -z "${!var}" ]; then
            echo "❌ Missing database variable: $var"
            exit 1
        fi
    done

    PGPASSWORD="$DB_PASS" psql -d "$DB_DATABASE" -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -t -A -c "$query" 2>/dev/null
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.$ENVIRONMENT"
CHAINS_FILE="$SCRIPT_DIR/../chains-block-number.json"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Environment file not found: $ENV_FILE"
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

echo "Update _metadata_*.deployments = *update_value*"
echo "Using environment: $ENVIRONMENT"
echo "Environment file: $ENV_FILE"

if [ ! -f "$CHAINS_FILE" ]; then
    echo "❌ Chains data file not found: $CHAINS_FILE"
    exit 1
fi

CHAINS_DATA=$(cat "$CHAINS_FILE")
echo "Loaded chains data from: $CHAINS_FILE"
echo "Updating deployments for environment: $ENVIRONMENT"

tables=$(run_query "SELECT tablename FROM pg_tables WHERE tablename LIKE '_metadata_%' AND schemaname = 'app'")
if [ -z "$tables" ]; then
    echo "❌ No metadata tables found"
    exit 1
fi

echo "$tables" | while read -r table; do
    table=$(echo "$table" | tr -d '[:space:]')
    [ -z "$table" ] && continue

    echo ""
    echo "Processing: app.$table"

    chain_value=$(run_query "SELECT value::text FROM app.$table WHERE key = 'chain'" | tr -d '[:space:]"')
    if [ -z "$chain_value" ]; then
        echo "No chain value found"
        continue
    fi

    chain_name=$(get_chain_name "$chain_value")
    if [ -z "$chain_name" ]; then
        echo "❌ Unknown chain: $chain_value"
        continue
    fi

    env_var_name=$(get_env_chain_name "$chain_name")
    endpoint=$(get_chain_endpoint "$env_var_name")
    if [ -z "$endpoint" ]; then
        echo "Chain $chain_name not configured in environment"
        continue
    fi

    block_number=$(echo "$CHAINS_DATA" | jq -r ".\"$chain_name\".blockNumber // empty")
    cid=$(echo "$CHAINS_DATA" | jq -r ".\"$chain_name\".cid // empty")
    if [ -z "$block_number" ] || [ -z "$cid" ]; then
        echo "❌ Missing deployment data for $chain_name"
        continue
    fi

    deployment_json=$(jq -nc --arg b "$block_number" --arg c "$cid" '{($b): ("ipfs://" + $c)} | @json')
    if run_query "UPDATE app.$table SET value = '$deployment_json'::jsonb WHERE key = 'deployments'" >/dev/null; then
        echo "Updated $chain_name (block: $block_number, cid: $cid)"
    else
        echo "❌ Failed to update $chain_name"
    fi
done

echo ""
echo "Deployment updates completed!"
