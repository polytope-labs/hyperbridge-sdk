"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const rimraf_1 = require("rimraf");
const codegen_controller_1 = require("./codegen-controller");
jest.mock('fs', () => {
    const fs = jest.requireActual('fs');
    return {
        ...fs,
        promises: {
            ...fs.promises,
            mkdir: jest.fn(),
        },
    };
});
jest.mock('rimraf', () => {
    return jest.createMockFromModule('rimraf');
});
jest.setTimeout(30000);
describe('Codegen can generate schema (mocked)', () => {
    const projectPath = path_1.default.join(__dirname, '../../test/test1');
    it('throw error when make directory failed at beginning of codegen', async () => {
        rimraf_1.rimraf.mockImplementation((path, cb) => cb());
        fs_1.default.promises.mkdir.mockImplementation(async () => Promise.reject(new Error()));
        await expect((0, codegen_controller_1.codegen)(projectPath)).rejects.toThrow(/Failed to prepare/);
    });
    it('test codegen reserved key validate', () => {
        const good_name = 'exampleFilterEntity';
        const good_result = (0, codegen_controller_1.validateEntityName)(good_name);
        expect(good_result).toEqual(good_name);
        const bad_name = 'exampleEntityFilters';
        expect(() => (0, codegen_controller_1.validateEntityName)(bad_name)).toThrow('EntityName: exampleEntityFilters cannot end with reservedKey: filters');
    });
    it('throw error when processing unsupported type in json fields', () => {
        expect(() => (0, codegen_controller_1.processFields)('jsonField', 'TypeNotSupported', [
            // Ignoring to test unsupported scalar type
            {
                name: 'notSupported',
                type: 'UnsupportedScalar',
                nullable: false,
                isArray: false,
                isEnum: false,
            },
        ], [])).toThrow('Schema: undefined type "UnsupportedScalar" on field "notSupported" in "type TypeNotSupported @jsonField"');
    });
});
//# sourceMappingURL=codegen-controller.spec.js.map