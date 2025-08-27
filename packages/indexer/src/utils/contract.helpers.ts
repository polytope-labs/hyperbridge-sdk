import fetch from "node-fetch"

import { ENV_CONFIG } from "@/constants"
import { replaceWebsocketWithHttp } from "./rpc.helpers"

export interface ContractInfo {
  address: string
  isContract: boolean
  bytecode: string
  cachedAt: number
}

// RPC function type for dependency injection in tests
export type RpcCallFunction = (address: string, chain: string) => Promise<string>

/**
 * Pure function to determine if bytecode represents a contract
 * @param bytecode - The bytecode string to analyze
 * @returns boolean indicating if the bytecode represents a contract
 */
export function determineIfContract(bytecode: string): boolean {
  // Validate input
  if (typeof bytecode !== "string") {
    throw new Error("Invalid bytecode format: must be string")
  }

  // Normalize bytecode - remove 0x prefix if present
  const normalizedBytecode = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode

  // Empty bytecode means EOA (Externally Owned Account)
  if (normalizedBytecode === "" || normalizedBytecode === "0") {
    return false
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]*$/.test(normalizedBytecode)) {
    throw new Error("Invalid bytecode format: not valid hex")
  }

  // Validate even length (each byte is 2 hex chars)
  if (normalizedBytecode.length % 2 !== 0) {
    throw new Error("Invalid bytecode format: odd length hex string")
  }

  // Any non-empty valid bytecode indicates a contract
  return true
}

/**
 * Validates Ethereum address format
 * @param address - Address to validate
 * @returns normalized address or throws error
 */
export function validateAddress(address: string): string {
  if (typeof address !== "string" || address === "") {
    throw new Error("Invalid address format: address must be non-empty string")
  }

  // Remove 0x prefix for validation
  const cleanAddress = address.startsWith("0x") ? address.slice(2) : address

  // Ethereum addresses are 40 hex characters (20 bytes)
  if (cleanAddress.length !== 40) {
    throw new Error("Invalid address format: must be 40 hex characters")
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]{40}$/.test(cleanAddress)) {
    throw new Error("Invalid address format: not valid hex")
  }

  // Return normalized address (lowercase with 0x prefix)
  return `0x${cleanAddress.toLowerCase()}`
}

/**
 * Makes RPC call to get bytecode for an address
 * @param address - The address to check
 * @param chain - The chain identifier
 * @returns Promise resolving to bytecode string
 */
export async function fetchBytecodeViaRpc(address: string, chain: string): Promise<string> {
  const rpcUrl = replaceWebsocketWithHttp(ENV_CONFIG[chain] || "")
  if (!rpcUrl) {
    throw new Error(`No RPC URL found for chain: ${chain}`)
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_getCode",
      params: [address, "latest"],
    }),
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const result = await response.json() as {
    jsonrpc: "2.0"
    id: number
    result?: string
    error?: { message: string; code: number }
  }

  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`)
  }

  if (typeof result.result !== "string") {
    throw new Error(`Unexpected RPC response: ${JSON.stringify(result)}`)
  }

  return result.result
}

/**
 * Get contract information for an address
 * @param address - The address to check
 * @param chain - The chain identifier
 * @param rpcCall - Optional RPC function (for testing)
 * @returns Promise resolving to contract information or Error
 */
export async function getContractInfo(
  address: string,
  chain: string,
  rpcCall: RpcCallFunction = fetchBytecodeViaRpc
): Promise<ContractInfo | Error> {
  try {
    // Validate inputs
    if (!chain || typeof chain !== "string") {
      return new Error("Chain identifier is required")
    }

    const normalizedAddress = validateAddress(address)

    // Fetch bytecode using provided RPC function
    const bytecode = await rpcCall(normalizedAddress, chain)

    // Determine if it's a contract
    const isContract = determineIfContract(bytecode)

    const contractInfo: ContractInfo = {
      address: normalizedAddress,
      isContract,
      bytecode,
      cachedAt: Date.now()
    }

    return contractInfo
  } catch (error) {
    return new Error(`Failed to fetch contract info: ${(error as Error).message}`)
  }
}

/**
 * Simple helper to check if address is a contract
 * @param address - Address to check
 * @param chain - Chain identifier
 * @returns Promise resolving to boolean
 */
export async function isContract(address: string, chain: string): Promise<boolean> {
  const result = await getContractInfo(address, chain)
  return result instanceof Error ? false : result.isContract
}

/**
 * Batch contract detection for multiple addresses
 * @param addresses - Array of addresses to check
 * @param chain - Chain identifier
 * @returns Promise resolving to array of contract info or Error
 */
export async function batchGetContractInfo(
  addresses: string[],
  chain: string
): Promise<ContractInfo[] | Error> {
  try {
    const results = await Promise.allSettled(
      addresses.map(address => getContractInfo(address, chain))
    )

    const contractInfos: ContractInfo[] = []
    const errors: string[] = []

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && !(result.value instanceof Error)) {
        contractInfos.push(result.value)
      } else if (result.status === "fulfilled" && result.value instanceof Error) {
        errors.push(`Address ${addresses[index]}: ${result.value.message}`)
      } else if (result.status === "rejected") {
        errors.push(`Address ${addresses[index]}: ${result.reason}`)
      }
    })

    if (errors.length > 0) {
      return new Error(`Failed to process some addresses: ${errors.join(", ")}`)
    }

    return contractInfos
  } catch (error) {
    return new Error(`Batch processing failed: ${(error as Error).message}`)
  }
}
