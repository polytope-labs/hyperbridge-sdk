#!/usr/bin/env node
import { Command } from "commander"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { parse } from "toml"
import { IntentFiller } from "../core/filler.js"
import { BasicFiller } from "../strategies/basic.js"
import { StableSwapFiller } from "../strategies/swap.js"
import { ConfirmationPolicy } from "../config/confirmation-policy.js"
import { ChainConfig, FillerConfig, HexString } from "@hyperbridge/sdk"

// Get package.json path
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJsonPath = resolve(__dirname, "../../package.json")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"))

interface StrategyConfig {
	type: "basic" | "stable-swap"
	privateKey: string
}

interface ChainConfirmationPolicy {
	minAmount: string
	maxAmount: string
	minConfirmations: number
	maxConfirmations: number
}

interface PendingQueueConfig {
	maxRechecks: number
	recheckDelayMs: number
}

interface ChainConfigToml {
	chainId: number
	rpcUrl: string
	intentGatewayAddress: string
}

interface FillerTomlConfig {
	filler: {
		privateKey: string
		maxConcurrentOrders: number
		pendingQueue: PendingQueueConfig
	}
	strategies: StrategyConfig[]
	chains: ChainConfigToml[]
	confirmationPolicies: Record<string, ChainConfirmationPolicy>
}

const program = new Command()

program.name("filler").description("Hyperbridge IntentGateway Filler").version(packageJson.version)

program
	.command("run")
	.description("Run the intent filler with the specified configuration")
	.requiredOption("-c, --config <path>", "Path to TOML configuration file")
	.action(async (options: { config: string }) => {
		try {
			console.log("🚀 Starting Hyperbridge IntentGateway Filler...")

			// Load and parse TOML configuration
			const configPath = resolve(process.cwd(), options.config)
			console.log(`📄 Loading configuration from: ${configPath}`)

			const tomlContent = readFileSync(configPath, "utf-8")
			const config = parse(tomlContent) as FillerTomlConfig

			// Validate required configuration
			validateConfig(config)

			// Initialize services
			console.log("🔧 Initializing services...")

			// Convert TOML chain configs to ChainConfig format
			const chainConfigs: ChainConfig[] = config.chains.map((chain) => ({
				chainId: chain.chainId,
				rpcUrl: chain.rpcUrl,
				intentGatewayAddress: chain.intentGatewayAddress as HexString,
			}))

			// Initialize confirmation policy
			const confirmationPolicy = new ConfirmationPolicy(config.confirmationPolicies)

			// Create filler configuration
			const fillerConfig: FillerConfig = {
				confirmationPolicy: {
					getConfirmationBlocks: (chainId: number, amount: bigint) =>
						confirmationPolicy.getConfirmationBlocks(chainId, amount),
				},
				maxConcurrentOrders: config.filler.maxConcurrentOrders,
				pendingQueueConfig: config.filler.pendingQueue,
			}

			// Initialize strategies
			console.log("🎯 Initializing strategies...")
			const strategies = config.strategies.map((strategyConfig) => {
				switch (strategyConfig.type) {
					case "basic":
						return new BasicFiller(strategyConfig.privateKey as HexString)
					case "stable-swap":
						return new StableSwapFiller(strategyConfig.privateKey as HexString)
					default:
						throw new Error(`Unknown strategy type: ${strategyConfig.type}`)
				}
			})

			// Initialize and start the intent filler
			console.log("🏃 Starting intent filler...")
			const intentFiller = new IntentFiller(chainConfigs, strategies, fillerConfig)
			// Start the filler
			intentFiller.start()

			console.log("✨ Intent filler is running...")
			console.log("📊 Configuration:")
			console.log(`   - Chains: ${config.chains.map((c) => `Chain ${c.chainId}`).join(", ")}`)
			console.log(`   - Strategies: ${config.strategies.map((s) => s.type).join(", ")}`)
			console.log(`   - Max concurrent orders: ${config.filler.maxConcurrentOrders}`)

			// Handle graceful shutdown
			process.on("SIGINT", () => {
				console.log("\n🛑 Shutting down intent filler...")
				intentFiller.stop()
				process.exit(0)
			})

			process.on("SIGTERM", () => {
				console.log("\n🛑 Shutting down intent filler...")
				intentFiller.stop()
				process.exit(0)
			})

			// Keep the process running
			process.stdin.resume()
		} catch (error) {
			console.error("❌ Failed to start filler:", error)
			process.exit(1)
		}
	})

function validateConfig(config: FillerTomlConfig): void {
	// Validate required fields
	if (!config.filler?.privateKey) {
		throw new Error("Filler private key is required")
	}

	if (!config.strategies || config.strategies.length === 0) {
		throw new Error("At least one strategy must be configured")
	}

	if (!config.chains || config.chains.length === 0) {
		throw new Error("At least one chain must be configured")
	}

	// Validate chain configurations
	for (const chain of config.chains) {
		if (!chain.chainId || !chain.rpcUrl || !chain.intentGatewayAddress) {
			throw new Error(`Chain configuration must have chainId, rpcUrl, and intentGatewayAddress`)
		}
		if (typeof chain.chainId !== "number") {
			throw new Error(`Chain ${chain.chainId} chainId must be a number`)
		}
	}

	// Validate strategies
	for (const strategy of config.strategies) {
		if (!strategy.type || !strategy.privateKey) {
			throw new Error("Strategy type and private key are required")
		}

		if (!["basic", "stable-swap"].includes(strategy.type)) {
			throw new Error(`Invalid strategy type: ${strategy.type}`)
		}
	}

	// Validate confirmation policies
	for (const [chainId, policy] of Object.entries(config.confirmationPolicies)) {
		if (!policy.minAmount || !policy.maxAmount) {
			throw new Error(`Confirmation policy for chain ${chainId} must have minAmount and maxAmount`)
		}

		if (policy.minConfirmations === undefined || policy.maxConfirmations === undefined) {
			throw new Error(`Confirmation policy for chain ${chainId} must have minConfirmations and maxConfirmations`)
		}

		if (policy.minConfirmations > policy.maxConfirmations) {
			throw new Error(`Invalid confirmation range for chain ${chainId}`)
		}
	}
}

// Parse command line arguments
program.parse(process.argv)

// Show help if no command is provided
if (!process.argv.slice(2).length) {
	program.outputHelp()
}
