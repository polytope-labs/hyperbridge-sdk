#!/usr/bin/env node
const dotenv = require("dotenv")
const path = require("path")
const os = require("os")

const currentEnv = process.env.ENV
if (!currentEnv) throw new Error("$ENV variable not set")

const root = process.cwd()
dotenv.config({ path: path.resolve(root, `../../.env.${currentEnv}`) })

const fs = require("fs-extra")
const configs = require(`${root}/src/configs/config-${currentEnv}.json`)

const SUBSTRATE_IMAGE = "subquerynetwork/subql-node-substrate:v5.9.1"
const EVM_IMAGE = "subquerynetwork/subql-node-ethereum:v5.5.0"
const QUERY_IMAGE = "subquerynetwork/subql-query:v2.21.0"
const POSTGRES_IMAGE = "postgres:14-alpine"

const getChainCid = (chain) => {
	const filePath = path.resolve(process.cwd(), `.${chain}-cid`)
	if (!fs.existsSync(filePath)) {
		return null
	}

	return fs.readFileSync(filePath, { encoding: "utf8" }).trim()
}

const generateNodeServices = () => {
	const unfinalized = `
      - --historical=timestamp
      - --block-confirmations=0
      - --unfinalized-blocks`

	Object.entries(configs)
		.filter(([chain]) => {
			const envKey = chain.replace(/-/g, "_").toUpperCase()
			return !!process.env[envKey]
		})
		.map(([chain, config]) => {
			const image = config.type === "substrate" ? SUBSTRATE_IMAGE : EVM_IMAGE
			const file = `services:
  subquery-${chain}:
    image: ${image}
    restart: unless-stopped
    environment:
      DB_USER: \${DB_USER}
      DB_PASS: \${DB_PASS}
      DB_DATABASE: \${DB_DATABASE}
      DB_HOST: \${DB_HOST}
      DB_PORT: \${DB_PORT}
    volumes:
      - ../../src/configs:/app
      - ../../dist:/app/dist
    command:
      - \${SUB_COMMAND:-}
      - -f=/app/${chain}.yaml
      - --db-schema=app
      - --workers=\${SUBQL_WORKERS:-16}
      - --batch-size=\${SUBQL_BATCH_SIZE:-100}
      - --multi-chain
      - --unsafe
      - --log-level=info${config.type === "substrate" ? "" : unfinalized}
      - --store-cache-async=true
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://subquery-node-${chain}:3000/ready']
      interval: 3s
      timeout: 5s
      retries: 10`

			const filePath = `${root}/docker/${currentEnv}/${chain}.yml`
			if (!fs.existsSync(filePath)) {
				fs.outputFileSync(filePath, file)
				console.log(`Generated ${root}/docker/${currentEnv}/${chain}.yml`)
			} else {
				console.log(`Skipping ${root}/docker/${currentEnv}/${chain}.yml - File already exists`)
			}
		})
}

const generateLocalNodeServices = () => {
	const validChains = Object.entries(configs).filter(([chain]) => {
		const envKey = chain.replace(/-/g, "_").toUpperCase()
		return !!process.env[envKey]
	})

	// Generate node services for each chain
	const nodeServices = validChains.map(([chain, config]) => {
		const image = config.type === "substrate" ? SUBSTRATE_IMAGE : EVM_IMAGE
		const envKey = chain.replace(/-/g, "_").toUpperCase()
		const serviceName = `subquery-node-${chain}-local`

		const networkMode = config.type === "substrate" ? "\n        network_mode: host" : ""
		const dbHost = config.type === "substrate" ? "0.0.0.0" : "${DB_HOST}"

    const cid = getChainCid(chain)
		const flag = cid ? `\n            - -f='ipfs://${cid}'` : `\n            - -f=/app/${chain}.yaml`
		const networkEndpoint = cid ? `\n            - --network-endpoint='\${${envKey}}'` : ''
		const configsDirectory = cid ? '' : `\n            - ../src/configs:/app/src/configs\n            - ../${chain}.yaml:/app/${chain}.yaml`

		const unfinalized = `
            - --historical=timestamp
            - --unfinalized-blocks
            - --block-confirmations=0`

		return `    ${serviceName}:
        image: ${image}
        restart: unless-stopped${networkMode}
        environment:
            DB_USER: \${DB_USER}
            DB_PASS: \${DB_PASS}
            DB_DATABASE: \${DB_DATABASE}
            DB_HOST: ${dbHost}
            DB_PORT: \${DB_PORT}

        depends_on:
            postgres:
                condition: service_healthy

        volumes:
            - ../dist:/app/dist${configsDirectory}
        command:
            - \${SUB_COMMAND:-}${flag}${networkEndpoint}
            - --db-schema=app
            - --workers=\${SUBQL_WORKERS:-6}
            - --batch-size=\${SUBQL_BATCH_SIZE:-10}
            - --multi-chain
            - --unsafe
            - --log-level=info${config.type === "substrate" ? "\n            - --block-confirmations=0" : unfinalized}
            - --store-cache-async=false
            - --store-cache-threshold=1${cid ? "\n            - --allow-schema-migration" : ""}
        healthcheck:
            test: ["CMD", "curl", "-f", "http://${serviceName}:3000/ready"]
            interval: 3s
            timeout: 5s
            retries: 10`
	}).join('\n\n')

	const dockerComposeContent = `services:
${nodeServices}

    graphql-engine:
        image: ${QUERY_IMAGE}
        restart: always
        ports:
            - 3100:3000
        environment:
            DB_USER: \${DB_USER}
            DB_PASS: \${DB_PASS}
            DB_DATABASE: \${DB_DATABASE}
            DB_HOST: \${DB_HOST}
            DB_PORT: \${DB_PORT}
        depends_on:
            postgres:
                condition: service_healthy
        command:
            - --name=app
            - --playground

    postgres:
        image: ${POSTGRES_IMAGE}
        ports:
            - 5432:5432
        volumes:
            - \${DB_PATH}:/var/lib/postgresql/data
        environment:
            POSTGRES_PASSWORD: \${DB_PASS}
            POSTGRES_USER: \${DB_USER}
            POSTGRES_DB: \${DB_DATABASE}
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U \${DB_USER} -d \${DB_DATABASE}"]
            interval: 10s
            timeout: 5s
            retries: 5
        command: |
            bash -c '
               # Start PostgreSQL in the background
              docker-entrypoint.sh postgres &

              sleep 5

              # Wait for PostgreSQL to become available
              until pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB; do
                echo "Waiting for PostgreSQL to start..."
                sleep 1
              done

              # Run our extension creation command - note we use localhost here
              echo "Creating btree_gist extension..."
              psql -v ON_ERROR_STOP=1 -U $$POSTGRES_USER -d $$POSTGRES_DB -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"

              # Keep container running by waiting for the PostgreSQL process
              wait
            '
`

	const outputPath = `${root}/docker/docker-compose.local.yml`
	fs.outputFileSync(outputPath, dockerComposeContent)
	console.log(`Generated ${outputPath}`)
}

// Run both functions
generateNodeServices()
generateLocalNodeServices()
