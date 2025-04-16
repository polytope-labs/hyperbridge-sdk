import { getContract, maxUint256, PublicClient, toHex, encodePacked, parseEther } from "viem"
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

/**
 * Handles contract interactions for tokens and other contracts
 */
export class ContractInteractionService {
	private configService: ChainConfigService

	constructor(
		private clientManager: ChainClientManager,
		private privateKey: HexString,
	) {
		this.configService = new ChainConfigService()
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

		return await tokenContract.read.balanceOf([walletAddress as HexString])
	}

	/**
	 * Gets the decimals for a token
	 */
	async getTokenDecimals(tokenAddress: string, chain: string): Promise<number> {
		if (tokenAddress === ADDRESS_ZERO) {
			return 18 // Native token (ETH, MATIC, etc.)
		}

		const client = this.clientManager.getPublicClient(chain)

		try {
			const decimals = await client.readContract({
				address: tokenAddress as HexString,
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
				const tokenAddress = output.token
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
		const uniqueTokens = new Set<string>()
		const wallet = privateKeyToAccount(this.privateKey)
		const outputs = order.outputs
		const destClient = this.clientManager.getPublicClient(order.destChain)
		const walletClient = this.clientManager.getWalletClient(order.destChain)
		const intentGateway = this.configService.getIntentGatewayAddress(order.destChain)

		// Collect unique ERC20 tokens
		for (const output of outputs) {
			if (output.token !== "0x0000000000000000000000000000000000000000") {
				uniqueTokens.add(output.token)
			}
		}

		// Approve each token
		for (const tokenAddress of uniqueTokens) {
			const currentAllowance = await destClient.readContract({
				abi: ERC20_ABI,
				address: tokenAddress as HexString,
				functionName: "allowance",
				args: [wallet.address, intentGateway],
			})

			// If allowance is too low, approve a very large amount
			if (currentAllowance < maxUint256) {
				console.log(`Approving ${tokenAddress} for the contract`)

				const request = await destClient.simulateContract({
					abi: ERC20_ABI,
					address: tokenAddress as HexString,
					functionName: "approve",
					args: [intentGateway, maxUint256],
					account: wallet,
				})

				const tx = await walletClient.writeContract(request.request)
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
			if (output.token === "0x0000000000000000000000000000000000000000") {
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
	async estimateGasForFill(order: Order): Promise<bigint> {
		try {
			const destClient = this.clientManager.getPublicClient(order.destChain)
			const postGasEstimate = await this.estimateGasForPost(order)
			const fillOptions: FillOptions = {
				relayerFee: postGasEstimate + (postGasEstimate * BigInt(2)) / BigInt(100),
			}

			const ethValue = this.calculateRequiredEthValue(order.outputs)

			const gas = await destClient.estimateContractGas({
				abi: INTENT_GATEWAY_ABI,
				address: this.configService.getIntentGatewayAddress(order.sourceChain),
				functionName: "fillOrder",
				args: [this.transformOrderForContract(order), fillOptions as any],
				account: privateKeyToAccount(this.privateKey),
				value: ethValue,
			})

			return gas
		} catch (error) {
			console.error(`Error estimating gas:`, error)
			// Return a conservative estimate if we can't calculate precisely
			return BigInt(500000)
		}
	}

	/**
	 * Gets the current ETH price in USD
	 */
	async getEthPriceUsd(order: Order, destClient: PublicClient): Promise<number> {
		const ethPriceUsd = await fetchTokenUsdPriceOnchain(
			this.configService.getWethAsset(order.destChain),
			destClient,
			this.configService.getUniswapV2RouterAddress(order.destChain),
			this.configService.getWethAsset(order.destChain),
			this.configService.getDaiAsset(order.destChain),
		)

		return ethPriceUsd
	}

	/**
	 * Gets the HyperBridge protocol fee in ETH
	 */
	async getProtocolFeeEth(order: Order, relayerFee: bigint): Promise<bigint> {
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
			functionName: "quoteNative",
			args: [dispatchPost as any],
		})

		return protocolFeeEth
	}

	/**
	 * Constructs the redeem escrow request body
	 */
	constructRedeemEscrowRequestBody(order: Order): HexString {
		const wallet = privateKeyToAddress(this.privateKey)
		const commitment = orderCommitment(order)

		// RequestKind.RedeemEscrow is 0 as defined in the contract
		const requestKind = encodePacked(["uint8"], [RequestKind.RedeemEscrow])

		const requestBody = encodePacked(
			["bytes32", "tuple(bytes32 token, uint256 amount)[]", "bytes32"],
			[commitment as HexString, order.inputs, wallet],
		)

		return hexConcat([requestKind, requestBody]) as HexString
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

		const { root, proof } = generateRootWithProof(postRequest)
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

		const gas = await sourceClient.estimateContractGas({
			address: this.configService.getHandlerAddress(order.sourceChain),
			abi: HandlerV1_ABI,
			functionName: "handlePostRequests",
			args: [
				this.configService.getHostAddress(order.sourceChain),
				{
					proof: params,
					requests: [
						{
							request: this.transformPostRequestForContract(postRequest),
							index: 0n,
							kIndex: 0n,
						},
					],
				},
			],
			stateOverride: [
				{
					address: this.configService.getHostAddress(order.sourceChain),
					stateDiff: [
						{
							slot: overlayRootSlot,
							value: root,
						},
					],
				},
			],
		})

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
		const wsProvider = new WsProvider(process.env.HYPERBRIDGE_GARGANTUA!)
		const api = await ApiPromise.create({ provider: wsProvider })
		await api.connect()
		const latestHeight = await api.query.ismp.latestStateMachineHeight({
			stateId: { Evm: this.configService.getChainId(chain) },
			consensusStateId: this.configService.getConsensusStateId(chain),
		})
		await api.disconnect()
		return BigInt(latestHeight.toString())
	}
}
