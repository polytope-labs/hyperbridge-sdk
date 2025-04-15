import { getContract, maxUint256 } from "viem"
import { ADDRESS_ZERO } from "@/utils"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { HexString, Order, PaymentInfo } from "@/types"
import { ChainClientManager } from "./ChainClientManager"
import { ChainConfigService } from "./ChainConfigService"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"

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
}
