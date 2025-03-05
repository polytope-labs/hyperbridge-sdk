"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.addChain = addChain;
exports.determineMultichainManifestPath = determineMultichainManifestPath;
exports.loadMultichainManifest = loadMultichainManifest;
exports.handleChainManifestOrId = handleChainManifestOrId;
exports.validateAndAddChainManifest = validateAndAddChainManifest;
exports.loadDockerComposeFile = loadDockerComposeFile;
exports.updateDockerCompose = updateDockerCompose;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const common_1 = require("@subql/common");
const yaml_1 = require("yaml");
const nodeToDockerImage = {
    '@subql/node': 'onfinality/subql-node',
    '@subql/node-ethereum': 'onfinality/subql-node-ethereum',
    '@subql/node-cosmos': 'onfinality/subql-node-cosmos',
    '@subql/node-algorand': 'onfinality/subql-node-algorand',
    '@subql/node-near': 'onfinality/subql-node-near',
    '@subql/node-stellar': 'subquerynetwork/subql-node-stellar',
    '@subql/node-concordium': 'subquerynetwork/subql-node-concordium',
    '@subql/node-starknet': 'subquerynetwork/subql-node-starknet',
};
async function addChain(multichain, chainManifestPath) {
    const multichainManifestPath = determineMultichainManifestPath(multichain);
    const multichainManifest = loadMultichainManifest(multichainManifestPath);
    chainManifestPath = handleChainManifestOrId(chainManifestPath);
    validateAndAddChainManifest(path.parse(multichainManifestPath).dir, chainManifestPath, multichainManifest);
    fs.writeFileSync(multichainManifestPath, multichainManifest.toString());
    await updateDockerCompose(path.parse(multichainManifestPath).dir, chainManifestPath);
}
function determineMultichainManifestPath(multichain) {
    if (!multichain) {
        throw new Error(`Multichain project path -f not provided`);
    }
    let multichainPath;
    if (fs.lstatSync(multichain).isDirectory()) {
        multichainPath = path.resolve(multichain, common_1.DEFAULT_MULTICHAIN_MANIFEST);
    }
    else {
        if (!fs.existsSync(multichain)) {
            throw new Error(`Could not resolve multichain project path: ${multichain}`);
        }
        multichainPath = multichain;
    }
    return multichainPath;
}
function loadMultichainManifest(multichainManifestPath) {
    let multichainManifest;
    if (!isMultiChainProject(multichainManifestPath)) {
        throw new Error(`${multichainManifestPath} is an invalid multichain project manifest`);
    }
    if (fs.existsSync(multichainManifestPath)) {
        const content = fs.readFileSync(multichainManifestPath, 'utf8');
        multichainManifest = (0, yaml_1.parseDocument)(content);
    }
    else {
        throw new Error(`Multichain project ${multichainManifestPath} does not exist`);
    }
    return multichainManifest;
}
function handleChainManifestOrId(chainManifestPath) {
    if (!chainManifestPath) {
        throw new Error('You must provide chain manifest path');
    }
    // Check if the provided chain manifest path exists
    if (!fs.existsSync(chainManifestPath)) {
        throw new Error(`Chain manifest file does not exist at the specified location: ${chainManifestPath}`);
    }
    return path.resolve(chainManifestPath);
}
function validateAndAddChainManifest(projectDir, chainManifestPath, multichainManifest) {
    // Validate schema paths
    const chainManifestProject = (0, common_1.getProjectRootAndManifest)(path.resolve(projectDir, chainManifestPath));
    const chainManifestSchemaPath = (0, common_1.getSchemaPath)(chainManifestProject.root, chainManifestProject.manifests[0]);
    console.log(`Chain manifest: ${chainManifestProject.manifests[0]}`);
    for (const manifestPath of multichainManifest.get('projects').items.map((item) => item.value)) {
        const project = (0, common_1.getProjectRootAndManifest)(path.resolve(projectDir, manifestPath));
        const schemaPath = (0, common_1.getSchemaPath)(project.root, project.manifests[0]);
        if (schemaPath !== chainManifestSchemaPath) {
            console.error(`Error: Schema path in the provided chain manifest is different from the schema path in the existing chain manifest for project: ${project.root}`);
            throw new Error('Schema path mismatch error');
        }
    }
    for (const project of multichainManifest.get('projects').toJSON()) {
        if (path.resolve(projectDir, project) === chainManifestPath) {
            console.log(`project ${project} already exists in multichain manifest, skipping addition`);
            return;
        }
    }
    // Add the chain manifest path to multichain manifest
    const relativePath = path.relative(projectDir, chainManifestPath);
    multichainManifest.get('projects').add(relativePath);
    console.log(`Successfully added chain manifest path: ${relativePath}`);
}
function loadDockerComposeFile(dockerComposePath) {
    if (fs.existsSync(dockerComposePath)) {
        const content = fs.readFileSync(dockerComposePath, 'utf8');
        return (0, yaml_1.parseDocument)(content);
    }
}
function getSubqlNodeService(dockerCompose) {
    const services = dockerCompose.get('services');
    if (services && services instanceof yaml_1.YAMLMap) {
        const service = services.items.find((item) => {
            const image = item.value.get('image');
            return image?.startsWith('onfinality/subql-node');
        });
        if (service && service.value instanceof yaml_1.YAMLMap) {
            const commands = service.value.get('command');
            if (!commands.toJSON().includes('--multi-chain')) {
                commands.add('--multi-chain');
            }
            return service.value.toJSON();
        }
    }
    return undefined;
}
async function getDefaultServiceConfiguration(chainManifestPath, serviceName) {
    const manifest = await (0, common_1.loadFromJsonOrYaml)(chainManifestPath);
    let nodeName;
    try {
        nodeName = manifest.runner.node.name;
    }
    catch (e) {
        throw new Error(`unable to retrieve runner node from manifest: ${e}`);
    }
    const dockerImage = nodeToDockerImage[nodeName];
    if (!dockerImage) {
        throw new Error(`unknown node runner name ${nodeName}`);
    }
    return {
        image: `${dockerImage}:latest`,
        depends_on: {
            postgres: {
                condition: 'service_healthy',
            },
        },
        restart: 'always',
        environment: {
            DB_USER: 'postgres',
            DB_PASS: 'postgres',
            DB_DATABASE: 'postgres',
            DB_HOST: 'postgres',
            DB_PORT: '5432',
        },
        volumes: ['./:/app'],
        command: [`-f=app/${path.basename(chainManifestPath)}`, '--multi-chain'],
        healthcheck: {
            test: ['CMD', 'curl', '-f', `http://${serviceName}:3000/ready`],
            interval: '3s',
            timeout: '5s',
            retries: 10,
        },
    };
}
async function updateDockerCompose(projectDir, chainManifestPath) {
    const serviceName = `subquery-node-${path.basename(chainManifestPath, '.yaml')}`;
    const dockerComposePath = path.join(projectDir, 'docker-compose.yml');
    const dockerCompose = loadDockerComposeFile(dockerComposePath);
    if (!dockerCompose) {
        throw new Error(`Docker Compose file does not exist at the specified location: ${dockerComposePath}`);
    }
    console.log(`Updating Docker Compose for chain manifest: ${chainManifestPath}`);
    //check if service already exists
    const services = dockerCompose.get('services');
    if (services && services instanceof yaml_1.YAMLMap) {
        const existingService = services.items.find((item) => {
            const image = item.value.toJSON().image;
            if (!image || !image.startsWith('onfinality/subql-node')) {
                return false;
            }
            const commands = item.value.toJSON().command;
            return commands?.includes(`-f=app/${path.basename(chainManifestPath)}`);
        });
        if (existingService) {
            console.log(`Service for ${path.basename(chainManifestPath)} already exists in Docker Compose, skipping addition`);
            return;
        }
    }
    let subqlNodeService = getSubqlNodeService(dockerCompose);
    if (subqlNodeService) {
        // If the service already exists, update its configuration
        subqlNodeService.command = subqlNodeService.command?.filter((cmd) => !cmd.startsWith('-f=')) ?? [];
        subqlNodeService.command.push(`-f=app/${path.basename(chainManifestPath)}`);
        if (subqlNodeService.healthcheck) {
            subqlNodeService.healthcheck.test = ['CMD', 'curl', '-f', `http://${serviceName}:3000/ready`];
        }
    }
    else {
        // Otherwise, create a new service configuration
        subqlNodeService = await getDefaultServiceConfiguration(chainManifestPath, serviceName);
    }
    console.log(`Created new service configuration: ${serviceName}`);
    services.add({ key: serviceName, value: subqlNodeService });
    // Save the updated Docker Compose file
    fs.writeFileSync(dockerComposePath, dockerCompose.toString());
    console.log(`Docker Compose file updated successfully at: ${dockerComposePath}`);
}
function isMultiChainProject(content) {
    return Array.isArray((0, common_1.loadFromJsonOrYaml)(content).projects);
}
//# sourceMappingURL=add-chain-controller.js.map