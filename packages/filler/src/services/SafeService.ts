import SafeApiKit from "@safe-global/api-kit"
import Safe from "@safe-global/protocol-kit"
import { MetaTransactionData, OperationType } from "@safe-global/types-kit"
import { HexString } from "hyperbridge-sdk"

export class SafeService {
	private safe!: Safe
	private apiKit: SafeApiKit
	private safeAddress: HexString

	constructor(safeAddress: HexString, chainId: bigint, provider: string, signer: HexString) {
		this.safeAddress = safeAddress
		this.apiKit = new SafeApiKit({ chainId })
		this.initializeSafe(provider, signer)
	}

	private async initializeSafe(provider: string, signer: HexString) {
		this.safe = await Safe.init({
			provider,
			signer,
			safeAddress: this.safeAddress,
		})
	}

	async createAndProposeTransaction(to: HexString, data: HexString, value: bigint): Promise<string> {
		const safeTransactionData: MetaTransactionData = {
			to,
			value: value.toString(),
			data,
			operation: OperationType.Call,
		}

		const safeTransaction = await this.safe.createTransaction({
			transactions: [safeTransactionData],
		})

		const safeTxHash = await this.safe.getTransactionHash(safeTransaction)
		const senderSignature = await this.safe.signHash(safeTxHash)

		await this.apiKit.proposeTransaction({
			safeAddress: this.safeAddress,
			safeTransactionData: safeTransaction.data,
			safeTxHash,
			senderAddress: await this.safe.getAddress(),
			senderSignature: senderSignature.data,
		})

		return safeTxHash
	}

	async getPendingTransactions() {
		return (await this.apiKit.getPendingTransactions(this.safeAddress)).results
	}

	async confirmTransaction(safeTxHash: string, signature: string) {
		return this.apiKit.confirmTransaction(safeTxHash, signature)
	}

	async executeTransaction(safeTxHash: string) {
		const safeTransaction = await this.apiKit.getTransaction(safeTxHash)
		return this.safe.executeTransaction(safeTransaction)
	}
}
