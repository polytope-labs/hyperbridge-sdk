"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const build_controller_1 = require("./build-controller");
describe('build controller', () => {
    it('picks up test and export files', () => {
        const dir = path_1.default.resolve(__dirname, '../../test/build');
        const entries = (0, build_controller_1.getBuildEntries)(dir);
        expect(entries['test/mappingHandler.test']).toEqual(path_1.default.resolve(dir, './src/test/mappingHandler.test.ts'));
        expect(entries.chaintypes).toEqual(path_1.default.resolve(dir, './src/chainTypes.ts'));
    });
});
//# sourceMappingURL=build-controller.spec.js.map