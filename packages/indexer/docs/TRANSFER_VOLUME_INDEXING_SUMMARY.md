# Transfer Volume Indexing - Executive Summary

## What Is This?

The Hyperbridge indexer tracks all token transfers that occur during cross-chain messaging operations, converting them to USD values and aggregating them by token type and contract address. This provides comprehensive visibility into the financial activity flowing through the protocol.

## Why It Matters

- **Protocol Analytics**: Measure total value transferred through Hyperbridge
- **Token Insights**: Track which tokens are most used for cross-chain operations
- **Contract Metrics**: Identify top applications by transfer volume
- **Business Intelligence**: Data-driven decisions for protocol development
- **User Dashboards**: Real-time and historical volume charts

## How It Works (High Level)

```
User Transaction → Hyperbridge Event Emitted → Indexer Processes Event
                                                        ↓
                                        Scan Transaction Logs for ERC20 Transfers
                                                        ↓
                                        Extract: token, amount, from, to addresses
                                                        ↓
                                        Convert Amount to USD using price feeds
                                                        ↓
                                    Update Volume Metrics (Token + Contract)
                                                        ↓
                                            Save to Database
```

## Two Types of Volumes Tracked

### 1. Token Volume
**Format**: `Transfer.{TOKEN_SYMBOL}`
**Example**: `Transfer.USDC`, `Transfer.WETH`
**Purpose**: Track total movement of each token across all contracts

### 2. Contract Volume
**Format**: `Contract.{CONTRACT_ADDRESS}`
**Example**: `Contract.0x1234...5678`
**Purpose**: Track total volume processed by specific smart contracts

## Two Time Windows

### Cumulative Volume
- **All-time** aggregate volume
- Never resets
- Shows total historical value

### Daily Volume
- **Rolling 24-hour** window
- New record created each day
- Shows recent activity trends

## Key Technical Components

| Component | Purpose |
|-----------|---------|
| **TransferService** | Stores individual transfer records, prevents duplicates |
| **VolumeService** | Aggregates volumes with 18-decimal precision |
| **TokenPriceService** | Fetches and caches token prices in USD |
| **Transfer Helpers** | Detects ERC20 events and extracts addresses |

## The Contract Address Challenge

**Problem**: Which contract should get credit for a transfer's volume?

**Solution**: Dual detection strategy based on event type:

### Source Chain Events (PostRequest, GetRequest, PostResponse)
- **Method**: Read directly from event arguments
- **Fast**: No extra processing needed
- **Example**: `args.from` contains the initiating contract address

### Destination Chain Events (*Handled, *Timeout)
- **Method**: Decode transaction input data using ABI
- **Complex**: Extracts addresses from batched messages
- **Example**: Parse `handlePostRequests()` calldata to find recipient contracts

## Event Processing Flow

### Example: Cross-Chain Swap

1. **PostRequest on Ethereum** (Source)
   - User sends 1000 USDC to DEX contract
   - Event args contain: `from: 0xDEX_CONTRACT`
   - Transfer detected: User → DEX (1000 USDC)
   - Volume attributed: `Contract.0xDEX_CONTRACT` += $1,000

2. **PostRequestHandled on Polygon** (Destination)
   - Transaction executes swap on Polygon
   - Decode TX input: finds `to: 0xPOLYGON_AMM`
   - Transfer detected: Bridge → AMM (500 MATIC)
   - Volume attributed: `Contract.0xPOLYGON_AMM` += $350

## Critical Features

### ✅ Deduplication
- Each transfer gets unique ID: `${txHash}-index-${logIndex}`
- Checked before processing to prevent double-counting
- Handles indexer restarts and chain reorgs safely

### ✅ USD Conversion
- Queries token contract for symbol and decimals
- Fetches current price from price oracle
- Calculation: `(amount / 10^decimals) * priceUSD`
- Precision: 18 decimal places using Decimal.js

### ✅ Batched Messages
- Single transaction can contain multiple cross-chain operations
- Each operation's contract address extracted separately
- Volumes attributed independently to correct contracts

### ✅ Error Handling
- ABI decoding failures don't block token volume tracking
- Missing prices logged but processing continues
- Token volumes always recorded, contract attribution optional

## Quick Statistics

```typescript
// Get total USDC volume on Ethereum
const volume = await CumulativeVolumeUSD.get('Transfer.USDC.ethereum-1')
console.log(volume.volumeUSD) // "1234567.890000000000000000"

// Get 24h volume for a DEX contract
const today = '2024-01-15'
const dailyVolume = await DailyVolumeUSD.get(`Contract.0xDEX.ethereum-1.${today}`)
console.log(dailyVolume.last24HoursVolumeUSD) // "45678.900000000000000000"
```

## Event Type Reference

| Event | Chain | Address Detection | Volume Attribution |
|-------|-------|-------------------|-------------------|
| PostRequest | Source | Event args (`from`) | Initiating contract |
| PostRequestHandled | Destination | TX input decode (`to`) | Receiving contract |
| PostResponse | Source | Event args (`to`) | Receiving contract |
| PostResponseHandled | Destination | TX input decode (`post.from`) | Original requester |
| GetRequest | Source | Event args (`from`) | Querying contract |
| GetRequestHandled | Destination | TX input decode (`get.from`) | Original requester |
| *TimeoutHandled | Source/Dest | TX input decode | Refund recipient |

## Example Volume Calculation

**Scenario**: 1 ETH transfer detected

1. Query WETH contract: `decimals() → 18`, `symbol() → "WETH"`
2. Fetch price: `TokenPriceService.getPrice("WETH") → $2,250`
3. Calculate: `1 * 10^18 / 10^18 * 2250 = $2,250.00`
4. Store: `"2250.000000000000000000"` (18 decimals)

## Data Models

### Transfer
```typescript
{
  id: "0xabc123...def-index-5",
  amount: 1000000000n,           // BigInt
  from: "0xuser...",
  to: "0xcontract...",
  chain: "ethereum-1"
}
```

### CumulativeVolumeUSD
```typescript
{
  id: "Transfer.USDC.ethereum-1",
  volumeUSD: "1234567.890000000000000000",
  lastUpdatedAt: 1704067200n
}
```

### DailyVolumeUSD
```typescript
{
  id: "Contract.0x123...abc.polygon-137.2024-01-15",
  last24HoursVolumeUSD: "45678.900000000000000000",
  lastUpdatedAt: 1704067200n,
  createdAt: Date
}
```

## Performance Characteristics

- **Deduplication**: O(1) - indexed database lookup
- **Address Matching**: O(n*m) - transfers × extracted addresses
- **ABI Decoding**: ~5-10ms per transaction
- **Price Lookup**: Cached, ~1ms typical
- **Volume Update**: Two parallel DB writes (cumulative + daily)

## Future Enhancements

1. **Historical Price Accuracy**: Use block timestamp for price lookups
2. **Trading Pair Volumes**: Track specific token pair flows (USDC/ETH)
3. **Relayer Attribution**: Link volumes to specific relayers for rewards
4. **Cross-Chain Aggregation**: Protocol-wide metrics across all chains
5. **Real-Time Streaming**: WebSocket feeds for live volume updates

## For Developers

**Full Documentation**: See `TRANSFER_VOLUME_INDEXING_METHODOLOGY.md` for:
- Detailed event handler implementations
- Complete code examples and walkthroughs
- Architecture deep-dive

**Quick Start**:
1. Read this summary for overall understanding
2. Review event type table for your specific use case
3. Check code snippets in Quick Reference section
4. Consult full methodology for implementation details

## Summary

The transfer volume indexing system provides accurate, granular tracking of all token movements through Hyperbridge by:
- Detecting ERC20 transfers in cross-chain transactions
- Converting amounts to USD using reliable price feeds
- Attributing volumes to specific tokens and contracts
- Aggregating data across multiple time windows
- Handling edge cases with robust error recovery

This enables data-driven decision making, comprehensive protocol analytics, and powerful user-facing dashboards showing the real financial activity of the Hyperbridge ecosystem.

---

**Quick Links**:
- [Full Methodology Documentation](./TRANSFER_VOLUME_INDEXING_METHODOLOGY.md)
- Event Handlers: `src/handlers/events/evmHost/`
- Services: `src/services/`
- Types: `src/types/ismp.ts`

**Last Updated**: 2024
**Status**: Production Ready
