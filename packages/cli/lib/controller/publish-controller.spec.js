"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@subql/common");
const common_substrate_1 = require("@subql/common-substrate");
const rimraf_1 = require("rimraf");
const createProject_fixtures_1 = require("../createProject.fixtures");
const publish_controller_1 = require("./publish-controller");
// Replace/Update your access token when test locally
const testAuth = process.env.SUBQL_ACCESS_TOKEN_TEST;
jest.setTimeout(300_000); // 300s
describe('Cli publish', () => {
    let projectDir;
    let multiChainProjectDir;
    let fullPaths;
    beforeAll(async () => {
        const res = await Promise.all([(0, createProject_fixtures_1.createTestProject)(), (0, createProject_fixtures_1.createMultiChainTestProject)()]);
        projectDir = res[0];
        multiChainProjectDir = res[1].multichainManifestPath;
        fullPaths = res[1].fullPaths;
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
    it('should upload appropriate project to IPFS', async () => {
        const cid = await (0, publish_controller_1.uploadToIpfs)([projectDir], testAuth);
        expect(cid).toBeDefined();
    });
    it('convert to deployment and removed descriptive field', async () => {
        const reader = await common_1.ReaderFactory.create(projectDir);
        const manifest = (0, common_substrate_1.parseProjectManifest)(await reader.getProjectSchema());
        const deployment = manifest.toDeployment();
        expect(deployment).not.toContain('author');
        expect(deployment).not.toContain('endpoint');
        expect(deployment).not.toContain('dictionary');
        expect(deployment).not.toContain('description');
        expect(deployment).not.toContain('repository');
        expect(deployment).toContain('chainId');
        expect(deployment).toContain('specVersion');
        expect(deployment).toContain('dataSources');
    });
    it('convert js object to JSON object', () => {
        const mockMap = new Map([
            [1, 'aaa'],
            ['2', 'bbb'],
        ]);
        expect((0, common_1.toJsonObject)({ map: mockMap, obj: { abc: 111 } })).toStrictEqual({
            map: { '1': 'aaa', '2': 'bbb' },
            obj: { abc: 111 },
        });
        expect((0, common_1.mapToObject)(mockMap)).toStrictEqual({ '1': 'aaa', '2': 'bbb' });
    });
    it('Get directory CID from multi-chain project', async () => {
        const cidMap = await (0, publish_controller_1.uploadToIpfs)(fullPaths, testAuth, multiChainProjectDir);
        const directoryCid = (0, publish_controller_1.getDirectoryCid)(cidMap);
        expect(directoryCid).toBeDefined();
    });
});
//# sourceMappingURL=publish-controller.spec.js.map