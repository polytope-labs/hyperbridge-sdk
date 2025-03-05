"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const rimraf_1 = require("rimraf");
const constants_1 = require("../constants");
const migrate_1 = tslib_1.__importDefault(require("./migrate"));
jest.setTimeout(300_000); // 300s
describe('Integration test - Migrate', () => {
    let projectDir;
    beforeAll(async () => {
        projectDir = await (0, common_1.makeTempDir)();
    });
    afterAll(async () => {
        try {
            if (!projectDir)
                return;
            await (0, rimraf_1.rimraf)(projectDir);
        }
        catch (e) {
            console.warn('Failed to clean up tmp dir after test', e);
        }
    });
    it('could migrate a subgraph project from remote source', async () => {
        const graphProjectGit = 'https://github.com/graphprotocol/graph-tooling/tree/main/';
        const graphProjectSubDir = 'examples/ethereum-gravatar';
        await migrate_1.default.run(['-f', graphProjectGit, '-d', graphProjectSubDir, '-o', projectDir]);
        const subqlManifest = await fs_1.default.promises.readFile(path_1.default.join(projectDir, constants_1.DEFAULT_SUBQL_MANIFEST), 'utf8');
        expect(subqlManifest).toContain(`const project: EthereumProject`);
        expect(subqlManifest).toContain(`name: "example-ethereum-gravatar"`);
        expect(subqlManifest).toContain(`handler: "handleUpdatedGravatar"`);
    });
});
//# sourceMappingURL=migrate.test.js.map