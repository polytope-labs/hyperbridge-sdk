"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const fs_extra_1 = require("fs-extra");
const rimraf_1 = require("rimraf");
const simple_git_1 = tslib_1.__importDefault(require("simple-git"));
const yaml_1 = require("yaml");
const types_1 = require("../types");
const init_controller_1 = require("./init-controller");
async function testYAML(projectPath, project) {
    const yamlPath = path_1.default.join(`${projectPath}`, `project.yaml`);
    const manifest = await fs.promises.readFile(yamlPath, 'utf8');
    const data = (0, yaml_1.parseDocument)(manifest);
    const clonedData = data.clone();
    clonedData.set('description', project.description ?? data.get('description'));
    // network type should be collection
    const network = clonedData.get('network');
    network.set('endpoint', 'http://def not real endpoint');
    clonedData.set('version', 'not real version');
    clonedData.set('name', 'not real name');
    if ((0, types_1.isProjectSpecV1_0_0)(project)) {
        network.set('chainId', 'random chainId');
    }
    else if ((0, types_1.isProjectSpecV0_2_0)(project)) {
        network.set('genesisHash', 'random genesisHash');
    }
    return {
        old: data,
        new: clonedData,
    };
}
// async
const fileExists = async (file) => {
    return new Promise((resolve, reject) => {
        fs.access(file, fs.constants.F_OK, (err) => {
            err ? reject(err) : resolve(true);
        });
    });
};
jest.setTimeout(30000);
const projectSpec = {
    name: 'mocked_starter',
    endpoint: ['wss://rpc.polkadot.io/public-ws'],
    specVersion: '1.0.0',
    author: 'jay',
    description: 'this is test for init controller',
    chainId: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
};
describe('Cli can create project', () => {
    it('should resolve when starter project created via template', async () => {
        const tempPath = await (0, common_1.makeTempDir)();
        const projects = await (0, init_controller_1.fetchExampleProjects)('polkadot', 'acala');
        const projectPath = await (0, init_controller_1.cloneProjectTemplate)(tempPath, projectSpec.name, projects[0]);
        await (0, init_controller_1.prepare)(projectPath, projectSpec);
        await expect(fileExists(path_1.default.join(tempPath, `${projectSpec.name}`))).resolves.toEqual(true);
    });
    it('should resolve when starter project created via git', async () => {
        const tempPath = await (0, common_1.makeTempDir)();
        const projectPath = await (0, init_controller_1.cloneProjectGit)(tempPath, projectSpec.name, 'https://github.com/subquery/subql-starter', 'v1.0.0');
        await (0, init_controller_1.prepare)(projectPath, projectSpec);
        await expect(fileExists(path_1.default.join(tempPath, `${projectSpec.name}`))).resolves.toEqual(true);
    });
    it('throw error if .git exists in starter project', async () => {
        const tempPath = await (0, common_1.makeTempDir)();
        const projects = await (0, init_controller_1.fetchExampleProjects)('polkadot', 'polkadot');
        const projectPath = await (0, init_controller_1.cloneProjectTemplate)(tempPath, projectSpec.name, projects[0]);
        await (0, init_controller_1.prepare)(projectPath, projectSpec);
        await expect(fileExists(path_1.default.join(tempPath, `${projectSpec.name}/.git`))).rejects.toThrow();
    });
    it('YAML contains comments', async () => {
        const localPath = await (0, common_1.makeTempDir)();
        const tempPath = await (0, common_1.makeTempDir)();
        // to pull from a commit that still uses project.yaml
        const projects = await (0, init_controller_1.fetchExampleProjects)('polkadot', 'polkadot');
        const projectPath = path_1.default.join(localPath, projectSpec.name);
        await (0, simple_git_1.default)(tempPath).init().addRemote('origin', projects[0].remote);
        await (0, simple_git_1.default)(tempPath).raw('sparse-checkout', 'set', `${projects[0].path}`);
        await (0, simple_git_1.default)(tempPath).raw('pull', 'origin', 'd2868e9e46371f0ce45e52acae2ace6cb97296a0');
        (0, fs_extra_1.copySync)(path_1.default.join(tempPath, `${projects[0].path}`), projectPath);
        fs.rmSync(tempPath, { recursive: true, force: true });
        const output = await testYAML(path_1.default.join(localPath, projectSpec.name), projectSpec);
        expect(output.new.toJS().network.chainId).toBe('random chainId');
        expect(output.new).not.toEqual(output.old);
        expect(output.new.toString()).toContain('# The genesis hash of the network (hash of block 0)');
        await (0, rimraf_1.rimraf)(localPath);
    });
    it('prepare correctly applies project details', async () => {
        const tempPath = await (0, common_1.makeTempDir)();
        const projects = await (0, init_controller_1.fetchExampleProjects)('polkadot', 'polkadot');
        const project = projects.find((p) => p.name === 'Polkadot-starter');
        const projectPath = await (0, init_controller_1.cloneProjectTemplate)(tempPath, projectSpec.name, project);
        await (0, init_controller_1.prepare)(projectPath, projectSpec);
        const { author, description } = await (0, init_controller_1.readDefaults)(projectPath);
        //spec version is  not returned from readDefaults
        //expect(projectSpec.specVersion).toEqual(specVersion);
        expect(projectSpec.author).toEqual(author);
        expect(projectSpec.description).toEqual(description);
        await (0, rimraf_1.rimraf)(tempPath);
    });
    it('allow git from sub directory', async () => {
        const tempPath = await (0, common_1.makeTempDir)();
        const template = {
            name: 'Polkadot-starter',
            description: '',
            remote: 'https://github.com/subquery/subql-starter',
            path: 'Polkadot/Polkadot-starter',
        };
        const projectPath = await (0, init_controller_1.cloneProjectTemplate)(tempPath, projectSpec.name, template);
        await (0, init_controller_1.prepare)(projectPath, projectSpec);
        await expect(fileExists(path_1.default.join(tempPath, `${projectSpec.name}`))).resolves.toEqual(true);
    }, 5000000);
});
//# sourceMappingURL=init-controller.test.js.map