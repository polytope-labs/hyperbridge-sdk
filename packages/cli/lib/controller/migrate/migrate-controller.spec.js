"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const migrate_controller_1 = require("./migrate-controller");
const migrate_fixtures_1 = require("./migrate.fixtures");
const testProjectPath = '../../../test/migrate/testProject';
describe('Migrate controller', () => {
    it('should able to extract git info from given link', () => {
        // git ssh should be same link
        expect((0, migrate_controller_1.extractGitInfo)('git@github.com:subquery/poap-benchmark.git')).toStrictEqual({
            link: 'git@github.com:subquery/poap-benchmark.git',
            branch: undefined,
        });
        // git link can extract git link, if branch is not provide should be undefined, so it can use default branch
        expect((0, migrate_controller_1.extractGitInfo)('https://github.com/subquery/poap-benchmark')).toStrictEqual({
            link: 'https://github.com/subquery/poap-benchmark',
            branch: undefined,
        });
        // can extract git branch
        expect((0, migrate_controller_1.extractGitInfo)('https://github.com/subquery/poap-benchmark/tree/test-branch')).toStrictEqual({
            link: 'https://github.com/subquery/poap-benchmark',
            branch: 'test-branch',
        });
        // bitbucket ssh
        expect((0, migrate_controller_1.extractGitInfo)('git@bitbucket.org:subquery/poap-benchmark.git')).toStrictEqual({
            link: 'git@bitbucket.org:subquery/poap-benchmark.git',
            branch: undefined,
        });
        // bitbucket link
        expect((0, migrate_controller_1.extractGitInfo)('https://bitbucket.org/subquery/poap-benchmark/')).toStrictEqual({
            link: 'https://bitbucket.org/subquery/poap-benchmark',
            branch: undefined,
        });
        // can extract bitbucket branch
        expect((0, migrate_controller_1.extractGitInfo)('https://bitbucket.org/subquery/poap-benchmark/src/test-branch')).toStrictEqual({
            link: 'https://bitbucket.org/subquery/poap-benchmark',
            branch: 'test-branch',
        });
        // should return result if user provide is a git subdirectory
        expect((0, migrate_controller_1.extractGitInfo)('https://github.com/gprotocol/g-tooling/tree/main/examples/ethereum-gravatar')).toStrictEqual({
            link: 'https://github.com/gprotocol/g-tooling',
            branch: 'main',
        });
        // IF not valid, should return undefined
        expect((0, migrate_controller_1.extractGitInfo)('https://google.com')).toBe(undefined);
    });
    it('should get chain id, getChainIdByNetworkName', () => {
        expect((0, migrate_controller_1.getChainIdByNetworkName)(common_1.NETWORK_FAMILY.ethereum, 'mainnet')).toBe('1');
        expect(() => (0, migrate_controller_1.getChainIdByNetworkName)(common_1.NETWORK_FAMILY.ethereum, 'newnetwork')).toThrow();
        // not support yet
        expect(() => (0, migrate_controller_1.getChainIdByNetworkName)(common_1.NETWORK_FAMILY.algorand, 'algorand')).toThrow();
    });
    it('prepareProject', async () => {
        const subqlDir = await (0, common_1.makeTempDir)();
        await (0, migrate_controller_1.prepareProject)({ chainId: '1', networkFamily: common_1.NETWORK_FAMILY.ethereum }, subqlDir);
        expect(fs_1.default.existsSync(path_1.default.join(subqlDir, 'project.ts'))).toBeTruthy();
        fs_1.default.rmSync(subqlDir, { recursive: true, force: true });
        const subqlDir2 = await (0, common_1.makeTempDir)();
        await expect((0, migrate_controller_1.prepareProject)({ chainId: '2', networkFamily: common_1.NETWORK_FAMILY.ethereum }, subqlDir2)).rejects.toThrow();
        fs_1.default.rmSync(subqlDir2, { recursive: true, force: true });
    }, 100000);
    it('improveProjectInfo', () => {
        const testSubgraph = migrate_fixtures_1.TestSubgraph;
        expect(migrate_fixtures_1.TestSubgraph.name).toBeUndefined();
        (0, migrate_controller_1.improveProjectInfo)(path_1.default.join(__dirname, testProjectPath), testSubgraph);
        expect(migrate_fixtures_1.TestSubgraph.name).toBe('poap-mainnet-subquery');
        expect(migrate_fixtures_1.TestSubgraph.repository).toBe('');
    });
});
//# sourceMappingURL=migrate-controller.spec.js.map