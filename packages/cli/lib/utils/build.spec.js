"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const path_1 = tslib_1.__importDefault(require("path"));
const yaml = tslib_1.__importStar(require("js-yaml"));
const rimraf_1 = require("rimraf");
const build_1 = require("./build");
describe('Manifest generation', () => {
    afterEach(() => {
        const projectPath = path_1.default.join(__dirname, '../../test/tsManifestTest');
        rimraf_1.rimraf.sync(path_1.default.join(projectPath, 'project1.yaml'));
        rimraf_1.rimraf.sync(path_1.default.join(projectPath, 'subquery-multichain2.yaml'));
        rimraf_1.rimraf.sync(path_1.default.join(projectPath, 'project2.yaml'));
        rimraf_1.rimraf.sync(path_1.default.join(projectPath, 'subquery-multichain.yaml'));
        rimraf_1.rimraf.sync(path_1.default.join(projectPath, 'subquery-multichain3.yaml'));
    });
    it('should build ts manifest from multichain file', async () => {
        const projectPath = path_1.default.join(__dirname, '../../test/tsManifestTest/subquery-multichain.ts');
        await expect((0, build_1.buildManifestFromLocation)(projectPath, console.log.bind(console))).resolves.toBeDefined();
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../project1.yaml'))).toBe(true);
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../project2.yaml'))).toBe(true);
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../subquery-multichain.yaml'))).toBe(true);
        //ts files are replaced with yaml files
        const multichainContent = yaml.load((0, fs_1.readFileSync)(path_1.default.join(projectPath, '../subquery-multichain.yaml'), 'utf8'));
        multichainContent.projects.forEach((project) => project.endsWith('.yaml'));
    }, 50000);
    it('throws error on unknown file in multichain manifest', async () => {
        const projectPath = path_1.default.join(__dirname, '../../test/tsManifestTest/subquery-multichain2.ts');
        await expect((0, build_1.buildManifestFromLocation)(projectPath, console.log.bind(console))).rejects.toThrow();
    }, 50000);
    it('allows both ts and yaml file in multichain manifest', async () => {
        const projectPath = path_1.default.join(__dirname, '../../test/tsManifestTest/subquery-multichain3.ts');
        await expect((0, build_1.buildManifestFromLocation)(projectPath, console.log.bind(console))).resolves.toBeDefined();
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../project1.yaml'))).toBe(true);
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../project3.yaml'))).toBe(true);
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../subquery-multichain3.yaml'))).toBe(true);
        //ts files are replaced with yaml files
        const multichainContent = yaml.load((0, fs_1.readFileSync)(path_1.default.join(projectPath, '../subquery-multichain3.yaml'), 'utf8'));
        multichainContent.projects.forEach((project) => project.endsWith('.yaml'));
    }, 50000);
    it('should build ts manifest from yaml multichain file', async () => {
        const projectPath = path_1.default.join(__dirname, '../../test/tsManifestTest/subquery-multichain4.yaml');
        await expect((0, build_1.buildManifestFromLocation)(projectPath, console.log.bind(console))).resolves.toBeDefined();
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../project1.yaml'))).toBe(true);
        expect((0, fs_1.existsSync)(path_1.default.join(projectPath, '../project2.yaml'))).toBe(true);
        //ts files are replaced with yaml files
        const multichainContent = yaml.load((0, fs_1.readFileSync)(path_1.default.join(projectPath, '../subquery-multichain4.yaml'), 'utf8'));
        multichainContent.projects.forEach((project) => expect(project.endsWith('.yaml')).toBe(true));
        //revert yaml to ts
        multichainContent.projects = multichainContent.projects.map((project) => project.replace('.yaml', '.ts'));
        (0, fs_1.writeFileSync)(path_1.default.join(projectPath, '../subquery-multichain4.yaml'), yaml.dump(multichainContent));
    }, 50000);
});
//# sourceMappingURL=build.spec.js.map