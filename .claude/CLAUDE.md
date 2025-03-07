# Hyperbridge SDK Workspace

## Package Structure
- Root package: `hyperbridge-sdk` (private, workspace container)
- Packages:
  - `@hyperbridge/sdk` - located in `/packages/sdk`
  - `@hyperbridge/subql-indexer` - located in `/packages/indexer`

## Build Commands
```bash
# Build both packages
pnpm build

# Build specific packages
pnpm --filter="@hyperbridge/indexer" build
pnpm --filter="@hyperbridge/sdk" build

# Run tests
pnpm test

# Lint code
pnpm lint

# Format code
pnpm format

# Clean
pnpm clean
```

## Release Process
```bash
# Create a changeset
pnpm changeset

# Version packages
pnpm version-packages

# Release
pnpm release
```

## CI/CD

### Publishing
- GitHub Actions workflow `.github/workflows/publish-sdk.yml` is set up to:
  - Automatically publish the SDK to npm when a new tag is pushed
  - Create a GitHub release draft that includes a changelog of commits since the last release
  - Process is triggered by pushing a tag that starts with 'v' (e.g., v1.0.1)
  - Requires an NPM_TOKEN secret to be configured in the repository settings

### Testing
- GitHub Actions workflow `.github/workflows/test-sdk.yml` is set up to:
  - Run tests for the SDK package
  - Automatically starts the indexer with the local environment configuration
  - Creates necessary environment variables from GitHub secrets
  - Waits for the GraphQL server to be available on port 3000 before running tests
  - Cleans up resources after tests complete
  - Triggers on:
    - Push to main (only when files in sdk/, indexer/, or the workflow itself change)
    - Pull requests to main (same path filtering)
    - Manual workflow dispatch
  - Requires the following secrets to be configured in the repository settings:
    - `BSC_CHAPEL`: BSC testnet RPC URL
    - `GNOSIS_CHIADO`: Gnosis Chiado RPC URL
    - `HYPERBRIDGE_GARGANTUA`: Hyperbridge Gargantua websocket URL
    - `PASEO_RPC_URL`: Paseo RPC URL
    - `BIFROST_RPC`: Bifrost RPC URL
    - `BSC_PRIVATE_KEY`: Private key for BSC testnet transactions
    - `PRIVATE_KEY`: Private key for transactions
    - `SECRET_PHRASE`: Secret phrase for keyring
    - `PING_MODULE_ADDRESS`: Address of the ping module
    - `TOKEN_GATEWAY_ADDRESS`: Address of the token gateway

## Fixes Applied
- Fixed package filter in root package.json to use the correct package name (`@hyperbridge/subql-indexer` instead of `@hyperbridge/indexer`)
- Fixed TypeScript type errors in test files:
  - Added type casting for unknown error types to string
  - Changed number literals to BigInt for values requiring BigInt type