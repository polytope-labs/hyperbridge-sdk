#!/usr/bin/env node

import { execSync } from "node:child_process"

import fetch from "node-fetch"

import { getEnv, getValidChains } from "../src/configs"

interface MetadataNodes {
	chain: string
	deployments: Record<string, string>
	lastProcessedHeight: number
	startHeight: number
	targetHeight: number
}

interface MetadataResponse {
	data: {
		_metadatas: {
			totalCount: number
			nodes: [MetadataNodes]
		}
	}
}

interface MigrationProcessResponse {
	completed: boolean
	totalCount: number
	ipfsCount: number
}

const currentEnv = getEnv()

const CHAIN_MAPPING = new Map<string, string>(
	Object.entries({
		"Cere Testnet": "cere-local",
		"Hyperbridge (Nexus)": "hyperbridge-nexus",
		"Bifrost Polkadot": "bifrost-mainnet",
		"Cere Mainnet Beta": "cere-mainnet",
		Argon: "argon-mainnet",
		"1": "ethereum-mainnet",
		"42161": "arbitrum-mainnet",
		"10": "optimism-mainnet",
		"8453": "base-mainnet",
		"56": "bsc-mainnet",
		"100": "gnosis-mainnet",
		"1868": "soneium-mainnet",
		"Hyperbridge (Gargantua)": "hyperbridge-gargantua",
		"Bifrost Paseo": "bifrost-paseo",
		"11155111": "sepolia",
		"421614": "arbitrum-sepolia",
		"11155420": "optimism-sepolia",
		"84532": "base-sepolia",
		"97": "bsc-chapel",
		"10200": "gnosis-chiado",
	}),
)

const metadataQuery = `
  query Metadata {
    _metadatas {
      totalCount
      nodes {
        chain
        deployments
        lastProcessedHeight
        startHeight
        targetHeight
      }
    }
  }
`

const stopIndexer = (): void => {
	if (currentEnv === "local") {
		console.debug("Skipping indexer stop in local environment")
		return
	}

	console.debug("Stopping indexer...")

	try {
		execSync(`ENV=${currentEnv} pnpm down`, { stdio: "inherit" })
		console.debug("Indexer stopped")
	} catch (e) {
		console.warn("Failed to stop indexer:", e instanceof Error ? e.message : e)
	}
}

const startIndexer = (): void => {
	if (currentEnv === "local") {
		console.debug("Skipping indexer start in local environment")
		return
	}

	console.debug("Starting indexer...")

	try {
		execSync(`ENV=${currentEnv} pnpm start > indexer_migration_final.log 2>&1 &`, { stdio: "inherit" })
		console.debug("Indexer started")
	} catch (e) {
		console.warn("Failed to start indexer:", e instanceof Error ? e.message : e)
	}
}

const getGraphqlEndpoint = () => {
	switch (currentEnv) {
		case "mainnet":
			return "https://nexus.indexer.polytope.technology"
		case "testnet":
			return "https://gargantua.indexer.polytope.technology"
		default:
			return "http://localhost:3100/graphql"
	}
}

/**
 * query graphql engine
 */
const queryGraphQLEngine = async <R>(query: string): Promise<R> => {
	const endpoint = getGraphqlEndpoint()
	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query }),
		timeout: 5000,
	})

	return (await response.json()) as R
}

/**
 * get available chains
 */
const getAvailableChains = async (): Promise<string[]> => {
	let validChains = getValidChains()

	if (currentEnv === "local") {
		validChains.delete("cere-local")
	}

	const data = await queryGraphQLEngine<MetadataResponse>(metadataQuery)

	let chains: string[] = []
	for (const node of data.data._metadatas.nodes) {
		const chain = CHAIN_MAPPING.get(node.chain)

		if (chain && validChains.has(chain)) {
			chains.push(node.chain)
		}
	}

	return chains
}

/**
 * check migration progress
 */
const checkMigrationProgress = async (supportedChains: string[]): Promise<MigrationProcessResponse> => {
	const data = await queryGraphQLEngine<MetadataResponse>(metadataQuery)

	const metadata = data?.data?._metadatas
	if (!metadata) {
		return { completed: false, totalCount: 0, ipfsCount: 0 }
	}

	const supportedNodes = metadata.nodes.filter((node) => supportedChains.includes(node.chain))
	const totalCount = supportedNodes.length

	let ipfsCount = 0
	let completed = false

	for (const node of supportedNodes) {
		const deploymentKeys = Object.keys(node.deployments)
		if (deploymentKeys.length < 2) {
			console.warn(`Skipping node ${node.chain} as it has no deployments`)
			return { completed: false, totalCount: 0, ipfsCount: 0 }
		}

		const latestBlockNumber = deploymentKeys
			.map((blockNumber) => parseInt(blockNumber))
			.filter((blockNumber) => !isNaN(blockNumber))
			.sort((a, b) => b - a)[0]

		if (node.lastProcessedHeight > latestBlockNumber + 10) {
			ipfsCount += 1
		}
	}

	if (ipfsCount === totalCount && totalCount > 0) {
		completed = true
	}

	return {
		completed,
		totalCount,
		ipfsCount,
	}
}

/**
 * wait for migration completion for all available chains
 */
const waitForMigrationCompletion = async (): Promise<void> => {
	console.log("Waiting for migration completion...")

	const interval = 10 * 1000 // 10 seconds
	const maxWaitTime = 5 * 60 * 1000
	const startTime = Date.now()

	const availableChains = await getAvailableChains()

	while (true) {
		if (Date.now() - startTime > maxWaitTime) {
			throw new Error("Migration verification timed out after 15 minutes")
		}

		try {
			const { completed, totalCount, ipfsCount } = await checkMigrationProgress(availableChains)

			if (completed) {
				console.log("Migration completed successfully!")
				console.debug(`All ${totalCount} deployments have IPFS links`)
				break
			}

			if (totalCount > 0) {
				console.debug(`Migration progress: ${ipfsCount}/${totalCount} deployments have IPFS links`)
			} else {
				console.debug("No metadata entries found yet, migration still starting...")
			}
		} catch {
			console.debug("GraphQL server not ready yet, waiting...")
		}

		await new Promise((resolve) => setTimeout(resolve, interval))
	}
}

async function main() {
	startIndexer()

	try {
		await waitForMigrationCompletion()

		console.log("Migration process completed successfully!")
	} catch (e) {
		console.error("Migration failed: ", e instanceof Error ? e.message : e)
	} finally {
		stopIndexer()
	}
}

main()
