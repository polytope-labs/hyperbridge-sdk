import {
  determineIfContract,
  getContractInfo,
  ContractInfo,
  isContract,
  batchGetContractInfo
} from "../contract.helpers"

describe("Contract Detection Utilities", () => {
  describe("determineIfContract", () => {
    it("should identify contract addresses with bytecode", () => {
      // ERC20 contract bytecode example (simplified)
      const contractBytecode = "0x608060405234801561001057600080fd5b506004361061004c57600080fd5b50610001600081905550"

      const result = determineIfContract(contractBytecode)

      expect(result).toBe(true)
    })

    it("should identify EOA addresses with no bytecode", () => {
      const eoa1 = "0x"
      const eoa2 = "0x0"
      const eoa3 = ""

      expect(determineIfContract(eoa1)).toBe(false)
      expect(determineIfContract(eoa2)).toBe(false)
      expect(determineIfContract(eoa3)).toBe(false)
    })

    it("should handle various bytecode formats", () => {
      const validBytecodes = [
        "0x6080604052",
        "0x608060405234801561001057600080fd5b50",
        "0xdeadbeef",
        "608060405234801561001057600080fd5b50" // without 0x prefix
      ]

      validBytecodes.forEach(bytecode => {
        const result = determineIfContract(bytecode)
        expect(result).toBe(true)
      })
    })

    it("should throw error for invalid bytecode format", () => {
      const invalidBytecodes = [
        "invalid-hex",
        "0xghijk",
        "0x123", // odd length
        null as any,
        undefined as any
      ]

      invalidBytecodes.forEach(bytecode => {
        expect(() => determineIfContract(bytecode)).toThrow()
      })
    })
  })

  describe("getContractInfo", () => {
    // Mock RPC responses for testing
    const mockRpcCall = jest.fn()

    beforeEach(() => {
      mockRpcCall.mockClear()
    })

    it("should return contract info for valid contract", async () => {
      const contractBytecode = "0x608060405234801561001057600080fd5b506004361061004c57600080fd5b50"
      mockRpcCall.mockResolvedValueOnce(contractBytecode)

      const result = await getContractInfo("0x1234567890123456789012345678901234567890", "EVM-1", mockRpcCall)

      expect(result).not.toBeInstanceOf(Error)

      const contractInfo = result as ContractInfo
      expect(contractInfo.isContract).toBe(true)
      expect(contractInfo.address).toBe("0x1234567890123456789012345678901234567890")
      expect(contractInfo.bytecode).toBe(contractBytecode)
      expect(typeof contractInfo.cachedAt).toBe("number")

      expect(mockRpcCall).toHaveBeenCalledWith("0x1234567890123456789012345678901234567890", "EVM-1")
    })

    it("should return EOA info for address with no bytecode", async () => {
      mockRpcCall.mockResolvedValueOnce("0x")

      const result = await getContractInfo("0x1111111111111111111111111111111111111111", "EVM-1", mockRpcCall)

      expect(result).not.toBeInstanceOf(Error)

      const contractInfo = result as ContractInfo
      expect(contractInfo.isContract).toBe(false)
      expect(contractInfo.address).toBe("0x1111111111111111111111111111111111111111")
      expect(contractInfo.bytecode).toBe("0x")
    })

    it("should handle RPC errors gracefully", async () => {
      mockRpcCall.mockRejectedValueOnce(new Error("RPC connection failed"))

      const result = await getContractInfo("0x2222222222222222222222222222222222222222", "EVM-1", mockRpcCall)

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain("Failed to fetch contract info")
      expect((result as Error).message).toContain("RPC connection failed")
    })

    it("should validate address format", async () => {
      const invalidAddresses = [
        "0x123", // too short
        "not-an-address",
        "",
        "0xghijk1234567890123456789012345678901234567890", // invalid hex
      ]

      for (const address of invalidAddresses) {
        const result = await getContractInfo(address, "EVM-1", mockRpcCall)
        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toContain("Failed to fetch contract info")
        expect((result as Error).message).toContain("Invalid address format")
      }

      expect(mockRpcCall).not.toHaveBeenCalled()
    })

    it("should validate chain parameter", async () => {
      const result = await getContractInfo("0x1234567890123456789012345678901234567890", "", mockRpcCall)

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toBe("Chain identifier is required")
      expect(mockRpcCall).not.toHaveBeenCalled()
    })

    it("should normalize address case", async () => {
      mockRpcCall.mockResolvedValueOnce("0x6080604052")

      const upperCaseAddress = "0X1234567890123456789012345678901234567890"
      const result = await getContractInfo(upperCaseAddress, "EVM-1", mockRpcCall)

      expect(result).not.toBeInstanceOf(Error)
      const contractInfo = result as ContractInfo
      expect(contractInfo.address).toBe("0x1234567890123456789012345678901234567890")
    })
  })

  describe("isContract helper", () => {
    it("should return true for contract addresses", async () => {
      // Mock the RPC call by providing a mock implementation
      const originalFetch = global.fetch
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: "2.0",
          id: 1,
          result: "0x608060405234801561001057600080fd5b506004361061004c57600080fd5b50"
        })
      }) as jest.Mock

      const result = await isContract("0x1234567890123456789012345678901234567890", "EVM-1")
      
      expect(result).toBe(true)
      
      global.fetch = originalFetch
    })

    it("should return false for EOA addresses", async () => {
      const originalFetch = global.fetch
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: "2.0",
          id: 1,
          result: "0x"
        })
      }) as jest.Mock

      const result = await isContract("0x1111111111111111111111111111111111111111", "EVM-1")
      
      expect(result).toBe(false)
      
      global.fetch = originalFetch
    })

    it("should return false on errors", async () => {
      const result = await isContract("invalid-address", "EVM-1")
      expect(result).toBe(false)
    })
  })

  describe("batchGetContractInfo", () => {
    it("should process multiple addresses successfully", async () => {
      const originalFetch = global.fetch
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: "0x608060405234801561001057600080fd5b506004361061004c57600080fd5b50"
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: "0x"
          })
        }) as jest.Mock

      const addresses = [
        "0x1234567890123456789012345678901234567890", // contract
        "0x1111111111111111111111111111111111111111"  // EOA
      ]

      const result = await batchGetContractInfo(addresses, "EVM-1")

      expect(result).not.toBeInstanceOf(Error)
      const contractInfos = result as ContractInfo[]
      expect(contractInfos).toHaveLength(2)
      expect(contractInfos[0].isContract).toBe(true)
      expect(contractInfos[1].isContract).toBe(false)

      global.fetch = originalFetch
    })

    it("should handle partial failures", async () => {
      const addresses = [
        "0x1234567890123456789012345678901234567890",
        "invalid-address"
      ]

      const result = await batchGetContractInfo(addresses, "EVM-1")

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain("Failed to process some addresses")
    })

    it("should handle empty address array", async () => {
      const result = await batchGetContractInfo([], "EVM-1")

      expect(result).not.toBeInstanceOf(Error)
      const contractInfos = result as ContractInfo[]
      expect(contractInfos).toHaveLength(0)
    })
  })

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty string addresses", async () => {
      const mockRpcCall = jest.fn()
      const result = await getContractInfo("", "EVM-1", mockRpcCall)

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain("Invalid address format")
    })

    it("should handle null/undefined inputs gracefully", async () => {
      const mockRpcCall = jest.fn()

      const result1 = await getContractInfo(null as any, "EVM-1", mockRpcCall)
      const result2 = await getContractInfo("0x1234567890123456789012345678901234567890", null as any, mockRpcCall)

      expect(result1).toBeInstanceOf(Error)
      expect(result2).toBeInstanceOf(Error)
    })

    it("should handle bytecode validation errors", () => {
      expect(() => determineIfContract(null as any)).toThrow("Invalid bytecode format: must be string")
      expect(() => determineIfContract("invalid-hex")).toThrow("Invalid bytecode format: not valid hex")
      expect(() => determineIfContract("0x123")).toThrow("Invalid bytecode format: odd length hex string")
    })

    it("should handle RPC response errors", async () => {
      const originalFetch = global.fetch
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: "2.0",
          id: 1,
          error: { message: "Invalid request", code: -32602 }
        })
      }) as jest.Mock

      const result = await isContract("0x1234567890123456789012345678901234567890", "EVM-1")
      
      expect(result).toBe(false)
      
      global.fetch = originalFetch
    })

    it("should handle HTTP errors", async () => {
      const originalFetch = global.fetch
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500
      }) as jest.Mock

      const result = await isContract("0x1234567890123456789012345678901234567890", "EVM-1")
      
      expect(result).toBe(false)
      
      global.fetch = originalFetch
    })
  })
})