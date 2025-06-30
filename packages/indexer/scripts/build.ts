#!/usr/bin/env node

import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

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

interface ChainDeployment {
	blockNumber: number
	cid: string | null
}

interface ChainsBlockNumber {
	[chainName: string]: ChainDeployment
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
 * Query GraphQL engine for metadata
 */
const queryGraphQLEngine = async <R>(query: string): Promise<R> => {
	const endpoint = getGraphqlEndpoint()
	console.debug(`Querying GraphQL endpoint: ${endpoint}`)

	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query }),
		// @ts-ignore - node-fetch v2 uses timeout option differently
		timeout: 10000,
	})

	if (!response.ok) {
		throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`)
	}

	return (await response.json()) as R
}

/**
 * Extract latest deployment information from metadata nodes
 */
const extractLatestDeployments = (nodes: MetadataNodes[]): ChainsBlockNumber => {
	const validChains = getValidChains()
	const deployments: ChainsBlockNumber = {}

	for (const node of nodes) {
		const chainName = CHAIN_MAPPING.get(node.chain)

		if (!chainName || !validChains.has(chainName)) {
			console.debug(`Skipping unsupported chain: ${node.chain}`)
			continue
		}

		const deploymentBlockNumbers = Object.entries(node.deployments)
		  .filter(([_, ref]) => !(ref as string).includes('app'))
			.map(([blockNumber]) => parseInt(blockNumber))
			.filter((blockNumber) => !isNaN(blockNumber))
			.sort((a, b) => b - a)

		if (deploymentBlockNumbers.length === 0) {
			console.warn(`No valid deployments found for chain: ${chainName}`)
			continue
		}

		const latestBlockNumber = deploymentBlockNumbers[0]
		const latestDeployment = node.deployments[latestBlockNumber.toString()]

		if (!latestDeployment) {
			console.warn(`No deployment data found for block ${latestBlockNumber} on chain: ${chainName}`)
			continue
		}

		let cid: string | null = null
		if (latestDeployment.startsWith("ipfs://")) {
			cid = latestDeployment.replace("ipfs://", "")
		}

		deployments[chainName] = {
			blockNumber: latestBlockNumber,
			cid: cid,
		}

		console.debug(`Extracted deployment for ${chainName}: block ${latestBlockNumber}, cid ${cid}`)
	}

	return deployments
}

/**
 * Fetch latest deployments and create chains-block-number.json
 */
const fetchAndPrepareDeployments = async (): Promise<void> => {
	console.log("Fetching latest deployments...")

	try {
		const data = await queryGraphQLEngine<MetadataResponse>(metadataQuery)

		if (!data?.data?._metadatas?.nodes) {
			throw new Error("Invalid response structure from GraphQL API")
		}

		const nodes = data.data._metadatas.nodes
		console.log(`Found ${nodes.length} metadata entries`)

		// Extract deployment information
		const deployments = extractLatestDeployments(nodes)
		const deploymentCount = Object.keys(deployments).length

		if (deploymentCount === 0) {
			throw new Error("No valid deployments found for configured chains")
		}

		console.log(`Extracted ${deploymentCount} valid deployments`)

		// Write to chains-block-number.json in the project root
		const rootPath = join(process.cwd(), "chains-block-number.json")
		const jsonContent = JSON.stringify(deployments, null, 2)

		writeFileSync(rootPath, jsonContent, "utf8")
		console.log(`Created chains-block-number.json with ${deploymentCount} entries`)

		console.log("Generated content preview:")
		console.log(jsonContent)
	} catch (error) {
		console.error("❌ Failed to fetch deployments:", error instanceof Error ? error.message : error)
		throw error
	}
}

const generateRef = async () => {
  console.log('Generating cid/reference from `chains-block-number.json` content')

  try {
    const configs = (await import('../chains-block-number.json')).default as ChainsBlockNumber

    for (const [chainName, config] of Object.entries(configs)) {
      if (!config.cid) {
        console.warn(`Skipping ${chainName} as it has no CID`)
        continue
      }

      const rootPath = join(process.cwd(), `.${chainName}-cid`)
      writeFileSync(rootPath, config.cid as string, "utf8")
      console.log(`Generating ${rootPath}`)
    }
  } catch(error) {
    console.error(`X generate ref configurations failed:`,error instanceof Error ? error.message : error)
  }
}

const build = async (command: string): Promise<void> => {
  console.log(`Starting ${command} build`)

	try {
		const buildCommand = `ENV=${currentEnv} ${command}`
		console.debug(`Executing: ${buildCommand}`)

		execSync(buildCommand, {
			stdio: "inherit",
			env: {
				...process.env,
				ENV: currentEnv,
			},
		})

		console.log(`Project ${command} build completed successfully`)
	} catch (error) {
		console.error(`❌ Project ${command} build failed:`, error instanceof Error ? error.message : error)
		throw error
	}
}


async function main() {
	console.log(`Starting build process for environment: ${currentEnv}`)

	try {
		await fetchAndPrepareDeployments()
		await generateRef()

		await build("npm run codegen:yamls")
		await build("npm run codegen:subql")
		await build("./node_modules/.bin/subql build")

		console.log("\n Finished build process! \n")
	} catch (error) {
		console.error("Build process failed:", error instanceof Error ? error.message : error)
		process.exit(1)
	}
}

main()
