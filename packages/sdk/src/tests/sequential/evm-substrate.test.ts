import type { HexString } from "@/types"
import EVM_HOST from "@/abis/evmHost"
import PING_MODULE from "@/abis/pingModule"
import ERC6160 from "@/abis/erc6160"
import HANDLER from "@/abis/handler"
import TOKEN_GATEWAY from "@/abis/tokenGateway"
import Keyring, { decodeAddress } from "@polkadot/keyring"
import { u8aToHex } from "@polkadot/util"
import {
	createPublicClient,
	createWalletClient,
	getContract,
	http,
	keccak256,
	parseUnits,
	PrivateKeyAccount,
	toHex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bscTestnet } from "viem/chains"
import { DEFAULT_LOGGER } from "@/utils"

test("BNC token from BSC to Bifrost", async () => {
	// get token data
	const token = TestToken

	// setup account
	// setup EVM account
	const sender_account = privateKeyToAccount(process.env.PRIVATE_KEY as HexString)
	const recipient_account = getSubstrateAccount()

	const helper = await createHelpers({
		account: sender_account,
		rpc_url: process.env.BSC_CHAPEL,
	})

	// make transfer
	const output = await Array.fromAsync(
		initiateEvmTx({
			source: BscTestnet,
			destination: BifrostTestnet,
			from: sender_account.address,
			recipient: encodePolkaAddress(recipient_account.address) as HexString,
			token: token,
			amount: 0.5,
			timeout: 0,
			relayerFee: 0,
			account: sender_account,
			helper: helper,
		}),
	)

	console.log(output)
	// initialize indexer client
	// observe transaction until finish
})

function getSubstrateAccount() {
	const keyring = new Keyring({ type: "sr25519" })
	const bob = keyring.addFromUri(process.env.SECRET_PHRASE as string)

	return bob
}

function encodePolkaAddress(polkaAddress?: string): string {
	const keyring = new Keyring()

	return polkaAddress ? keyring.encodeAddress(polkaAddress, 0) : ""
}

const BscTestnet = {
	name: "BSC Testnet",
	chainId: 97,
	stateMachineId: "EVM-97",
	networkType: "testnet",
	rpcUrls: ["https://bsc-geth-testnet-rpc.blockops.network"],
	estimatedTransferTime: "10 minutes",
	consensus: { layer: "BNB Testnet", stateId: "BSC0" },
	ismpHost: "0x8Aa0Dea6D675d785A882967Bf38183f6117C09b7",
	transaction: {
		url: "https://testnet.bscscan.com/tx/[txHash]",
	},
}

const BifrostTestnet = {
	name: "Bifrost Paseo",
	networkType: "testnet",
	chainId: "KUSAMA-2030",
	consensus: {
		layer: "Paseo",
		stateId: "PAS0",
	},
	rpcUrls: ["wss://bifrost-rpc.paseo.liebi.com/ws"],
	estimatedTransferTime: "10 minute",
	transaction: {
		url: "/[txHash]",
	},
}

const TestToken = {
	name: "Cere",
	symbol: "CERE",
	address: "0xf310641B4B6c032D0c88d72d712C020fCa9805A3",
	decimals: 18,
}

type BridgeParams = {
	readonly source: typeof BscTestnet
	readonly from: HexString
	readonly destination: typeof BifrostTestnet
	readonly token: typeof TestToken
	readonly amount: number
	readonly timeout: number
	readonly relayerFee: number
	readonly recipient: HexString
	readonly account: PrivateKeyAccount
	readonly helper: Awaited<ReturnType<typeof createHelpers>>
}

const readAssetId = (token_symbol: string) => {
	const encoder = new TextEncoder()
	return keccak256(encoder.encode(token_symbol))
}

async function* initiateEvmTx(params: BridgeParams) {
	const { account, helper } = params
	const to: HexString = u8aToHex(decodeAddress(params.recipient, false))

	const evm_token = params.token
	const assetId = readAssetId(evm_token.symbol)

	if (!assetId) {
		throw new Error(`Invalid assetId for token ${params.token.name}`)
	}

	const nativeCost = 0n

	const transfer_params = {
		amount: parseUnits(String(params.amount), params.token.decimals),
		assetId: assetId,
		data: "0x",
		dest: toHex(params.destination.chainId),
		nativeCost,
		redeem: false,
		relayerFee: parseUnits(
			String(params.relayerFee),
			18, // todo: Fetch FeeToken decimal
		),
		timeout: BigInt(params.timeout),
		to,
	} as const

	DEFAULT_LOGGER.debug("Initializing EVM transaction with params", {
		token: params.token,
		params: transfer_params,
	})

	const hash = await helper.tokenGateway.write.teleport([transfer_params], {
		// chain: bscTestnet,
		value: nativeCost,
		account,
	})

	// add to store
	yield {
		kind: "Ready",
		transaction_hash: hash,
		meta: [
			{
				type: "resumption_params",
				network: "evm",
				transaction_hash: hash,
			},
		],
	}
}

async function createHelpers(params: { account: PrivateKeyAccount; rpc_url: string }) {
	const { account, rpc_url: rpc } = params

	const walletClient = createWalletClient({
		chain: bscTestnet,
		account,
		transport: http(rpc),
	})

	const publicClient = createPublicClient({
		chain: bscTestnet,
		transport: http(process.env.BSC_CHAPEL),
	})

	const sharedClient = { public: publicClient, wallet: walletClient }

	const ping = getContract({
		address: process.env.PING_MODULE_ADDRESS as HexString,
		abi: PING_MODULE.ABI,
		client: sharedClient,
	})

	const hostAddress = await ping.read.host()

	const host = getContract({
		address: hostAddress,
		abi: EVM_HOST.ABI,
		client: publicClient,
	})

	const hostParams = await host.read.hostParams()

	const handler = getContract({
		address: hostParams.handler,
		abi: HANDLER.ABI,
		client: sharedClient,
	})

	const feeToken = getContract({
		address: hostParams.feeToken,
		abi: ERC6160.ABI,
		client: sharedClient,
	})

	const tokenGateway = getContract({
		abi: TOKEN_GATEWAY.ABI,
		address: tokenGatewayAddress,
		client: sharedClient,
	})

	return { publicClient, tokenGateway, walletClient: walletClient, host, ping, handler, feeToken: feeToken }
}

const tokenGatewayAddress = process.env.TOKEN_GATEWAY_ADDRESS as HexString
