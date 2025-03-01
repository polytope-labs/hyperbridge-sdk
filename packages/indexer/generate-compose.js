#!/usr/bin/env node
const dotenv = require("dotenv")
const path = require("path")
const os = require("os")

const currentEnv = process.env.ENV
if (!currentEnv) throw new Error("$ENV variable not set")

const root = process.cwd()
dotenv.config({ path: path.resolve(root, `../../.env.${currentEnv}`) })

const fs = require("fs")
const configs = require(`./configs/config-${currentEnv}.json`)

const SUBSTRATE_IMAGE = "subquerynetwork/subql-node-substrate:v5.9.1"
const EVM_IMAGE = "subquerynetwork/subql-node-ethereum:v5.5.0"

const generateNodeServices = () => {
	const unfinalized = `
      - --historical=timestamp
      - --unfinalized-blocks`
	return Object.entries(configs)
		.filter(([chain]) => {
			const envKey = chain.replace(/-/g, "_").toUpperCase()
			return !!process.env[envKey]
		})
		.map(([chain, config]) => {
			const image = config.type === "substrate" ? SUBSTRATE_IMAGE : EVM_IMAGE
			return `
  subquery-node-${chain}:
    image: ${image}
    restart: unless-stopped
    environment:
      DB_USER: \${DB_USER}
      DB_PASS: \${DB_PASS}
      DB_DATABASE: \${DB_DATABASE}
      DB_HOST: \${DB_HOST}
      DB_PORT: \${DB_PORT}
      ${
			currentEnv === "local"
				? `
    depends_on:
      postgres:
        condition: service_healthy
      `
				: ""
		}
    volumes:
      - ../configs:/app
      - ../dist:/app/dist
    command:
      - \${SUB_COMMAND:-}
      - -f=/app/${chain}.yaml
      - --db-schema=app
      - --workers=\${SUBQL_WORKERS:-10}
      - --batch-size=\${SUBQL_BATCH_SIZE:-${config.type === "substrate" ? 100 : 10}}
      - --multi-chain
      - --unsafe
      - --log-level=info${config.type === "substrate" ? "" : unfinalized}
      - --block-confirmations=0
      - --store-cache-async=false
      - --store-cache-threshold=1
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://subquery-node-${chain}:3000/ready']
      interval: 3s
      timeout: 5s
      retries: 10`
		})
		.join("\n")
}

const generateDependencies = () => {
	return Object.keys(configs)
		.filter(([chain]) => {
			const envKey = chain.replace(/-/g, "_").toUpperCase()
			return !!process.env[envKey]
		})
		.map(
			(chain) => `      'subquery-node-${chain}':
        condition: service_healthy`,
		)
		.join("\n")
}

const generatePostgres = () => {
	if (currentEnv === "local") {
		return `
  postgres:
    image: postgres:14-alpine
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
      '`
	}

	return ""
}

const dockerCompose = `services:
${generateNodeServices()}

${generatePostgres()}
`
fs.writeFileSync(`docker/docker-compose.${currentEnv}.yml`, dockerCompose)
console.log(`Generated docker/docker-compose.${currentEnv}.yml`)
