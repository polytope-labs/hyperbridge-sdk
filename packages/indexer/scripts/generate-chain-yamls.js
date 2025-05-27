#!/usr/bin/env node
const dotenv = require("dotenv")
const fs = require("fs")
const path = require("path")
const Handlebars = require("handlebars")

const { RpcWebSocketClient } = require("rpc-websocket-client")
const { hexToNumber } = require("viem")

const currentEnv = process.env.ENV
if (!currentEnv) throw new Error("$ENV variable not set")

const root = process.cwd()
dotenv.config({ path: path.resolve(root, `../../.env.${currentEnv}`) })

const configs = require(root + `/src/configs/config-${currentEnv}.json`)

// Load and compile templates
const templatesDir = path.join(__dirname, 'templates')
const partialsDir = path.join(templatesDir, 'partials')

// Register partials
Handlebars.registerPartial('metadata', fs.readFileSync(path.join(partialsDir, 'metadata.hbs'), 'utf8'))
Handlebars.registerPartial('network-config', fs.readFileSync(path.join(partialsDir, 'network-config.hbs'), 'utf8'))
Handlebars.registerPartial('evm-handlers', fs.readFileSync(path.join(partialsDir, 'evm-handlers.hbs'), 'utf8'))
Handlebars.registerPartial('substrate-handlers', fs.readFileSync(path.join(partialsDir, 'substrate-handlers.hbs'), 'utf8'))

// Compile templates
const substrateTemplate = Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'substrate-chain.yaml.hbs'), 'utf8'))
const evmTemplate = Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'evm-chain.yaml.hbs'), 'utf8'))
const multichainTemplate = Handlebars.compile(fs.readFileSync(path.join(templatesDir, 'multichain.yaml.hbs'), 'utf8'))


const getChainTypesPath = (chain) => {
	// Extract base chain name before the hyphen
	const baseChainName = chain.split("-")[0]

	const potentialPath = `./dist/substrate-chaintypes/${baseChainName}.js`

	// Check if file exists
	if (fs.existsSync(potentialPath)) {
		return potentialPath
	}

	return null
}

const generateEndpoints = (chain) => {
	const envKey = chain.replace(/-/g, "_").toUpperCase()
	// Expect comma-separated endpoints in env var
	const endpoints = process.env[envKey]?.split(",") || []

	return endpoints.map((endpoint) => `    - '${endpoint.trim()}'`).join("\n")
}

// Generate chain-specific YAML files
const generateSubstrateYaml = async (chain, config) => {
	const chainTypesConfig = getChainTypesPath(chain)
	const endpoints = generateEndpoints(chain).split('\n').map(line => line.trim().replace(/^- '/, '').replace(/'$/, ''))

	// Expect comma-separated endpoints in env var
	const rpcUrl = process.env[chain.replace(/-/g, "_").toUpperCase()]?.split(",")[0]
	const rpc = new RpcWebSocketClient()
	await rpc.connect(rpcUrl)
	const header = await rpc.call("chain_getHeader", [])
	const blockNumber = currentEnv === "local" ? hexToNumber(header.number) : config.startBlock

	// Check if this is a Hyperbridge chain (stateMachineId is KUSAMA-4009 or POLKADOT-3367)
	const isHyperbridgeChain = config.stateMachineId === "KUSAMA-4009" || config.stateMachineId === "POLKADOT-3367"

	const templateData = {
		name: `${chain}-chain`,
		description: `${chain.charAt(0).toUpperCase() + chain.slice(1)} Chain Indexer`,
		runner: {
			node: {
				name: '@subql/node',
				version: '>=4.0.0'
			}
		},
		config,
		endpoints,
		chainTypesConfig,
		blockNumber,
		isHyperbridgeChain
	}

	return substrateTemplate(templateData)
}

const generateEvmYaml = async (chain, config) => {
	const endpoints = generateEndpoints(chain).split('\n').map(line => line.trim().replace(/^- '/, '').replace(/'$/, ''))

	// Expect comma-separated endpoints in env var
	const rpcUrl = process.env[chain.replace(/-/g, "_").toUpperCase()]?.split(",")[0]
	const response = await fetch(rpcUrl, {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			id: 1,
			jsonrpc: "2.0",
			method: "eth_blockNumber",
		}),
	})
	const data = await response.json()
	const blockNumber = currentEnv === "local" ? hexToNumber(data.result) : config.startBlock

	const templateData = {
		name: chain,
		description: `${chain.charAt(0).toUpperCase() + chain.slice(1)} Indexer`,
		runner: {
			node: {
				name: '@subql/node-ethereum',
				version: '>=3.0.0'
			}
		},
		config,
		endpoints,
		blockNumber
	}

	return evmTemplate(templateData)
}

const validChains = Object.entries(configs).filter(([chain, config]) => {
	const envKey = chain.replace(/-/g, "_").toUpperCase()
	const endpoint = process.env[envKey]

	if (!endpoint) {
		console.log(`Skipping ${chain}.yaml - No endpoint configured in environment`)
		return false
	}
	return true
})

async function generateAllChainYamls() {
	for (const [chain, config] of validChains) {
		const yaml =
			config.type === "substrate"
				? await generateSubstrateYaml(chain, config)
				: await generateEvmYaml(chain, config)

		fs.writeFileSync(root + `/src/configs/${chain}.yaml`, yaml)
		console.log(`Generated ${root}/src/configs/${chain}.yaml`)
	}
}

const generateMultichainYaml = () => {
	const projects = validChains.map(([chain]) => `./${chain}.yaml`)

	const templateData = {
		projects
	}

	const yaml = multichainTemplate(templateData)
	fs.writeFileSync(root + "/src/configs/subquery-multichain.yaml", yaml)
	console.log("Generated subquery-multichain.yaml")
}

const generateSubstrateWsJson = () => {
	const substrateWsConfig = {}

	validChains.forEach(([chain, config]) => {
		if (config.type === "substrate") {
			const envKey = chain.replace(/-/g, "_").toUpperCase()
			const endpoints = process.env[envKey]?.split(",") || []

			if (endpoints.length > 0) {
				substrateWsConfig[config.stateMachineId] = endpoints[0].trim()
			}
		}
	})

	fs.writeFileSync(root + "/src/substrate-ws.json", JSON.stringify(substrateWsConfig, null, 2))
	console.log("Generated substrate-ws.json")
}

const generateEvmWsJson = () => {
	const evmWsConfig = {}

	validChains.forEach(([chain, config]) => {
		if (config.type === "evm") {
			const envKey = chain.replace(/-/g, "_").toUpperCase()
			const endpoints = process.env[envKey]?.split(",") || []

			if (endpoints.length > 0) {
				evmWsConfig[config.stateMachineId] = endpoints[0].trim()
			}
		}
	})

	fs.writeFileSync(root + "/src/evm-ws.json", JSON.stringify(evmWsConfig, null, 2))
	console.log("Generated evm-ws.json")
}

const generateChainIdsByGenesis = () => {
	const chainIdsByGenesis = {}

	validChains.forEach(([chain, config]) => {
		if (config.chainId) {
			chainIdsByGenesis[config.chainId] = config.stateMachineId
		}
	})

	const chainIdsByGenesisContent = `// Auto-generated, DO NOT EDIT \nexport const CHAIN_IDS_BY_GENESIS = ${JSON.stringify(chainIdsByGenesis, null, 2)}`

	fs.writeFileSync(root + "/src/chain-ids-by-genesis.ts", chainIdsByGenesisContent)
	console.log("Generated chain-ids-by-genesis.ts")
}

const generateChainsByIsmpHost = () => {
	const chainsByIsmpHost = {}

	validChains.forEach(([chain, config]) => {
		// Only include EVM chains with ethereumHost contract
		if (config.type === "evm" && config.contracts?.ethereumHost) {
			chainsByIsmpHost[config.stateMachineId] = config.contracts.ethereumHost
		}
	})

	const chainsByIsmpHostContent = `// Auto-generated, DO NOT EDIT \nexport const CHAINS_BY_ISMP_HOST = ${JSON.stringify(chainsByIsmpHost, null, 2)}`

	fs.writeFileSync(root + "/src/chains-by-ismp-host.ts", chainsByIsmpHostContent)
	console.log("Generated chains-by-ismp-host.ts")
}

generateAllChainYamls()
	.then(() => {
		generateMultichainYaml()
		generateSubstrateWsJson()
		generateEvmWsJson()
		generateChainIdsByGenesis()
		generateChainsByIsmpHost()
		process.exit(0)
	})
	.catch((err) => {
		console.error("Error generating YAMLs:", err)
		process.exit(1)
	})
