"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestProject = createTestProject;
exports.createMultiChainTestProject = createMultiChainTestProject;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const child_process_1 = tslib_1.__importDefault(require("child_process"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const cross_fetch_1 = tslib_1.__importDefault(require("cross-fetch"));
const build_1 = tslib_1.__importDefault(require("./commands/build"));
const codegen_1 = tslib_1.__importDefault(require("./commands/codegen"));
const init_controller_1 = require("./controller/init-controller");
const projectSpecV1_0_0 = {
    name: 'mocked_starter',
    chainId: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
    endpoint: 'wss://rpc.polkadot.io/public-ws',
    author: 'jay',
    description: 'this is test for init controller',
    runner: {
        node: {
            name: '@subql/node',
            version: '>=1.0.0',
        },
        query: {
            name: '@subql/query',
            version: '*',
        },
    },
};
const multiProjectSpecV1_0_0 = {
    name: 'multi_mocked_starter',
    chainId: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
    endpoint: 'https://arbitrum.llamarpc.com',
    author: 'jay',
    description: 'this is test for init controller',
    runner: {
        node: {
            name: '@subql/node-ethereum',
            version: '>=3.0.0',
        },
        query: {
            name: '@subql/query',
            version: '*',
        },
    },
};
async function getExampleProject(networkFamily, network) {
    const res = await (0, cross_fetch_1.default)('https://raw.githubusercontent.com/subquery/templates/main/dist/output.json');
    if (!res.ok) {
        throw new Error('Failed to get template');
    }
    const templates = (await res.json());
    const template = templates
        .find((t) => t.code === networkFamily)
        ?.networks.find((n) => n.code === network)
        ?.examples.find((e) => e.remote === 'https://github.com/subquery/subql-starter');
    (0, assert_1.default)(template, 'Failed to get template');
    return template;
}
async function createTestProject() {
    const tmpdir = await fs_1.default.promises.mkdtemp(`${os_1.default.tmpdir()}${path_1.default.sep}`);
    const projectDir = path_1.default.join(tmpdir, projectSpecV1_0_0.name);
    const exampleProject = await getExampleProject('polkadot', 'polkadot');
    const projectPath = await (0, init_controller_1.cloneProjectTemplate)(tmpdir, projectSpecV1_0_0.name, exampleProject);
    await (0, init_controller_1.prepare)(projectPath, projectSpecV1_0_0);
    // Install dependencies
    child_process_1.default.execSync(`npm i`, { cwd: projectDir });
    // Set test env to be develop mode, only limit to test
    process.env.NODE_ENV = 'develop';
    await codegen_1.default.run(['-f', projectDir]);
    await build_1.default.run(['-f', projectDir]);
    return projectDir;
}
async function createMultiChainTestProject() {
    const tmpdir = await fs_1.default.promises.mkdtemp(`${os_1.default.tmpdir()}${path_1.default.sep}`);
    const projectDir = path_1.default.join(tmpdir, multiProjectSpecV1_0_0.name);
    const exampleProject = await getExampleProject('multi', 'multi');
    await (0, init_controller_1.cloneProjectTemplate)(tmpdir, multiProjectSpecV1_0_0.name, exampleProject);
    // Install dependencies
    child_process_1.default.execSync(`npm i`, { cwd: projectDir });
    // Set test env to be develop mode, only limit to test
    process.env.NODE_ENV = 'develop';
    await codegen_1.default.run(['-f', projectDir]);
    await build_1.default.run(['-f', projectDir]);
    const project = (0, common_1.getProjectRootAndManifest)(projectDir);
    const fullPaths = project.manifests.map((manifest) => path_1.default.join(project.root, manifest));
    let multichainManifestPath = (0, common_1.getMultichainManifestPath)(projectDir);
    if (!multichainManifestPath) {
        throw new Error('Selected project is not multi-chain. Please set correct file.\n\n https://academy.subquery.network/build/multi-chain.html');
    }
    multichainManifestPath = path_1.default.join(project.root, multichainManifestPath);
    return { multichainManifestPath, fullPaths };
}
//# sourceMappingURL=createProject.fixtures.js.map