"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const simple_git_1 = tslib_1.__importDefault(require("simple-git"));
const constants_1 = require("../constants");
const utils_1 = require("../utils");
const init_controller_1 = require("./init-controller");
jest.mock('simple-git', () => {
    const mGit = {
        clone: jest.fn(),
    };
    return jest.fn(() => mGit);
});
jest.setTimeout(30000);
async function makeTempDir() {
    const sep = path_1.default.sep;
    const tmpDir = os_1.default.tmpdir();
    const tempPath = await fs.promises.mkdtemp(`${tmpDir}${sep}`);
    return tempPath;
}
const projectSpec = {
    name: 'mocked_starter',
    repository: '',
    endpoint: 'wss://rpc.polkadot.io/public-ws',
    author: 'jay',
    description: 'this is test for init controller',
    version: '',
    license: '',
};
describe('Cli can create project (mocked)', () => {
    const projectPath = path_1.default.join(__dirname, '../../test/schemaTest/');
    let originalManifest;
    let originalPackage;
    beforeAll(async () => {
        originalManifest = (await fs.promises.readFile(`${projectPath}/${common_1.DEFAULT_TS_MANIFEST}`)).toString();
        originalPackage = (await fs.promises.readFile(`${projectPath}/package.json`)).toString();
    });
    afterAll(async () => {
        // resort original after the test
        await fs.promises.writeFile(path_1.default.join(projectPath, common_1.DEFAULT_TS_MANIFEST), originalManifest);
        await fs.promises.writeFile(path_1.default.join(projectPath, 'package.json'), originalPackage);
    });
    it('throw error when git clone failed', async () => {
        const tempPath = await makeTempDir();
        (0, simple_git_1.default)().clone.mockImplementationOnce((cb) => {
            cb(new Error());
        });
        await expect((0, init_controller_1.cloneProjectGit)(tempPath, projectSpec.name, 'invalid_url', 'invalid_branch')).rejects.toThrow(/Failed to clone starter template from git/);
    });
    it('validate ethereum project manifest', async () => {
        const projectPath_eth = path_1.default.join(__dirname, '../../test/abiTest1');
        await expect((0, init_controller_1.validateEthereumProjectManifest)(projectPath_eth)).resolves.toBe(true);
        await expect((0, init_controller_1.validateEthereumProjectManifest)(projectPath)).resolves.toBe(false);
    });
    // These tests are disabled because they can interfere with the service
    it.skip('fetch templates', async () => {
        expect((await (0, init_controller_1.fetchTemplates)()).length).toBeGreaterThan(0);
    });
    it.skip('fetch networks', async () => {
        expect((await (0, init_controller_1.fetchNetworks)()).length).toBeGreaterThan(0);
    });
    it.skip('fetch example projects', async () => {
        expect((await (0, init_controller_1.fetchExampleProjects)('evm', '1')).length).toBeGreaterThan(0);
    });
    it('readDefaults using regex', async () => {
        const manifest = (await fs.promises.readFile(path_1.default.join(__dirname, `../../test/schemaTest/${common_1.DEFAULT_TS_MANIFEST}`))).toString();
        expect((0, utils_1.extractFromTs)(manifest, {
            endpoint: constants_1.ENDPOINT_REG,
        })).toStrictEqual({
            endpoint: ['wss://acala-polkadot.api.onfinality.io/public-ws', 'wss://acala-rpc-0.aca-api.network'],
        });
    });
    it('Ensure regex correctness for ENDPOINT_REG', () => {
        expect((0, utils_1.extractFromTs)(`endpoint: 'wss://acala-polkadot.api.onfinality.io/public-ws'`, {
            endpoint: constants_1.ENDPOINT_REG,
        })).toStrictEqual({
            endpoint: ['wss://acala-polkadot.api.onfinality.io/public-ws'],
        });
        expect((0, utils_1.extractFromTs)('endpoint: `wss://acala-polkadot.api.onfinality.io/public-ws`', {
            endpoint: constants_1.ENDPOINT_REG,
        })).toStrictEqual({
            endpoint: ['wss://acala-polkadot.api.onfinality.io/public-ws'],
        });
        expect((0, utils_1.extractFromTs)('endpoint: [`wss://acala-polkadot.api.onfinality.io/public-ws`]', {
            endpoint: constants_1.ENDPOINT_REG,
        })).toStrictEqual({
            endpoint: ['wss://acala-polkadot.api.onfinality.io/public-ws'],
        });
        expect((0, utils_1.extractFromTs)("endpoint: [`wss://acala-polkadot.api.onfinality.io/public-ws`, 'wss://acala-polkadot.api.onfinality.io/public-ws']", {
            endpoint: constants_1.ENDPOINT_REG,
        })).toStrictEqual({
            endpoint: [
                'wss://acala-polkadot.api.onfinality.io/public-ws',
                'wss://acala-polkadot.api.onfinality.io/public-ws',
            ],
        });
    });
    it('findReplace using regex', async () => {
        const manifest = (await fs.promises.readFile(path_1.default.join(__dirname, `../../test/schemaTest/${common_1.DEFAULT_TS_MANIFEST}`))).toString();
        const v = (0, utils_1.findReplace)(manifest, constants_1.ENDPOINT_REG, "endpoint: ['wss://acala-polkadot.api.onfinality.io/public-ws']");
        expect((0, utils_1.extractFromTs)(v, {
            endpoint: constants_1.ENDPOINT_REG,
        })).toStrictEqual({ endpoint: ['wss://acala-polkadot.api.onfinality.io/public-ws'] });
    });
    it('findReplace with string endpoints', async () => {
        const manifest = (await fs.promises.readFile(path_1.default.join(__dirname, `../../test/schemaTest/${common_1.DEFAULT_TS_MANIFEST}`))).toString();
        const v = (0, utils_1.findReplace)(manifest, constants_1.ENDPOINT_REG, "endpoint: 'wss://acala-polkadot.api.onfinality.io/public-ws'");
        expect((0, utils_1.extractFromTs)(v, {
            endpoint: constants_1.ENDPOINT_REG,
        })).toStrictEqual({ endpoint: ['wss://acala-polkadot.api.onfinality.io/public-ws'] });
    });
    it('able to extract string endpoints', () => {
        expect((0, utils_1.extractFromTs)(`
      endpoint: 'wss://aaa'
    `, { endpoint: constants_1.ENDPOINT_REG })).toStrictEqual({ endpoint: ['wss://aaa'] });
    });
    it('Ensure prepareManifest and preparePackage correctness for project.ts', async () => {
        const project = {
            name: 'test-1',
            endpoint: ['https://zzz', 'https://bbb'],
            author: 'bz888',
            description: 'tester project',
        };
        await (0, init_controller_1.prepareManifest)(projectPath, project);
        await (0, init_controller_1.preparePackage)(projectPath, project);
        const packageData = await fs.promises.readFile(`${projectPath}/package.json`);
        const projectPackage = JSON.parse(packageData.toString());
        expect(projectPackage.name).toBe(project.name);
        expect(projectPackage.description).toBe(project.description);
        expect(projectPackage.author).toBe(project.author);
        const updatedManifest = await fs.promises.readFile(`${projectPath}/${common_1.DEFAULT_TS_MANIFEST}`);
        expect(originalManifest).not.toBe(updatedManifest.toString());
        expect(originalPackage).not.toBe(packageData.toString());
    });
    it('Validate validateEthereumTsManifest', () => {
        const passingManifest = `import {
  SubstrateDatasourceKind,
  SubstrateHandlerKind,
  SubstrateProject,
} from '@subql/types-ethereum';
  runner:{ node: '@subql/node-ethereum' }`;
        const failingManifest = `import {
  SubstrateDatasourceKind,
  SubstrateHandlerKind,
  SubstrateProject,
} from '@subql/types';
  runner:{ node: '@subql/node' }`;
        expect((0, utils_1.validateEthereumTsManifest)(passingManifest)).toBe(true);
        expect((0, utils_1.validateEthereumTsManifest)(failingManifest)).toBe(false);
    });
});
//# sourceMappingURL=init-controller.spec.js.map