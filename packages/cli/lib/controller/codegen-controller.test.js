"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const rimraf_1 = require("rimraf");
const codegen_controller_1 = require("./codegen-controller");
jest.setTimeout(30000);
const projectPath = path_1.default.join(__dirname, '../../test/schemaTest');
describe('Codegen can generate schema', () => {
    afterEach(async () => {
        await (0, rimraf_1.rimraf)(path_1.default.join(__dirname, '../../test/schemaTest/src'));
    });
    it('codegen with correct schema should pass', async () => {
        await expect((0, codegen_controller_1.codegen)(projectPath)).resolves.not.toThrow();
    });
    it('codegen with incorrect schema field should fail', async () => {
        await expect((0, codegen_controller_1.codegen)(projectPath, ['project-bad-schema.yaml'])).rejects.toThrow(/is not a valid type/);
    });
    it('codegen with entities that uses reserved names should throw', async () => {
        await expect((0, codegen_controller_1.codegen)(projectPath, ['project-bad-entity.yaml'])).rejects.toThrow('EntityName: exampleEntityFilter cannot end with reservedKey: filter');
    });
    it('Codegen should be able to generate ABIs from template datasources', async () => {
        await (0, codegen_controller_1.codegen)(projectPath, ['project-templates-abi.yaml']);
        await expect(fs_1.default.promises.readFile(`${projectPath}/src/types/abi-interfaces/Erc721.ts`, 'utf8')).resolves.toBeTruthy();
    });
    it('Should not fail, if ds does not have any assets', async () => {
        await expect((0, codegen_controller_1.codegen)(projectPath, ['project-no-assets.yaml'])).resolves.not.toThrow();
    });
    it('Codegen should be able to generate ABIs from customName datasources', async () => {
        await (0, codegen_controller_1.codegen)(projectPath);
        await expect(fs_1.default.promises.readFile(`${projectPath}/src/types/abi-interfaces/Erc721.ts`, 'utf8')).resolves.toBeTruthy();
    });
    it('Should clean out existing types directory', async () => {
        await (0, codegen_controller_1.codegen)(projectPath);
        await (0, codegen_controller_1.codegen)(projectPath, ['project-no-abi.yaml']);
        // should not contain abi directory
        await expect(fs_1.default.promises.readFile(`${projectPath}/src/types/abi-interfaces/erc721.ts`, 'utf8')).rejects.toThrow();
    });
    it('should generate contracts on different glob paths', async () => {
        await (0, codegen_controller_1.codegen)(projectPath, ['typechain-test.yaml']);
        await expect(fs_1.default.promises.readFile(`${projectPath}/src/types/abi-interfaces/Erc721.ts`, 'utf8')).resolves.toBeTruthy();
        await expect(fs_1.default.promises.readFile(`${projectPath}/src/types/abi-interfaces/Artifact.ts`, 'utf8')).resolves.toBeTruthy();
        await expect(fs_1.default.promises.readFile(`${projectPath}/src/types/contracts/Erc721.ts`, 'utf8')).resolves.toBeTruthy();
        await expect(fs_1.default.promises.readFile(`${projectPath}/src/types/abi-interfaces/Artifact.ts`, 'utf8')).resolves.toBeTruthy();
    });
    it('Should not generate ABI for non evm ds', async () => {
        await (0, codegen_controller_1.codegen)(projectPath, ['non-evm-project.yaml']);
        expect(fs_1.default.existsSync(`${projectPath}/src/types/abi-interfaces/`)).toBeFalsy();
    });
    it('Should not generate proto-interfaces if no chaintypes are provided', async () => {
        await (0, codegen_controller_1.codegen)(projectPath, ['project-cosmos.yaml']);
        expect(fs_1.default.existsSync(`${projectPath}/src/types/proto-interfaces/`)).toBeFalsy();
    });
    it('Should dedupe enums', async () => {
        await (0, codegen_controller_1.codegen)(projectPath, ['project-duplicate-enum.yaml']);
        const fooFile = await fs_1.default.promises.readFile(`${projectPath}/src/types/models/Foo.ts`, 'utf8');
        expect(fooFile).toContain(`import {
    Bar,
} from '../enums';`);
    });
    // github issue #2211
    it('codegen file should import model files with correct case-sensitive names', async () => {
        await (0, codegen_controller_1.codegen)(projectPath, ['project-case-sensitive-import-entity.yaml']);
        const codegenFile = await fs_1.default.promises.readFile(`${projectPath}/src/types/models/index.ts`, 'utf8');
        expect(codegenFile).toContain(`export {ExampleField} from "./ExampleField"`);
    });
    it('correctly generates relations with different dbTypes', async () => {
        const projectPath = path_1.default.join(__dirname, '../../test/schemaTest');
        await (0, codegen_controller_1.codegen)(projectPath, ['project-id-type.yaml']);
        const blockEntity = await fs_1.default.promises.readFile(`${projectPath}/src/types/models/Block.ts`, 'utf8');
        expect(blockEntity).toContain('        metaId: bigint,');
        expect(blockEntity).toContain('public metaId: bigint;');
        expect(blockEntity).toContain('static async getByMetaId(metaId: bigint, options: GetOptions<CompatBlockProps>): Promise<Block[]> {');
    });
});
//# sourceMappingURL=codegen-controller.test.js.map