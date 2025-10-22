# Transfer Volume Indexing - Visual Diagram Reference

This document contains visual diagrams to help understand the transfer volume indexing system architecture and flows.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Event Processing Flow](#event-processing-flow)
3. [Address Detection Flows](#address-detection-flows)
4. [Cross-Chain Message Flows](#cross-chain-message-flows)
5. [Volume Attribution Decision Trees](#volume-attribution-decision-trees)
6. [Data Model Relationships](#data-model-relationships)
7. [Error Handling Flows](#error-handling-flows)

---

## System Architecture

### High-Level Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BLOCKCHAIN NETWORKS                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │  Ethereum  │  │  Polygon   │  │    Base    │  │  Optimism  │  ...     │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘          │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          │     Events     │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SUBQL INDEXER                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     EVENT HANDLER LAYER                               │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │ │
│  │  │ PostRequest  │  │ GetRequest   │  │PostResponse  │               │ │
│  │  │   Handler    │  │   Handler    │  │   Handler    │               │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │ │
│  │         │                  │                  │                        │ │
│  │  ┌──────┴──────────────────┴──────────────────┴───────┐               │ │
│  │  │                                                      │               │ │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │               │ │
│  │  │  │*Handled      │  │*Timeout      │  │  Other   │ │               │ │
│  │  │  │  Handlers    │  │  Handlers    │  │ Handlers │ │               │ │
│  │  │  └──────┬───────┘  └──────┬───────┘  └─────┬────┘ │               │ │
│  │  └─────────┼──────────────────┼─────────────────┼──────┘               │ │
│  └────────────┼──────────────────┼─────────────────┼──────────────────────┘ │
│               │                  │                 │                        │
│               ▼                  ▼                 ▼                        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                      SERVICE LAYER                                    │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │ │
│  │  │  Transfer    │  │   Volume     │  │ TokenPrice   │               │ │
│  │  │  Service     │  │   Service    │  │   Service    │               │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │ │
│  │         │                  │                  │                        │ │
│  └─────────┼──────────────────┼──────────────────┼────────────────────────┘ │
│            │                  │                  │                          │
│  ┌─────────┼──────────────────┼──────────────────┼────────────────────────┐ │
│  │         │        UTILITY LAYER                │                        │ │
│  │  ┌──────▼───────┐  ┌──────────────┐  ┌───────▼────────┐              │ │
│  │  │   Transfer   │  │     Price    │  │      ABI       │              │ │
│  │  │   Helpers    │  │   Helpers    │  │   Interface    │              │ │
│  │  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘              │ │
│  └─────────┼──────────────────┼──────────────────┼────────────────────────┘ │
└────────────┼──────────────────┼──────────────────┼──────────────────────────┘
             │                  │                  │
             ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE (PostgreSQL)                             │
│  ┌────────────┐  ┌──────────────────┐  ┌──────────────────┐               │
│  │  Transfer  │  │ CumulativeVolume │  │  DailyVolumeUSD  │               │
│  │   Table    │  │   USD Table      │  │      Table       │               │
│  └────────────┘  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service Interaction Flow

```
┌──────────────┐
│ Event Handler│
└──────┬───────┘
       │
       │ 1. Iterate transaction logs
       ▼
┌────────────────────────┐
│  isERC20TransferEvent  │
│  (Transfer Helper)     │
└───────┬────────────────┘
        │
        │ 2. If ERC20 Transfer detected
        ▼
┌────────────────────────┐
│  Transfer.get(id)      │ ──────No────┐
│  (Dedup Check)         │             │
└───────┬────────────────┘             │
        │                              │
        │ 3. If already exists         │ 4. Process new transfer
        │                              │
        ▼                              ▼
    [Skip]                  ┌─────────────────────┐
                            │ extractAddressFrom  │
                            │ Topic (Helper)      │
                            └──────────┬──────────┘
                                       │
                            5. Extract from/to addresses
                                       ▼
                            ┌─────────────────────┐
                            │ TransferService     │
                            │ .storeTransfer()    │
                            └──────────┬──────────┘
                                       │
                            6. Save transfer record
                                       ▼
                            ┌─────────────────────┐
                            │ getPriceDataFrom    │
                            │ EthereumLog()       │
                            └──────────┬──────────┘
                                       │
                            7. Get token info + USD price
                                       ▼
                            ┌─────────────────────┐
                            │ VolumeService       │
                            │ .updateVolume()     │
                            └──────────┬──────────┘
                                       │
                        8a. Update Token Volume (always)
                                       │
                        8b. Match contract address
                                       │
                        8c. Update Contract Volume (if match)
                                       ▼
                            ┌─────────────────────┐
                            │   Database Write    │
                            └─────────────────────┘
```

---

## Event Processing Flow

### Source Event Processing (PostRequest, GetRequest, PostResponse)

```
┌────────────────────────────────────────────────────────────────┐
│                    EVENT EMITTED ON SOURCE CHAIN                │
│  Example: PostRequest(from, to, nonce, body, ...)              │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ Extract Event Metadata │
              │ - blockNumber          │
              │ - transactionHash      │
              │ - timestamp            │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Extract Event Args    │
              │  - from: 0xABC...      │◄────── DIRECT ADDRESS
              │  - to: 0xDEF...        │        SOURCE
              │  - nonce, body, etc.   │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ Iterate Transaction    │
              │ Logs (all logs)        │
              └────────────┬───────────┘
                           │
                           ▼
         ┌─────────────────────────────────┐
         │  For each log:                  │
         │  Is ERC20 Transfer Event?       │
         └────┬───────────────────────┬────┘
              │ Yes                   │ No
              ▼                       ▼
    ┌──────────────────┐         [Skip Log]
    │ Extract Transfer │
    │ - from           │
    │ - to             │
    │ - value          │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ Check if Transfer│
    │ already indexed  │
    └────┬────────┬────┘
         │ New    │ Exists
         ▼        ▼
    [Process]  [Skip]
         │
         ▼
    ┌──────────────────────────┐
    │ Match Transfer Address   │
    │ against Event Arg "from" │
    └────┬────────────────┬────┘
         │ Match          │ No Match
         ▼                ▼
    [Attribute      [Token Volume
     Contract        Only]
     Volume]
```

### Handled Event Processing (*Handled, *Timeout)

```
┌────────────────────────────────────────────────────────────────┐
│              EVENT EMITTED ON DESTINATION CHAIN                │
│  Example: PostRequestHandled(commitment, relayer)              │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ Extract Event Metadata │
              │ - No "from/to" in args │
              │ - Only commitment      │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ Get Transaction Input  │
              │ transaction.input      │
              └────────────┬───────────┘
                           │
                           ▼
         ┌─────────────────────────────────┐
         │  Transaction Input exists?      │
         └────┬────────────────────────┬───┘
              │ Yes                    │ No
              ▼                        ▼
    ┌──────────────────────┐    [Skip Contract
    │ Decode with ABI      │     Attribution,
    │ Interface.parse      │     Track Token
    │ Transaction()        │     Volume Only]
    └────────┬─────────────┘
             │
             ▼
    ┌──────────────────────┐
    │ Extract Function     │
    │ Name & Arguments     │
    └────────┬─────────────┘
             │
             ▼
    ┌───────────────────────────────┐
    │ Match Function Name?          │
    │ - handlePostRequests          │
    │ - handlePostResponses         │
    │ - handleGetResponses          │
    │ - handle*Timeouts             │
    └────┬─────────────────────┬────┘
         │ Match               │ No Match
         ▼                     ▼
    ┌─────────────────┐   [Skip - Unknown
    │ Extract Message │    Function]
    │ from args[1]    │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────────────┐
    │ Iterate Batch Messages  │
    │ (requests/responses/    │
    │  timeouts array)        │
    └────────┬────────────────┘
             │
             ▼
    ┌─────────────────────────┐
    │ Extract Address from    │
    │ Each Message:           │
    │ - request.to            │
    │ - response.post.from    │
    │ - timeout.from          │
    │ etc.                    │
    └────────┬────────────────┘
             │
             ▼
    ┌─────────────────────────┐
    │ Collect All Addresses   │
    │ in Array                │
    │ [0xABC, 0xDEF, ...]     │
    └────────┬────────────────┘
             │
             ▼
    [Continue to Transfer Processing]
             │
             ▼
    ┌─────────────────────────┐
    │ Iterate Transfer Logs   │
    │ (same as source events) │
    └────────┬────────────────┘
             │
             ▼
    ┌─────────────────────────┐
    │ Match Transfer Address  │
    │ against Extracted Array │
    └────┬────────────────┬───┘
         │ Match          │ No Match
         ▼                ▼
    [Attribute      [Token Volume
     Contract        Only]
     Volume]
```

---

## Address Detection Flows

### Source Event Address Detection

```
┌─────────────────────────┐
│   Event Arguments       │
│                         │
│  {                      │
│    from: "0xABC...",    │ ◄───── TARGET ADDRESS
│    to: "0xDEF...",      │
│    nonce: 123,          │
│    body: "0x..."        │
│  }                      │
└──────────┬──────────────┘
           │
           │ Direct access
           ▼
┌──────────────────────────┐
│  const address =         │
│     event.args.from      │
│  // or                   │
│  const address =         │
│     event.args.to        │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  address.toLowerCase()   │
└──────────┬───────────────┘
           │
           ▼
      [READY TO USE]
```

### Handled Event Address Detection (Detailed)

```
┌─────────────────────────────────────────────┐
│         Transaction Object                  │
│  {                                          │
│    input: "0x1234abcd...",  ◄────── Raw Calldata
│    logs: [...],                             │
│    hash: "0x...",                           │
│    blockNumber: 12345                       │
│  }                                          │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Step 1: Create ABI Interface              │
│                                            │
│  const iface = new Interface(              │
│    HandlerV1Abi                            │
│  )                                         │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Step 2: Parse Transaction                 │
│                                            │
│  const { name, args } =                    │
│    iface.parseTransaction({                │
│      data: transaction.input               │
│    })                                      │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Step 3: Extract Function Name             │
│                                            │
│  name = "handlePostRequests"               │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Step 4: Access Message Argument           │
│                                            │
│  const message = args[1]                   │
│  // PostRequestMessage structure           │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Step 5: Navigate Message Structure        │
│                                            │
│  Example for PostRequestMessage:           │
│                                            │
│  message = {                               │
│    proof: {...},                           │
│    requests: [                             │
│      {                                     │
│        request: {                          │
│          from: "0xABC...", ◄─────┐        │
│          to: "0xDEF...",   ◄─────┼─ TARGET│
│          nonce: 156,             │        │
│          body: "0x..."           │        │
│        },                        │        │
│        index: 0,                 │        │
│        kIndex: 0                 │        │
│      }                           │        │
│    ]                             │        │
│  }                               │        │
└──────────────────┬───────────────┴────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Step 6: Iterate & Extract Addresses      │
│                                            │
│  let addresses = []                        │
│  for (const req of message.requests) {     │
│    addresses.push(req.request.to)          │
│  }                                         │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│  Step 7: Normalize Addresses               │
│                                            │
│  addresses = addresses.map(                │
│    addr => addr.toLowerCase()              │
│  )                                         │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
          [READY TO MATCH]
```

---

## Cross-Chain Message Flows

### Complete PostRequest Flow (Source → Destination)

```
ETHEREUM (Source)                        POLYGON (Destination)
─────────────────                        ─────────────────────

User Transaction
     │
     ▼
┌─────────────┐
│ DEX Contract│
│ 0xABC...    │
└──────┬──────┘
       │
       │ User → DEX: 1000 USDC
       │
       ▼
┌──────────────────┐
│ PostRequest      │
│ Event Emitted    │
│                  │
│ from: 0xABC...   │ ◄── Indexer extracts
│ to: 0xDEF...     │     address from args
└────────┬─────────┘
         │
         │ Indexer detects Transfer:
         │ User → 0xABC: 1000 USDC
         │ 
         │ Volume Update:
         │ • Transfer.USDC += $1000
         │ • Contract.0xABC += $1000
         │
         ╠═══════════════════════════╗
         ║   Cross-Chain Message     ║
         ║   Relayer carries proof   ║
         ╚═══════════════════════════╣
                                     ▼
                          ┌─────────────────────┐
                          │ Handler Contract    │
                          │ Receives Message    │
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │ PostRequestHandled  │
                          │ Event Emitted       │
                          │                     │
                          │ commitment: 0x...   │
                          │ (No address in args)│
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │ Indexer decodes     │
                          │ transaction.input:  │
                          │                     │
                          │ handlePostRequests( │
                          │   proof,            │
                          │   {requests: [{     │
                          │     request: {      │
                          │       to: 0xDEF...  │◄── Extract
                          │     }               │    address
                          │   }]}               │
                          │ )                   │
                          └──────────┬──────────┘
                                     │
                          Detects Transfer:
                          Bridge → 0xDEF: 500 MATIC
                          
                          Volume Update:
                          • Transfer.MATIC += $350
                          • Contract.0xDEF += $350
```

### Timeout Flow

```
SOURCE CHAIN                             DESTINATION CHAIN
───────────                              ─────────────────

PostRequest
     │
     │ Sent at T=0
     │ Timeout: T+3600
     ▼
[Waiting for handling...]
     │
     │ T > T+3600
     │ (No handling occurred)
     ▼
┌──────────────────────┐
│ PostRequestTimeout   │
│ Handled Event        │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Decode TX Input:     │
│                      │
│ handlePostRequest    │
│ Timeouts(            │
│   proof,             │
│   {timeouts: [{      │
│     from: 0xABC...,  │ ◄── Original requester
│     to: 0xDEF...,    │
│     nonce: 156       │
│   }]}                │
│ )                    │
└──────────┬───────────┘
           │
           ▼
    Refund Transfer:
    Protocol → 0xABC: 900 USDC
    (90% refund)
    
    Volume Update:
    • Transfer.USDC += $900
    • Contract.0xABC += $900
```

---

## Volume Attribution Decision Trees

### Transfer Volume Attribution Logic

```
                    ┌────────────────────┐
                    │ ERC20 Transfer     │
                    │ Event Detected     │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Already Indexed?   │
                    │ Transfer.get(id)   │
                    └─────┬──────────┬───┘
                          │ No       │ Yes
                          ▼          ▼
                    [Process]    [Skip All]
                          │
                          ▼
            ┌─────────────────────────────┐
            │ Store Transfer Record       │
            │ Get Token Price             │
            │ Calculate USD Value         │
            └─────────────┬───────────────┘
                          │
                          ▼
            ┌─────────────────────────────┐
            │ UPDATE TOKEN VOLUME         │
            │ Transfer.{symbol} += $value │
            │ (ALWAYS HAPPENS)            │
            └─────────────┬───────────────┘
                          │
                          ▼
            ┌─────────────────────────────┐
            │ Contract Addresses          │
            │ Extracted?                  │
            └─────┬──────────────────┬────┘
                  │ Yes              │ No
                  ▼                  ▼
        [Check Match]          [Skip Contract
                               Attribution]
                  │
                  ▼
        ┌─────────────────────┐
        │ Transfer.from or    │
        │ Transfer.to matches │
        │ extracted address?  │
        └─────┬──────────┬────┘
              │ Yes      │ No
              ▼          ▼
    ┌──────────────┐  [Skip]
    │ UPDATE       │
    │ CONTRACT     │
    │ VOLUME       │
    │ Contract.    │
    │ {addr} +=    │
    │ $value       │
    └──────────────┘
```

### Event Type Decision Tree for Address Source

```
                    ┌────────────────────┐
                    │   Event Received   │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │   Event Name?      │
                    └──┬──────────────┬──┘
                       │              │
        ┌──────────────┴─────┐        │
        │                    │        │
        ▼                    ▼        ▼
┌───────────────┐  ┌────────────┐  ┌─────────────┐
│ PostRequest   │  │GetRequest  │  │PostResponse │
│ GetRequest    │  │            │  │             │
│ PostResponse  │  │            │  │             │
└───────┬───────┘  └─────┬──────┘  └──────┬──────┘
        │                │                 │
        │ SOURCE         │                 │
        │ EVENTS         │                 │
        │                │                 │
        ▼                ▼                 ▼
┌────────────────────────────────────────────┐
│  Use Event Arguments                       │
│  - args.from                               │
│  - args.to                                 │
│  No decoding needed                        │
└────────────────────────────────────────────┘


                    ┌────────────────────┐
                    │   Event Name?      │
                    └──┬──────────────┬──┘
                       │              │
        ┌──────────────┴─────────┐   │
        │                        │   │
        ▼                        ▼   ▼
┌─────────────────┐  ┌─────────────────┐
│ *Handled        │  │ *TimeoutHandled │
│ - PostRequest   │  │ - PostRequest   │
│ - PostResponse  │  │ - PostResponse  │
│ - GetRequest    │  │ - GetRequest    │
└────────┬────────┘  └────────┬────────┘
         │                    │
         │ HANDLED            │
         │ EVENTS             │
         │                    │
         ▼                    ▼
┌───────────────────────────────────────────┐
│  Decode Transaction Input                 │
│  1. new Interface(HandlerV1Abi)           │
│  2. parseTransaction(tx.input)            │
│  3. Extract addresses from message        │
│  4. Iterate batch if multiple             │
└───────────────────────────────────────────┘
```

---

## Data Model Relationships

### Entity Relationship Diagram

```
┌──────────────────────────────────────┐
│           Transfer                   │
├──────────────────────────────────────┤
│ id: string (PK)                      │
│ amount: BigInt                       │
│ from: string                         │
│ to: string                           │
│ chain: string                        │
└──────────────┬───────────────────────┘
               │
               │ 1 Transfer generates
               │ 2 Volume records
               │
               ├─────────────────┬─────────────────┐
               │                 │                 │
               ▼                 ▼                 ▼
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ CumulativeVolumeUSD│  │ CumulativeVolumeUSD│  │   DailyVolumeUSD   │
│     (Token)        │  │    (Contract)      │  │      (Token)       │
├────────────────────┤  ├────────────────────┤  ├────────────────────┤
│ id: Transfer.USDC. │  │ id: Contract.0x... │  │ id: Transfer.USDC. │
│     ethereum-1     │  │     ethereum-1     │  │   ethereum-1.      │
│ volumeUSD: string  │  │ volumeUSD: string  │  │   2024-01-15       │
│ lastUpdatedAt:     │  │ lastUpdatedAt:     │  │ last24HoursVol:    │
│   bigint           │  │   bigint           │  │   string           │
└────────────────────┘  └────────────────────┘  │ lastUpdatedAt:     │
                                                 │   bigint           │
                                                 │ createdAt: Date    │
                                                 └────────────────────┘
                                                           │
                                                           │ Also has
                                                           │ Contract
                                                           │ version
                                                           ▼
                                                 ┌────────────────────┐
                                                 │   DailyVolumeUSD   │
                                                 │    (Contract)      │
                                                 ├────────────────────┤
                                                 │ id: Contract.0x... │
                                                 │   ethereum-1.      │
                                                 │   2024-01-15       │
                                                 │ last24HoursVol:    │
                                                 │   string           │
                                                 │ lastUpdatedAt:     │
                
