"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importStar(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const yaml = tslib_1.__importStar(require("js-yaml"));
const rimraf_1 = require("rimraf");
const add_chain_controller_1 = require("./add-chain-controller");
const multichainManifest = {
    specVersion: '1.0.0',
    query: {
        name: '@subql/query',
        version: '*',
    },
    projects: ['./project-polkadot.yaml'],
};
const childChainManifest_1 = {
    specVersion: '1.0.0',
    version: '1.0.0',
    name: 'project-polkadot',
    runner: {
        node: {
            name: '@subql/node',
            version: '*',
        },
        query: {
            name: '@subql/query',
            version: '*',
        },
    },
    network: {
        chainId: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
        endpoint: 'wss://polkadot.api.onfinality.io/public-ws',
        dictionary: 'https://api.subquery.network/sq/subquery/polkadot-dictionary',
    },
    schema: {
        file: './schema.graphql',
    },
    dataSources: [],
};
const childChainManifest_2 = {
    specVersion: '1.0.0',
    version: '1.0.0',
    name: 'project-kusama',
    runner: {
        node: {
            name: '@subql/node',
            version: '*',
        },
        query: {
            name: '@subql/query',
            version: '*',
        },
    },
    network: {
        chainId: '0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe',
        endpoint: 'wss://kusama.api.onfinality.io/public-ws',
        dictionary: 'https://api.subquery.network/sq/subquery/kusama-dictionary',
    },
    schema: {
        file: './schema.graphql',
    },
    dataSources: [],
};
const childChainManifest_2_wrongSchema = {
    specVersion: '1.0.0',
    version: '1.0.0',
    name: 'project-kusama',
    runner: {
        node: {
            name: '@subql/node',
            version: '*',
        },
        query: {
            name: '@subql/query',
            version: '*',
        },
    },
    network: {
        chainId: '0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe',
        endpoint: 'wss://kusama.api.onfinality.io/public-ws',
        dictionary: 'https://api.subquery.network/sq/subquery/kusama-dictionary',
    },
    schema: {
        file: './schema_wrong.graphql',
    },
    dataSources: [],
};
async function createMultichainProject(multichainManifest, childManifests) {
    const tmpdir = await fs_1.default.promises.mkdtemp(`${os_1.default.tmpdir()}${path_1.default.sep}`);
    const projectDir = path_1.default.join(tmpdir, 'multichain');
    await fs_1.default.promises.mkdir(projectDir);
    // Create multichain manifest YAML
    const multichainYaml = yaml.dump(multichainManifest);
    if (!(0, fs_1.existsSync)(projectDir)) {
        throw new Error(`${projectDir} does not exist`);
    }
    await fs_1.default.promises.writeFile(path_1.default.join(projectDir, common_1.DEFAULT_MULTICHAIN_MANIFEST), multichainYaml);
    // Create child manifest YAML files
    const childManifestPromises = childManifests.map(async (childManifest) => {
        const childManifestYaml = yaml.dump(childManifest);
        const fileName = `${childManifest.name}.yaml`;
        await fs_1.default.promises.writeFile(path_1.default.join(projectDir, fileName), childManifestYaml);
        return fileName;
    });
    await Promise.all(childManifestPromises);
    return projectDir;
}
async function createChildManifestFile(childManifest, projectDir) {
    const childManifestYaml = yaml.dump(childManifest);
    const fileName = `${childManifest.name}.yaml`;
    await fs_1.default.promises.writeFile(path_1.default.join(projectDir, fileName), childManifestYaml);
    return path_1.default.join(projectDir, fileName);
}
describe('MultiChain - ADD', () => {
    let projectDir;
    afterEach(async () => {
        try {
            await (0, rimraf_1.rimraf)(projectDir);
        }
        catch (e) {
            console.warn('Failed to clean up tmp dir after test', e);
        }
    });
    it('can add chain to multichain manifest - valid schema paths', async () => {
        projectDir = await createMultichainProject(multichainManifest, [childChainManifest_1]);
        const chainFile = await createChildManifestFile(childChainManifest_2, projectDir);
        const multichainManifestPath = path_1.default.join(projectDir, common_1.DEFAULT_MULTICHAIN_MANIFEST);
        const multiManifest = (0, add_chain_controller_1.loadMultichainManifest)(multichainManifestPath);
        (0, add_chain_controller_1.validateAndAddChainManifest)(projectDir, chainFile, multiManifest);
        expect(multiManifest.get('projects').get(1)).toEqual(`${childChainManifest_2.name}.yaml`);
    });
    it('cannot add chain to multichain manifest - invalid schema path', async () => {
        projectDir = await createMultichainProject(multichainManifest, [childChainManifest_1]);
        const chainFile = await createChildManifestFile(childChainManifest_2_wrongSchema, projectDir);
        const multichainManifestPath = path_1.default.join(projectDir, common_1.DEFAULT_MULTICHAIN_MANIFEST);
        const multiManifest = (0, add_chain_controller_1.loadMultichainManifest)(multichainManifestPath);
        expect(() => (0, add_chain_controller_1.validateAndAddChainManifest)(projectDir, chainFile, multiManifest)).toThrow();
    });
});
//# sourceMappingURL=add-chain-controller.spec.js.map