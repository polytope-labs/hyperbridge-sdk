import {
	getContract,
	maxUint256,
	PublicClient,
	toHex,
	encodePacked,
	parseEther,
	hexToBytes,
	bytesToHex,
	padHex,
	encodeAbiParameters,
} from "viem"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"
import {
	ADDRESS_ZERO,
	Order,
	PaymentInfo,
	HexString,
	FillOptions,
	DispatchPost,
	RequestKind,
	IPostRequest,
} from "hyperbridge-sdk"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { ChainClientManager } from "./ChainClientManager"
import { ChainConfigService } from "./ChainConfigService"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { HandlerV1_ABI } from "@/config/abis/HandlerV1"
import { generateRootWithProof, orderCommitment, getStateCommitmentFieldSlot } from "hyperbridge-sdk"
import { hexConcat } from "ethers/lib/utils"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { fetchTokenUsdPriceOnchain } from "@/utils"
import { keccakAsU8a } from "@polkadot/util-crypto"

/**
 * Handles contract interactions for tokens and other contracts
 */
export class ContractInteractionService {
	private configService: ChainConfigService
	private api: ApiPromise | null = null

	constructor(
		private clientManager: ChainClientManager,
		private privateKey: HexString,
	) {
		this.configService = new ChainConfigService()
	}

	/**
	 * Converts a bytes32 token address to bytes20 format
	 * This removes the extra padded zeros from the address
	 */
	private bytes32ToBytes20(bytes32Address: string): HexString {
		if (bytes32Address === ADDRESS_ZERO) {
			return ADDRESS_ZERO
		}

		const bytes = hexToBytes(bytes32Address as HexString)
		const addressBytes = bytes.slice(12)
		return bytesToHex(addressBytes) as HexString
	}

	private bytes20ToBytes32(bytes20Address: string): HexString {
		return `0x${bytes20Address.slice(2).padStart(64, "0")}` as HexString
	}

	/**
	 * Gets the balance of a token for a wallet
	 */
	async getTokenBalance(tokenAddress: string, walletAddress: string, chain: string): Promise<bigint> {
		const client = this.clientManager.getPublicClient(chain)

		if (tokenAddress === ADDRESS_ZERO) {
			return await client.getBalance({ address: walletAddress as HexString })
		}

		const tokenContract = getContract({
			address: tokenAddress as HexString,
			abi: ERC20_ABI,
			client,
		})

		const balance = await tokenContract.read.balanceOf([walletAddress as HexString])

		return balance
	}

	/**
	 * Gets the decimals for a token
	 */
	async getTokenDecimals(tokenAddress: string, chain: string): Promise<number> {
		const bytes20Address = this.bytes32ToBytes20(tokenAddress)

		if (bytes20Address === ADDRESS_ZERO) {
			return 18 // Native token (ETH, MATIC, etc.)
		}

		const client = this.clientManager.getPublicClient(chain)

		try {
			const decimals = await client.readContract({
				address: bytes20Address as HexString,
				abi: ERC20_ABI,
				functionName: "decimals",
			})

			return decimals
		} catch (error) {
			console.warn(`Error getting token decimals, defaulting to 18:`, error)
			return 18 // Default to 18 if we can't determine
		}
	}

	/**
	 * Checks if we have sufficient token balances to fill the order
	 */
	async checkTokenBalances(outputs: PaymentInfo[], destChain: string): Promise<boolean> {
		try {
			let totalNativeTokenNeeded = BigInt(0)
			const fillerWalletAddress = privateKeyToAddress(this.privateKey)
			const destClient = this.clientManager.getPublicClient(destChain)

			// Check all token balances
			for (const output of outputs) {
				const tokenAddress = this.bytes32ToBytes20(output.token)
				const amount = output.amount

				if (tokenAddress === ADDRESS_ZERO) {
					// Native token
					totalNativeTokenNeeded = totalNativeTokenNeeded + amount
				} else {
					// ERC20 token
					const balance = await this.getTokenBalance(tokenAddress, fillerWalletAddress, destChain)

					if (balance < amount) {
						console.debug(
							`Insufficient ${tokenAddress} balance. Have ${balance.toString()}, need ${amount.toString()}`,
						)
						return false
					}
				}
			}

			// Check if we have enough native token
			if (totalNativeTokenNeeded > 0n) {
				const nativeBalance = await destClient.getBalance({ address: fillerWalletAddress })

				// Add some buffer for gas
				const withGasBuffer = totalNativeTokenNeeded + BigInt(0.001 * 10 ** 18) // 0.001 ETH buffer for gas

				if (BigInt(nativeBalance.toString()) < withGasBuffer) {
					console.debug(
						`Insufficient native token balance. Have ${nativeBalance.toString()}, need ${withGasBuffer.toString()}`,
					)
					return false
				}
			}

			return true
		} catch (error) {
			console.error(`Error checking token balances:`, error)
			return false
		}
	}

	/**
	 * Approves ERC20 tokens for the contract if needed
	 */
	async approveTokensIfNeeded(order: Order): Promise<void> {
		const uniqueTokens: string[] = []
		const wallet = privateKeyToAccount(this.privateKey)
		const outputs = order.outputs
		const destClient = this.clientManager.getPublicClient(order.destChain)
		const walletClient = this.clientManager.getWalletClient(order.destChain)
		const intentGateway = this.configService.getIntentGatewayAddress(order.destChain)

		// Collect unique ERC20 tokens
		for (const output of outputs) {
			const bytes20Address = this.bytes32ToBytes20(output.token)
			console.log("bytes20Address", bytes20Address)
			if (bytes20Address !== ADDRESS_ZERO) {
				uniqueTokens.push(bytes20Address)
			}
		}

		console.log("uniqueTokens", uniqueTokens)

		// Approve each token
		for (const tokenAddress of [...uniqueTokens, this.configService.getFeeTokenAddress(order.destChain)]) {
			const currentAllowance = await destClient.readContract({
				abi: ERC20_ABI,
				address: tokenAddress as HexString,
				functionName: "allowance",
				args: [wallet.address, intentGateway],
			})

			console.log("currentAllowance", currentAllowance)

			// If allowance is too low, approve a very large amount
			if (currentAllowance < maxUint256) {
				console.log(`Approving ${tokenAddress} for the contract`)

				const { request } = await destClient.simulateContract({
					abi: ERC20_ABI,
					address: tokenAddress as HexString,
					functionName: "approve",
					args: [intentGateway, maxUint256],
					account: wallet,
				})

				const tx = await walletClient.writeContract(request)
				console.log(`Approval confirmed for ${tokenAddress}`)
			}
		}
	}

	/**
	 * Calculates the ETH value to send with the transaction
	 */
	calculateRequiredEthValue(outputs: PaymentInfo[]): bigint {
		let totalEthValue = 0n

		for (const output of outputs) {
			const bytes20Address = this.bytes32ToBytes20(output.token)
			if (bytes20Address === ADDRESS_ZERO) {
				// Native token output
				totalEthValue = totalEthValue + output.amount
			}
		}

		return totalEthValue
	}

	/**
	 * Transforms the order object to match the contract's expected format
	 */
	transformOrderForContract(order: Order) {
		return {
			sourceChain: toHex(order.sourceChain),
			destChain: toHex(order.destChain),
			fees: order.fees,
			callData: order.callData,
			deadline: order.deadline,
			nonce: order.nonce,
			inputs: order.inputs.map((input) => ({
				token: input.token,
				amount: input.amount,
			})),
			outputs: order.outputs.map((output) => ({
				token: output.token,
				amount: output.amount,
				beneficiary: output.beneficiary,
			})),
			user: order.user,
		}
	}

	/**
	 * Transforms the post request object to match the contract's expected format
	 */
	transformPostRequestForContract(postRequest: IPostRequest) {
		return {
			source: toHex(postRequest.source),
			dest: toHex(postRequest.dest),
			nonce: postRequest.nonce,
			from: postRequest.from,
			to: postRequest.to,
			timeoutTimestamp: postRequest.timeoutTimestamp,
			body: postRequest.body,
		}
	}

	/**
	 * Checks if an order is already filled by querying contract storage
	 */
	async checkIfOrderFilled(order: Order): Promise<boolean> {
		try {
			const commitment = orderCommitment(order)
			const sourceClient = this.clientManager.getPublicClient(order.sourceChain)
			const intentGatewayAddress = this.configService.getIntentGatewayAddress(order.sourceChain)

			const filledSlot = await sourceClient.readContract({
				abi: INTENT_GATEWAY_ABI,
				address: intentGatewayAddress,
				functionName: "calculateCommitmentSlotHash",
				args: [commitment as HexString],
			})

			const filledStatus = await sourceClient.getStorageAt({
				address: intentGatewayAddress,
				slot: filledSlot,
			})
			return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
		} catch (error) {
			console.error(`Error checking if order filled:`, error)
			// Default to assuming it's not filled if we can't check
			return false
		}
	}

	/**
	 * Estimates gas for filling an order
	 */
	async estimateGasFillPost(order: Order): Promise<{ fillGas: bigint; postGas: bigint }> {
		console.log("Estimating gas for fill")
		try {
			const destClient = this.clientManager.getPublicClient(order.destChain)
			const postGasEstimate = await this.estimateGasForPost(order)
			const fillOptions: FillOptions = {
				relayerFee: postGasEstimate + (postGasEstimate * BigInt(2)) / BigInt(100),
			}

			const ethValue = this.calculateRequiredEthValue(order.outputs)

			// Approve tokens if needed before estimating gas for failsafe
			await this.approveTokensIfNeeded(order)

			const gas = await destClient.estimateContractGas({
				abi: INTENT_GATEWAY_ABI,
				address: this.configService.getIntentGatewayAddress(order.sourceChain),
				functionName: "fillOrder",
				args: [this.transformOrderForContract(order), fillOptions as any],
				account: privateKeyToAccount(this.privateKey),
				value: ethValue,
			})

			console.log(`Gas estimate for filling order ${order.id} on ${order.destChain} is ${gas}`)
			return { fillGas: gas, postGas: postGasEstimate }
		} catch (error) {
			console.error(`Error estimating gas:`, error)
			// Return a conservative estimate if we can't calculate precisely
			return { fillGas: 500000n, postGas: 100000n }
		}
	}

	/**
	 * Gets the current ETH price in USD
	 */
	async getEthPriceUsd(order: Order, destClient: PublicClient): Promise<bigint> {
		const ethPriceUsd = await fetchTokenUsdPriceOnchain(this.configService.getWethAsset(order.destChain))

		return ethPriceUsd
	}

	/**
	 * Gets the HyperBridge protocol fee in ETH
	 */
	async getProtocolFeeUSD(order: Order, relayerFee: bigint): Promise<bigint> {
		const destClient = this.clientManager.getPublicClient(order.destChain)
		const intentFillerAddr = privateKeyToAddress(this.privateKey)
		const requestBody = this.constructRedeemEscrowRequestBody(order)

		const dispatchPost: DispatchPost = {
			dest: toHex(order.sourceChain),
			to: this.configService.getIntentGatewayAddress(order.sourceChain),
			body: requestBody,
			timeout: 0n,
			fee: relayerFee,
			payer: intentFillerAddr,
		}

		const protocolFeeEth = await destClient.readContract({
			abi: INTENT_GATEWAY_ABI,
			address: this.configService.getIntentGatewayAddress(order.destChain),
			functionName: "quote",
			args: [dispatchPost as any],
		})

		return protocolFeeEth
	}

	/**
	 * Constructs the redeem escrow request body
	 */
	constructRedeemEscrowRequestBody(order: Order): HexString {
		const wallet = this.bytes20ToBytes32(privateKeyToAddress(this.privateKey))
		const commitment = orderCommitment(order)
		const inputs = order.inputs

		// RequestKind.RedeemEscrow is 0 as defined in the contract
		const requestKind = encodePacked(["uint8"], [RequestKind.RedeemEscrow])

		const requestBody = {
			commitment: commitment as HexString,
			beneficiary: wallet,
			tokens: inputs,
		}

		const encodedRequestBody = encodeAbiParameters(
			[
				{
					name: "requestBody",
					type: "tuple",
					components: [
						{ name: "commitment", type: "bytes32" },
						{ name: "beneficiary", type: "bytes32" },
						{
							name: "tokens",
							type: "tuple[]",
							components: [
								{ name: "token", type: "bytes32" },
								{ name: "amount", type: "uint256" },
							],
						},
					],
				},
			],
			[requestBody],
		)

		return hexConcat([requestKind, encodedRequestBody]) as HexString
	}

	/**
	 * Estimates gas for handling POST requests in the source chain
	 */
	async estimateGasForPost(order: Order): Promise<bigint> {
		const { sourceClient, destClient } = this.clientManager.getClientsForOrder(order)
		const postRequest: IPostRequest = {
			source: order.destChain,
			dest: order.sourceChain,
			body: this.constructRedeemEscrowRequestBody(order),
			timeoutTimestamp: 0n,
			nonce: await this.getHostNonce(order.destChain),
			from: this.configService.getIntentGatewayAddress(order.destChain),
			to: this.configService.getIntentGatewayAddress(order.sourceChain),
		}
		const { root, proof, index, kIndex } = generateRootWithProof(postRequest, 100n)
		const latestStateMachineHeight = await this.getHostLatestStateMachineHeight(order.destChain)
		const overlayRootSlot = getStateCommitmentFieldSlot(
			BigInt(this.configService.getChainId(order.destChain)),
			latestStateMachineHeight,
			1, // For overlayRoot
		)
		const params = {
			height: {
				stateMachineId: BigInt(this.configService.getChainId(order.destChain)),
				height: latestStateMachineHeight,
			},
			multiproof: proof,
			leafCount: 100n,
		}

		const gas = 150000n

		// const gas = await sourceClient.estimateContractGas({
		// 	address: this.configService.getHandlerAddress(order.sourceChain),
		// 	abi: HandlerV1_ABI,
		// 	functionName: "handlePostRequests",
		// 	args: [
		// 		this.configService.getHostAddress(order.sourceChain),
		// 		{
		// 			proof: params,
		// 			requests: [
		// 				{
		// 					request: this.transformPostRequestForContract(postRequest),
		// 					index,
		// 					kIndex,
		// 				},
		// 			],
		// 		},
		// 	],
		// 	stateOverride: [
		// 		{
		// 			address: this.configService.getHostAddress(order.sourceChain),
		// 			stateDiff: [
		// 				{
		// 					slot: overlayRootSlot,
		// 					value: root,
		// 				},
		// 			],
		// 		},
		// 	],
		// })
		console.log("Gas estimate for post", gas)

		return gas
	}

	/**
	 * Gets the host nonce
	 */
	async getHostNonce(chain: string): Promise<bigint> {
		const client = this.clientManager.getPublicClient(chain)
		const nonce = await client.readContract({
			abi: EVM_HOST,
			address: this.configService.getHostAddress(chain),
			functionName: "nonce",
		})

		return nonce
	}

	/**
	 * Gets the host latest state machine height
	 */
	async getHostLatestStateMachineHeight(chain: string): Promise<bigint> {
		const wsUrl = "" // Cleanup
		console.log("Connecting to API", wsUrl)
		if (!this.api) {
			this.api = await ApiPromise.create({
				provider: new WsProvider(wsUrl),
				typesBundle: {
					spec: {
						gargantua: {
							hasher: keccakAsU8a,
						},
					},
				},
			})

			await this.api.connect()
		}

		console.log("Connected to API")
		const latestHeight = await this.api.query.ismp.latestStateMachineHeight({
			stateId: { Evm: this.configService.getChainId(chain) },
			consensusStateId: this.configService.getConsensusStateId(chain),
		})
		return BigInt(latestHeight.toString())
	}
}
