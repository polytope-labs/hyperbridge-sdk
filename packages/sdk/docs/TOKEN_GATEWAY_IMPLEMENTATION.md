# TokenGateway Implementation Summary

## Overview

The TokenGateway SDK implementation provides a comprehensive solution for estimating fees (relayer and protocol) for cross-chain token teleports via Hyperbridge. The implementation exposes a `quoteNative` method on the `TokenGateway` class that returns the native cost for token gateway teleport operations.

## Implementation Details

### Core Class: `TokenGateway`

**Location:** `packages/sdk/src/protocols/tokenGateway.ts`

The `TokenGateway` class manages cross-chain token transfers and fee estimation for the Hyperbridge protocol.

#### Constructor Parameters

```typescript
{
  source: EvmChain              // Source chain instance
  dest: EvmChain                // Destination chain instance
}
```

**Note:** ChainConfigService is accessed via `EvmChain.configService` property, so it doesn't need to be passed separately.

### Main Method: `quoteNative(params: TeleportParams): Promise<bigint>`

#### Purpose
Estimates the total native token cost for a token gateway teleport operation, including both relayer fees and protocol fees.

#### TeleportParams Interface

```typescript
interface TeleportParams {
  amount: bigint              // Amount to be sent
  assetId: HexString          // The token identifier to send
  redeem: boolean             // Redeem ERC20 on the destination?
  to: HexString               // Recipient address (32 bytes)
  dest: string | Uint8Array   // Recipient state machine
  timeout: bigint             // Request timeout in seconds
  data?: HexString | Uint8Array  // Destination contract call data (optional)
}
```

**Note:** The `relayerFee` is NOT included in the params - it is automatically calculated internally.

## Fee Estimation Algorithm

### Step 1: Determine Relayer Fee

The relayer fee calculation depends on whether the destination is an EVM chain:

#### For EVM Destination Chains:
1. **Generate Dummy Post Request:**
   - Creates a post request with exactly **191 bytes of random data** in the body
   - Uses actual source and destination values from teleport parameters
   - Sets proper source/destination TokenGateway addresses

2. **Estimate Gas on Destination Chain:**
   - Calls `dest.estimateGas(dummyPostRequest)` to get gas estimate
   - Uses the destination `EvmChain`'s built-in gas estimation

3. **Convert to Native Tokens:**
   - Retrieves current gas price on destination chain
   - Calculates: `relayerFee = gas * gasPrice`

#### For Non-EVM Destination Chains:
- Relayer fee is set to **zero** (`0n`)
- Identified by checking if destination chain ID starts with "EVM-"

### Step 2: Calculate Protocol Fee

1. **Encode Teleport Body:**
   - Encodes the actual teleport parameters including the calculated relayer fee
   - Uses ABI encoding: `(uint256 amount, uint256 relayerFee, bytes32 assetId, bool redeem, bytes32 to, bytes data)`

2. **Create Post Request:**
   - Constructs proper `IPostRequest` with encoded teleport body
   - Includes all necessary fields (source, dest, from, to, nonce, body, timeoutTimestamp)

3. **Call Source Chain's quoteNative:**
   - Calls `source.quoteNative(postRequest, relayerFee)`
   - This returns the total cost in native tokens (includes both protocol fee and relayer fee)

### Step 3: Return Total Cost

Returns the result from `source.quoteNative()`, which represents:
- **Relayer Fee** (estimated gas cost on destination, or 0 for non-EVM)
- **Protocol Fee** (Hyperbridge protocol fees for message passing)

## Additional Helper Methods

### `getErc20Address(assetId: HexString): Promise<Address>`
Queries the TokenGateway contract to retrieve the ERC20 token address for a given asset ID.

### `getErc6160Address(assetId: HexString): Promise<Address>`
Queries the TokenGateway contract to retrieve the ERC6160 (hyper-fungible) token address for a given asset ID.

### `getInstanceAddress(destination: string | Uint8Array): Promise<Address>`
Retrieves the TokenGateway contract address on the destination chain.

### `getParams(): Promise<{ host: Address; dispatcher: Address }>`
Gets the TokenGateway contract parameters (host and dispatcher addresses).

## Configuration

### Chain Configuration Updates

**File:** `packages/sdk/src/configs/chain.ts`

Added TokenGateway addresses for all supported networks:

```typescript
TokenGateway: {
  [Chains.BSC_CHAPEL]: "0xFcDa26cA021d5535C3059547390E6cCd8De7acA6",
  [Chains.GNOSIS_CHIADO]: "0xFcDa26cA021d5535C3059547390E6cCd8De7acA6",
  [Chains.SEPOLIA]: "0xFcDa26cA021d5535C3059547390E6cCd8De7acA6",
  [Chains.MAINNET]: "0x8b6f1e3b932fcf883b27e5b9c1f1e90d35f6e234",
  [Chains.BSC_MAINNET]: "0x8b6f1e3b932fcf883b27e5b9c1f1e90d35f6e234",
  [Chains.ARBITRUM_MAINNET]: "0x8b6f1e3b932fcf883b27e5b9c1f1e90d35f6e234",
  [Chains.BASE_MAINNET]: "0x8b6f1e3b932fcf883b27e5b9c1f1e90d35f6e234",
  [Chains.POLYGON_MAINNET]: "0x8b6f1e3b932fcf883b27e5b9c1f1e90d35f6e234",
  [Chains.UNICHAIN_MAINNET]: "0x8b6f1e3b932fcf883b27e5b9c1f1e90d35f6e234",
}
```

### ChainConfigService Extension

**File:** `packages/sdk/src/configs/ChainConfigService.ts`

Added method:
```typescript
getTokenGatewayAddress(chain: string): `0x${string}`
```

## Usage Example

```typescript
import { TokenGateway, EvmChain, ChainConfigService } from "@hyperbridge/sdk"
import { keccak256, toHex, pad, parseEther } from "viem"

// Create chain instances
const sourceChain = new EvmChain({
  chainId: 97, // BSC Testnet
  rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
  host: "0x...", // IsmpHost contract address
  consensusStateId: "BSC0"
})

const destChain = new EvmChain({
  chainId: 10200, // Gnosis Chiado
  rpcUrl: "https://rpc.chiadochain.net",
  host: "0x...", // IsmpHost contract address
  consensusStateId: "GNO0"
})

// Initialize TokenGateway
const tokenGateway = new TokenGateway({
  source: sourceChain,
  dest: destChain
})

// Estimate fees for a teleport
const assetId = keccak256(toHex("USDC")) // Asset identifier
const recipientAddress = pad("0xRecipientAddress", { size: 32 })

const teleportParams = {
  amount: parseEther("100"), // Amount to teleport
  assetId: assetId,
  redeem: true, // Redeem as ERC20 on destination
  to: recipientAddress,
  dest: "EVM-10200", // Destination chain
  timeout: 3600n, // Timeout in seconds
  data: "0x" // Optional call data
}

// Get native cost estimate (protocol + relayer fees)
const estimatedCost = await tokenGateway.quoteNative(teleportParams)
console.log(`Estimated cost: ${estimatedCost} wei`)
console.log(`Estimated cost in ETH: ${formatEther(estimatedCost)}`)
```

## Testing

### Test Files

**Location:** `packages/sdk/src/tests/tokenGateway.test.ts`

#### Test Cases

1. **Test: Automatic Relayer Fee Estimation (EVM destination)**
   - Creates TokenGateway with BSC → Gnosis Chiado
   - Calls `quoteNative` without providing relayer fee
   - Verifies returned cost is positive bigint

2. **Test: Different Amounts**
   - Tests with varying teleport amounts
   - Ensures fee estimation scales appropriately

3. **Test: Non-EVM Destination (Zero Relayer Fee)**
   - Tests with Substrate destination
   - Verifies relayer fee component is zero
   - Protocol fee should still apply

4. **Test: Get ERC20/ERC6160 Addresses**
   - Tests helper methods for token address retrieval

5. **Test: Get TokenGateway Parameters**
   - Tests parameter retrieval method

## Key Features

✅ **Automatic Relayer Fee Estimation**
- Generates dummy post request with exactly 191 bytes of random data
- Estimates gas on destination EVM chain
- Converts gas cost to native tokens

✅ **EVM Chain Detection**
- Automatically detects if destination is EVM chain
- Sets relayer fee to zero for non-EVM destinations

✅ **Protocol Fee Calculation**
- Uses source chain's `quoteNative` method
- Includes both relayer and protocol fees in final result

✅ **Type Safety**
- Full TypeScript support
- Proper type definitions for all parameters

✅ **Comprehensive Documentation**
- JSDoc comments on all methods
- Usage examples in README
- Test coverage

## Technical Notes

### Why 191 Bytes?

The dummy post request body is exactly 191 bytes to accurately estimate the gas cost for a realistic teleport operation. This size represents a typical teleport message body.

### Random Data Generation

Random data is generated using JavaScript's `Math.random()`:
```typescript
const randomHex = "0x" + Array.from({ length: 191 * 2 }, () => 
  Math.floor(Math.random() * 16).toString(16)
).join("")
```

### EVM Chain Detection

Destination chain type is detected by checking if the chain ID starts with "EVM-":
```typescript
const isEvmDest = destChainId.startsWith("EVM-")
```

### Dependencies on EvmChain Methods

The implementation relies on two key `EvmChain` methods:
- `estimateGas(request: IPostRequest)` - Estimates gas for post request execution
- `quoteNative(request: IPostRequest, fee: bigint)` - Gets native token cost including protocol fees

## Export Configuration

**File:** `packages/sdk/src/index.ts`

The TokenGateway class and TeleportParams interface are exported:
```typescript
export * from "@/protocols/tokenGateway"
```

## Changelog Entry

**Version:** 1.4.8

**Changes:**
- Added TokenGateway class with `quoteNative` method for estimating cross-chain token teleport fees
- Automatic relayer fee estimation for EVM destination chains
- For non-EVM destination chains, relayer fee is set to zero
- Returns total native cost (relayer fee + protocol fee)
- Added helper methods: `getErc20Address`, `getErc6160Address`, `getInstanceAddress`, and `getParams`
- Added TokenGateway addresses to chain configuration for all supported networks
- Added comprehensive tests and documentation for TokenGateway functionality

## Conclusion

This implementation provides a complete, production-ready solution for estimating token gateway teleport fees in the Hyperbridge SDK. It automatically handles the complexity of relayer fee estimation for EVM chains while maintaining simplicity for the end user who only needs to provide the teleport parameters.