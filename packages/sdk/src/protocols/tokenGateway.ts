import type { Address } from "viem"
import { toHex, encodeAbiParameters, parseAbiParameters } from "viem"
import { EvmChain } from "@/chains/evm"
import TokenGatewayABI from "@/abis/tokenGateway"
import type { HexString, DispatchPost, IPostRequest } from "@/types"

/**
 * Parameters for token gateway teleport operations
 */
export interface TeleportParams {
	/** Amount to be sent */
	amount: bigint
	/** The token identifier to send */
	assetId: HexString
	/** Redeem ERC20 on the destination? */
	redeem: boolean
	/** Recipient address */
	to: HexString
	/** Recipient state machine */
	dest: string | Uint8Array
	/** Request timeout in seconds */
	timeout: bigint
	/** Destination contract call data */
	data?: HexString | Uint8Array
}

/**
 * TokenGateway class for managing cross-chain token transfers via Hyperbridge
 *
 * This class provides methods to interact with the TokenGateway contract, including
 * estimating fees for cross-chain token teleports.
 *
 * @example
 * ```typescript
 * const tokenGateway = new TokenGateway({
 *   source: sourceChain,
 *   dest: destChain
 * })
 *
 * const teleportParams: TeleportParams = {
 *   amount: parseEther("1.0"),
 *   assetId: keccak256(toHex("USDC")),
 *   redeem: true,
 *   to: pad("0xRecipientAddress", { size: 32 }),
 *   dest: "EVM-1",
 *   timeout: 3600n,
 * }
 *
 * // Estimate native cost (relayer fee + protocol fee)
 * const nativeCost = await tokenGateway.quoteNative(teleportParams)
 * console.log(`Estimated native cost: ${formatEther(nativeCost)} ETH`)
 * ```
 */
export class TokenGateway {
	private readonly source: EvmChain
	private readonly dest: EvmChain

	constructor(params: {
		source: EvmChain
		dest: EvmChain
	}) {
		this.source = params.source
		this.dest = params.dest
	}

	/**
	 * Get the TokenGateway contract address for a given chain
	 *
	 * @param chain - The chain identifier (e.g., "EVM-1", "EVM-56")
	 * @returns The TokenGateway contract address
	 */
	private getTokenGatewayAddress(chain: string | Uint8Array): Address {
		const chainStr = typeof chain === "string" ? chain : new TextDecoder().decode(chain)
		return this.source.configService.getTokenGatewayAddress(chainStr)
	}

	/**
	 * Estimate the native token cost for a token gateway teleport operation.
	 * This includes both relayer fees and protocol fees for cross-chain delivery.
	 *
	 * The relayer fee is automatically estimated for EVM destination chains by:
	 * 1. Creating a dummy post request with 191 bytes of random data in the body
	 * 2. Estimating gas for delivery on the destination chain
	 * 3. Converting the gas estimate to native tokens as the relayer fee
	 * 
	 * For non-EVM destination chains, the relayer fee is set to zero.
	 *
	 * The function then constructs a proper post request and calls quoteNative on the 
	 * source chain to get protocol fees, and returns the sum of relayer fee + protocol fee.
	 *
	 * @param params - The teleport parameters
	 * @returns The estimated native cost in wei (relayer fee + protocol fee)
	 *
	 * @throws Will throw an error if the contract call fails
	 *
	 * @example
	 * ```typescript
	 * const params: TeleportParams = {
	 *   amount: parseEther("1.0"),
	 *   assetId: keccak256(toHex("USDC")),
	 *   redeem: true,
	 *   to: pad("0xRecipientAddress", { size: 32 }),
	 *   dest: "EVM-1",
	 *   timeout: 3600n,
	 *   data: "0x"
	 * }
	 *
	 * const nativeCost = await tokenGateway.quoteNative(params)
	 * console.log(`Estimated native cost: ${formatEther(nativeCost)} ETH`)
	 * ```
	 */
	async quoteNative(params: TeleportParams): Promise<bigint> {
		// Convert dest to hex if it's Uint8Array
		const destHex = typeof params.dest === "string" ? toHex(params.dest) : toHex(params.dest)

		// Convert data to hex if it's Uint8Array, default to empty bytes
		const dataHex = params.data
			? typeof params.data === "string"
				? params.data
				: toHex(params.data)
			: "0x"

		// Get the TokenGateway addresses
		const sourceTokenGatewayAddress = this.getTokenGatewayAddress(this.source.config.stateMachineId)
		const destTokenGatewayAddress = this.getTokenGatewayAddress(params.dest)

		let relayerFee = 0n

		// Only estimate relayer fee if destination is an EVM chain
		const destChainId = typeof params.dest === "string" ? params.dest : new TextDecoder().decode(params.dest)
		const isEvmDest = destChainId.startsWith("EVM-")

		if (isEvmDest) {
			// Create a dummy post request with 191 bytes of random data
			// Generate 191 random bytes as hex string (191 * 2 hex chars + 0x prefix)
			const randomHex = "0x" + Array.from({ length: 191 * 2 }, () => 
				Math.floor(Math.random() * 16).toString(16)
			).join("")
			const randomBody = randomHex as HexString

			const dummyPostRequest: IPostRequest = {
				source: this.source.config.stateMachineId,
				dest: destChainId,
				from: sourceTokenGatewayAddress,
				to: destTokenGatewayAddress,
				nonce: 0n,
				body: randomBody,
				timeoutTimestamp: params.timeout,
			}

			// Estimate gas on destination chain
			const { gas } = await this.dest.estimateGas(dummyPostRequest)

			// Get current gas price on destination chain
			const gasPrice = await this.dest.client.getGasPrice()

			// Calculate gas cost in native tokens (gas * gasPrice)
			const gasCostInNative = gas * gasPrice

			// This is the relayer fee
			relayerFee = gasCostInNative
		}

		// Now encode the actual teleport body with the calculated relayer fee
		const teleportBody = encodeAbiParameters(
			parseAbiParameters("uint256, uint256, bytes32, bool, bytes32, bytes"),
			[
				params.amount,
				relayerFee, // Use the calculated relayer fee (0 for non-EVM destinations)
				params.assetId,
				params.redeem,
				params.to,
				dataHex as `0x${string}`,
			],
		)

		// Create the actual post request for protocol fee estimation
		const postRequest: IPostRequest = {
			source: this.source.config.stateMachineId,
			dest: destChainId,
			from: sourceTokenGatewayAddress,
			to: destTokenGatewayAddress,
			nonce: 0n,
			body: teleportBody,
			timeoutTimestamp: params.timeout,
		}

		// Get protocol fee from source chain by calling quoteNative
		// This returns the cost in native tokens for dispatching the request
		const protocolFeeInNative = await this.source.quoteNative(postRequest, relayerFee)

		// Return total native cost (relayer fee is already included in quoteNative calculation)
		return protocolFeeInNative
	}

	/**
	 * Get the ERC20 address for a given asset ID
	 *
	 * This method queries the TokenGateway contract to retrieve the ERC20 token address
	 * associated with a specific asset ID. This is useful for interacting with custodied tokens.
	 *
	 * @param assetId - The asset identifier (32-byte hash)
	 * @returns The ERC20 contract address, or zero address if not found
	 *
	 * @example
	 * ```typescript
	 * const assetId = keccak256(toHex("USDC"))
	 * const erc20Address = await tokenGateway.getErc20Address(assetId)
	 * console.log(`ERC20 address: ${erc20Address}`)
	 * ```
	 */
	async getErc20Address(assetId: HexString): Promise<Address> {
		const tokenGatewayAddress = this.getTokenGatewayAddress(this.source.config.stateMachineId)

		const erc20Address = await this.source.client.readContract({
			address: tokenGatewayAddress,
			abi: TokenGatewayABI.ABI,
			functionName: "erc20",
			args: [assetId],
		})

		return erc20Address as Address
	}

	/**
	 * Get the ERC6160 (hyper-fungible) address for a given asset ID
	 *
	 * This method queries the TokenGateway contract to retrieve the ERC6160 token address
	 * associated with a specific asset ID. ERC6160 tokens use burn-and-mint mechanisms
	 * for cross-chain transfers.
	 *
	 * @param assetId - The asset identifier (32-byte hash)
	 * @returns The ERC6160 contract address, or zero address if not found
	 *
	 * @example
	 * ```typescript
	 * const assetId = keccak256(toHex("hUSDC"))
	 * const erc6160Address = await tokenGateway.getErc6160Address(assetId)
	 * console.log(`ERC6160 address: ${erc6160Address}`)
	 * ```
	 */
	async getErc6160Address(assetId: HexString): Promise<Address> {
		const tokenGatewayAddress = this.getTokenGatewayAddress(this.source.config.stateMachineId)

		const erc6160Address = await this.source.client.readContract({
			address: tokenGatewayAddress,
			abi: TokenGatewayABI.ABI,
			functionName: "erc6160",
			args: [assetId],
		})

		return erc6160Address as Address
	}

	/**
	 * Get the TokenGateway instance address for a destination chain
	 *
	 * This method queries the source TokenGateway contract to find the corresponding
	 * TokenGateway contract address on the destination chain. This is used for
	 * constructing cross-chain messages.
	 *
	 * @param destination - The destination chain identifier (e.g., "EVM-1", "EVM-56")
	 * @returns The TokenGateway contract address on the destination chain
	 *
	 * @example
	 * ```typescript
	 * const destChain = "EVM-1"
	 * const destGatewayAddress = await tokenGateway.getInstanceAddress(destChain)
	 * console.log(`Destination TokenGateway: ${destGatewayAddress}`)
	 * ```
	 */
	async getInstanceAddress(destination: string | Uint8Array): Promise<Address> {
		const tokenGatewayAddress = this.getTokenGatewayAddress(this.source.config.stateMachineId)
		const destHex = typeof destination === "string" ? toHex(destination) : toHex(destination)

		const instanceAddress = await this.source.client.readContract({
			address: tokenGatewayAddress,
			abi: TokenGatewayABI.ABI,
			functionName: "instance",
			args: [destHex],
		})

		return instanceAddress as Address
	}

	/**
	 * Get the TokenGateway contract parameters
	 *
	 * This method retrieves the current configuration parameters of the TokenGateway contract,
	 * including the host and dispatcher addresses.
	 *
	 * @returns The TokenGateway parameters including host and dispatcher addresses
	 *
	 * @example
	 * ```typescript
	 * const params = await tokenGateway.getParams()
	 * console.log(`Host: ${params.host}`)
	 * console.log(`Dispatcher: ${params.dispatcher}`)
	 * ```
	 */
	async getParams(): Promise<{ host: Address; dispatcher: Address }> {
		const tokenGatewayAddress = this.getTokenGatewayAddress(this.source.config.stateMachineId)

		const params = await this.source.client.readContract({
			address: tokenGatewayAddress,
			abi: TokenGatewayABI.ABI,
			functionName: "params",
			args: [],
		})

		return params as { host: Address; dispatcher: Address }
	}
}