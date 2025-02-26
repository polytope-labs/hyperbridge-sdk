#!/usr/bin/env node

require("dotenv").config()

const fs = require("fs")
const currentEnv = process.env.CURRENT_ENV || "test"
const configs = require(`./configs/chain-configs-${currentEnv}.json`)

const SUBSTRATE_IMAGE = "subquerynetwork/subql-node-substrate:v5.9.1"
const EVM_IMAGE = "subquerynetwork/subql-node-ethereum:v5.5.0"
const GRAPHQL_IMAGE = "subquerynetwork/subql-query:v2.21.0"

const generateNodeServices = () => {
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

    volumes:
      - ../configs:/app
      - ../dist:/app/dist
    command:
      - \${SUB_COMMAND:-}
      - -f=/app/${chain}.yaml
      - --db-schema=app
      - --workers=\${SUBQL_WORKERS:-6}
      - --batch-size=\${SUBQL_BATCH_SIZE:-10}
      - --multi-chain
      - --unsafe
      - --log-level=info
      - --historical=timestamp
      - --unfinalized 
      - --block-confirmations=1
      - --store-cache-async=false
      - --store-cache-threshold=100
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
	if (currentEnv === "test") {
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
      interval: 5s
      timeout: 5s
      retries: 5
    command: |
      bash -c '
         # Start PostgreSQL in the background
        docker-entrypoint.sh postgres &
        
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

  graphql-engine:
    image: ${GRAPHQL_IMAGE}
    ports:
      - 3000:3000
${generateDependencies()}
    restart: always
    environment:
      DB_USER: \${DB_USER}
      DB_PASS: \${DB_PASS}
      DB_DATABASE: \${DB_DATABASE}
      DB_HOST: \${DB_HOST}
      DB_PORT: \${DB_PORT}
    command:
      - --name=app
      - --playground
${generatePostgres()}
`

fs.writeFileSync(
	currentEnv === "prod" ? "docker/docker-compose.yml" : "docker/docker-compose.testnet.yml",
	dockerCompose,
)
console.log("Generated docker-compose.yml")
