"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const rimraf_1 = require("rimraf");
const createProject_fixtures_1 = require("../createProject.fixtures");
const publish_1 = tslib_1.__importDefault(require("./publish"));
jest.setTimeout(300_000); // 300s
describe('Integration test - Publish', () => {
    let projectDir;
    beforeAll(async () => {
        projectDir = await (0, createProject_fixtures_1.createTestProject)();
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
    it('overwrites any exisiting CID files', async () => {
        const initCID = 'QmWLxg7xV7ZWUyc7ZxZ8XuQQ7NmH8WQGXzg7VZ3QQNqF-testing';
        const cidFilePath = path_1.default.resolve(projectDir, '.project-cid');
        await fs_1.default.promises.writeFile(cidFilePath, initCID);
        await publish_1.default.run(['-f', projectDir, '-o']);
        const cidValue = await fs_1.default.promises.readFile(cidFilePath, 'utf8');
        expect(initCID).not.toEqual(cidValue);
    });
    it('create ipfsCID file stored in local with dictiory path', async () => {
        await publish_1.default.run(['-f', projectDir]);
        const cidFile = path_1.default.resolve(projectDir, '.project-cid');
        const fileExists = fs_1.default.existsSync(cidFile);
        const IPFScontent = await fs_1.default.promises.readFile(cidFile, 'utf8');
        expect(IPFScontent).toBeDefined();
        expect(fileExists).toBeTruthy();
    });
    // Run this last because it modifies the project
    it('file name consistent with manifest file name, if -f <manifest path> is used', async () => {
        const manifestPath = path_1.default.resolve(projectDir, 'project.yaml');
        const testManifestPath = path_1.default.resolve(projectDir, 'test.yaml');
        fs_1.default.renameSync(manifestPath, testManifestPath);
        await publish_1.default.run(['-f', testManifestPath]);
        const cidFile = path_1.default.resolve(projectDir, '.test-cid');
        const fileExists = await fs_1.default.promises.stat(cidFile);
        expect(fileExists.isFile()).toBeTruthy();
    });
});
//# sourceMappingURL=publish.test.js.map