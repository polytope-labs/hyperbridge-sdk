# Hyperbridge SDK Documentation

![CI](https://github.com/polytope-labs/hyperbridge-sdk/actions/workflows/test-sdk.yml/badge.svg) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

The Hyperbridge SDK is a comprehensive developer toolkit that enables secure, trust-free cross-chain interoperability through cryptographic proofs. Built by Polytope Labs, this SDK provides the essential infrastructure for developers to build mission-critical cross-chain applications that leverage Hyperbridge's coprocessor model for expensive cryptographic operations.

Unlike traditional cross-chain solutions that rely on multi-signature committees (which have resulted in over $2 billion in losses), Hyperbridge SDK implements a **crypto-economic coprocessor** that uses consensus proofs to attest to the correctness of computations performed onchain, enabling truly trustless cross-chain communication.

## Architecture

The Hyperbridge SDK is organized as a monorepo containing three core packages that work together to provide complete cross-chain messaging infrastructure:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    @hyperbridge/│    │  hyperbridge-   │    │  @hyperbridge/  │
│     indexer     │───▶│      sdk        │───▶│     filler      │
│                 │    │                 │    │                 │
│ SubQuery-based  │    │ JavaScript/     │    │ Intent          │
│ indexing &      │    │ TypeScript SDK  │    │ processing &    │
│ GraphQL API     │    │ & utilities     │    │ fulfillment     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Data Flow Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Chains    │───▶│   Indexer    │───▶│     SDK     │
│             │    │              │    │             │
│ EVM/        │    │ SubQuery +   │    │ Client +    │
│ Substrate   │    │ GraphQL      │    │ Utilities   │
└─────────────┘    └──────────────┘    └─────────────┘
                           │
                           ▼
                   ┌──────────────┐
                   │    Filler    │
                   │              │
                   │ Intent       │
                   │ Processing   │
                   └──────────────┘
```

## Package Overview

### @hyperbridge/indexer

**Purpose:** SubQuery-based indexer service for cross-chain message tracking
**Version:** 1.0.0

The indexer serves as the backbone of the Hyperbridge SDK ecosystem, providing comprehensive data indexing and querying capabilities for cross-chain messages. Built on SubQuery, it offers:

#### Core Functionality

- **Cross-Chain Message Indexing**: Tracks post requests, get requests, and responses across multiple blockchain networks
- **Real-Time State Monitoring**: Monitors state machine updates and consensus finalization events
- **Relayer Activity Tracking**: Indexes relayer activities, fee structures, and delivery confirmations
- **Status Management**: Tracks request statuses from initiation to completion or timeout
- **Multi-Chain Support**: Supports both EVM-compatible chains and Substrate-based networks

#### Technical Implementation

- **SubQuery Framework**: Leverages SubQuery's battle-tested indexing infrastructure
- **GraphQL API**: Provides a standardized GraphQL endpoint for data queries
- **PostgreSQL Backend**: Uses PostgreSQL for reliable data persistence and complex queries
- **Docker Deployment**: Containerized architecture for easy deployment and scaling
- **Environment Support**: Configurable for local, testnet, and mainnet environments

#### Supported Networks

The indexer supports a wide range of blockchain networks including:
- **EVM Chains**: Ethereum, Binance Smart Chain, Polygon, Arbitrum, Optimism
- **Substrate Chains**: Polkadot, Kusama, and parachains
- **Layer 2 Solutions**: Various rollups and sidechains

### hyperbridge-sdk (Main SDK) [@hyperbridge/sdk](https://www.npmjs.com/package/@hyperbridge/sdk)

**Purpose:** TypeScript/JavaScript SDK for cross-chain interaction
**Version:** 1.1.9

The main SDK provides developers with a comprehensive toolkit for building cross-chain applications. It abstracts complex cryptographic operations and provides high-level interfaces for common cross-chain operations.

#### Core Features

- **Cross-Chain Client**: Unified interface for interacting with multiple blockchain networks
- **Real-Time Monitoring**: Stream-based monitoring of request statuses and state changes
- **Proof Generation**: Generate and verify cryptographic proofs for cross-chain messages
- **Chain Abstraction**: Unified APIs for both EVM and Substrate chains
- **Type Safety**: Full TypeScript support with comprehensive type definitions

#### Key Components

**IndexerClient**: The primary client for querying cross-chain data
```typescript
const indexer = new IndexerClient({
  queryClient: createQueryClient({ url: "http://localhost:3000" }),
  pollInterval: 1000,
  source: { /* source chain config */ },
  dest: { /* destination chain config */ },
  hyperbridge: { /* hyperbridge config */ }
})
```

**Chain Utilities**:
- `EvmChain`: Utilities for EVM-compatible chains
- `SubstrateChain`: Utilities for Substrate-based chains
- `createQueryClient`: GraphQL client factory

**Status Monitoring**:
```typescript
// Real-time status monitoring
for await (const status of indexer.postRequestStatusStream(commitment)) {
  switch (status.status) {
    case RequestStatus.SOURCE_FINALIZED:
      console.log("Request finalized on source chain")
      break
    case RequestStatus.HYPERBRIDGE_DELIVERED:
      console.log("Request delivered to Hyperbridge")
      break
  }
}
```

#### Browser and Node.js Compatibility

The SDK provides separate builds optimized for different environments:
- **Browser Build**: Optimized for web applications with WebAssembly support
- **Node.js Build**: Server-side optimized with full cryptographic capabilities
- **Vite Plugin**: Specialized plugin for Vite-based development workflows

#### Advanced Features

- **WebAssembly Integration**: Efficient cryptographic operations using WASM
- **Async Generators**: Stream-based APIs for real-time data monitoring
- **Batch Operations**: Efficient handling of multiple operations
- **Connection Management**: Automatic connection pooling and retry logic

#### Use Cases

1. **Cross-Chain DApps**: Build applications that span multiple blockchains
2. **Bridge Interfaces**: Create user interfaces for cross-chain asset transfers
3. **Monitoring Tools**: Build dashboards for tracking cross-chain activity
4. **Integration Services**: Integrate cross-chain functionality into existing applications

### @hyperbridge/filler

**Purpose:** Intent fulfillment and processing engine
**Version:** 0.1.0

The filler package provides sophisticated intent processing capabilities, enabling automated fulfillment of cross-chain requests with configurable strategies and policies.

#### Core Components

**IntentFiller**: Primary engine for processing and fulfilling intents
```typescript
import { IntentFiller } from "@hyperbridge/filler"

const filler = new IntentFiller({
  strategy: new BasicFiller(),
  confirmationPolicy: new ConfirmationPolicy(),
  chainConfig: chainConfigService
})
```

**EventMonitor**: Monitors blockchain events for intent opportunities
**BasicFiller**: Default strategy for intent fulfillment
**ConfirmationPolicy**: Configurable policies for transaction confirmation
**ChainConfigService**: Management service for multi-chain configurations

#### Filling Strategies

The filler supports multiple strategies for different use cases:

1. **Basic Strategy**: Simple first-come-first-served fulfillment
2. **Profit Optimization**: Strategies that optimize for profitability
3. **Risk Management**: Conservative strategies with enhanced safety checks
4. **Custom Strategies**: Extensible framework for custom fulfillment logic

#### Use Cases

1. **Professional Relayers**: Run automated filling services for profit
2. **Protocol Integration**: Integrate intent filling into existing protocols
3. **Market Making**: Automated market making for cross-chain assets
4. **Arbitrage Services**: Automated arbitrage opportunities across chains

## Getting Started

### Prerequisites

Before working with the Hyperbridge SDK, ensure your development environment meets these requirements:

- **Node.js 22+**: Required for all packages and optimal performance
- **pnpm 7+**: Package manager (required for monorepo management)
- **Docker**: Required for running the indexer service locally
- **Git**: Version control system

### Quick Installation

#### For Application Development (SDK Only)

```bash
# Install the main SDK
npm install @hyperbridge/sdk
# or
yarn add @hyperbridge/sdk
# or
pnpm add @hyperbridge/sdk
```

#### For Full Development Setup

```bash
# Clone the repository
git clone https://github.com/polytope-labs/hyperbridge-sdk.git
cd hyperbridge-sdk/packages/sdk

# Install all dependencies
pnpm install

# Build all packages
pnpm build
```

### Environment Configuration

The project supports multiple deployment environments:

```bash
# Development environment files
.env                 # Default configuration
.env.local        # Local development overrides
.env.testnet    # Testnet configuration
.env.mainnet  # Production/Mainnet configuration
```

**Sample .env.local:**
```bash
# Indexer Configuration
INDEXER_URL="http://localhost:3000"
DB_PASS=postgres
DB_USER=postgres
DB_DATABASE=postgres
DB_HOST=postgres
DB_PORT=5432
DB_PATH="/tmp/local/db/"

# Chain Rpc
HYPERBRIDGE_GARGANTUA="wss://hyperbridge-paseo-rpc.blockops.network"
```

## Development Workflows

### Building the Project

The monorepo uses a carefully orchestrated build process to handle dependencies correctly:

```bash
# Build all packages in dependency order
pnpm build

# Build specific packages
pnpm --filter="@hyperbridge/indexer" build
pnpm --filter="hyperbridge-sdk" build
pnpm --filter="@hyperbridge/filler" build

# Clean build (remove all build artifacts)
pnpm clean
```

### Testing Strategy

The SDK includes comprehensive testing across multiple dimensions:

#### Test Categories

```bash
# Run all tests
pnpm test

# Concurrent tests (general functionality)
pnpm --filter="hyperbridge-sdk" test:concurrent

# Sequential tests (complex integration scenarios)
pnpm --filter="hyperbridge-sdk" test:sequence

# Specific test suites
pnpm --filter="hyperbridge-sdk" test:requests
pnpm --filter="hyperbridge-sdk" test:intent-gateway
pnpm --filter="hyperbridge-sdk" test:token-gateway
pnpm --filter="hyperbridge-sdk" test:evm-substrate
```

#### Test Structure

- **Unit Tests**: Individual component and utility testing
- **Integration Tests**: Cross-package functionality validation
- **Sequential Tests**: Order-dependent scenarios (relayer workflows, etc.)
- **Gateway Tests**: Token and intent gateway interaction testing
- **Network Tests**: Real network interaction testing (when available)

### Code Quality and Standards

The project maintains high code quality through multiple automated tools:

```bash
# Linting
pnpm lint          # Run ESLint across all packages
pnpm lint:fix      # Auto-fix linting issues

# Formatting
pnpm format        # Format code with Prettier

# Type Checking
pnpm type-check    # TypeScript compilation check
```

**Quality Tools:**
- **ESLint**: JavaScript/TypeScript linting with custom rules
- **Prettier**: Code formatting with project-specific configuration
- **TypeScript**: Strict type checking across all packages
- **Biome**: Additional linting and formatting (where applicable)
- **Husky**: Git hooks for pre-commit quality checks
- **lint-staged**: Staged file processing for faster feedback

## Package-Specific Development

### Indexer Development

#### Local Development Setup

```bash
cd packages/indexer

# Generate configuration files
npm run codegen:yamls
npm run codegen:subql

# Start local development environment
npm run start:local
```

This will:
1. Generate chain-specific YAML configurations
2. Start PostgreSQL database in Docker
3. Launch SubQuery node for indexing
4. Start GraphQL server on port 3000

#### Production Deployment

```bash
# Build for production
npm run build

# Deploy with specific environment
ENV=testnet npm run start
ENV=mainnet npm run start

# Monitor deployment
docker-compose logs -f

# Shutdown
npm run down
```

#### Querying the Indexer

Once running, the indexer provides a GraphQL endpoint at `http://localhost:3000` with a built-in playground for query development:

```graphql
query GetPostRequests($first: Int!, $offset: Int!) {
  postRequests(first: $first, offset: $offset) {
    nodes {
      id
      source
      dest
      commitmentHash
      statuses {
        status
        timestamp
      }
    }
  }
}
```

### SDK Development

#### Basic Usage Pattern

```typescript
import { IndexerClient, createQueryClient, RequestStatus } from "hyperbridge-sdk"

// Initialize the client
const queryClient = createQueryClient({
  url: "http://localhost:3000"
})

const indexer = new IndexerClient({
  queryClient,
  pollInterval: 1000, // 1 second polling
  source: {
    consensusStateId: "BSC0",
    rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
    stateMachineId: "EVM-97",
    host: "0x..." // Host contract address
  },
  dest: {
    consensusStateId: "GNO0",
    rpcUrl: "https://rpc.chiadochain.net",
    stateMachineId: "EVM-10200",
    host: "0x..." // Host contract address
  },
  hyperbridge: {
    consensusStateId: "PAS0",
    stateMachineId: "KUSAMA-4009",
    wsUrl: "wss://gargantua.polytope.technology"
  }
})
```

#### Advanced Usage Patterns

**Real-Time Status Monitoring:**
```typescript
import { postRequestCommitment } from "hyperbridge-sdk"

async function monitorRequest(request) {
  const commitment = postRequestCommitment(request)

  for await (const status of indexer.postRequestStatusStream(commitment)) {
    switch (status.status) {
      case RequestStatus.SOURCE_FINALIZED:
        console.log("✓ Request finalized on source chain")
        break

      case RequestStatus.HYPERBRIDGE_DELIVERED:
        console.log("✓ Request delivered to Hyperbridge")
        break

      case RequestStatus.DEST_DELIVERED:
        console.log("✓ Request delivered to destination")
        break

      case RequestStatus.TIMED_OUT:
        console.log("⚠ Request timed out")
        break
    }
  }
}
```

## Use Cases and Applications

### Cross-Chain DApp Development

**Token Bridges:**
```typescript
import { IndexerClient, RequestStatus } from "hyperbridge-sdk"

class TokenBridge {
  constructor(private indexer: IndexerClient) {}

  async bridgeTokens(amount: string, from: string, to: string) {
    // Initiate bridge request
    const request = await this.initiateBridge(amount, from, to)
    const commitment = postRequestCommitment(request)

    // Monitor progress
    for await (const status of this.indexer.postRequestStatusStream(commitment)) {
      this.updateUI(status)

      if (status.status === RequestStatus.DEST_DELIVERED) {
        this.notifySuccess()
        break
      }
    }
  }
}
```

## Security Considerations

### Best Practices

#### Private Key Management
```typescript
// ❌ Never hardcode private keys
const PRIVATE_KEY = "0x1234..." // DON'T DO THIS

// ✅ Use environment variables
const privateKey = process.env.PRIVATE_KEY
if (!privateKey) {
  throw new Error("PRIVATE_KEY environment variable required")
}

// ✅ Use secure key management services
import { KMSClient } from "@aws-sdk/client-kms"
const kms = new KMSClient({ region: "us-east-1" })
```

#### Network Security
```typescript
// ✅ Always use HTTPS/WSS in production
const config = {
  indexerUrl: process.env.NODE_ENV === 'production'
    ? 'https://indexer.hyperbridge.network'
    : 'http://localhost:3000',

  // ✅ Implement retry logic with exponential backoff
  retryConfig: {
    retries: 3,
    retryDelay: (attempt) => Math.pow(2, attempt) * 1000
  }
}
```

### Audit Considerations

The Hyperbridge SDK follows security best practices:

1. **Cryptographic Verification**: All cross-chain messages are verified using cryptographic proofs
2. **No Trust Assumptions**: The system doesn't rely on trusted validators or multi-sig committees
3. **Consensus Integration**: Leverages native blockchain consensus mechanisms
4. **Timeout Mechanisms**: Built-in timeout handling prevents stuck transactions
5. **Formal Verification**: Core cryptographic components are formally verified

## FAQ

### General Questions

**Q: What makes Hyperbridge different from other cross-chain solutions?**
A: Hyperbridge uses cryptographic proofs instead of trusted validators, eliminating the trust assumptions that have led to billions in losses in other protocols.

**Q: Which blockchains does Hyperbridge support?**
A: Hyperbridge supports EVM-compatible chains (Ethereum, BSC, Polygon, etc.) and Substrate-based chains (Polkadot, Kusama). New chains are regularly added.

**Q: Can I use Hyperbridge SDK in a browser environment?**
A: Yes, the SDK provides separate browser and Node.js builds with full WebAssembly support for browser environments.

### Development Questions

**Q: How do I handle failed cross-chain requests?**
A: Use the timeout monitoring system and implement retry logic with exponential backoff:

```typescript
async function handleFailedRequest(commitment: string) {
  for await (const timeout of indexer.postRequestTimeoutStream(commitment)) {
    if (timeout.status === TimeoutStatus.HYPERBRIDGE_TIMED_OUT) {
      // Implement retry or refund logic
      await handleTimeout(commitment)
      break
    }
  }
}
```

**Q: What's the recommended polling interval?**
A: For production applications, use 5-10 second intervals. For development, 1 second is fine. Higher frequency polling may be rate limited.

**Q: How do I optimize gas costs for cross-chain operations?**
A: Use the fee estimation utilities and implement dynamic gas pricing:

```typescript
const estimatedFee = await indexer.estimateFees(request)
const gasPrice = await optimizeGasPrice(estimatedFee)
```

### Troubleshooting Questions

**Q: Why am I getting WebAssembly errors in my Vite project?**
A: Make sure to use the Hyperbridge Vite plugin and configure proper headers:

```typescript
export default defineConfig({
  plugins: [hyperbridge()],
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  }
})
```

**Q: The indexer is not returning recent transactions**
A: Check the indexer sync status and ensure your polling interval matches the block finalization time of your source chain.

---

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Acknowledgments

- **SubQuery Network** - Blockchain indexing infrastructure
- **Polkadot Ecosystem** - Interoperability protocol foundation
- **Ethereum Foundation** - EVM compatibility standards
- **Polytope Labs** - Core development and research team

## Support and Community

- **Documentation**: https://docs.hyperbridge.network
- **GitHub Issues**: https://github.com/polytope-labs/hyperbridge-sdk/issues
- **Discord**: https://discord.gg/hyperbridge
- **Telegram**: https://t.me/hyperbridge
- **Twitter**: https://twitter.com/hyperbridge

---

*This documentation is continuously updated. For the latest version, visit the [official repository](https://github.com/polytope-labs/hyperbridge-sdk).*
